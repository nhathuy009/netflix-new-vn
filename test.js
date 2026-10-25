// Test không cần mạng: dùng HTML thật của trang Netflix (fixtures/) và giả lập API Netflix, Wikidata, TMDB.
const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync(__dirname + '/fixtures/new-to-watch-vi.html', 'utf8');
const page1 = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]).props.pageProps.data;
const realPage2 = require('./fixtures/api-releases-vi-page2.json'); // phản hồi thật của API trang 2
const titlePage = fs.readFileSync(__dirname + '/fixtures/netflix-title-82023496.html', 'utf8'); // trang phim "Sống đời" (phần nmTitleGQL thật)
const PAST = Date.parse('2026-10-15T00:00:00+07:00');
const page2 = {
  ...realPage2,
  data: [
    ...realPage2.data,
    { videoID: 900001, title1: 'Phim lẻ A', title2: 'Phim lẻ A', collection: 2694103, startTime: PAST },
    { videoID: 900002, title1: 'Trò chơi B', title2: 'Trò chơi B', collection: 81500273, startTime: PAST },
    { videoID: 900003, title1: 'Tương lai C', title2: 'Mùa 1', startTime: Date.parse('2099-01-01') },
    page1.data[0], // trùng với trang 1
  ],
};
const page3 = { ...page1, current: 3, data: [{ videoID: 900004, title1: 'Không có trên TMDB', title2: 'x', startTime: PAST }] };
const apiPages = { 1: page1, 2: page2, 3: page3 };

// Kết quả Wikidata thật (P1874) cho các mã Netflix trong fixtures, người dùng tra ngày 25/10/2026
const WD_ROWS = [
  { netflix: '81757047', imdb: 'tt31049299', tmdbMovie: '1236045' },
  { netflix: '82023496', imdb: 'tt36429458', tmdbMovie: '1458857' },  // Sống đời / Doing Life
  { netflix: '82027563', imdb: 'tt37027309', tmdbMovie: '1487317' },
  { netflix: '81952372', imdb: 'tt43738050' },                         // Giàu nứt vách... : TMDB không có
];
// Giả lập: Wikidata chỉ biết mã gốc của loạt phim "Cái bẫy" (81720671), không biết mã mùa trong danh sách (81720672)
WD_ROWS.push({ netflix: '81720671', imdb: 'tt88888888', tmdbTv: '283371' });
const wdBindings = (ids) => WD_ROWS.filter((r) => ids.includes(r.netflix)).map((r) => {
  const b = { netflix: { value: r.netflix }, imdb: { value: r.imdb } };
  if (r.tmdbMovie) b.tmdbMovie = { value: r.tmdbMovie };
  if (r.tmdbTv) b.tmdbTv = { value: r.tmdbTv };
  return b;
});

// Top 10 thật của trang chủ netflix.com/vn (chỉ có thứ hạng và mã)
// Top 10 tuần thật của Netflix Tudum tại Việt Nam (tuần đến 18/10/2026), chỉ gồm các khối Top10Data
const tudumMovies = fs.readFileSync(__dirname + '/fixtures/tudum-top10-vietnam-movies.html', 'utf8');
const tudumTv = fs.readFileSync(__dirname + '/fixtures/tudum-top10-vietnam-tv.html', 'utf8');
const { parseTudumTop10 } = require('./api/index');
const TOP10 = [...parseTudumTop10(tudumMovies, 'movie'), ...parseTudumTop10(tudumTv, 'tv')];
const top10Type = new Map(TOP10.map((r) => [String(r.showId), r.type]));

let apiUp = true;
let wdUp = true;
let top10Up = true;
let wdHeaders = null;
const searches = [];
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const json = (o) => ({ ok: true, json: async () => o });
  if (u.hostname === 'query.wikidata.org') {
    if (!wdUp) return { ok: false, status: 503 };
    wdHeaders = opts.headers;
    const ids = [...u.searchParams.get('query').matchAll(/"(\d+)"/g)].map((m) => m[1]);
    return json({ results: { bindings: wdBindings(ids) } });
  }
  if (u.hostname === 'www.netflix.com') {
    if (u.pathname === '/vn/title/82023496') return { ok: true, text: async () => titlePage };
    // Mã mùa 81720672: trang phim ghi mã gốc 81720671 (Netflix chuyển hướng sang /title/81720671)
    if (u.pathname === '/vn/title/81720672') return { ok: true, url: 'https://www.netflix.com/vn/title/81720671', text: async () => fakeTitle({ type: 'Show', videoId: 81720671, topLevelVideoId: 81720671 }) };
    // Trang không ghi topLevelVideoId: lấy mã từ địa chỉ sau chuyển hướng
    // "#Yêu" và "Cơn bão": Netflix Original chiếu lần đầu
    if (u.pathname === '/vn/title/81680909') return { ok: true, text: async () => fakeTitle({ type: 'Show', isOriginal: true, topLevelVideoId: 81680908 }) };
    if (u.pathname === '/vn/title/81786721') return { ok: true, text: async () => fakeTitle({ type: 'Movie', isOriginal: true, topLevelVideoId: 81786721 }) };
    const tudum = { '/tudum/top10/vietnam': tudumMovies, '/tudum/top10/vietnam/tv': tudumTv }[u.pathname];
    if (tudum) {
      if (top10Up === 'redirect') return { ok: true, url: 'https://www.netflix.com/tudum/top10/united-states', text: async () => tudum };
      if (!top10Up) return { ok: false, status: 403, url: String(url) };
      return { ok: true, url: String(url), text: async () => tudum };
    }
    // Trang phim của các tựa trong Top 10: tên giả lập "Top10 <mã>"
    const t10 = u.pathname.match(/^\/vn\/title\/(\d+)$/);
    // "Firefly Wedding" (83136358): giả lập trang phim Netflix không đọc được
    if (t10 && top10Type.has(t10[1]) && t10[1] !== '83136358') {
      const id = Number(t10[1]);
      return { ok: true, text: async () => fakeTitle({ type: top10Type.get(t10[1]) === 'tv' ? 'Show' : 'Movie', videoId: id, topLevelVideoId: id }, { title: `Top10 ${id}` }) };
    }
    if (u.pathname === '/vn/title/555') return { ok: true, url: 'https://www.netflix.com/vn/title/554?fromWatch=true', text: async () => fakeTitle({ type: 'Show' }) };
    return { ok: false, status: 404 };
  }
  const det = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)$/);
  if (det) {
    const id = det[2];
    // Phim đúng có Tyler Perry và dàn diễn viên trùng trang Netflix; phim sai thì không
    const credits = id === '1458857'
      ? { cast: [{ name: 'Naomi Baker' }, { name: 'Jay Reeves' }, { name: 'Ai Đó' }], crew: [{ job: 'Director', name: 'Tyler Perry' }] }
      : id === '1058827'
        ? { cast: [{ name: 'Người A' }, { name: 'Người B' }, { name: 'Người C' }], crew: [{ job: 'Director', name: 'Đạo diễn khác' }] }
        : { cast: [], crew: [] };
    return json({ id: Number(id), poster_path: `/wd-${id}.jpg`, overview: 'Mô tả TMDB', external_ids: { imdb_id: `tt${id}` }, credits });
  }
  if (u.pathname.startsWith('/3/find/')) return json({ movie_results: [], tv_results: [] });
  if (u.hostname === 'about.netflix.com') {
    if (u.pathname === '/api/data/releases') {
      if (!apiUp) return { ok: false, status: 403 };
      const lang = u.searchParams.get('language');
      assert.ok(lang === 'vi' || lang === 'en');
      assert.strictEqual(u.searchParams.get('country'), 'VN');
      const p = apiPages[u.searchParams.get('page')];
      // Bản tiếng Anh: cùng videoID, tên khác
      return json(lang === 'en' ? { ...p, data: p.data.map((r) => ({ ...r, title1: 'EN-' + r.title1 })) } : p);
    }
    if (u.pathname === '/vi/new-to-watch') return { ok: true, text: async () => html };
  }
  const s = u.pathname.match(/\/search\/(movie|tv|multi)$/);
  if (s) {
    const q = u.searchParams.get('query');
    const year = u.searchParams.get('first_air_date_year') || u.searchParams.get('primary_release_year');
    searches.push([s[1], q, year]);
    // "#Yêu": 20 loạt phim "Love" cũ chiếm hết trang đầu; chỉ khi lọc năm 2026 mới ra tv/302882
    if (q === '#Yêu' || q === 'EN-#Yêu') {
      if (year === '2026') return json({ results: [{ id: 302882, name: 'Love', first_air_date: '2026-10-02' }] });
      return json({ results: Array.from({ length: 20 }, (_, i) => ({ id: 50000 + i, name: 'Love', first_air_date: `${2000 + (i % 10)}-01-01` })) });
    }
    // "Cơn bão": phim đúng ở vị trí thứ 6, sau 5 phim cũ trùng tên (trước đây chỉ xét 5 kết quả đầu)
    if (q === 'Cơn bão' || q === 'EN-Cơn bão') {
      if (year) return json({ results: [] }); // tách riêng: chỉ kiểm tra việc xét đủ kết quả
      return json({ results: [
        ...Array.from({ length: 5 }, (_, i) => ({ id: 60000 + i, title: 'Cơn bão', release_date: `${2015 + i}-05-01` })),
        { id: 1614937, title: 'The Storm', release_date: '2026-10-15' },
      ] });
    }
    if (q.includes('Không có trên TMDB')) return json({ results: [] }); // không có cả tên Việt lẫn Anh
    if (q === 'Bác sĩ X') return json({ results: [] });                 // tên Việt không có, tên Anh có
    // Phim trùng tên đứng trước phim Netflix đúng (movie/1458857)
    if (q === 'Sống đời' || q === 'EN-Sống đời') return json({ results: [
      { id: 1058827, media_type: 'movie', title: 'Sống đời', release_date: '2026-09-30' }, // trùng tên, cùng đợt, có IMDb: chỉ khác người
      { id: 1458857, media_type: 'movie', title: 'Doing Life', release_date: '2026-10-02' },
      { id: 777, media_type: 'movie', title: 'Sống đời', release_date: '2027-06-01' }, // ra mắt sau: bị loại
    ] });
    const media = s[1] === 'multi' ? 'movie' : s[1];
    let hash = 7;
    for (const ch of q) hash = (hash * 31 + ch.codePointAt(0)) % 9000000;
    return json({ results: [{ id: 1000000 + hash, media_type: media, poster_path: '/p.jpg', overview: 'Mô tả' }] });
  }
  const e = u.pathname.match(/\/(movie|tv)\/(\d+)\/external_ids$/);
  if (e) return json({ imdb_id: e[2] === '1058827' ? null : `tt${e[2]}` });
  throw new Error('fetch không mong đợi: ' + url);
};
process.env.TMDB_API_KEY = 'testkey';

function fakeTitle(metaData, copy = {}) {
  return '<script>netflix.reactContext = {"models":{"nmTitleGQL":' + JSON.stringify({ data: { metaData, copy, persons: {} } }) + '}};</script>';
}

function freshHandler() {
  delete require.cache[require.resolve('./api/index')];
  return require('./api/index');
}
function call(handler, path) {
  return new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    handler({ url: path }, res);
  });
}

(async () => {
  // Đọc HTML thật
  let h = freshHandler();
  const d = h.parseNextData(html);
  assert.strictEqual(d.data.length, 20);
  assert.ok(d.totalPages >= 1 && d.totalItems > 20);
  assert.ok(d.data.every((r) => r.videoID && r.title1 && r.startTime));

  // Đoán loại
  assert.strictEqual(h.netflixType({ collection: 2170013 }), 'tv');
  assert.strictEqual(h.netflixType({ collection: 2694103 }), 'movie');
  assert.strictEqual(h.netflixType({ title2: 'Mùa 2' }), 'tv');
  assert.strictEqual(h.netflixType({ title2: 'Loạt phim truyền hình ngắn' }), 'tv');
  assert.strictEqual(h.netflixType({ title1: '#Yêu', title2: '#Yêu' }), null);

  // Gộp kết quả Wikidata: nhiều dòng P31 cho một mục, bỏ mục không có IMDb ID phim
  const wd = h.parseWikidata({ results: { bindings: [
    { netflix: { value: '1' }, imdb: { value: 'tt1' }, inst: { value: 'http://www.wikidata.org/entity/Q11424' } },
    { netflix: { value: '1' }, imdb: { value: 'tt1' }, inst: { value: 'http://www.wikidata.org/entity/Q1259759' } },
    { netflix: { value: '2' }, imdb: { value: 'nm123' } },
    { netflix: { value: '3' } },
  ] } });
  assert.deepStrictEqual([...wd.keys()], ['1']);
  assert.strictEqual(wd.get('1').isSeries, true);

  // Đọc trang phim Netflix thật (chuỗi JS có \xNN)
  const nf = h.parseNetflixTitle(titlePage);
  assert.strictEqual(nf.type, 'movie');
  assert.deepStrictEqual(nf.directors, ['Tyler Perry']);
  assert.strictEqual(nf.cast.length, 10);
  assert.ok(nf.cast.includes('Danielle Moné Truitt'));
  assert.ok(nf.synopsis.startsWith('Người mẹ đơn thân'));
  assert.strictEqual(nf.isOriginal, true);
  assert.ok(nf.background.startsWith('https://occ-0-58-325.1.nflxso.net/'));
  assert.strictEqual(h.parseNetflixTitle('<html>không có dữ liệu</html>'), null);
  assert.strictEqual(nf.topId, 82023496); // phim lẻ: mã gốc trùng mã trong danh sách
  assert.strictEqual((await h.fetchNetflixTitle(81720672)).topId, 81720671);
  assert.strictEqual((await h.fetchNetflixTitle(81720672)).type, 'tv');
  assert.strictEqual((await h.fetchNetflixTitle(555)).topId, 554); // không có topLevelVideoId: theo địa chỉ chuyển hướng

  // Đọc Top 10 từ trang chủ thật
  assert.strictEqual(TOP10.length, 20); // mỗi khối có hai bản trong trang: đã bỏ trùng
  assert.deepStrictEqual(TOP10.filter((r) => r.type === 'movie').map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // Loạt phim: mã của cả loạt phim lấy từ displayVideo.video.parentShow trong khối JSON, mã trong Top10Data là mã của mùa.
  // Dữ liệu test không có thẻ <li> nào (giống HTML máy chủ trả về có thể thiếu thẻ), nên chỉ đọc được từ khối JSON.
  assert.deepStrictEqual(TOP10.find((r) => r.type === 'tv'), {
    type: 'tv', rank: 1, showId: 82682379, seasonId: 82682380, weeks: 2, weekEnd: '2026-10-18', enTitle: 'Doctor X: Mafia in White',
  });
  assert.deepStrictEqual(TOP10.filter((r) => r.type === 'tv' && r.rank === 8).map((r) => [r.showId, r.seasonId]), [[83136358, 83136391]]);
  assert.deepStrictEqual(TOP10.filter((r) => r.type === 'tv' && r.rank === 6).map((r) => [r.showId, r.seasonId]), [[81712068, 83050560]]);
  assert.strictEqual(TOP10.find((r) => r.type === 'tv' && r.rank === 10).enTitle, 'Doctor X Surgeon Michiko Daimon'); // tên loạt phim, không có số mùa
  assert.ok(!/<li[\s>]/.test(tudumTv)); // không có thẻ <li> nào
  // Phim lẻ: không có parentShow, mã trùng videoId, không có mã mùa
  assert.ok(TOP10.filter((r) => r.type === 'movie').every((r) => r.seasonId === null));
  assert.strictEqual(h.cleanSeasonTitle('Firefly Wedding: Season 1'), 'Firefly Wedding');
  assert.strictEqual(h.cleanSeasonTitle('Below: Limited Series'), 'Below');
  assert.strictEqual(h.cleanSeasonTitle('Kong: Skull Island'), 'Kong: Skull Island');
  // Giải mã chuỗi JavaScript '...'
  assert.strictEqual(h.decodeJsString("It\\'s \\\\ \\u00F4 \\x41 \\n \\\""), 'It\'s \\ ô A \n "');
  assert.strictEqual(h.decodeJsString('{\\"a\\":1}'), '{"a":1}'); // chuỗi vào: {\"a\":1}
  assert.deepStrictEqual(h.parseTudumTop10('<script>netflix.reactContext.models.graphql = JSON.parse(\'hỏng\');</script>', 'tv'), []);
  assert.strictEqual(TOP10.find((r) => r.type === 'movie' && r.rank === 7).weeks, 84);
  assert.deepStrictEqual(h.parseTudumTop10(tudumTv, 'movie'), []); // trang loạt phim không có khối MOVIES
  assert.deepStrictEqual(h.parseTudumTop10('<html></html>', 'movie'), []);
  assert.strictEqual(nf.title, 'Sống đời');

  // Đối chiếu người
  const crew = (d) => ({ crew: [{ job: 'Director', name: d }] });
  assert.strictEqual(h.peopleScore({ credits: { cast: [], ...crew('Tyler Perry') } }, nf), 6);
  assert.strictEqual(h.peopleScore({ credits: { cast: [{ name: 'Naomi Baker' }, { name: 'Jay Reeves' }], crew: [] } }, nf), 6);
  assert.strictEqual(h.peopleScore({ credits: { cast: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], ...crew('Khác') } }, nf), -4);
  assert.strictEqual(h.peopleScore({ aggregate_credits: { cast: [{ name: 'Naomi Baker' }], crew: [] } }, nf), 2); // loạt phim
  assert.strictEqual(h.peopleScore({ created_by: [{ name: 'Tyler Perry' }] }, { ...nf, directors: [], creators: ['Tyler Perry'] }), 6);
  assert.strictEqual(h.peopleScore({ credits: {} }, null), 0);

  // Chấm điểm ứng viên TMDB
  const oct2 = Date.parse('2026-10-02');
  const sc = (c, item) => h.scoreCandidate(c, { title: 'X', startTime: oct2, ...item });
  assert.ok(sc({ title: 'X', release_date: '2026-10-02' }) > sc({ title: 'X', release_date: '2019-01-01' })); // cùng đợt Netflix
  assert.strictEqual(sc({ title: 'X', release_date: '2027-06-01' }), -Infinity);                                       // ra mắt sau: loại
  assert.ok(sc({ media_type: 'tv' }, { hint: 'tv' }) > sc({ media_type: 'movie' }, { hint: 'tv' }));         // đúng loại
  // Netflix Original chiếu lần đầu: ứng viên ra trước hơn 1 năm bị loại ("Cái bẫy" từng khớp nhầm phim năm 1950)
  const orig = { nf: { isOriginal: true } };
  assert.strictEqual(sc({ name: 'X', first_air_date: '1950-01-01' }, orig), -Infinity);
  assert.ok(sc({ name: 'X', first_air_date: '2026-09-01' }, orig) > 0);
  assert.ok(sc({ name: 'X', first_air_date: '2021-01-08' }, { ...orig, subtitle: 'Phần 4' }) > -Infinity);           // mùa sau: giữ
  assert.ok(sc({ name: 'X', first_air_date: '2022-09-13' }, { ...orig, subtitle: 'Cyberpunk: Edgerunners 2' }) > -Infinity);
  assert.ok(sc({ name: 'X', release_date: '1990-01-01' }, { nf: { isOriginal: false } }) > -Infinity);              // phim mua bản quyền: giữ
  assert.strictEqual(h.isLaterSeason({ subtitle: 'Cyberpunk: Edgerunners 2' }), true);
  // Năm lọc khi tìm: chỉ cho Netflix Original chiếu lần đầu, theo giờ Việt Nam, tháng 1 thì thêm năm trước
  const yr = (iso, extra) => h.searchYears({ hint: 'tv', nf: { isOriginal: true }, startTime: Date.parse(iso), ...extra });
  assert.deepStrictEqual(yr('2026-10-02T00:00:00+07:00'), [2026]);
  assert.deepStrictEqual(yr('2026-01-15T00:00:00+07:00'), [2026, 2025]);
  assert.deepStrictEqual(yr('2026-01-01T00:30:00+07:00'), [2026, 2025]); // 31/12 UTC nhưng đã 1/1 ở Việt Nam
  assert.deepStrictEqual(yr('2026-10-02T00:00:00+07:00', { subtitle: 'Mùa 3' }), []);
  assert.deepStrictEqual(yr('2026-10-02T00:00:00+07:00', { nf: { isOriginal: false } }), []);
  assert.deepStrictEqual(yr('2026-10-02T00:00:00+07:00', { hint: null }), []);
  assert.strictEqual(h.isLaterSeason({ subtitle: 'Mùa 1' }), false);
  assert.strictEqual(h.isLaterSeason({ subtitle: 'Schumacher 1994 – Huyền thoại ra đời' }), false);
  assert.strictEqual(h.isLaterSeason({ subtitle: 'Loạt phim truyền hình ngắn' }), false);
  // Mùa 4 của loạt phim cũ: ngày TMDB là mùa 1, không được cộng điểm "cùng đợt"
  assert.strictEqual(sc({ name: 'X', first_air_date: '2026-09-20' }, { subtitle: 'Mùa 4' }), sc({ name: 'X', first_air_date: '2021-01-08' }, { subtitle: 'Mùa 4' }));

  // Kịch bản 1: API hoạt động → lấy đủ các trang
  const man = await call(h, '/manifest.json');
  assert.strictEqual(man.status, 200);
  assert.strictEqual(man.headers['Access-Control-Allow-Origin'], '*');
  let dbg = (await call(h, '/debug.json')).body;
  assert.strictEqual(dbg.source, 'api');
  // 20 (trang 1) + 20 thật + Phim lẻ A, Tương lai C (trang 2, bỏ trò chơi và tựa trùng) + 1 (trang 3)
  assert.strictEqual(dbg.read, 43);
  const future = [...page1.data, ...realPage2.data].filter((r) => r.startTime > Date.now()).length + 1; // + Tương lai C
  assert.strictEqual(dbg.released, 43 - future);
  assert.deepStrictEqual(dbg.unmatched.map((x) => x.title), ['Không có trên TMDB']);

  const series = (await call(h, '/catalog/series/netflix-new-series.json')).body.metas;
  const movies = (await call(h, '/catalog/movie/netflix-new-movie.json')).body.metas;
  const names = (list) => list.map((x) => x.name);
  assert.ok(names(series).includes('Phía đông vườn Địa đàng')); // collection SERIES
  assert.ok(names(series).includes('Bức tường băng'));          // "Mùa 2", không có collection
  assert.ok(names(movies).includes('Phim lẻ A'));               // collection FILM
  assert.ok(names(series).includes('Lupin'));                   // trang 2 thật: "Phần 4"
  assert.ok(names(series).includes('Bác sĩ X'));                // tìm ra nhờ tên tiếng Anh, vẫn hiện tên Việt
  // Wikidata: tra thẳng theo mã Netflix, không qua tên
  assert.ok(dbg.matchedViaWikidata >= 4);
  assert.ok(wdHeaders['User-Agent']);
  const song = movies.find((x) => x.name === 'Sống đời');
  assert.strictEqual(song.id, 'tt36429458');
  assert.strictEqual(song.poster, 'https://image.tmdb.org/t/p/w342/wd-1458857.jpg');
  assert.deepStrictEqual(dbg.matchedItems.find((x) => x.title === 'Sống đời'), { title: 'Sống đời', via: 'wikidata', tmdb: 'movie/1458857', imdb: 'tt36429458' });
  // Có IMDb trên Wikidata nhưng TMDB không có: vẫn hiện, dùng ảnh Netflix
  const giau = movies.concat(series).find((x) => x.name === 'Giàu nứt vách, nghèo mạt rệp');
  assert.strictEqual(giau.id, 'tt43738050');
  assert.ok(giau.poster.startsWith('https://dnm.nflximg.net/'));
  assert.ok(!searches.some(([, q]) => q === 'Sống đời')); // không tốn lượt tìm theo tên
  // "Cái bẫy": tra Wikidata bằng mã gốc của loạt phim, không phải mã mùa trong danh sách
  const trap = series.find((x) => x.name === 'Cái bẫy');
  assert.strictEqual(trap.id, 'tt88888888');
  assert.deepStrictEqual(dbg.matchedItems.find((x) => x.title === 'Cái bẫy'), { title: 'Cái bẫy', via: 'wikidata', tmdb: 'tv/283371', imdb: 'tt88888888' });
  assert.strictEqual(dbg.seasonIds, 2); // Cái bẫy, #Yêu
  // "#Yêu": chỉ lượt tìm lọc năm 2026 mới tìm ra loạt phim đúng
  assert.strictEqual(series.find((x) => x.name === '#Yêu').id, 'tt302882');
  assert.ok(searches.some(([t, q, y]) => t === 'tv' && q === '#Yêu' && y === '2026'));
  // "Cơn bão": phim đúng ở vị trí thứ 6 vẫn được xét
  assert.strictEqual(movies.find((x) => x.name === 'Cơn bão').id, 'tt1614937');
  // Không phải Netflix Original thì không tìm lọc năm
  assert.ok(!searches.some(([, q, y]) => q === 'Phim lẻ A' && y));
  assert.strictEqual(dbg.matchedViaWikidata, 5);

  // Metadata từ trang phim Netflix
  assert.strictEqual(dbg.netflixPages, 5); // Sống đời, Cái bẫy, #Yêu, Cơn bão + Bản năng thú (cũng là phim lẻ hạng 1 Top 10 tuần)
  assert.ok(song.description.startsWith('Người mẹ đơn thân'));   // mô tả tiếng Việt của Netflix
  assert.ok(song.releaseInfo.endsWith('· Netflix Original'));
  assert.deepStrictEqual(song.links.filter((l) => l.category === 'Directors').map((l) => l.name), ['Tyler Perry']);
  assert.deepStrictEqual(song.links.filter((l) => l.category === 'Genres').map((l) => l.name), ['Lãng mạn', 'Phim chính kịch']);
  assert.strictEqual(song.links.filter((l) => l.category === 'Cast').length, 5);
  assert.strictEqual(song.links[0].url, 'stremio:///search?search=L%C3%A3ng%20m%E1%BA%A1n');
  assert.ok(searches.some(([t, q]) => t === 'tv' && q === 'EN-Bác sĩ X'));
  assert.ok(!searches.some(([, q]) => q.includes('Cái bẫy'))); // đã khớp qua Wikidata, không tìm theo tên
  assert.strictEqual(dbg.unmatched[0].enTitle, 'EN-Không có trên TMDB');
  assert.ok(names(movies).includes('Vượt qua bão Otis'));       // trang 2 thật: collection FILM
  const minWage = realPage2.data.find((r) => r.title1 === 'Lương tối thiểu');
  if (minWage.startTime > Date.now()) assert.ok(!names(series).includes('Lương tối thiểu')); // chưa ra mắt
  assert.ok(!names(movies.concat(series)).includes('Trò chơi B'));
  assert.ok(!names(movies.concat(series)).includes('Tương lai C'));
  assert.ok(series.every((x) => x.id.startsWith('tt') && x.releaseInfo.startsWith('Lên Netflix ')));
  // Tựa đã biết loại thì tìm đúng endpoint TMDB
  assert.ok(searches.some(([t, q]) => t === 'tv' && q === 'Bức tường băng'));
  assert.ok(searches.some(([t, q]) => t === 'movie' && q === 'Phim lẻ A'));
  // Mới nhất trước
  const times = series.map((x) => x.releaseInfo.slice(12, 22).split('/').reverse().join(''));
  assert.deepStrictEqual(times, [...times].sort().reverse());
  assert.deepStrictEqual((await call(h, '/catalog/movie/netflix-new-movie/skip=100.json')).body.metas, []);
  assert.strictEqual((await call(h, '/catalog/movie/khac.json')).status, 404);

  // Top 10 Việt Nam
  const topMovies = (await call(h, '/catalog/movie/netflix-top10-movie.json')).body.metas;
  const topSeries = (await call(h, '/catalog/series/netflix-top10-series.json')).body.metas;
  assert.strictEqual(topMovies.length, 10);
  // Hạng 1 là "Bản năng thú" (81757047): khớp qua Wikidata thật, cùng IMDb ID với mục trong danh sách phim mới
  assert.strictEqual(topMovies[0].id, 'tt31049299');
  assert.strictEqual(topMovies[0].name, 'Top10 81757047');                 // tên lấy từ trang phim
  assert.ok(topMovies.every((x, i) => x.releaseInfo.startsWith(`#${i + 1} tại Việt Nam · `)));
  assert.strictEqual(topMovies[6].releaseInfo, '#7 tại Việt Nam · 84 tuần trong Top 10');
  assert.strictEqual(topSeries.length, 10);
  assert.strictEqual(topSeries[0].name, 'Top10 82682379'); // trang phim đọc theo mã loạt phim
  // "Firefly Wedding": trang phim không đọc được, dùng tên tiếng Anh trên trang Tudum để hiển thị và tìm
  assert.strictEqual(topSeries[7].name, 'Firefly Wedding');
  assert.ok(searches.some(([t, q]) => t === 'tv' && q === 'Firefly Wedding'));
  assert.ok(topSeries.every((x) => x.type === 'series') && topMovies.every((x) => x.type === 'movie'));
  const t10dbg = (await call(h, '/debug.json')).body.top10;
  assert.strictEqual(t10dbg.total, 20);
  assert.strictEqual(t10dbg.matched, 20);
  assert.deepStrictEqual(t10dbg.lists, {
    movie: { url: 'https://www.netflix.com/tudum/top10/vietnam' }, // không có trường error
    tv: { url: 'https://www.netflix.com/tudum/top10/vietnam/tv' },
  });
  assert.strictEqual(t10dbg.weekEnd, '2026-10-18');
  assert.strictEqual(t10dbg.items[6].weeks, 84);
  const firefly = t10dbg.items.find((x) => x.list === 'tv' && x.rank === 8);
  assert.deepStrictEqual([firefly.netflixId, firefly.seasonId, firefly.fromTudum, firefly.via], [83136358, 83136391, true, 'search']);
  assert.ok((await call(h, '/debug.json')).body.needsReview.some((x) => x.title === 'Firefly Wedding')); // không đối chiếu được người
  assert.deepStrictEqual(t10dbg.items.slice(0, 2).map((x) => [x.list, x.rank, x.via]), [['movie', 1, 'wikidata'], ['movie', 2, 'search']]);
  // Danh sách phim mới không bị ảnh hưởng
  assert.ok(!movies.some((x) => x.releaseInfo.startsWith('#')));
  const man2 = (await call(h, '/manifest.json')).body;
  assert.deepStrictEqual(man2.catalogs.map((c) => c.id), ['netflix-new-movie', 'netflix-new-series', 'netflix-top10-movie', 'netflix-top10-series']);

  // Dạng request trên Vercel sau rewrite: /api/index?__path=<đường dẫn gốc>
  assert.strictEqual((await call(h, '/api/index?__path=')).body.id, 'community.netflix.newtowatch.vi');            // trang gốc /
  assert.strictEqual((await call(h, '/api/index?__path=manifest.json')).body.id, 'community.netflix.newtowatch.vi');
  assert.strictEqual((await call(h, '/api/index?__path=debug.json')).body.source, 'api');
  assert.deepStrictEqual((await call(h, '/api/index?__path=catalog/series/netflix-new-series.json')).body.metas, series);
  assert.deepStrictEqual((await call(h, '/api/index?__path=catalog/movie/netflix-new-movie/skip%3D100.json')).body.metas, []);
  assert.strictEqual((await call(h, '/api/index?__path=abc')).body.path, '/abc');

  // Kịch bản 2: API lỗi → đọc __NEXT_DATA__ trong HTML (trang 1)
  // Kịch bản 2: API Netflix và Wikidata đều lỗi → đọc HTML (trang 1), tìm theo tên và chấm điểm
  apiUp = false;
  wdUp = false;
  top10Up = false;
  h = freshHandler();
  dbg = (await call(h, '/debug.json')).body;
  assert.ok(dbg.source.startsWith('html'));
  assert.strictEqual(dbg.read, 20);
  assert.strictEqual(dbg.matchedViaWikidata, 0);
  // Trang Top 10 lỗi: hai dòng Top 10 trống, có lý do; các dòng khác vẫn chạy
  assert.deepStrictEqual((await call(h, '/catalog/movie/netflix-top10-movie.json')).body.metas, []);
  assert.strictEqual(dbg.top10.lists.movie.error, 'Netflix 403');
  assert.strictEqual(dbg.top10.lists.tv.error, 'Netflix 403');
  assert.strictEqual(dbg.top10.total, 0);
  // Bị chuyển sang trang nước khác: báo lỗi, không hiện Top 10 của nước đó
  top10Up = 'redirect';
  h = freshHandler();
  const dbg3 = (await call(h, '/debug.json')).body;
  assert.strictEqual(dbg3.top10.lists.tv.error, 'Netflix chuyển sang https://www.netflix.com/tudum/top10/united-states, không phải trang Việt Nam');
  assert.deepStrictEqual((await call(h, '/catalog/series/netflix-top10-series.json')).body.metas, []);
  assert.ok((await call(h, '/catalog/series/netflix-new-series.json')).body.metas.length > 0);
  // "Sống đời": hai phim trùng tên, cùng đợt, đều có IMDb ID; chỉ đạo diễn/diễn viên phân biệt được
  const movies2 = (await call(h, '/catalog/movie/netflix-new-movie.json')).body.metas;
  assert.strictEqual(movies2.find((x) => x.name === 'Sống đời').id, 'tt1458857');
  const songDbg = dbg.matchedItems.find((x) => x.title === 'Sống đời');
  assert.strictEqual(songDbg.via, 'search');
  assert.strictEqual(songDbg.tmdb, 'movie/1458857');
  assert.ok(songDbg.tried.some((t) => t.startsWith('movie/1058827') && t.includes('-4')));  // phim sai bị trừ điểm
  assert.ok(songDbg.tried.some((t) => t.startsWith('movie/1458857') && t.includes('+12'))); // đạo diễn + 2 diễn viên khớp
  assert.ok(!dbg.needsReview.some((x) => x.title === 'Sống đời'));   // trùng đạo diễn/diễn viên: không cần kiểm tra
  assert.ok(dbg.needsReview.every((x) => x.tmdb.startsWith('https://www.themoviedb.org/') && x.netflix.startsWith('https://www.netflix.com/vn/title/')));

  console.log('OK: tất cả test đều đạt');
})().catch((e) => { console.error(e); process.exit(1); });
