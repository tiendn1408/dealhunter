# DealHunter Assistant — Client-Side Fast Voucher Clicker

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
3. **Price History & Deal Score Badge**:
   - Tự động hiển thị widget nhỏ gọn trên trang chi tiết sản phẩm Shopee: báo đáy lịch sử 30 ngày và so sánh Best Deal nếu sản phẩm đang rẻ hơn trên Lazada/TikTok Shop.
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

## 4. Kiểm Thử Mã Nguồn (Unit Tests & Quality Assurance)

Chạy bộ kiểm thử tự động Vitest:
```bash
npm test
```
- `element_resolver.test.ts`: Kiểm tra nhận diện chính xác các nút "Lưu", "Lưu mã", "Thu thập" và lọc theo từ khóa.
- `human_clicker.test.ts`: Kiểm tra chuỗi sự kiện chuột mô phỏng tự nhiên với tọa độ ngẫu nhiên.
- `time_calibrator.test.ts`: Kiểm tra thuật toán đo RTT và bù trừ độ lệch đồng hồ máy chủ.

Kiểm tra Zero-Emoji:
Tuân thủ tuyệt đối 100% quy chuẩn Zero-Emoji trên toàn bộ mã nguồn và giao diện.
