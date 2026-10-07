# DealHunter — Kế Hoạch & Thiết Kế Kỹ Thuật Chrome Extension Assistant
# (Client-Side Fast Voucher Clicker & Price Intelligence In-Page)

> **Mục tiêu tài liệu**: Đặc tả vị trí kiến trúc, mô hình dữ liệu, cơ chế tương tác API giữa **Backend DealHunter** và **DealHunter Chrome Extension (Client-Side Assistant)**; đồng thời giải thích chiến lược kinh doanh bảo toàn hoa hồng Affiliate và lộ trình mở rộng đa sàn TMĐT.

---

## 1. Bối Cảnh & Động Lực Phát Triển

### 1.1. Nỗi Đau Thực Tế Của Người Dùng (User Pain Points)
1. **Hiện tượng "bốc hơi" của Voucher lớn (Flash Vouchers)**:
   - Các mã giảm giá 15% - 20%, voucher 500k - 1 triệu vào các đợt Siêu Sale (10/10, 11/11, 12/12) tại các khung giờ vàng (0h, 9h, 12h, 18h, 21h) thường hết sạch trong 1 đến 3 giây.
   - Người dùng bấm tay thông thường không thể cạnh tranh được với công cụ auto-click.
2. **Shopee Anti-Bot chặn triệt để Server-Side Bot**:
   - Shopee áp dụng cơ chế xác thực 2 lớp (2FA/OTP), Cloudflare WAF, canvas fingerprinting và captcha trượt hình.
   - Nếu Backend DealHunter tự động đăng nhập tài khoản người dùng từ server để "lưu hộ", máy chủ sẽ bị ban IP, tài khoản Shopee của khách hàng sẽ bị khóa vĩnh viễn (lỗi F02/M04) và tài khoản Affiliate của DealHunter sẽ bị sàn hủy hoa hồng.

### 1.2. Giải Pháp: Client-Side Assistant Chuẩn Manifest V3
Thay vì can thiệp bằng bot từ máy chủ, DealHunter cung cấp tiện ích mở rộng chạy trực tiếp trên trình duyệt của người dùng (**Client-Side**):
- Sử dụng địa chỉ IP mạng cá nhân và cookie đăng nhập chính chủ của người dùng $\to$ **100% hợp lệ và an toàn**.
- Tự động bù trừ độ lệch đồng hồ Shopee Server qua HTTP HEAD ping với độ chính xác mili-giây.
- Web Worker Ticker độc lập duy trì nhịp click 25ms - 35ms không bị Chrome bóp nghẹt tài nguyên khi tab chạy nền.
- Đóng vai trò là "Cánh tay nối dài" trên trình duyệt, kết nối dữ liệu 2 chiều với Backend Go API.

---

## 2. Vị Trí Trong Kiến Trúc Tổng Thể Hệ Sinh Thái

```mermaid
flowchart TD
    subgraph Browser ["Trình Duyệt Người Dùng (Client Machine)"]
        ShopeeTab["Tab Web Shopee.vn (DOM, React App, Voucher Hub, Cart)"]
        
        subgraph Extension ["DealHunter Chrome Extension (Manifest V3)"]
            HUD["Floating HUD (Đếm ngược mili-giây, Chọn nút, Semi-Auto)"]
            Scheduler["Background Scheduler (chrome.alarms, Full-Auto)"]
            PriceBadge["Price History Badge (Floating Widget trên Product Page)"]
            CoreEngine["Core Clicker (TimeSync, WebWorker, HumanizedClick)"]
        end
        
        WebDashboard["DealHunter Web (Next.js 14 Dashboard)"]
    end

    subgraph Backend ["DealHunter Backend (Go Monolith)"]
        API["REST API Server (cmd/api)"]
        VoucherService["Voucher Intelligence (internal/voucher)"]
        ComparisonService["Comparison Engine (internal/comparison)"]
        AffiliateTransformer["Affiliate Transformer (pkg/affiliate)"]
        Database[(PostgreSQL 15)]
        RedisCache[(Redis Cache & Stream)]
    end

    HUD <-->|DOM Events & Clicks| ShopeeTab
    PriceBadge <-->|Extract SKU| ShopeeTab
    Scheduler -->|chrome.tabs.create| ShopeeTab
    
    PriceBadge -->|GET /tracked-products/{id}/comparison| API
    HUD -->|GET /tracked-products/{id}/vouchers| API
    WebDashboard -->|REST API| API
    
    API <--> VoucherService
    API <--> ComparisonService
    VoucherService --> AffiliateTransformer
    ComparisonService --> RedisCache
    ComparisonService --> Database
```

---

## 3. Các Luồng Nghiệp Vụ Tương Tác Giữa Extension Và Backend

### 3.1. Luồng Báo Giá & So Sánh Đa Sàn (In-Page Price Intelligence)
Khi người dùng đang lướt xem bất kỳ sản phẩm nào trên trang `shopee.vn/product/...` hoặc `shopee.vn/*-i.*.*`:
1. **Extension** trích xuất URL và mã định danh sản phẩm (`itemId`, `shopId`).
2. **Extension** gọi API:
   ```http
   GET /api/v1/tracked-products
   ```
3. Nếu sản phẩm đã nằm trong hệ thống theo dõi:
   - Extension gọi tiếp:
     ```http
     GET /api/v1/tracked-products/{id}/comparison
     ```
   - Nhận về thông tin `best_deal`, giá đáy lịch sử 30 ngày, giá so sánh trên Lazada và TikTok Shop.
   - Hiển thị component `PriceHistoryBadge` nhỏ gọn ở góc màn hình báo: *"Sản phẩm này đang rẻ hơn 18% trên TikTok Shop"* kèm link chuyển đổi.
4. Nếu sản phẩm chưa có trong hệ thống:
   - Hiển thị nút "Theo dõi giá trên DealHunter". Người dùng bấm 1 chạm sẽ tự động gửi `POST /api/v1/tracked-products` vào tài khoản cá nhân.

---

### 3.2. Luồng Săn Voucher & Kích Hoạt Hoa Hồng (Voucher Hunt & Early Cookie Drop)
Khi người dùng truy cập trang mã giảm giá Shopee (`shopee.vn/m/ma-giam-gia`, `shopee.vn/m/10-10`, `shopee.vn/cart`):
1. **Extension** kích hoạt `FloatingHUD` kèm đồng hồ Shopee Server mili-giây.
2. Extension lấy danh sách mã hot ngày Siêu Sale từ Backend:
   ```http
   GET /api/v1/tracked-products/{id}/vouchers
   ```
3. Các URL thu thập mã (`collect_url`) trả về từ Backend đã được bọc sẵn **Affiliate Deeplink**:
   ```text
   https://s.shopee.vn/universal-link?url=https%3A%2F%2Fshopee.vn%2Fm%2F10-10&sub_id=u_{user_id}_p_{product_id}
   ```
4. **Hiệu ứng kép (Double Benefit)**:
   - **Với người dùng**: Extension kích hoạt chuỗi click tốc độ 35ms giúp họ giật được mã 500k trước khi hết lượt.
   - **Với hệ sinh thái DealHunter**: Thao tác mở trang và lưu mã kích hoạt ngay lập tức **Cookie Affiliate 7 - 30 ngày** có gắn mã `sub_id` của DealHunter. Khi người dùng hoàn tất đơn hàng, DealHunter được ghi nhận 100% doanh thu hoa hồng.

---

## 4. Hai Chế Độ Vận Hành Chi Tiết

### 4.1. Chế Độ 1: Bán Tự Động (Semi-Auto) — Trợ Lý Trực Tiếp
* **Mục đích**: Dành cho người dùng chủ động ngồi trước máy tính vào khung giờ vàng (ví dụ lúc 23h55).
* **Quy trình hoạt động**:
  1. Người dùng mở sẵn tab Shopee chứa voucher cần săn.
  2. Floating HUD hiển thị đồng hồ Shopee Server và độ lệch ping RTT.
  3. Người dùng bấm **Trỏ Chọn Nút** (hoặc để hệ thống **Tự Tìm Nút**).
  4. Chọn khung giờ mục tiêu (mặc định: Khung giờ vàng kế tiếp `0h, 9h, 12h, 15h, 18h, 21h`, hoặc Phút kế tiếp để test).
  5. Bấm **BẬT SĂN MÃ (SEMI-AUTO)**.
  6. Đúng thời điểm `TargetTime - 80ms`: Tiện ích tự động bắn chuỗi click tốc độ 35ms trong vòng 1.5 - 2.0 giây cho đến khi nút chuyển sang trạng thái "Đã lưu".

---

### 4.2. Chế Độ 2: Tự Động Hoàn Toàn (Full-Auto) — Đặt Lịch Hẹn Trước
* **Mục đích**: Dành cho người dùng không muốn thức canh màn hình hoặc muốn chuẩn bị trước nhiều tiếng đồng hồ.
* **Quy trình hoạt động**:
  1. Người dùng mở Popup Extension, chọn:
     - Khung giờ săn (ví dụ: `0h00`).
     - Trang Shopee mục tiêu (Hub mã, giỏ hàng, hoặc trang chiến dịch 10/10).
     - Từ khóa lọc voucher (ví dụ: `"15%"`, `"500k"`).
  2. Background Service Worker tạo lịch hẹn qua `chrome.alarms.create`.
  3. **Thời điểm `T - 60 giây`**:
     - Service Worker đánh thức, gửi lệnh `chrome.tabs.create` tự động mở tab Shopee mới và đưa vào trạng thái `active: true`.
     - Đo lại RTT ping để hiệu chỉnh đồng hồ máy chủ Shopee lần cuối.
     - Content Script tải xong, tự động tìm và khóa mục tiêu khớp với từ khóa.
  4. **Thời điểm `T - 80ms` (Đúng 00:00:00)**:
     - Tự động kích hoạt Turbo Burst Clicker.
     - Cập nhật trạng thái tác vụ thành `completed` và phát âm thanh thông báo để người dùng chốt đơn.

---

## 5. Nguyên Tắc An Toàn & Chống Khóa Tài Khoản (Anti-Ban Safety)

1. **Chuỗi sự kiện chuột toàn diện (Synthetic Event Chain)**:
   Không sử dụng lệnh gọi `element.click()` đơn độc (dễ bị React synthetic event scanner bỏ qua hoặc gắn cờ bot). Sử dụng chuỗi 5 sự kiện chuột hoàn chỉnh:
   $$\text{pointerdown} \longrightarrow \text{mousedown} \longrightarrow \text{pointerup} \longrightarrow \text{mouseup} \longrightarrow \text{click}$$
2. **Tọa độ click ngẫu nhiên bên trong nút (Coordinate Jitter)**:
   Mỗi nhịp click rơi vào tọa độ ngẫu nhiên trong vùng an toàn từ 25% đến 75% chiều dài và chiều rộng của nút bấm, mô phỏng chính xác thao tác nhấp chuột của con người.
3. **Ngắt an toàn tự động (Safe Burst Window)**:
   - Tần suất: 35ms/click.
   - Giới hạn: Tối đa 25 - 30 clicks trong cửa sổ tối đa 2.0 giây.
   - Tự động dừng ngay lập tức khi phát hiện nút chuyển sang nhãn: `"Đã lưu"`, `"Đã nhận"`, `"Dùng ngay"`, `"Hết lượt"`, hoặc bị gắn thuộc tính `disabled`.

---

## 6. Lộ Trình Mở Rộng Đa Sàn (Multi-Marketplace Roadmap)

Hệ thống được thiết kế theo mẫu **MarketplaceAdapter Interface**, cho phép mở rộng không giới hạn:

```text
src/content/adapters/
├── adapter_interface.ts      # Hợp đồng chung cho mọi sàn
├── shopee_adapter.ts        # Hoàn thiện 100% trong đợt này
├── lazada_adapter.ts        # Mở rộng tiếp theo (Lazada Voucher Collector)
└── tiktok_adapter.ts        # Mở rộng tiếp theo (TikTok Shop Live Voucher)
```

* **Giai đoạn 1 (Hiện tại)**: Tối ưu 100% cho Shopee Web (nơi có lượng voucher lớn nhất và cạnh tranh gay gắt nhất).
* **Giai đoạn 2 (Dự kiến)**: Bật module `lazada_adapter.ts` cho các đợt Mega Sale của Lazada (trang `lazada.vn/voucher`).
* **Giai đoạn 3 (Dự kiến)**: Bật module `tiktok_adapter.ts` để tự động giật mã trợ giá trên các phiên TikTok Shop Live.
