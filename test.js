// Test không cần mạng: dùng HTML thật của trang Netflix (fixtures/) và giả lập API Netflix + TMDB.
const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync(__dirname + '/fixtures/new-to-watch-vi.html', 'utf8');
const page1 = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]).props.pageProps.data;
const realPage2 = require('./fixtures/api-releases-vi-page2.json'); // phản hồi thật của API trang 2
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

let apiUp = true;
const searches = [];
global.fetch = async (url) => {
  const u = new URL(url);
  const json = (o) => ({ ok: true, json: async () => o });
  if (u.hostname === 'about.netflix.com') {
    if (u.pathname === '/api/data/releases') {
      if (!apiUp) return { ok: false, status: 403 };
      assert.strictEqual(u.searchParams.get('language'), 'vi');
      assert.strictEqual(u.searchParams.get('country'), 'VN');
      return json(apiPages[u.searchParams.get('page')]);
    }
    if (u.pathname === '/vi/new-to-watch') return { ok: true, text: async () => html };
  }
  const s = u.pathname.match(/\/search\/(movie|tv|multi)$/);
  if (s) {
    const q = u.searchParams.get('query');
    searches.push([s[1], q]);
    if (q === 'Không có trên TMDB') return json({ results: [] });
    const media = s[1] === 'multi' ? 'movie' : s[1];
    return json({ results: [{ id: q.length * 1000 + q.charCodeAt(0), media_type: media, poster_path: '/p.jpg', overview: 'Mô tả' }] });
  }
  const e = u.pathname.match(/\/(movie|tv)\/(\d+)\/external_ids$/);
  if (e) return json({ imdb_id: `tt${e[2]}` });
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
  const times = series.map((x) => x.releaseInfo.slice(12).split('/').reverse().join(''));
  assert.deepStrictEqual(times, [...times].sort().reverse());
  assert.deepStrictEqual((await call(h, '/catalog/movie/netflix-new-movie/skip=100.json')).body.metas, []);
  assert.strictEqual((await call(h, '/catalog/movie/khac.json')).status, 404);

  // Kịch bản 2: API lỗi → đọc __NEXT_DATA__ trong HTML (trang 1)
  apiUp = false;
  h = freshHandler();
  dbg = (await call(h, '/debug.json')).body;
  assert.ok(dbg.source.startsWith('html'));
  assert.strictEqual(dbg.read, 20);
  assert.ok((await call(h, '/catalog/series/netflix-new-series.json')).body.metas.length > 0);

  console.log('OK: tất cả test đều đạt');
})().catch((e) => { console.error(e); process.exit(1); });
