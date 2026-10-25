# Mới trên Netflix (VN) – Stremio catalog addon

Tạo 4 danh sách trong Stremio:

- **Netflix: Phim mới**, **Netflix: Loạt phim mới**: từ https://about.netflix.com/vi/new-to-watch
- **Netflix: Top 10 phim Việt Nam**, **Netflix: Top 10 loạt phim Việt Nam**: bảng xếp hạng theo tuần của Netflix Tudum, https://www.netflix.com/tudum/top10/vietnam và https://www.netflix.com/tudum/top10/vietnam/tv

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
4. Tải trang phim Netflix của từng tựa (`netflix.com/vn/title/<id>`) để lấy loại chính xác (phim/loạt phim), đạo diễn, diễn viên, thể loại, mô tả tiếng Việt và cờ Netflix Original.
5. Tìm IMDb ID cho từng tựa:
   - **Wikidata trước:** tra thẳng theo mã Netflix (thuộc tính `P1874`), một request cho cả danh sách. Chính xác tuyệt đối, nhưng phim mới thường chưa được nhập.
   - **Không có trên Wikidata:** tìm TMDB bằng tên tiếng Việt và tiếng Anh (với Netflix Original chiếu lần đầu, tìm thêm một lượt lọc theo năm lên Netflix), xét toàn bộ 20 kết quả mỗi lượt, chấm điểm ứng viên theo loại, tên và ngày ra mắt so với ngày lên Netflix. Với Netflix Original chiếu lần đầu, ứng viên ra trước ngày lên Netflix hơn 1 năm bị loại. Với 3 ứng viên tốt nhất, đối chiếu đạo diễn và diễn viên với trang Netflix (+6 nếu trùng đạo diễn, +6 nếu trùng từ 2 diễn viên, −4 nếu không trùng ai), rồi lấy ứng viên tổng điểm cao nhất có IMDb ID.
   - Tựa không có IMDb ID sẽ bị bỏ (Stremio cần ID `tt...`).
6. Kết quả được cache 6 giờ. Lần tải đầu mất khoảng 20–40 giây.

### Top 10 Việt Nam theo tuần

1. Đọc hai trang Netflix Tudum (phim lẻ và loạt phim). Bảng xếp hạng tính theo tuần thứ Hai đến Chủ nhật, cập nhật mỗi thứ Ba.
2. Mỗi tựa có một khối `Top10Data`: thứ hạng tuần (`weeklyRank`), số tuần trong Top 10 (`cumulativeWeeksInTop10`), ngày cuối tuần (`weekEndDate`) và mã Netflix (`videoId`; với loạt phim là mã của mùa). Trang lưu mỗi khối hai lần, addon bỏ bản trùng.
3. Đọc trang phim của từng mã để lấy tên, loại, mã gốc, đạo diễn, diễn viên, mô tả; rồi tìm IMDb ID như danh sách phim mới (Wikidata trước, sau đó tìm TMDB).
4. Xếp theo thứ hạng Netflix, hiển thị dạng "#4 tại Việt Nam · 20 tuần trong Top 10". Một loạt phim có nhiều mùa cùng lọt Top 10 chỉ hiện một lần, ở hạng cao nhất.
5. Trang Top 10 lỗi, hoặc Netflix chuyển sang trang nước khác: dòng tương ứng trống và `/debug.json` ghi lý do; các dòng khác vẫn chạy.

## Chạy thử trên máy

```bash
npm test                              # test không cần mạng, dùng HTML thật trong fixtures/
TMDB_API_KEY=khoa_cua_ban npm start   # http://127.0.0.1:7000/manifest.json
```

Mở `http://127.0.0.1:7000/debug.json` để kiểm tra:
- `source`: `api` là lấy đủ các trang; `html (...)` là API lỗi, chỉ có trang 1.
- `totalItems` / `read`: Netflix có bao nhiêu tựa, addon đọc được bao nhiêu.
- `netflixPages`: số trang phim Netflix đọc được. Bằng 0 nghĩa là Netflix chặn request từ máy chủ; addon vẫn chạy nhưng không có đối chiếu người và metadata bổ sung.
- `matchedViaWikidata`: số tựa khớp chính xác qua Wikidata.
- `matchedItems`: mỗi tựa khớp với mã TMDB/IMDb nào, qua nguồn nào (`wikidata` hoặc `search`), và với `search` thì các ứng viên đã thử kèm điểm (`điểm 4+12` = điểm theo tên/ngày + điểm đối chiếu người).
- `needsReview`: các tựa khớp theo tên mà không trùng đạo diễn hay diễn viên nào, kèm link TMDB và Netflix để kiểm tra tay.
- `unmatched`: các tựa không khớp, kèm các ứng viên đã thử.
- `top10`: địa chỉ và lỗi (nếu có) của từng bảng (`lists`), tuần xếp hạng (`weekEnd`), số tựa khớp, và từng tựa theo thứ hạng kèm số tuần trong Top 10.

## Deploy lên Vercel

1. Đưa thư mục này lên một repo GitHub, rồi Import vào Vercel (không cần build command).
2. Settings → Environment Variables: thêm `TMDB_API_KEY` (API key v3 hoặc Read Access Token v4 đều được).
3. Deploy. URL addon: `https://<ten-du-an>.vercel.app/manifest.json`
4. Trong Stremio: Addons → dán link manifest vào ô tìm kiếm → Install.

## Giới hạn cần biết

- **API:** đường dẫn và định dạng phản hồi đã khớp với request thật từ trình duyệt (`fixtures/api-releases-vi-page2.json`). Addon gọi API không kèm cookie hay đăng nhập. Nếu Netflix chặn request từ máy chủ Vercel, `source` trong `/debug.json` sẽ báo `html`.
- **Khớp tên:** tìm TMDB bằng tên tiếng Việt, lấy kết quả đầu tiên. Tựa tên chung chung có thể khớp nhầm.
