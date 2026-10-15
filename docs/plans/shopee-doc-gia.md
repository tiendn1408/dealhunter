# Shopee: đọc giá khi Shopee chặn máy chủ

> Viết 2026-10-15. Trạng thái: **chưa làm**, chờ chủ dự án chọn thời điểm. Liên quan: `docs/third_party_and_environment_requirements.md` (mục 2.3 Affiliate).

## 1. Hiện trạng (đã kiểm tra 2026-10-15)

- Link rút gọn khi bấm «Chia sẻ» trong app Shopee (`vn.shp.ee/...`, `shope.ee/...`, `s.shopee.vn/...`) **đã được nhận diện và mở ra link thật** (đã sửa, có test: `internal/marketplace/registry.go` `IsShortLink`, `WithoutQuery`; adapter Shopee/Lazada/TikTok).
  - Ví dụ: `https://vn.shp.ee/pzvUeCZa` chuyển hướng 301 tới `https://shopee.vn/product/1054984507/29254262829?...`.
- **Shopee chặn backend đọc dữ liệu sản phẩm** (thử từ máy dev):
  - `GET https://shopee.vn/api/v4/item/get?itemid=...&shopid=...` trả **HTTP 403**, `{"error":90309999, ... "redirect_to_error_page":true}` (chống truy cập tự động).
  - Trang `https://shopee.vn/product/<shop>/<item>` trả HTTP 200 nhưng là khung trang rỗng (phải chạy JavaScript), không có `<title>`, `og:image` hay JSON-LD.
- Hệ quả: **mọi link Shopee** (rút gọn hay đầy đủ) đều báo «Không đọc được thông tin sản phẩm từ sàn». Không phải lỗi cấu hình.
- Affiliate Shopee đã được điền cấu hình (`AFFILIATE_ENABLED`, `SHOPEE_AFFILIATE_ID`, `SHOPEE_AFFILIATE_URL_TEMPLATE`), nhưng link affiliate chỉ được tạo cho sản phẩm đã đọc được, nên hiện chưa có sản phẩm Shopee mới nào có link affiliate.
- Chưa kiểm tra: Lazada và TikTok Shop có còn đọc được tự động không.

## 2. Các hướng, theo thứ tự đề xuất

### Hướng A: nhận link Shopee dù chưa đọc được giá (làm trước, nhỏ)

Mục tiêu: người dùng dán link Shopee vẫn được theo dõi và có nút «Mua trên Shopee» qua link affiliate, ngay cả khi chưa có giá.

- Backend: khi adapter Shopee không đọc được dữ liệu **nhưng** link chứa mã shop + mã sản phẩm (`shopeeProductPathPattern` / `shopeeItemPattern`):
  - vẫn tạo `ProductSource` với `ExternalProductID = shopee-<shop>-<item>`, `CanonicalURL = https://shopee.vn/product/<shop>/<item>`, chưa có tên/giá/ảnh;
  - ghi rõ trạng thái «chưa đọc được giá» (cột hoặc cờ mới, ví dụ `read_status = 'blocked'`), **không** bịa tên hay giá;
  - `AffiliateURL` được tạo bình thường từ `CanonicalURL`.
- Worker: không lặp lại việc đọc vô ích mỗi chu kỳ; thử lại thưa (ví dụ mỗi 6-12 giờ) để biết khi nào Shopee mở lại.
- Web: thẻ sản phẩm hiện «Shopee chưa cho đọc giá tự động» thay cho giá, vẫn hiện nút «Mua trên Shopee»; tên sản phẩm tạm là link rút gọn hoặc «Sản phẩm Shopee <mã>» cho tới khi có tên thật.
- Test: link có mã -> tạo được nguồn + link affiliate dù 403; link không có mã -> lỗi như cũ.

### Hướng B: đọc giá Shopee qua tiện ích Chrome (vừa)

Mục tiêu: có giá thật từ trình duyệt đã đăng nhập Shopee của người dùng.

- Tiện ích (`extension/`) đã chạy trên trang sản phẩm Shopee. Khi trang đã hiện đủ, đọc: tên, giá đang bán (lưu ý sản phẩm nhiều phân loại có khoảng giá), còn hàng, ảnh, mã shop + mã sản phẩm từ URL.
  - Ưu tiên đọc từ câu trả lời API mà **chính trang** đã gọi (trang ký request hợp lệ), không tự gọi API Shopee.
- Gửi về backend qua endpoint mới, ví dụ `POST /api/v1/extension/price-observations` (xác thực bằng phiên đăng nhập web đã truyền cho tiện ích). Backend kiểm tra: đúng sàn, đúng mã, giá hợp lý; ghi thành một lần kiểm tra trong `price_snapshots` với nguồn `extension`.
- Chỉ ghi cho sản phẩm có người đang theo dõi; không thu thập lịch sử duyệt web khác.
- Hạn chế: giá chỉ cập nhật khi có người mở trang Shopee có tiện ích; không tự kiểm tra theo giờ.
- Cần quyết định: dữ liệu từ tiện ích của một người có được dùng cho người khác cùng theo dõi sản phẩm đó không (đề xuất: có, vì là giá công khai).

### Hướng C: AccessTrade (cần kiểm chứng)

- AccessTrade là mạng affiliate lớn ở Việt Nam, có chiến dịch Shopee, thường duyệt dễ hơn Shopee trực tiếp.
- **Chưa kiểm chứng** API của họ trả được giá/tên/ảnh sản phẩm Shopee hay chỉ tạo deeplink. Khi có tài khoản: đọc tài liệu API của họ, ghi kết quả vào mục 4.
- Deeplink AccessTrade đã có chỗ cấu hình (`ACCESSTRADE_DEEPLINK_URL`).

### Hướng D: Shopee Affiliate Open API (dài hạn)

- Kênh chính thức: theo mã shop + mã sản phẩm trả tên, giá, ảnh, hoa hồng, và link affiliate.
- Shopee xét duyệt chặt (thường cần tài khoản affiliate có lượt truy cập/đơn hàng). Nộp đơn song song; khả năng được duyệt tăng khi DealHunter có đơn qua link affiliate.
- Khi có AppID + Secret: chủ dự án tự điền vào file cấu hình của backend; viết adapter đọc qua API, ưu tiên hơn đọc trang.

### Không đề xuất

- Chạy trình duyệt ảo trên máy chủ giả làm người dùng, hoặc mua dữ liệu từ dịch vụ thu thập trả phí: dễ hỏng, tốn phí, rủi ro điều khoản Shopee.

## 3. Việc chủ dự án cần làm

- [ ] Chọn thời điểm làm hướng A (rồi B).
- [ ] Nộp đơn Shopee Open API trong trang affiliate.shopee.vn (nếu thấy mục Open API); chụp màn hình yêu cầu/kết quả để ghi vào mục 4.
- [ ] Nếu có tài khoản AccessTrade: gửi link tài liệu API của họ.
- [ ] Đồng ý cho kiểm tra Lazada và TikTok Shop còn đọc được tự động không (dùng vài link sản phẩm thật).

## 4. Nhật ký kiểm chứng

| Ngày | Kiểm tra | Kết quả |
| --- | --- | --- |
| 2026-10-15 | `vn.shp.ee/pzvUeCZa` chuyển hướng | 301 -> `shopee.vn/product/1054984507/29254262829` |
| 2026-10-15 | Shopee item API từ máy dev | 403, `error: 90309999` |
| 2026-10-15 | Trang sản phẩm Shopee từ máy dev | 200, khung rỗng, không có tên/giá/ảnh |
