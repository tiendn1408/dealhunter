# DealHunter — Biến môi trường & cách lấy từng giá trị

> Cập nhật: 2026-10-14 · Đối chiếu với code: `pkg/config/config.go`, `docker-compose.yml`, `docker-compose.prod.yml`, `dealhunter-web/lib`.
>
> File mẫu:
> - Backend: [`dealhunter/.env.example`](../.env.example) → copy thành `.env` (local dev).
> - Web: [`dealhunter-web/.env.example`](../../dealhunter-web/.env.example) → copy thành `.env.local`.
> - Production (Docker Compose): **không** copy nguyên file mẫu. Dùng danh sách ở [hướng dẫn triển khai, mục 2](deployment/production-deployment-guide.md).

---

## 1. Bảng tổng hợp

**Cột «Bắt buộc»:**
- **Luôn**: thiếu là API không khởi động.
- **Prod**: chỉ bắt buộc khi `APP_ENV` khác `development`/`test`. Production sẽ từ chối khởi động nếu thiếu hoặc sai.
- **Tuỳ chọn**: để trống thì tính năng đó tắt.

### 1.1. Backend (`dealhunter/.env`)

| Biến | Bắt buộc | Mặc định | Lấy ở đâu / ý nghĩa |
| :--- | :--- | :--- | :--- |
| `APP_ENV` | Luôn | `production` | `development` khi chạy local. Thiếu biến = áp quy tắc production. |
| `HTTP_PORT` | — | `8080` | Cổng API. |
| `LOG_LEVEL` | — | `info` | `debug` / `info` / `warn` / `error`. |
| `CORS_ALLOWED_ORIGINS` | Prod | `http://localhost:3000` | Địa chỉ web, cách nhau dấu phẩy. Production không được chứa `*`. |
| `JWT_SECRET` | Luôn | giá trị dev | Tự tạo: `openssl rand -base64 32`. Production từ chối giá trị dev và chuỗi < 32 ký tự. |
| `ACCESS_TOKEN_TTL` | — | `15m` | Thời hạn access token. |
| `REFRESH_TOKEN_TTL` | — | `720h` | Thời hạn refresh token (30 ngày), phải lớn hơn access. |
| `AUTH_COOKIE_SECURE` | Prod (`true`) | `false` ở dev, `true` ở prod | Cookie refresh chỉ gửi qua HTTPS. |
| `GOOGLE_CLIENT_ID` | Prod | trống | [Mục 2.1](#21-google-đăng-nhập). |
| `ADMIN_EMAILS` | Tuỳ chọn | trống | Email Google được phép tạo voucher qua API, cách nhau dấu phẩy. |
| `DATABASE_URL` | Luôn | Postgres dev | Chuỗi kết nối Postgres. Mật khẩu có `@ : / ? #` phải URL-encode. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose (`POSTGRES_PASSWORD` bắt buộc ở prod) | `dealuser` / `dealpass` (chỉ dev) / `dealdb` | Dùng để tạo container Postgres. Code Go chỉ đọc `DATABASE_URL`. Compose prod dừng lại nếu thiếu `POSTGRES_PASSWORD`; dùng mật khẩu mạnh không có `@ : / ? #`. |
| `POSTGRES_PORT` | — | `5433` | Chỉ để ghi nhớ: `docker-compose.yml` luôn mở cổng 5433. |
| `REDIS_URL` | Luôn | `redis://localhost:6380` | Redis 7+ (dùng Streams). |
| `REDIS_PORT` | Compose | `6380` | Cổng trên máy của container Redis (dev). |
| `WORKER_CONCURRENCY` | — | `10` | Số job đọc giá chạy song song. |
| `DEFAULT_POLL_INTERVAL` | — | `1800` | Chu kỳ kiểm tra giá mặc định (giây). |
| `FETCH_TIMEOUT` | — | `10s` | Thời gian chờ tối đa mỗi lần đọc trang sàn. |
| `MAX_RETRY` | — | `5` | Số lần thử lại một job lỗi. |
| `TRUSTED_PROXIES` | Tuỳ | trống | IP/CIDR reverse proxy được tin header `X-Forwarded-For`. **Không đặt khi dùng compose prod** (compose tự điền). |
| `AFFILIATE_ENABLED` | Tuỳ chọn | `false` | [Mục 2.3](#23-affiliate-tiếp-thị-liên-kết). |
| `SHOPEE_AFFILIATE_ID` / `SHOPEE_AFFILIATE_URL_TEMPLATE` | Tuỳ chọn | trống | Mục 2.3. |
| `LAZADA_AFFILIATE_ID` / `LAZADA_AFFILIATE_URL_TEMPLATE` | Tuỳ chọn | trống | Mục 2.3. |
| `TIKTOK_AFFILIATE_ID` / `TIKTOK_AFFILIATE_URL_TEMPLATE` | Tuỳ chọn | trống | Mục 2.3. |
| `ACCESSTRADE_DEEPLINK_URL` | Tuỳ chọn | trống | Mục 2.3. |
| `ZALO_ENABLED` | Tuỳ chọn | `false` | [Mục 2.2](#22-zalo-oa--zns-thông-báo). Có `ZALO_REFRESH_TOKEN` hoặc `ZALO_OA_ACCESS_TOKEN` thì Zalo **tự bật**. |
| `ZALO_APP_ID` | Prod khi bật Zalo | trống | Mục 2.2. |
| `ZALO_OA_SECRET_KEY` | Prod khi bật Zalo | trống | **App Secret Key** của ứng dụng (dù tên biến có chữ OA). Mục 2.2. |
| `ZALO_REFRESH_TOKEN` | Khi bật Zalo | trống | Mục 2.2. |
| `ZALO_OA_ACCESS_TOKEN` | Tuỳ chọn | trống | Mục 2.2 (thường để trống). |
| `ZALO_TEMPLATE_ID` | Khi bật Zalo | trống | Mẫu ZNS báo giá giảm. |
| `ZALO_OTP_TEMPLATE_ID` | Tuỳ chọn | trống | Mẫu ZNS gửi mã xác minh khi người dùng liên kết Zalo. Trống = không liên kết được Zalo. |
| `ZALO_WEBHOOK_SECRET` | Khi dùng webhook | = `ZALO_OA_SECRET_KEY` | **OA Secret Key** ở trang Webhook của ứng dụng (khác App Secret Key). |

### 1.2. Chỉ dùng với `docker-compose.prod.yml`

| Biến | Bắt buộc | Ý nghĩa |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Có | URL API mà web gọi, nhúng vào image web lúc **build** (ví dụ `https://dealhunter.io.vn/api/v1`). |
| `EXTENSION_ID` | Tuỳ chọn | ID extension trên Chrome Web Store; web dùng làm `NEXT_PUBLIC_EXTENSION_ID`. |
| `DEALHUNTER_GATEWAY` | Tuỳ chọn | Gateway mạng Docker mà API tin `X-Forwarded-For` (mặc định `172.30.240.1`). |

Compose prod tự đặt `APP_ENV=production`, `DATABASE_URL`, `REDIS_URL` cho từng service. Giá trị `DATABASE_URL`/`REDIS_URL` trong `.env` **không** được dùng khi chạy compose prod.

### 1.3. Web (`dealhunter-web/.env.local`)

| Biến | Bắt buộc | Ý nghĩa |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Có | URL API (local: `http://localhost:8080/api/v1`). |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Khi dùng đăng nhập Google | **Phải trùng** `GOOGLE_CLIENT_ID` của backend. |
| `NEXT_PUBLIC_EXTENSION_ID` | Tuỳ chọn | ID extension (xem `chrome://extensions`). Trống thì web không gửi phiên đăng nhập sang extension. |
| `PORT` | — | Cổng dev server (mặc định 3000). |

Các biến `NEXT_PUBLIC_*` được nhúng vào code lúc build: đổi giá trị thì phải build lại.

---

## 2. Cách lấy giá trị từ dịch vụ bên ngoài

> Các bước trên giao diện của Google, Zalo và các chương trình affiliate là tóm tắt tại thời điểm viết. Giao diện của họ có thể đã đổi. Phần **đã đối chiếu với code** là tên biến, định dạng và cách hệ thống dùng chúng.

### 2.1. Google (đăng nhập)

Web dùng **Google Identity Services** (nút «Đăng nhập với Google», nhận ID token). Backend kiểm tra token với `GOOGLE_CLIENT_ID`.

1. [Google Cloud Console](https://console.cloud.google.com/): tạo project (ví dụ `DealHunter`).
2. **APIs & Services → OAuth consent screen**: User type **External**, điền tên app và email hỗ trợ.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, loại **Web application**.
4. **Authorized JavaScript origins**: `http://localhost:3000` (dev) và `https://dealhunter.io.vn` (prod). Không cần redirect URI vì luồng này không chuyển hướng.
5. Copy **Client ID** (dạng `….apps.googleusercontent.com`) vào `GOOGLE_CLIENT_ID` (backend) **và** `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web).

Không có client secret trong cấu hình: luồng ID token không cần secret.

**Kiểm tra:** mở web, bấm Đăng nhập, chọn tài khoản. Nếu Google báo `origin_mismatch` thì origin ở bước 4 chưa đúng.

### 2.2. Zalo OA & ZNS (thông báo)

Hướng dẫn đầy đủ, từng bước: [`runbooks/zalo-setup.md`](runbooks/zalo-setup.md). Gồm tạo ứng dụng (mô tả, danh mục), lấy khoá, refresh token ban đầu, hai mẫu ZNS, webhook và cách xử lý sự cố.

Tóm tắt các biến:
- `ZALO_APP_ID` = App ID.
- `ZALO_OA_SECRET_KEY` = **App Secret Key** (code gửi làm header `secret_key` khi lấy và làm mới token, và dùng tính header `appsecret_proof` cho mọi lệnh gửi ZNS).
- `ZALO_WEBHOOK_SECRET` = **OA Secret Key** ở trang Webhook (kiểm chữ ký `X-ZEvent-Signature`).
- `ZALO_REFRESH_TOKEN` = refresh token ban đầu từ OAuth v4. Hệ thống tự làm mới mỗi 12 giờ và lưu vào Redis.
- `ZALO_TEMPLATE_ID` = mẫu báo giá (biến `price_before`, `price_after`, `deal_url`). `ZALO_OTP_TEMPLATE_ID` = mẫu mã xác minh (biến `otp`).

Không bật Zalo thì thông báo Zalo được ghi là **failed**. **Không có chế độ giả lập** trong ứng dụng; client giả `tests/fakezalo` chỉ dùng cho test.

### 2.3. Affiliate (tiếp thị liên kết)

Khi bật, link «Mua» (trên web, trong tin Zalo, trong trang so sánh) được chuyển thành link affiliate có `sub_id` để biết người dùng và sản phẩm nào tạo đơn. Thiếu cấu hình thì luôn giữ **link gốc** (người dùng vẫn mua được bình thường).

**Quy tắc của code** (`pkg/affiliate/affiliate.go`):
- Chỉ chạy khi `AFFILIATE_ENABLED=true`.
- Mỗi sàn dùng template riêng **chỉ khi có cả** `*_AFFILIATE_ID` và `*_URL_TEMPLATE`. Thiếu một trong hai thì dùng `ACCESSTRADE_DEEPLINK_URL` nếu có, không thì giữ link gốc.
- Template phải chứa `{URL}` (link sản phẩm đã URL-encode) hoặc `{RAW_URL}`. Không chứa thì bị bỏ qua, để tránh đưa mọi sản phẩm về cùng một trang.
- Biến thay thế được: `{URL}`, `{RAW_URL}`, `{SUB_ID}`, `{AFFILIATE_ID}`.
- `{SUB_ID}` có dạng `u<8 ký tự user>-p<8 ký tự sản phẩm>`, hoặc `guest-…` với khách (chỉ chữ, số và `-`).

**Lấy giá trị cho Shopee (từng bước):**

1. **Đăng ký Shopee Tiếp thị liên kết** (Shopee Affiliate): app Shopee → **Tôi** → **Shopee Tiếp Thị Liên Kết**, hoặc trang [affiliate.shopee.vn](https://affiliate.shopee.vn). Chờ Shopee duyệt; chưa được duyệt thì link không ghi nhận hoa hồng.
2. **Lấy Affiliate ID** (một dãy số, khác với *mã giới thiệu*): xem trong trang quản lý affiliate, phần thông tin tài khoản. Không thấy thì làm cách này: vào mục **Custom Link** (Liên kết tùy chỉnh), tạo link cho một sản phẩm bất kỳ, mở link vừa tạo trong trình duyệt và xem địa chỉ cuối cùng; dãy số sau `affiliate_id=` (hoặc sau `an_`) là Affiliate ID. **[Cần kiểm chứng trên tài khoản của bạn]**
3. **Điền cấu hình** (file i èn vi của backend):
   ```ini
   AFFILIATE_ENABLED=true
   SHOPEE_AFFILIATE_ID=<Affiliate ID ở bước 2>
   SHOPEE_AFFILIATE_URL_TEMPLATE=https://s.shopee.vn/an_redir?origin_link={URL}&affiliate_id={AFFILIATE_ID}&sub_id={SUB_ID}
   ```
   Lazada, TikTok, AccessTrade để trống: link của các sàn đó giữ nguyên link gốc.
4. **Khởi động lại API** (và notifier nếu dùng Zalo).

**Về mẫu link:** dạng `s.shopee.<tên miền>/an_redir?origin_link=...&affiliate_id=...&sub_id=...` là dạng chính thức trong hướng dẫn «Short Link Implementation» của Shopee cho [Singapore](https://help.shopee.sg/portal/10/article/171184), [Malaysia](https://help.shopee.com.my/portal/10/article/174050-%5BENG%5D-Short-Link-Implementation-Guideline) và [Philippines](https://help.shopee.ph/portal/10/article/172142-Short-Link-Implementation-Guideline). Với `s.shopee.vn`, cộng đồng affiliate Việt Nam dùng cùng dạng, nhưng **chưa thấy tài liệu chính thức của Shopee Việt Nam**. Vì vậy kiểm tra theo mục «Kiểm tra» dưới đây trước khi tin vào nó. Nếu trang Shopee Affiliate của bạn đưa ra mẫu khác, dùng mẫu đó, miễn là giữ `{URL}`.

**Sub ID:** DealHunter gửi `{SUB_ID}` dạng `u1a2b3c4d-p5e6f7a8b` (8 ký tự đầu mã người dùng, 8 ký tự đầu mã sản phẩm; khách là `guest-…`). Shopee chỉ nhận chữ, số và dấu `-`, và tách theo `-` thành **Sub_id1 = người dùng**, **Sub_id2 = sản phẩm** trong báo cáo **[Đã kiểm, có test]**.

**Lazada / TikTok / AccessTrade:** làm tương tự khi có tài khoản. Lấy mẫu deeplink từ trang quản lý affiliate của sàn, đổi chỗ link sản phẩm thành `{URL}` và chỗ sub-id thành `{SUB_ID}`. AccessTrade dùng một deeplink cho nhiều sàn, ví dụ dạng `https://go.isclix.com/deep_link/<ma_publisher>?url={URL}&utm_content={SUB_ID}`. **[Chưa kiểm chứng với tài khoản thật]**

**Kiểm tra:**
1. Trên web local, dán một link Shopee ở trang chủ. Ở kết quả, bấm **«Mua trên Shopee»**: link phải bắt đầu bằng `https://s.shopee.vn/an_redir?...` và mở **đúng sản phẩm**. Hoặc gọi `GET /api/v1/tracked-products/{id}`: trường `AffiliateURL` phải là link affiliate, không phải link gốc.
2. Vào trang quản lý Shopee Affiliate, xem báo cáo lượt bấm (thường trễ vài phút tới vài giờ).
3. Chắc chắn nhất: đặt thử một đơn nhỏ qua link đó. Báo cáo đơn hàng phải có Sub_id1 = `u…`, Sub_id2 = `p…`.

### 2.4. Khoá và hạ tầng nội bộ

- **`JWT_SECRET`:** `openssl rand -base64 32`. Đổi khoá thì mọi phiên đăng nhập hiện tại hết hiệu lực.
- **PostgreSQL:** bản 15 trở lên. Migration dùng `gen_random_uuid()`.
- **Redis:** bản 7 trở lên (Redis Streams: `XADD`, `XREADGROUP`, `XACK`).
- **Sàn TMĐT:** không cần API key. Giá được đọc trực tiếp từ trang sản phẩm (OpenGraph, JSON-LD `Product`…). Khi quy mô lớn mà IP máy chủ bị chặn, cần proxy dân cư; hiện chưa có biến cấu hình cho proxy.

---

## 3. Tự kiểm tra trước khi chạy

| Kiểm tra | Cách |
| :--- | :--- |
| Cấu hình API hợp lệ | Khởi động API; nếu sai, log in `invalid configuration (APP_ENV=…)` kèm danh sách lỗi. |
| Web gọi đúng API | Mở web, tab Network: request tới `NEXT_PUBLIC_API_URL`, không lỗi CORS. |
| Google | Đăng nhập thành công, `GET /api/v1/auth/me` trả email. |
| Zalo | Log notifier ghi `Using Zalo OA HTTP client`, không phải `Zalo OA is NOT configured`. Liên kết Zalo trong Cài đặt nhận được mã OTP. |
| Affiliate | `AffiliateURL` của một sản phẩm là link affiliate (mục 2.3). |

---

## 4. Các điểm cũ đã sửa trong tài liệu này (2026-10-14)

- Bỏ «nút Đăng nhập Demo» và «MockZaloClient sandbox»: code không có hai thứ này. Zalo tắt thì thông báo ghi là failed.
- JWT không phải «7 ngày»: access token 15 phút, refresh token 30 ngày (`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`).
- Thêm các biến code có đọc nhưng tài liệu cũ thiếu: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `AUTH_COOKIE_SECURE`, `ADMIN_EMAILS`, `TRUSTED_PROXIES`, `ZALO_OTP_TEMPLATE_ID`, toàn bộ nhóm affiliate, `NEXT_PUBLIC_EXTENSION_ID`, `EXTENSION_ID`, `DEALHUNTER_GATEWAY`.
- Bỏ các biến web không có code nào đọc: `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_DEFAULT_POLL_INTERVAL`, `NEXT_PUBLIC_ENABLE_MOCK_SANDBOX`.
- Mẫu ZNS báo giá có thêm biến `deal_url`.
- Hai khoá Zalo khác nhau: `ZALO_OA_SECRET_KEY` nhận App Secret Key (lấy token), `ZALO_WEBHOOK_SECRET` nhận OA Secret Key (kiểm chữ ký webhook).
