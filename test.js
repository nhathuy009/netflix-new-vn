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
const wdBindings = (ids) => WD_ROWS.filter((r) => ids.includes(r.netflix)).map((r) => {
  const b = { netflix: { value: r.netflix }, imdb: { value: r.imdb } };
  if (r.tmdbMovie) b.tmdbMovie = { value: r.tmdbMovie };
  return b;
});

let apiUp = true;
let wdUp = true;
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
    searches.push([s[1], q]);
    if (q.includes('Không có trên TMDB')) return json({ results: [] }); // không có cả tên Việt lẫn Anh
    if (q === 'Cái bẫy') return json({ results: [] });                  // tên Việt không có, tên Anh có
    // Phim trùng tên đứng trước phim Netflix đúng (movie/1458857)
    if (q === 'Sống đời' || q === 'EN-Sống đời') return json({ results: [
      { id: 1058827, media_type: 'movie', title: 'Sống đời', release_date: '2026-09-30' }, // trùng tên, cùng đợt, có IMDb: chỉ khác người
      { id: 1458857, media_type: 'movie', title: 'Doing Life', release_date: '2026-10-02' },
      { id: 777, media_type: 'movie', title: 'Sống đời', release_date: '2027-06-01' }, // ra mắt sau: bị loại
    ] });
    const media = s[1] === 'multi' ? 'movie' : s[1];
    return json({ results: [{ id: q.length * 1000 + q.charCodeAt(0), media_type: media, poster_path: '/p.jpg', overview: 'Mô tả' }] });
  }
  const e = u.pathname.match(/\/(movie|tv)\/(\d+)\/external_ids$/);
  if (e) return json({ imdb_id: e[2] === '1058827' ? null : `tt${e[2]}` });
  throw new Error('fetch không mong đợi: ' + url);
};
process.env.TMDB_API_KEY = 'testkey';

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
  assert.ok(names(series).includes('Cái bẫy'));                 // tìm ra nhờ tên tiếng Anh, vẫn hiện tên Việt
  // Wikidata: tra thẳng theo mã Netflix, không qua tên
  assert.strictEqual(dbg.matchedViaWikidata, 4);
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
  // Metadata từ trang phim Netflix
  assert.strictEqual(dbg.netflixPages, 1);
  assert.ok(song.description.startsWith('Người mẹ đơn thân'));   // mô tả tiếng Việt của Netflix
  assert.ok(song.releaseInfo.endsWith('· Netflix Original'));
  assert.deepStrictEqual(song.links.filter((l) => l.category === 'Directors').map((l) => l.name), ['Tyler Perry']);
  assert.deepStrictEqual(song.links.filter((l) => l.category === 'Genres').map((l) => l.name), ['Lãng mạn', 'Phim chính kịch']);
  assert.strictEqual(song.links.filter((l) => l.category === 'Cast').length, 5);
  assert.strictEqual(song.links[0].url, 'stremio:///search?search=L%C3%A3ng%20m%E1%BA%A1n');
  assert.ok(searches.some(([t, q]) => t === 'tv' && q === 'EN-Cái bẫy'));
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
  h = freshHandler();
  dbg = (await call(h, '/debug.json')).body;
  assert.ok(dbg.source.startsWith('html'));
  assert.strictEqual(dbg.read, 20);
  assert.strictEqual(dbg.matchedViaWikidata, 0);
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
