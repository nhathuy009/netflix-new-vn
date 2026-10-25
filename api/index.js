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
  version: '1.1.0',
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

async function fetchApiPage(page) {
  const url = `${API_URL}?language=${LANG}&country=${COUNTRY}&page=${page}`;
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

// Đoán loại từ dữ liệu Netflix; null = chưa biết, để TMDB quyết định
function netflixType(row) {
  if (row.collection === COLLECTION.SERIES) return 'tv';
  if (row.collection === COLLECTION.FILM) return 'movie';
  if (/^(Mùa|Phần|Chương|Tập)\s|Loạt phim/i.test(row.title2 || '')) return 'tv';
  return null;
}

function toItem(row) {
  return {
    netflixId: row.videoID,
    title: row.title1,
    subtitle: row.title2 !== row.title1 ? row.title2 : undefined,
    startTime: row.startTime,
    image: row.image,
    hint: netflixType(row),
  };
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

async function findOnTmdb(item) {
  const q = { query: item.title, language: 'vi-VN', include_adult: 'false' };
  if (item.hint) {
    const res = await tmdb(`/search/${item.hint}`, q);
    if (res.results?.[0]) return { ...res.results[0], media_type: item.hint };
  }
  const res = await tmdb('/search/multi', q);
  return (res.results || []).find((x) => x.media_type === 'movie' || x.media_type === 'tv');
}

function vnDate(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
}

async function resolve(item) {
  const hit = await findOnTmdb(item);
  if (!hit) return { ...item, error: 'không tìm thấy trên TMDB' };
  const ext = await tmdb(`/${hit.media_type}/${hit.id}/external_ids`);
  if (!ext.imdb_id) return { ...item, error: `TMDB ${hit.media_type}/${hit.id} không có IMDb ID` };
  const desc = [item.subtitle, hit.overview].filter(Boolean).join(' — ');
  return {
    ...item,
    meta: {
      id: ext.imdb_id,
      type: hit.media_type === 'tv' ? 'series' : 'movie',
      name: item.title,
      poster: hit.poster_path ? `https://image.tmdb.org/t/p/w342${hit.poster_path}` : item.image,
      background: hit.backdrop_path ? `https://image.tmdb.org/t/p/w1280${hit.backdrop_path}` : item.image,
      description: desc || undefined,
      releaseInfo: `Lên Netflix ${vnDate(item.startTime)}`,
    },
  };
}

// Gọi TMDB theo lô 10 để không vượt giới hạn tốc độ
async function resolveAll(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    out.push(...(await Promise.all(batch.map((it) => resolve(it).catch((e) => ({ ...it, error: e.message }))))));
  }
  return out;
}

// ---------- Cache ----------

let cache = { at: 0, data: null, pending: null };

async function load() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const { source, totalItems, rows } = await fetchReleases();
    const seen = new Set();
    const items = rows
      .filter((r) => r.videoID && r.title1 && r.collection !== COLLECTION.GAMES)
      .filter((r) => !seen.has(r.videoID) && seen.add(r.videoID))
      .map(toItem);
    const released = items.filter((x) => !x.startTime || x.startTime <= Date.now()); // bỏ tựa chưa ra mắt
    const resolved = await resolveAll(released);
    const data = { fetchedAt: new Date().toISOString(), source, totalItems, read: items.length, released: released.length, items: resolved };
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

async function handler(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
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
        matched: d.items.filter((x) => x.meta).length,
        unmatched: d.items.filter((x) => !x.meta).map((x) => ({ title: x.title, netflixId: x.netflixId, reason: x.error })),
      });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}

module.exports = handler;
module.exports.parseNextData = parseNextData;
module.exports.netflixType = netflixType;
