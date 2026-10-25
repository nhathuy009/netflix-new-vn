// Chạy thử trên máy: TMDB_API_KEY=xxx node server.js
const http = require('http');
const handler = require('./api/index');
const port = process.env.PORT || 7000;
http.createServer(handler).listen(port, () => {
  console.log(`Addon: http://127.0.0.1:${port}/manifest.json`);
  console.log(`Kiểm tra: http://127.0.0.1:${port}/debug.json`);
});
