# Mới trên Netflix (VN) – Stremio catalog addon

Tạo 2 danh sách trong Stremio từ https://about.netflix.com/vi/new-to-watch:

- **Netflix: Phim mới**
- **Netflix: Loạt phim mới**

Addon chỉ cung cấp danh sách. Bấm vào phim, Stremio dùng các addon stream bạn đã cài để phát.

## Cách hoạt động

1. Gọi API mà chính trang Netflix dùng khi chuyển trang:
   `https://about.netflix.com/api/data/releases?language=vi&country=VN&page=N`
   rồi lấy hết các trang (hiện có 3 trang, 54 tựa).
   Nếu API lỗi, addon đọc dữ liệu nhúng trong HTML trang (`__NEXT_DATA__`), nhưng cách này chỉ có trang 1 (20 tựa).
2. Bỏ trò chơi, tựa trùng và tựa chưa ra mắt.
3. Xác định loại:
   - Netflix ghi rõ loại (`collection`: 2170013 = loạt phim, 2694103 = phim) → dùng luôn.
   - Phụ đề là "Mùa N", "Chương N", "Loạt phim…" → loạt phim.
   - Còn lại → để TMDB quyết định.
4. Tra TMDB theo tên tiếng Việt để lấy poster, mô tả và IMDb ID. Tựa không có IMDb ID sẽ bị bỏ (Stremio cần ID `tt...`).
5. Kết quả được cache 6 giờ.

## Chạy thử trên máy

```bash
npm test                              # test không cần mạng, dùng HTML thật trong fixtures/
TMDB_API_KEY=khoa_cua_ban npm start   # http://127.0.0.1:7000/manifest.json
```

Mở `http://127.0.0.1:7000/debug.json` để kiểm tra:
- `source`: `api` là lấy đủ các trang; `html (...)` là API lỗi, chỉ có trang 1.
- `totalItems` / `read`: Netflix có bao nhiêu tựa, addon đọc được bao nhiêu.
- `unmatched`: các tựa không khớp TMDB.

## Deploy lên Vercel

1. Đưa thư mục này lên một repo GitHub, rồi Import vào Vercel (không cần build command).
2. Settings → Environment Variables: thêm `TMDB_API_KEY` (API key v3 hoặc Read Access Token v4 đều được).
3. Deploy. URL addon: `https://<ten-du-an>.vercel.app/manifest.json`
4. Trong Stremio: Addons → dán link manifest vào ô tìm kiếm → Install.

## Giới hạn cần biết

- **API:** đường dẫn và định dạng phản hồi đã khớp với request thật từ trình duyệt (`fixtures/api-releases-vi-page2.json`). Addon gọi API không kèm cookie hay đăng nhập. Nếu Netflix chặn request từ máy chủ Vercel, `source` trong `/debug.json` sẽ báo `html`.
- **Khớp tên:** tìm TMDB bằng tên tiếng Việt, lấy kết quả đầu tiên. Tựa tên chung chung có thể khớp nhầm.
