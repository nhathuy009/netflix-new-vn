// Stremio catalog addon: "Mới trên Netflix" (about.netflix.com/vi/new-to-watch)
// Chỉ tạo danh sách (catalog). Không cung cấp nguồn phát.

const NETFLIX = 'https://about.netflix.com';
const PAGE_URL = `${NETFLIX}/vi/new-to-watch`;
const API_URL = `${NETFLIX}/api/data/releases`; // API trang gọi khi chuyển trang
const LANG = 'vi';
const COUNTRY = 'VN';
const TMDB = 'https://api.themoviedb.org/3';
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 giờ
const MAX_PAGES = 10;

// Mã "collection" lấy từ JS của trang Netflix
const COLLECTION = { SERIES: 2170013, FILM: 2694103, SPECIALS: 2173907, GAMES: 81500273 };

const manifest = {
  id: 'community.netflix.newtowatch.vi',
  version: '1.3.0',
  name: 'Mới trên Netflix (VN)',
  description: 'Danh sách phim và loạt phim mới lên Netflix Việt Nam, lấy từ about.netflix.com/vi/new-to-watch',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie', id: 'netflix-new-movie', name: 'Netflix: Phim mới' },
    { type: 'series', id: 'netflix-new-series', name: 'Netflix: Loạt phim mới' },
  ],
};

// ---------- Lấy dữ liệu Netflix ----------

const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/html', 'Accept-Language': LANG, Referer: PAGE_URL };

async function fetchApiPage(page, language = LANG) {
  const url = `${API_URL}?language=${language}&country=${COUNTRY}&page=${page}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Netflix API ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j.data)) throw new Error('Netflix API trả dữ liệu lạ');
  return j;
}

// Dữ liệu trang 1 nằm sẵn trong <script id="__NEXT_DATA__">
function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Không thấy __NEXT_DATA__ trong trang Netflix');
  const data = JSON.parse(m[1])?.props?.pageProps?.data;
  if (!data || !Array.isArray(data.data)) throw new Error('__NEXT_DATA__ không có danh sách phim');
  return data;
}

async function fetchReleases() {
  try {
    const first = await fetchApiPage(1);
    const pages = Math.min(first.totalPages || 1, MAX_PAGES);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchApiPage(i + 2)));
    return { source: 'api', totalItems: first.totalItems, rows: [first, ...rest].flatMap((p) => p.data) };
  } catch (apiErr) {
    const r = await fetch(PAGE_URL, { headers: UA });
    if (!r.ok) throw new Error(`Netflix ${r.status} (API: ${apiErr.message})`);
    const d = parseNextData(await r.text());
    return { source: `html (API lỗi: ${apiErr.message})`, totalItems: d.totalItems, rows: d.data };
  }
}

// Tên tiếng Anh theo videoID, dùng khi tên tiếng Việt không có trên TMDB. Lỗi thì bỏ qua.
async function fetchEnglishTitles() {
  try {
    const first = await fetchApiPage(1, 'en');
    const pages = Math.min(first.totalPages || 1, MAX_PAGES);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchApiPage(i + 2, 'en')));
    return new Map([first, ...rest].flatMap((p) => p.data).map((r) => [r.videoID, nfc(r.title1)]));
  } catch {
    return new Map();
  }
}

// Đoán loại từ dữ liệu Netflix; null = chưa biết, để TMDB quyết định
function netflixType(row) {
  if (row.collection === COLLECTION.SERIES) return 'tv';
  if (row.collection === COLLECTION.FILM) return 'movie';
  if (/^(Mùa|Phần|Chương|Tập)\s|Loạt phim/i.test(nfc(row.title2) || '')) return 'tv';
  return null;
}

// Netflix trả một số tên ở dạng Unicode tách dấu (NFD); đưa về NFC để so khớp và tìm TMDB đúng
const nfc = (s) => (typeof s === 'string' ? s.normalize('NFC') : s);

function toItem(row) {
  const title = nfc(row.title1);
  const subtitle = nfc(row.title2);
  return {
    netflixId: row.videoID,
    title,
    subtitle: subtitle !== title ? subtitle : undefined,
    startTime: row.startTime,
    image: row.image,
    hint: netflixType(row),
  };
}

// ---------- Trang phim Netflix: loại, đạo diễn, diễn viên, mô tả ----------

const titleUrl = (id) => `https://www.netflix.com/vn/title/${id}`;

// Cắt khối JSON {...} ngay sau `key` bằng cách đếm ngoặc (bỏ qua ngoặc nằm trong chuỗi)
function extractObject(text, key) {
  const k = text.indexOf(key);
  if (k < 0) return null;
  const start = text.indexOf('{', k + key.length);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// Dữ liệu phim nằm trong netflix.reactContext.models.nmTitleGQL, viết bằng JS nên có \xNN cần đổi sang \u00NN
function parseNetflixTitle(html) {
  const raw = extractObject(html, '"nmTitleGQL":');
  if (!raw) return null;
  const d = JSON.parse(raw.replace(/(?<!\\)((?:\\\\)*)\\x([0-9a-fA-F]{2})/g, '$1\\u00$2'))?.data;
  if (!d?.metaData) return null;
  const names = (list) => (list || []).map((p) => nfc(p.name)).filter(Boolean);
  const t = d.metaData.type || '';
  return {
    type: /movie/i.test(t) ? 'movie' : /show|series/i.test(t) || d.metaData.seasonCount ? 'tv' : null,
    synopsis: nfc(d.copy?.synopsis) || undefined,
    genres: names(d.genreInfo?.coreGenre?.name),
    directors: names(d.persons?.directors),
    creators: names(d.persons?.creators),
    cast: names(d.persons?.actors),
    isOriginal: !!d.metaData.isOriginal,
    background: d.artwork?.heroImage?.url,
  };
}

// Lỗi hoặc bị chặn thì trả null: addon vẫn chạy với dữ liệu từ trang danh sách
async function fetchNetflixTitle(id) {
  try {
    const r = await fetch(titleUrl(id), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html', 'Accept-Language': LANG } });
    if (!r.ok) return null;
    return parseNetflixTitle(await r.text());
  } catch {
    return null;
  }
}

// Chạy fn cho từng phần tử, mỗi lần 10 cái song song
async function mapInBatches(items, fn, size = 10) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// ---------- TMDB ----------

async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('Thiếu biến môi trường TMDB_API_KEY');
  const url = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = {};
  // Hỗ trợ cả API key v3 (ngắn) và Read Access Token v4 (JWT dài)
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

const PER_QUERY = 5;  // số kết quả TMDB lấy mỗi lần tìm
const MAX_CHECK = 3;  // số ứng viên tốt nhất được kiểm tra IMDb ID
const DAY = 24 * 3600 * 1000;

async function searchTmdb(title, hint) {
  const q = { query: title, language: 'vi-VN', include_adult: 'false' };
  if (hint) {
    const res = await tmdb(`/search/${hint}`, q);
    const list = (res.results || []).slice(0, PER_QUERY).map((x) => ({ ...x, media_type: hint }));
    if (list.length) return list;
  }
  const res = await tmdb('/search/multi', q);
  return (res.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').slice(0, PER_QUERY);
}

const norm = (s) => nfc(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// "Mùa 2", "Phần 4", "Chương 2"...: loạt phim đã ra từ trước, ngày TMDB là ngày của mùa đầu
function isLaterSeason(item) {
  const m = (item.subtitle || '').match(/(?:Mùa|Phần|Chương|Season)\s*(\d+)/i);
  return !!m && Number(m[1]) >= 2;
}

// Chấm điểm ứng viên TMDB dựa trên thông tin Netflix
function scoreCandidate(c, item) {
  let s = 0;
  if (item.hint && c.media_type === item.hint) s += 3; // đúng loại Netflix ghi
  const names = [c.title, c.name, c.original_title, c.original_name].filter(Boolean).map(norm);
  if ([item.title, item.enTitle].filter(Boolean).some((t) => names.includes(norm(t)))) s += 2; // trùng tên
  const d = Date.parse(c.release_date || c.first_air_date || '');
  if (!Number.isNaN(d) && item.startTime) {
    if (d > item.startTime + 60 * DAY) return -Infinity; // ra mắt sau ngày lên Netflix: không thể là phim này
    else if (!isLaterSeason(item) && Math.abs(d - item.startTime) <= 45 * DAY) s += 4; // ra mắt cùng đợt với Netflix
  }
  return s;
}

// Gom ứng viên từ tên Việt và tên Anh, xếp theo điểm (bằng điểm thì giữ thứ tự TMDB)
async function findCandidates(item) {
  const queries = [item.title, item.enTitle].filter((t, i, a) => t && a.indexOf(t) === i);
  const seen = new Set();
  const list = [];
  for (const q of queries) {
    for (const c of await searchTmdb(q, item.hint)) {
      const key = `${c.media_type}/${c.id}`;
      if (!seen.has(key)) { seen.add(key); list.push({ ...c, score: scoreCandidate(c, item) }); }
    }
  }
  return list.filter((c) => c.score !== -Infinity).sort((a, b) => b.score - a.score);
}

function vnDate(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
}

// Liên kết bấm được trong Stremio (thể loại, đạo diễn, diễn viên) → mở trang tìm kiếm
function links(category, names) {
  return (names || []).map((name) => ({ name, category, url: `stremio:///search?search=${encodeURIComponent(name)}` }));
}

// details: dữ liệu TMDB của tựa (có thể null nếu TMDB không có, khi đó dùng ảnh Netflix)
// item.nf: dữ liệu từ trang phim Netflix (có thể null)
function withMeta(item, { imdb, mediaType, details, via }) {
  const nf = item.nf;
  // Mô tả tiếng Việt của Netflix luôn có và đúng phim; TMDB thường thiếu bản tiếng Việt
  const desc = [item.subtitle, nf?.synopsis || details?.overview].filter(Boolean).join(' — ');
  return {
    ...item,
    via,
    tmdb: details?.id ? `${mediaType}/${details.id}` : undefined,
    meta: {
      id: imdb,
      type: mediaType === 'tv' ? 'series' : 'movie',
      name: item.title,
      poster: details?.poster_path ? `https://image.tmdb.org/t/p/w342${details.poster_path}` : item.image,
      background: details?.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : nf?.background || item.image,
      description: desc || undefined,
      releaseInfo: `Lên Netflix ${vnDate(item.startTime)}${nf?.isOriginal ? ' · Netflix Original' : ''}`,
      links: nf
        ? [...links('Genres', nf.genres), ...links('Directors', nf.directors.length ? nf.directors : nf.creators), ...links('Cast', nf.cast.slice(0, 5))]
        : undefined,
    },
  };
}

// Có IMDb ID chính xác từ Wikidata: chỉ cần TMDB để lấy poster và mô tả
async function resolveFromWikidata(item, w) {
  let mediaType = w.tmdbTv ? 'tv' : w.tmdbMovie ? 'movie' : null;
  let details = null;
  if (mediaType) {
    details = await tmdb(`/${mediaType}/${w.tmdbTv || w.tmdbMovie}`, { language: 'vi-VN' }).catch(() => null);
  } else {
    const f = await tmdb(`/find/${w.imdb}`, { external_source: 'imdb_id', language: 'vi-VN' }).catch(() => null);
    if (f?.movie_results?.[0]) { mediaType = 'movie'; details = f.movie_results[0]; }
    else if (f?.tv_results?.[0]) { mediaType = 'tv'; details = f.tv_results[0]; }
  }
  mediaType = mediaType || (w.isSeries ? 'tv' : null) || item.hint || 'movie';
  return withMeta(item, { imdb: w.imdb, mediaType, details, via: 'wikidata' });
}

// So đạo diễn / người tạo và diễn viên từ trang Netflix với danh sách của ứng viên TMDB
function peopleScore(details, nf) {
  if (!nf) return 0;
  const credits = details.aggregate_credits || details.credits || {};
  const cast = new Set((credits.cast || []).map((p) => norm(p.name)));
  const crew = new Set([
    ...(credits.crew || [])
      .filter((p) => p.job === 'Director' || (p.jobs || []).some((j) => j.job === 'Director'))
      .map((p) => norm(p.name)),
    ...(details.created_by || []).map((p) => norm(p.name)),
  ]);
  let s = 0;
  const directorMatch = [...nf.directors, ...nf.creators].some((n) => crew.has(norm(n)));
  if (directorMatch) s += 6;
  const overlap = nf.cast.filter((n) => cast.has(norm(n))).length;
  if (overlap >= 2) s += 6;
  else if (overlap === 1) s += 2;
  // Cả hai bên đều có danh sách diễn viên mà không trùng ai: gần như chắc chắn là phim khác
  else if (!directorMatch && nf.cast.length >= 3 && cast.size >= 3) s -= 4;
  return s;
}

// Không có trên Wikidata: tìm theo tên, chấm điểm, rồi đối chiếu đạo diễn/diễn viên với các ứng viên tốt nhất
async function resolveBySearch(item) {
  const candidates = await findCandidates(item);
  if (!candidates.length) return { ...item, error: 'không tìm thấy trên TMDB' };
  const checked = [];
  for (const c of candidates.slice(0, MAX_CHECK)) {
    const extra = c.media_type === 'tv' ? 'external_ids,aggregate_credits' : 'external_ids,credits';
    const details = await tmdb(`/${c.media_type}/${c.id}`, { language: 'vi-VN', append_to_response: extra });
    const people = peopleScore(details, item.nf);
    checked.push({ c, details, imdb: details.external_ids?.imdb_id, total: c.score + people, people });
  }
  const tried = checked.map((x) =>
    `${x.c.media_type}/${x.c.id} (${(x.c.release_date || x.c.first_air_date || '?').slice(0, 4)}, điểm ${x.c.score}${x.people >= 0 ? '+' : ''}${x.people}${x.imdb ? '' : ', không có IMDb'})`);
  // Điểm cao nhất trong số ứng viên có IMDb ID; bằng điểm thì giữ thứ tự cũ
  const best = checked.filter((x) => x.imdb).sort((a, b) => b.total - a.total)[0];
  if (!best) return { ...item, error: `không ứng viên nào có IMDb ID: ${tried.join('; ')}` };
  return { ...withMeta(item, { imdb: best.imdb, mediaType: best.c.media_type, details: best.details, via: 'search' }), tried };
}

function resolve(item, wikidata) {
  const w = wikidata.get(String(item.netflixId));
  return w ? resolveFromWikidata(item, w) : resolveBySearch(item);
}

// Gọi TMDB theo lô 10 để không vượt giới hạn tốc độ
function resolveAll(items, wikidata) {
  return mapInBatches(items, (it) => resolve(it, wikidata).catch((e) => ({ ...it, error: e.message })));
}

// ---------- Wikidata: Netflix ID (P1874) → IMDb ID chính xác ----------

const WIKIDATA = 'https://query.wikidata.org/sparql';
// Loại mục Wikidata (P31) được coi là loạt phim
const SERIES_QIDS = new Set(['Q5398426', 'Q1259759', 'Q526877', 'Q117467246', 'Q63952888', 'Q15416']);

function wikidataQuery(netflixIds) {
  return `SELECT ?netflix ?imdb ?tmdbMovie ?tmdbTv ?inst WHERE {
  VALUES ?netflix { ${netflixIds.map((id) => `"${id}"`).join(' ')} }
  ?item wdt:P1874 ?netflix .
  OPTIONAL { ?item wdt:P345 ?imdb }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovie }
  OPTIONAL { ?item wdt:P4983 ?tmdbTv }
  OPTIONAL { ?item wdt:P31 ?inst }
}`;
}

// Mỗi mục có thể ra nhiều dòng (nhiều P31), gộp lại theo Netflix ID. Chỉ giữ mục có IMDb ID của phim (tt...).
function parseWikidata(json) {
  const map = new Map();
  for (const b of json?.results?.bindings || []) {
    const id = b.netflix?.value;
    if (!id) continue;
    const w = map.get(id) || { imdb: null, tmdbMovie: null, tmdbTv: null, isSeries: false };
    if (/^tt\d+$/.test(b.imdb?.value || '')) w.imdb = b.imdb.value;
    if (b.tmdbMovie?.value) w.tmdbMovie = b.tmdbMovie.value;
    if (b.tmdbTv?.value) w.tmdbTv = b.tmdbTv.value;
    if (SERIES_QIDS.has((b.inst?.value || '').split('/').pop())) w.isSeries = true;
    map.set(id, w);
  }
  for (const [id, w] of map) if (!w.imdb) map.delete(id);
  return map;
}

// Lỗi thì trả Map rỗng: addon vẫn chạy bằng cách tìm theo tên
async function fetchWikidata(netflixIds) {
  if (!netflixIds.length) return new Map();
  try {
    const url = `${WIKIDATA}?format=json&query=${encodeURIComponent(wikidataQuery(netflixIds))}`;
    const r = await fetch(url, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'netflix-new-stremio/1.3 (Stremio catalog addon)' },
    });
    if (!r.ok) throw new Error(`Wikidata ${r.status}`);
    return parseWikidata(await r.json());
  } catch {
    return new Map();
  }
}

// ---------- Cache ----------

let cache = { at: 0, data: null, pending: null };

async function load() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const [{ source, totalItems, rows }, enTitles] = await Promise.all([fetchReleases(), fetchEnglishTitles()]);
    const seen = new Set();
    const items = rows
      .filter((r) => r.videoID && r.title1 && r.collection !== COLLECTION.GAMES)
      .filter((r) => !seen.has(r.videoID) && seen.add(r.videoID))
      .map((r) => ({ ...toItem(r), enTitle: enTitles.get(r.videoID) }));
    const released = items.filter((x) => !x.startTime || x.startTime <= Date.now()); // bỏ tựa chưa ra mắt
    // Trang phim Netflix: loại chính xác, đạo diễn, diễn viên, mô tả. Song song với Wikidata.
    const [pages, wikidata] = await Promise.all([
      mapInBatches(released, (x) => fetchNetflixTitle(x.netflixId)),
      fetchWikidata(released.map((x) => String(x.netflixId))),
    ]);
    released.forEach((x, i) => {
      x.nf = pages[i];
      if (x.nf?.type) x.hint = x.nf.type; // Netflix ghi rõ loại → ưu tiên hơn mọi cách đoán
    });
    const resolved = await resolveAll(released, wikidata);
    const data = {
      fetchedAt: new Date().toISOString(), source, totalItems, read: items.length, released: released.length,
      netflixPages: pages.filter(Boolean).length, wikidata: wikidata.size, items: resolved,
    };
    cache = { at: Date.now(), data, pending: null };
    return data;
  })().catch((e) => { cache.pending = null; throw e; });
  return cache.pending;
}

function catalogFor(data, type) {
  const ids = new Set();
  return [...data.items]
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0)) // mới nhất trước
    .filter((it) => it.meta && it.meta.type === type && !ids.has(it.meta.id) && ids.add(it.meta.id))
    .map((it) => it.meta);
}

// ---------- HTTP ----------

function send(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (cacheSeconds) res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`);
  res.end(JSON.stringify(body));
}

// Trên Vercel, req.url là đường dẫn sau rewrite (/api/index); đường dẫn gốc nằm ở ?__path= (xem vercel.json)
function getPath(req) {
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('__path');
  return p !== null ? '/' + p.replace(/^\/+/, '') : u.pathname;
}

async function handler(req, res) {
  const path = getPath(req);
  try {
    if (path === '/' || path === '/manifest.json') return send(res, 200, manifest, 86400);

    const m = path.match(/^\/catalog\/(movie|series)\/([^/]+?)(\/.*)?\.json$/);
    if (m) {
      const [, type, id, extra] = m;
      if (!manifest.catalogs.some((c) => c.type === type && c.id === id)) return send(res, 404, { metas: [] });
      if (extra && /skip=[1-9]/.test(extra)) return send(res, 200, { metas: [] }); // chỉ có 1 trang
      return send(res, 200, { metas: catalogFor(await load(), type) }, 21600);
    }

    // Kiểm tra: nguồn dữ liệu, số tựa đọc được, tựa nào không khớp TMDB
    if (path === '/debug.json') {
      const d = await load();
      return send(res, 200, {
        fetchedAt: d.fetchedAt,
        source: d.source,
        totalItems: d.totalItems,
        read: d.read,
        released: d.released,
        netflixPages: d.netflixPages,
        matched: d.items.filter((x) => x.meta).length,
        matchedViaWikidata: d.items.filter((x) => x.via === 'wikidata').length,
        matchedItems: d.items.filter((x) => x.meta).map((x) => ({ title: x.title, via: x.via, tmdb: x.tmdb, imdb: x.meta.id, tried: x.tried })),
        unmatched: d.items.filter((x) => !x.meta).map((x) => ({ title: x.title, enTitle: x.enTitle, netflixId: x.netflixId, reason: x.error })),
      });
    }

    return send(res, 404, { error: 'not found', path, url: req.url });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}

module.exports = handler;
module.exports.parseNextData = parseNextData;
module.exports.netflixType = netflixType;
module.exports.scoreCandidate = scoreCandidate;
module.exports.parseWikidata = parseWikidata;
module.exports.parseNetflixTitle = parseNetflixTitle;
module.exports.peopleScore = peopleScore;
