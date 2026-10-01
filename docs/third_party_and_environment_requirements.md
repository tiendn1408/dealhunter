# DealHunter — Danh Sách & Biểu Mẫu Cấu Hình Bên Thứ Ba (API Keys & Credentials)

> [!NOTE]
> Tài liệu này liệt kê toàn bộ các dịch vụ bên thứ ba (Third-party Services), khóa bảo mật (API Keys / Secrets), cấu hình Webhook và biến môi trường cần thiết để vận hành hệ sinh thái **DealHunter** từ môi trường phát triển (Local/Dev) lên môi trường thực tế (Staging/Production).

---

## 1. Bảng Tổng Hợp Thông Tin Cần Điền (Quick Checklist)

| Dịch vụ bên thứ ba | Thông số / Khóa cần điền | Mục đích sử dụng | Bắt buộc khi nào? | Nơi lấy thông tin |
| :--- | :--- | :--- | :--- | :--- |
| **Google Cloud** | `GOOGLE_CLIENT_ID` | Đăng nhập Google 1-click & đồng bộ dữ liệu | Chạy tính năng Auth thật (GAP-02) | [Google Cloud Console](https://console.cloud.google.com/) |
| **Zalo Developers** | `ZALO_APP_ID` | Định danh ứng dụng Zalo | Chạy thông báo Zalo OA (GAP-04) | [Zalo for Developers](https://developers.zalo.me/) |
| **Zalo Developers** | `ZALO_OA_SECRET_KEY` | Tạo token truy cập & xác thực chữ ký | Chạy thông báo Zalo OA (GAP-04) | [Zalo for Developers](https://developers.zalo.me/) |
| **Zalo OA / ZNS** | `ZALO_REFRESH_TOKEN` | Duy trì Access Token 24/7 (vòng đời 25h) | Chạy thông báo Zalo OA (GAP-04) | OAuth v4 Authorization Flow |
| **Zalo OA / ZNS** | `ZALO_OA_ACCESS_TOKEN` | Token gửi tin nhắn tức thì (nếu có sẵn) | Tùy chọn (hệ thống tự sinh từ refresh) | Zalo API Explorer |
| **Zalo ZNS** | `ZALO_TEMPLATE_ID` | ID mẫu tin nhắn ZNS thông báo giảm giá | Gửi tin ZNS qua số điện thoại | [Zalo Cloud Services](https://zns.zalocloud.com/) |
| **Zalo Webhook** | `ZALO_WEBHOOK_SECRET` | Khóa xác thực chữ ký HMAC-SHA256 | Nhận trạng thái `delivered` & `read` | Cấu hình trên Zalo OA Console |
| **Bảo mật nội bộ** | `JWT_SECRET` | Ký và xác thực phiên đăng nhập (7 ngày) | Luôn luôn bắt buộc | Tự sinh ngẫu nhiên 32 ký tự |
| **Cơ sở dữ liệu** | `DATABASE_URL` | Kết nối PostgreSQL 15 | Luôn luôn bắt buộc | Thông tin máy chủ PostgreSQL |
| **Hàng đợi & Cache** | `REDIS_URL` | Kết nối Redis 7 (Stream & Cache) | Luôn luôn bắt buộc | Thông tin máy chủ Redis |

---

## 2. Hướng Dẫn Chi Tiết Từng Dịch Vụ Bên Thứ Ba

### 2.1. Google OAuth 2.0 (Đăng Nhập & Di Trú Dữ Liệu Thành Viên)

* **Mục đích**: Cho phép người dùng đăng nhập bằng tài khoản Google, tự động di trú danh mục sản phẩm đang theo dõi từ khách vãng lai (Guest) sang tài khoản cá nhân cố định.
* **Các bước lấy thông tin**:
  1. Truy cập [Google Cloud Console](https://console.cloud.google.com/).
  2. Tạo mới một Project (ví dụ: `DealHunter-Production`).
  3. Vào mục **APIs & Services** $\to$ **OAuth consent screen**:
     * Chọn User Type: **External**.
     * Điền App name: `DealHunter`.
     * User support email & Developer contact information: Email quản trị của bạn.
  4. Vào mục **APIs & Services** $\to$ **Credentials**:
     * Nhấn **Create Credentials** $\to$ **OAuth client ID**.
     * Application type: **Web application**.
     * Name: `DealHunter Web Client`.
     * **Authorized JavaScript origins**:
       * Dev: `http://localhost:3000`
       * Production: `https://your-domain.com`
     * **Authorized redirect URIs**:
       * Dev: `http://localhost:3000`
       * Production: `https://your-domain.com`
  5. Sao chép **Client ID** và điền vào cấu hình.

---

### 2.2. Zalo Official Account & ZNS (Hệ Thống Thông Báo Biến Động Giá)

* **Mục đích**: Gửi tin nhắn thông báo tức thời đến Zalo của người dùng khi sản phẩm chạm giá mục tiêu hoặc giảm giá sâu; tự động nhận webhook xác nhận người dùng đã nhận (`delivered`) hoặc đã xem (`read`).
* **Các bước lấy thông tin**:
  1. **Đăng ký Zalo App**:
     * Truy cập [Zalo for Developers](https://developers.zalo.me/).
     * Tạo ứng dụng mới liên kết với Zalo Official Account (OA) của doanh nghiệp.
     * Lấy **App ID** $\to$ điền vào `ZALO_APP_ID`.
     * Lấy **App Secret Key** $\to$ điền vào `ZALO_OA_SECRET_KEY`.
  2. **Cấp quyền & Lấy Refresh Token ban đầu**:
     * Trong mục **Official Account** $\to$ **Login with Zalo**: Bật quyền gửi tin nhắn (`oa.message`).
     * Thực hiện luồng OAuth v4 để xin Authorization Code từ Admin OA:
       $$\text{https://oauth.zaloapp.com/v4/oa/permission?app\_id=\{APP\_ID\}\&redirect\_uri=\{REDIRECT\_URI\}}$$
     * Đổi Authorization Code lấy Access Token & Refresh Token qua endpoint:
       $$\text{POST https://oauth.zaloapp.com/v4/oa/access\_token}$$
     * Lấy giá trị `refresh_token` điền vào `ZALO_REFRESH_TOKEN`. Hệ thống `TokenManager` ngầm của DealHunter sẽ tự động làm mới và xoay vòng token 12 giờ/lần vào Redis.
  3. **Đăng ký Mẫu Tin Nhắn ZNS (Zalo Notification Service)**:
     * Truy cập [Zalo Cloud Services](https://zns.zalocloud.com/) $\to$ **Quản lý mẫu ZNS**.
     * Tạo mẫu tin thông báo biến động giá với các biến nội dung: `<price_before>`, `<price_after>`.
     * Sau khi Zalo kiểm duyệt, sao chép mã mẫu $\to$ điền vào `ZALO_TEMPLATE_ID`.
  4. **Cấu hình Webhook Callback**:
     * Trong Zalo Developers $\to$ **Webhook**:
     * Điền Webhook URL: `https://api.your-domain.com/api/v1/webhooks/zalo`
     * Chọn các sự kiện đăng ký:
       * `user_received_message` (Người dùng nhận tin nhắn $\to$ trạng thái `delivered`).
       * `user_read_message` (Người dùng mở đọc tin nhắn $\to$ trạng thái `read`).
     * Khóa bí mật webhook (dùng xác thực HMAC-SHA256) $\to$ điền vào `ZALO_WEBHOOK_SECRET`.

---

### 2.3. Sàn Thương Mại Điện Tử (Shopee, Lazada, TikTok Shop)

* **Hiện trạng hệ thống**:
  * DealHunter sử dụng bộ Direct HTTP Crawler bóc tách chuẩn quốc tế OpenGraph, Twitter Cards, và Schema.org JSON-LD `Product`.
  * Không yêu cầu API Key chính thức của sàn khi chạy quy mô vừa và nhỏ.
* **Cần chuẩn bị khi Scale Production (Tùy chọn nâng cao - Phase 6)**:
  * **Residential Proxy Provider** (Ví dụ: BrightData, Oxylabs, Smartproxy): Cần chuẩn bị tài khoản và chuỗi kết nối Proxy (`http://user:pass@proxy-node:port`) nếu IP datacenter bị sàn chặn tần suất cao.

---

### 2.4. Khóa Bảo Mật & Hạ Tầng Nội Bộ

* **JWT Secret (`JWT_SECRET`)**:
  * Chuỗi ký token phiên đăng nhập của người dùng DealHunter.
  * Lệnh tạo chuỗi an toàn 256-bit:
    ```bash
    openssl rand -base64 32
    ```
* **PostgreSQL (`DATABASE_URL`)**:
  * Khuyên dùng PostgreSQL phiên bản 15 trở lên.
  * Cần hỗ trợ extension `pgcrypto` hoặc `gen_random_uuid()` (đã có sẵn trong migration).
* **Redis (`REDIS_URL`)**:
  * Khuyên dùng Redis 7 trở lên có hỗ trợ Redis Streams (`XADD`, `XREADGROUP`, `XACK`).

---

## 3. Biểu Mẫu Điền Biến Môi Trường (Form Điền Trực Tiếp)

### 3.1. File Cấu Hình Backend (`dealhunter/.env`)

```ini
# ==============================================================================
# DEALHUNTER BACKEND CONFIGURATION
# ==============================================================================

# [1] MOI TRUONG VA CONG MANG
APP_ENV=production
HTTP_PORT=8080
LOG_LEVEL=info
CORS_ALLOWED_ORIGINS=https://dealhunter.vn,http://localhost:3000

# [2] KHOA BAO MAT PHIEN DANG NHAP (JWT)
# Dien chuoi ngau nhien it nhat 32 ky tu:
JWT_SECRET=THAY_BANG_CHUOI_BI_MAT_32_KY_TU

# [3] GOOGLE OAUTH 2.0 (GAP-02)
# Lay tu Google Cloud Console -> APIs & Services -> Credentials:
GOOGLE_CLIENT_ID=xxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com

# [4] POSTGRESQL DATABASE
POSTGRES_USER=dealuser
POSTGRES_PASSWORD=MAT_KHAU_POSTGRES
POSTGRES_DB=dealdb
POSTGRES_PORT=5432
DATABASE_URL=postgres://dealuser:MAT_KHAU_POSTGRES@localhost:5432/dealdb?sslmode=disable

# [5] REDIS QUEUE & CACHE
REDIS_PORT=6380
REDIS_URL=redis://localhost:6380

# [6] CAU HINH SCANNER & WORKER
WORKER_CONCURRENCY=10
DEFAULT_POLL_INTERVAL=1800
FETCH_TIMEOUT=10s
MAX_RETRY=5

# [7] ZALO OA & ZNS NOTIFICATION (GAP-04)
# Bat true de kich hoat gui tin Zalo thuc te (false de chay sandbox mien phi)
ZALO_ENABLED=false
# ID ung dung tu Zalo for Developers:
ZALO_APP_ID=
# Khoa bi mat ung dung tu Zalo for Developers:
ZALO_OA_SECRET_KEY=
# Refresh token OAuth v4 ban dau de he thong tu dong duy tri token 24/7:
ZALO_REFRESH_TOKEN=
# Access token co san (tuy chon, he thong se tu khoi tao tu refresh token):
ZALO_OA_ACCESS_TOKEN=
# ID mau tin ZNS da duyet:
ZALO_TEMPLATE_ID=
# Khoa bi mat kiem tra chu ky webhook HMAC-SHA256 (mac):
ZALO_WEBHOOK_SECRET=
```

---

### 3.2. File Cấu Hình Frontend (`dealhunter-web/.env.local`)

```ini
# ==============================================================================
# DEALHUNTER WEB FRONTEND CONFIGURATION
# ==============================================================================

# Dia chi Backend Go API:
NEXT_PUBLIC_API_URL=https://api.dealhunter.vn/api/v1

# Tên thuong hieu:
NEXT_PUBLIC_APP_NAME=DealHunter
NEXT_PUBLIC_DEFAULT_POLL_INTERVAL=1800
NEXT_PUBLIC_ENABLE_MOCK_SANDBOX=false

# Google OAuth Client ID (Bat buoc phai trung voi GOOGLE_CLIENT_ID cua Backend):
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com

# Cong chay server Next.js:
PORT=3000
```

---

## 4. Chế Độ Vận Hành Hiện Tại (Sandbox / Dev Mode)

> [!TIP]
> Hệ thống DealHunter đã được thiết kế sẵn cơ chế **Fallback An Toàn** tuyệt đối:
> * Nếu bạn chưa có tài khoản Google Cloud: Hệ thống cung cấp nút **Đăng nhập Demo** 1-click để kiểm tra trọn vẹn luồng di trú dữ liệu mà không cần cấu hình Google.
> * Nếu bạn chưa đăng ký Zalo OA: Đặt `ZALO_ENABLED=false`, hệ thống sẽ kích hoạt **MockZaloClient**, tự động mô phỏng sinh mã `msg_id`, trả trạng thái thành công và cho phép kiểm thử trọn vẹn toàn bộ quy trình nhận webhook mà không phát sinh bất kỳ chi phí tin nhắn nào.
