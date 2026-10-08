# DealHunter Assistant — Client-Side Fast Voucher Clicker

> **Hướng dẫn sử dụng cho người dùng:** [`docs/extension/huong-dan-su-dung.md`](../docs/extension/huong-dan-su-dung.md)

Tiện ích mở rộng trình duyệt (Chrome Extension) theo chuẩn **Manifest V3**, chuyên dụng để săn mã giảm giá chớp nhoáng (flash vouchers 0h, 9h, 12h, 18h, 21h) trên **Shopee Việt Nam** và tích hợp thông tin trí tuệ giá của hệ sinh thái **DealHunter**.

---

## 1. Tính Năng Nổi Bật

1. **Tối ưu 100% cho Shopee Web**:
   - Đồng bộ đồng hồ Shopee Server qua HTTP HEAD ping với độ chính xác mili-giây.
   - Web Worker Ticker độc lập, không bị Chrome bóp nghẹt tài nguyên khi tab chạy nền (bypass tab background throttling).
   - Mô phỏng chuỗi sự kiện chuột người dùng (`pointerdown` -> `mousedown` -> `pointerup` -> `mouseup` -> `click`) với tọa độ ngẫu nhiên bên trong nút, chống bị Shopee gắn cờ gian lận (lỗi F02 / M04).
2. **Hỗ trợ đầy đủ 2 chế độ săn mã**:
   - **Chế độ 1: Bán tự động (Semi-Auto)**: Người dùng mở sẵn trang Shopee, Extension hiển thị Floating HUD góc màn hình đếm ngược mili-giây, cho phép trỏ chọn nút voucher và tự động kích hoạt Turbo Click khi đến giờ G.
   - **Chế độ 2: Tự động hoàn toàn (Full-Auto)**: Người dùng lên lịch hẹn trước trong Popup Extension (chọn khung giờ và link mục tiêu), Service Worker (`chrome.alarms`) tự động mở tab Shopee trước 60 giây, pre-warm kết nối, cuộn trang tới nút và tự động bắn click đúng giờ G.
3. **Thẻ giá trên trang sản phẩm (chỉ khi đã đăng nhập DealHunter web)**:
   - Đã đăng nhập DealHunter web: trên trang sản phẩm Shopee bạn đang theo dõi, hiển thị giá DealHunter ghi nhận và báo nếu sàn khác (Lazada/TikTok Shop) rẻ hơn — chỉ dữ liệu thật trong tài khoản của bạn.
   - Chưa đăng nhập: thẻ không hiện, extension chỉ có các tính năng săn deal.
4. **Kiến trúc sẵn sàng mở rộng (Extensible Marketplace Adapter)**:
   - Áp dụng mẫu thiết kế `MarketplaceAdapter` interface, sẵn sàng mở rộng sang Lazada và TikTok Shop mà không cần sửa đổi lõi xử lý thời gian và turbo click.

---

## 2. Hướng Dẫn Cài Đặt (Developer Mode)

### Bước 1: Biên dịch mã nguồn Extension
Tại thư mục `dealhunter/extension`:
```bash
npm install
npm run build
```
Sau khi lệnh hoàn tất, thư mục `dist/` sẽ chứa trọn bộ file cài đặt tiện ích (`manifest.json`, `background.js`, `content.js`, `popup.html`, `icons/`).

### Bước 2: Nạp tiện ích vào trình duyệt (Google Chrome / Edge / Cốc Cốc / Brave)
1. Mở trình duyệt và truy cập: `chrome://extensions/` (hoặc `edge://extensions/`, `coccoc://extensions/`).
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấn vào nút **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn đường dẫn đến thư mục:
   ```text
   /Users/tien.dang/Workplace/reference/dealhunter/extension/dist
   ```
5. Biểu tượng **DealHunter Assistant** sẽ xuất hiện trên thanh công cụ của trình duyệt. Ghim (Pin) tiện ích lên thanh tiện ích để tiện sử dụng.

### Bước 3 (tuỳ chọn): Kết nối với tài khoản DealHunter web
Extension không tự đăng nhập. Web DealHunter gửi phiên đăng nhập sang extension mỗi khi bạn đăng nhập hoặc phiên được làm mới (access token 15 phút), và xoá khi bạn đăng xuất.
1. Mở `chrome://extensions`, sao chép **ID** của DealHunter Assistant.
2. Trong `dealhunter-web/.env.local` đặt `NEXT_PUBLIC_EXTENSION_ID=<ID>` rồi khởi động lại web (production: biến `EXTENSION_ID` của `docker-compose.prod.yml`).
3. Đăng nhập DealHunter web bằng Google. Popup extension hiện "Da ket noi DealHunter".
- Web chỉ gửi được phiên từ các origin trong `externally_connectable` (`public/manifest.json`) và `DEALHUNTER_WEB_ORIGINS` (`src/lib/constants.ts`): `http://localhost:3000`, `http://localhost:3100`, `https://dealhunter.vn`.
- **Địa chỉ API / web không cần cấu hình trong extension**: cùng tin nhắn phiên, web gửi kèm `apiUrl` (chính `NEXT_PUBLIC_API_URL` của web) và `webUrl` (origin của trang web). Extension kiểm tra rồi lưu vào `chrome.storage.local` (vẫn giữ sau khi đăng xuất) và dùng cho mọi lệnh gọi API và liên kết:
  - `apiUrl` phải là http(s) trên `localhost`/`127.0.0.1`, hoặc `https` trên `dealhunter.vn` / `*.dealhunter.vn`; không có query/fragment.
  - `webUrl` phải trùng origin của trang đã gửi tin nhắn và nằm trong `DEALHUNTER_WEB_ORIGINS`.
  - Giá trị không hợp lệ bị bỏ qua. Khi chưa nhận được gì từ web, extension dùng mặc định cho dev: `http://localhost:8080/api/v1` và `http://localhost:3000` (`DEFAULT_SETTINGS` trong `src/lib/constants.ts`).
- Phiên chỉ nằm trong `chrome.storage.session` (mất khi đóng trình duyệt) và chỉ service worker dùng; content script trên Shopee không thấy token.
- Token hết hạn khoảng 15 phút sau lần cuối web làm mới phiên. Web chỉ làm mới khi nó cần gửi yêu cầu tới API (token sắp hết hạn), nên một tab web để nền không gửi yêu cầu nào thì cũng không làm mới: mở tab web (hoặc thao tác trên web) để phiên được làm mới và gửi lại cho extension. Khi token hết hạn, thẻ giá ẩn đi. Extension không tự làm mới phiên, vì refresh token xoay vòng nghiêm ngặt: làm mới song song với web sẽ bị coi là dùng lại token và mọi phiên bị thu hồi.
- ID của extension nạp từ thư mục (unpacked) phụ thuộc đường dẫn thư mục; nạp lại từ thư mục khác thì phải cập nhật `NEXT_PUBLIC_EXTENSION_ID`.

---

## 3. Hướng Dẫn Sử Dụng Thực Chiến

### Chế độ 1: Bán tự động (Semi-Auto) — Dành cho phiên săn trực tiếp
1. Trước khung giờ mở mã 2 - 5 phút (ví dụ: 23h55): Mở trang Shopee chứa mã bạn muốn săn:
   - Hub mã giảm giá: `https://shopee.vn/m/ma-giam-gia`
   - Hoặc trang chiến dịch: `https://shopee.vn/m/10-10`, `https://shopee.vn/m/11-11`
   - Hoặc giỏ hàng: `https://shopee.vn/cart`
2. Bạn sẽ thấy thanh **DealHunter Assistant HUD** xuất hiện ở góc dưới bên phải màn hình:
   - Quan sát dòng đồng hồ Shopee Server màu xanh lá (chính xác đến mili-giây).
   - Nhấn **Trỏ Chọn Nút**: Rê chuột vào nút "Lưu" hoặc "Áp dụng" trên màn hình Shopee, viền xanh sẽ sáng lên để khóa mục tiêu. (Hoặc bấm **Tự Tìm Nút** để hệ thống tự động tìm).
   - Nhấn nút màu xanh **BẬT SĂN MÃ (SEMI-AUTO)**.
3. Đúng thời điểm `23:59:59.900`, tiện ích sẽ tự động bắn chuỗi click tốc độ cao (35ms/click) trong vòng 1.5 - 2.0 giây cho đến khi nút chuyển sang trạng thái "Đã lưu".

### Chế độ 2: Tự động hoàn toàn (Full-Auto) — Dành cho việc hẹn giờ trước
1. Nhấn vào biểu tượng tiện ích DealHunter trên thanh trình duyệt.
2. Tại mục **Hẹn Giờ Săn Voucher**:
   - Chọn chế độ: **Tự động 100%**.
   - Chọn khung giờ: `0h`, `9h`, `12h`, `15h`, `18h`, hoặc `21h`.
   - Chọn trang Shopee mục tiêu (hoặc dán link trang chiến dịch).
   - Điền từ khóa lọc (tùy chọn, ví dụ: "15%", "500k").
   - Nhấn **Đặt Lịch Săn Mã**.
3. Trước giờ G 60 giây, tiện ích sẽ tự động mở tab Shopee mới, pre-warm kết nối, cuộn trang tới vị trí nút và tự động bắn click đúng 00:00:00.000.

---

## 3b. Quy Tắc Săn Mã (áp dụng cho mọi khung giờ)

1. **Giờ G là giờ Việt Nam (GMT+7)** — tính đúng kể cả khi máy đặt múi giờ khác.
2. **Đồng hồ Shopee** đo bằng cách bắt đúng khoảnh khắc đồng hồ máy chủ Shopee nhảy sang giây mới (không dùng thẳng header `Date` vốn chỉ chính xác tới 1 giây). HUD hiển thị `+độ lệch ±sai số`; nếu hiện **CHUA DONG BO** thì bấm vào để đo lại trước giờ G.
3. **Chọn đúng voucher**: hoặc bấm **Trỏ Chọn Nút** rồi bấm vào nút "Lưu" của voucher muốn săn (khóa được cả khi nút đang mờ/disabled trước giờ G), hoặc nhập **từ khóa** ("500k", "15%") ở chế độ Tự động 100%.
   - Khi đã khóa một voucher, tiện ích **chỉ** click voucher đó — kể cả khi Shopee render lại thẻ lúc mở mã. Không bao giờ chuyển sang click voucher khác.
   - Không khóa, không từ khóa: chỉ click voucher **mở ra đúng giờ G**, bỏ qua các voucher đã mở sẵn trước đó.
4. **Bắt đầu click 150ms trước giờ G** (bù sai số đồng hồ), mỗi 35ms, tối đa 80 click, trong cửa sổ 3 giây sau giờ G. Bộ đếm chạy bằng Web Worker nên không bị Chrome làm chậm khi tab ở nền.
5. **Kết quả là những gì trang Shopee hiển thị**, không tự báo thành công:
   - `ĐÃ LƯU MÃ` — nút chuyển sang "Đã lưu"/"Dùng ngay"/...
   - `Voucher đã hết lượt` — trang hiện "Hết lượt"/"Đã hết"
   - `Không thấy nút voucher` — không có nút phù hợp trong khung giờ
   - `Đã click nhưng trang chưa xác nhận` — hãy mở ví voucher để kiểm tra
   - Tự động 100% còn báo rõ nếu Shopee chuyển sang trang xác minh (captcha) hoặc chưa đăng nhập.
6. **Trước giờ G**: đăng nhập Shopee trên chính trình duyệt này và mở thử trang mã một lần để vượt xác minh (nếu có). Máy không được ngủ; Chrome phải đang mở.

## 4. Kiểm Thử Mã Nguồn (Unit Tests & Quality Assurance)

Chạy bộ kiểm thử tự động Vitest:
```bash
npm test
```
- `element_resolver.test.ts`: Kiểm tra nhận diện chính xác các nút "Lưu", "Lưu mã", "Thu thập" và lọc theo từ khóa.
- `human_clicker.test.ts`: Kiểm tra chuỗi sự kiện chuột mô phỏng tự nhiên với tọa độ ngẫu nhiên.
- `endpoints.test.ts`: Chỉ chấp nhận URL API/web hợp lệ do web gửi (http(s), host DealHunter), còn lại dùng mặc định dev.
- `api_client.test.ts`: Phần trăm "Rẻ hơn" tính theo giá của chính nguồn Shopee đang xem; không biết giá thì không hiện phần trăm.
- `time_calibrator.test.ts`: Thuật toán bắt mốc đổi giây khôi phục đúng độ lệch đồng hồ (sai số ≤ RTT/2); không có mốc đổi giây thì báo "chưa đồng bộ".
- `hunt_engine.test.ts`: Không click trước giờ G; chỉ báo đã lưu khi trang xác nhận; theo được nút bị React thay mới; báo hết lượt / không tìm thấy / hết giờ đúng sự thật; lọc từ khóa; không bao giờ click nhầm voucher khác.
- `drop_time.test.ts`: Giờ G theo giờ Việt Nam.
- E2E trên Chrome thật: xem `e2e/README.md`.

Kiểm tra Zero-Emoji:
Tuân thủ tuyệt đối 100% quy chuẩn Zero-Emoji trên toàn bộ mã nguồn và giao diện.
