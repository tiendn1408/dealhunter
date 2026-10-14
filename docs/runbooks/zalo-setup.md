# Thiết lập Zalo cho DealHunter (từng bước)

> Cập nhật: 2026-10-14 · Domain mẫu: **`dealhunter.io.vn`** (web và API cùng domain, API ở `/api/v1`).
> Đối chiếu với code: `internal/notification/zalo/`, `internal/notification/phone_otp.go`, `internal/http/zalo_webhook.go`, `pkg/config/config.go`.

**Nhãn trong tài liệu:**
- **[Đã kiểm]**: đúng với code DealHunter (có test).
- **[Đã thấy]**: đã đối chiếu với màn hình Zalo for Developers thật (ảnh chụp 2026-10-14).
- **[Cần kiểm chứng]**: chưa thấy tận mắt; giao diện Zalo có thể khác.

**Đi theo thứ tự:**
- **Phần A — ở máy local:** tạo ứng dụng → lấy khoá → lấy refresh token → tạo mẫu ZNS → điền cấu hình → gửi thử. **Không cần** domain hay máy chủ.
- **Phần B — khi deploy lên `dealhunter.io.vn`:** xác thực domain → webhook (trạng thái «đã nhận / đã đọc»).
- **Phần C — tra cứu:** biến cấu hình, mẫu ZNS, App Secret Proof, sự cố.

---

## Tổng quan: DealHunter dùng Zalo để làm gì

| Tính năng | Chiều gọi | Làm được ở local? |
| :--- | :--- | :--- |
| Gửi tin ZNS **báo giá giảm** / chạm giá mong muốn | API → Zalo | Có |
| Gửi tin ZNS **mã xác minh** khi người dùng liên kết Zalo (mã 6 số, sống 5 phút, tối đa 5 mã/giờ) | API → Zalo | Có |
| Nhận trạng thái **đã nhận / đã đọc** (webhook) | Zalo → API | **Không** (Zalo không gọi được `localhost`) |

Chưa cấu hình Zalo thì web vẫn chạy; thông báo Zalo được ghi là **failed**, log notifier: `Zalo OA is NOT configured`. Không có chế độ giả lập.

**Chi phí:** mỗi tin ZNS (kể cả mã xác minh) đều tính phí, trừ vào tài khoản ZNS. **[Cần kiểm chứng: bảng giá trên trang ZNS]**

---

# Phần A — Làm ở máy local

## A1. Chuẩn bị

- [ ] **Zalo Official Account (OA)** của DealHunter, loại doanh nghiệp/tổ chức. ZNS thường yêu cầu OA đã xác thực. **[Cần kiểm chứng]**
- [ ] **Tài khoản ZNS** (Zalo Cloud) gắn với OA, đã nạp tiền.
- [ ] Bạn là **admin của OA** (cần để bấm «Cho phép» ở bước A4).
- [ ] Máy có `openssl` và `curl` (macOS có sẵn).

## A2. Tạo ứng dụng

Vào [developers.zalo.me](https://developers.zalo.me/) → đăng nhập → **Tạo ứng dụng**:

| Ô | Điền |
| :--- | :--- |
| Tên ứng dụng | `DealHunter` |
| Danh mục | **Mua sắm** (không có thì chọn **Thương mại điện tử**, rồi **Tiện ích**). Không chọn «Tài chính»: DealHunter không xử lý thanh toán. **[Cần kiểm chứng: tên danh mục]** |
| Mô tả | Một đoạn ở [C4](#c4-mô-tả-ứng-dụng-copy-dùng-ngay) |
| Website | `https://dealhunter.io.vn` |
| Email liên hệ | Email quản trị DealHunter |
| Biểu tượng | `dealhunter-web/public/icon-512.png` |

Sau khi tạo, menu bên trái của ứng dụng có **[Đã thấy]**:
- **Tổng quan:** Cài đặt · Vai trò · Lịch sử
- **API và Cấp quyền:** Đăng ký sử dụng API · Xác thực domain · Webhook
- **Sản phẩm:** Đăng nhập bằng Zalo · **Official Account** (Thiết lập chung · Quản lý OA · Thống kê sản phẩm) · Mini App · Gọi thoại

## A3. Liên kết OA và lấy App ID, App Secret Key

1. Menu **Official Account → Quản lý OA** → liên kết OA DealHunter với ứng dụng. **[Cần kiểm chứng: nút liên kết nằm ở đây]**
2. Menu **API và Cấp quyền → Đăng ký sử dụng API** → đăng ký nhóm API của Official Account và ZNS (gửi tin). **[Cần kiểm chứng: tên nhóm API]**
3. Menu **Tổng quan → Cài đặt** **[Đã thấy menu]**:
   - copy **App ID** → `ZALO_APP_ID`
   - copy **khoá bí mật của ứng dụng (App Secret Key)** → `ZALO_OA_SECRET_KEY`

> **Tên biến dễ nhầm:** `ZALO_OA_SECRET_KEY` nhận **App Secret Key** (khoá ở menu Cài đặt), **không phải** OA Secret Key. Code dùng khoá này để xin token và để tính `appsecret_proof` **[Đã kiểm]**. OA Secret Key (ở menu Webhook) chỉ cần cho Phần B.

## A4. Lấy refresh token (làm một lần)

Trang dùng: **Official Account → Thiết lập chung** **[Đã thấy]**. Trang có ô **Đường dẫn yêu cầu cấp quyền** ở trên (link dạng `https://oauth.zaloapp.com/v4/oa/permission?app_id=...&redirect_uri=...`) và phần **Thiết lập đường dẫn yêu cầu cấp quyền** gồm 3 ô: **Official Account Callback Url**, **Code Challenge**, **State**.

**Bước 1. Tạo cặp mã PKCE** (mở Terminal, **giữ nguyên cửa sổ này** tới hết bước 5):
```bash
VERIFIER=$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-43)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
echo "Code Challenge: $CHALLENGE"
```
PKCE bảo vệ để lỡ lộ `code` thì người khác cũng không đổi được ra token. Lệnh đã thử: tạo cặp S256 hợp lệ **[Đã kiểm]**.

**Bước 2. Điền 3 ô** rồi bấm **Cập nhật**:

| Ô | Điền |
| :--- | :--- |
| Official Account Callback Url | `https://dealhunter.io.vn/zalo-callback` |
| Code Challenge | Giá trị `Code Challenge` in ra ở bước 1 |
| State | Một chuỗi bất kỳ, ví dụ `dealhunter-2026` |

- Trang `/zalo-callback` **không cần tồn tại, domain chưa cần chạy**. Mục đích chỉ là đọc `code` trên thanh địa chỉ sau khi Zalo chuyển hướng; trình duyệt báo «không mở được trang» cũng không sao.
- **Đừng** điền link này vào ô Webhook URL (Phần B). Đây là hai ô khác nhau.

**Bước 3. Copy link** ở ô **Đường dẫn yêu cầu cấp quyền**. Link đã kèm `redirect_uri`, `code_challenge`, `state` vừa điền. Nếu trang có phần chọn quyền thì chọn quyền gửi tin / ZNS trước khi copy (trang ghi: «thiết lập đường dẫn và chọn quyền cần yêu cầu trước khi gửi đường dẫn dưới đây cho OA admin») **[Đã thấy]**.

**Bước 4. Admin OA mở link** → chọn OA DealHunter → **Cho phép**. Trình duyệt chuyển tới:
```
https://dealhunter.io.vn/zalo-callback?code=XXXX&oa_id=YYYY&state=dealhunter-2026
```
Kiểm tra `state` đúng chuỗi đã điền, rồi copy giá trị `code`. Code chỉ dùng được trong thời gian ngắn, nên làm bước 5 ngay. **[Cần kiểm chứng: thời hạn]**

**Bước 5. Đổi `code` lấy token**, trong **cùng cửa sổ Terminal** còn biến `VERIFIER`:
```bash
curl -s -X POST https://oauth.zaloapp.com/v4/oa/access_token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "secret_key: <App Secret Key>" \
  --data-urlencode "app_id=<App ID>" \
  --data-urlencode "code=<code ở bước 4>" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code_verifier=$VERIFIER"
```
Kết quả có `access_token`, `refresh_token`, `expires_in`. Copy **`refresh_token`** → `ZALO_REFRESH_TOKEN`.
- Lỗi về code hết hạn hoặc không hợp lệ: làm lại từ bước 3 (lấy `code` mới).
- Đã đóng Terminal (mất `VERIFIER`): làm lại từ bước 1.

**Sau đó hệ thống tự lo** **[Đã kiểm]**: làm mới token mỗi 12 giờ và lưu token mới vào Redis (`zalo:oa:access_token`, `zalo:oa:refresh_token`).
- Refresh token **chỉ dùng được một lần** (mỗi lần làm mới, Zalo cấp token mới). **Đừng tự chạy lệnh làm mới bằng tay** sau khi đã đưa token cho hệ thống.
- Xoá dữ liệu Redis hoặc đổi sang Redis khác: hệ thống quay về `ZALO_REFRESH_TOKEN` trong cấu hình, mà giá trị đó có thể đã bị dùng. Khi đó làm lại A4.

## A5. Tạo hai mẫu ZNS

Trang quản lý ZNS (Zalo Cloud) → **Quản lý mẫu** → tạo mẫu, gửi duyệt. **Tên biến trong mẫu phải đúng như dưới đây**, vì code gửi đúng các tên này **[Đã kiểm]**. Chi tiết và gợi ý nội dung: [C2](#c2-hai-mẫu-zns).

| Mẫu | Biến | Điền ID mẫu vào |
| :--- | :--- | :--- |
| Báo giá giảm | `price_before`, `price_after`, `deal_url` | `ZALO_TEMPLATE_ID` |
| Mã xác minh (loại OTP) | `otp` | `ZALO_OTP_TEMPLATE_ID` |

## A6. Điền cấu hình (local)

Trong file i èn vi của backend (`dealhunter/`, tạo từ file mẫu):
```ini
ZALO_ENABLED=true
ZALO_APP_ID=<App ID>
ZALO_OA_SECRET_KEY=<App Secret Key>
ZALO_REFRESH_TOKEN=<refresh_token ở A4>
ZALO_OA_ACCESS_TOKEN=
ZALO_TEMPLATE_ID=<ID mẫu báo giá>
ZALO_OTP_TEMPLATE_ID=<ID mẫu mã xác minh>
# Phần B (webhook) mới cần; ở local để trống
ZALO_WEBHOOK_SECRET=
```
Khởi động lại **api** và **notifier** (cả hai đều đọc cấu hình Zalo).

## A7. Gửi thử

| Bước | Kết quả đúng |
| :--- | :--- |
| Khởi động notifier | Log `Using Zalo OA HTTP client` với `auto_refresh=true` |
| Web local → **Cài đặt** → Liên kết Zalo → nhập số điện thoại của bạn | Nhận tin ZNS có mã 6 số; nhập mã thì liên kết thành công |
| Theo dõi một sản phẩm, đặt giá mong muốn **cao hơn** giá hiện tại | Lần kiểm tra giá kế tiếp gửi tin báo giá; trang Thông báo hiện «đã gửi» (ở local dừng ở đây vì chưa có webhook) |

---

# Phần B — Khi deploy lên `dealhunter.io.vn`

Cần trước: API chạy trên máy chủ, domain `dealhunter.io.vn` đã trỏ DNS về máy chủ, có HTTPS (nginx, xem [hướng dẫn triển khai](../deployment/production-deployment-guide.md)). Tự thử:
```bash
curl -i -X POST https://dealhunter.io.vn/api/v1/webhooks/zalo
```
Lệnh phải trả `HTTP/2 200` (hoặc `HTTP/1.1 200`). Chưa có 200 thì đừng làm tiếp: Zalo sẽ báo «http code 0».

## B1. Xác thực domain

Menu **API và Cấp quyền → Xác thực domain** **[Đã thấy menu]** → nhập `dealhunter.io.vn` → làm theo cách Zalo đưa ra (thường là thêm thẻ meta vào trang chủ hoặc đặt file xác thực ở thư mục gốc của web) → bấm xác thực. **[Cần kiểm chứng: cách xác thực]**

## B2. Webhook

1. Menu **API và Cấp quyền → Webhook** **[Đã thấy menu]** → copy **OA Secret Key** → `ZALO_WEBHOOK_SECRET`.
2. Bấm cập nhật URL → hộp **Cập nhật webhook url** → ô **Webhook URL** **[Đã thấy]**:
   ```
   https://dealhunter.io.vn/api/v1/webhooks/zalo
   ```
   → **Kiểm tra** → **Cập nhật**.
   - «Kiểm tra» gửi một POST tới URL; Zalo chỉ cho lưu khi nhận **200 OK** **[Đã thấy]**.
   - API DealHunter trả 200 cho request thử này (không có chữ ký) mà không xử lý gì, và trả 200 cả khi chưa điền khoá Zalo **[Đã kiểm, có test]**.
3. Trong **danh sách sự kiện webhook**, bật:
   - `user_received_message`: người dùng **đã nhận** tin → DealHunter ghi «đã nhận».
   - Sự kiện người dùng **đã xem** tin → DealHunter ghi «đã đọc». Code nhận cả `user_seen_message` lẫn `user_read_message` **[Đã kiểm]**; tên chính xác trên Zalo **[Cần kiểm chứng]**.
   - Lần đầu, bật thêm `user_send_text` để kiểm chữ ký: nhắn một tin cho OA, log API phải có `zalo webhook accepted`.
4. Thêm `ZALO_WEBHOOK_SECRET=<OA Secret Key>` vào cấu hình production, khởi động lại api.

> **Zalo có 2 khoá khác nhau:** App Secret Key (menu Cài đặt) → `ZALO_OA_SECRET_KEY`; OA Secret Key (menu Webhook) → `ZALO_WEBHOOK_SECRET`. Để trống `ZALO_WEBHOOK_SECRET` thì hệ thống kiểm chữ ký bằng App Secret Key, không khớp với cách Zalo ký, nên mọi trạng thái «đã nhận / đã đọc» bị từ chối.

## B3. Cấu hình production

Ngoài các biến ở A6, đặt thêm `ZALO_WEBHOOK_SECRET`. Production từ chối khởi động nếu Zalo bật mà thiếu `ZALO_APP_ID` hoặc khoá kiểm webhook **[Đã kiểm]**. Danh sách đầy đủ: [hướng dẫn triển khai, mục 2](../deployment/production-deployment-guide.md).

## B4. Trước khi gửi Zalo duyệt (ứng dụng / mẫu ZNS)

- [ ] Trang **Chính sách quyền riêng tư** và **Điều khoản sử dụng** trên web (ví dụ `https://dealhunter.io.vn/privacy`, `/terms`). Web **chưa có** hai trang này; Zalo thường yêu cầu link.
- [ ] Bật bắt buộc **App Secret Proof** (C3) và gửi thử một tin ZNS.
- [ ] Nhắn thử cho OA, xác nhận log `zalo webhook accepted` (chữ ký đúng).

---

# Phần C — Tra cứu

## C1. Biến cấu hình Zalo

| Biến | Lấy ở đâu | Bắt buộc |
| :--- | :--- | :--- |
| `ZALO_ENABLED` | `true` để gửi tin. Có `ZALO_REFRESH_TOKEN` hoặc `ZALO_OA_ACCESS_TOKEN` thì Zalo **tự bật** | — |
| `ZALO_APP_ID` | Menu **Cài đặt** | Khi bật Zalo |
| `ZALO_OA_SECRET_KEY` | **App Secret Key**, menu **Cài đặt** | Khi bật Zalo |
| `ZALO_REFRESH_TOKEN` | Bước A4 | Khi bật Zalo |
| `ZALO_OA_ACCESS_TOKEN` | Để trống (hệ thống tự lấy) | Không |
| `ZALO_TEMPLATE_ID` | ID mẫu báo giá (A5) | Để gửi tin báo giá |
| `ZALO_OTP_TEMPLATE_ID` | ID mẫu mã xác minh (A5) | Để người dùng liên kết Zalo (thiếu thì API trả `503`) |
| `ZALO_WEBHOOK_SECRET` | **OA Secret Key**, menu **Webhook** | Khi dùng webhook (Phần B) |

## C2. Hai mẫu ZNS

### Báo giá giảm → `ZALO_TEMPLATE_ID`

| Biến | Code gửi | Ví dụ |
| :--- | :--- | :--- |
| `price_before` | Giá trước, số nguyên VND, **không có dấu chấm** | `1290000` |
| `price_after` | Giá mới, cùng định dạng | `990000` |
| `deal_url` | Link sản phẩm (đã gắn affiliate nếu bật); chỉ gửi khi có link | `https://s.shopee.vn/...` |

Gợi ý nội dung:
> **DealHunter: Sản phẩm bạn theo dõi vừa giảm giá**
> Giá trước: <price_before> đ
> Giá mới: <price_after> đ
> Nút «Xem sản phẩm» → `<deal_url>`

- Muốn hiện `990.000 đ` thay vì `990000`: khai báo kiểu biến số/tiền tệ khi tạo mẫu (nếu Zalo hỗ trợ). **[Cần kiểm chứng]**
- Mẫu nên có biến `deal_url`, vì code gửi biến này mỗi khi có link; gửi biến không có trong mẫu có thể bị Zalo từ chối. **[Cần kiểm chứng]**

### Mã xác minh → `ZALO_OTP_TEMPLATE_ID`

| Biến | Code gửi |
| :--- | :--- |
| `otp` | Mã 6 chữ số, sống 5 phút |

Gợi ý nội dung (loại mẫu OTP/xác thực):
> Mã xác minh DealHunter của bạn là <otp>. Mã có hiệu lực 5 phút. Không chia sẻ mã này cho bất kỳ ai.

Số điện thoại được chuẩn hoá về dạng `84xxxxxxxxx` trước khi gửi **[Đã kiểm]**.

## C3. App Secret Proof (nên bật)

Mọi lệnh gửi ZNS (báo giá ở notifier, mã xác minh ở API) đều kèm header `appsecret_proof` = `hex(HMAC-SHA256(khoá = App Secret Key, nội dung = access token))` **[Đã kiểm, có test]**. Công thức giống SDK PHP chính thức của Zalo ([`zaloplatform/zalo-php-sdk`](https://github.com/zaloplatform/zalo-php-sdk), `src/Zalo.php`: `hash_hmac('sha256', $accessToken, $app->getSecret())`). Zalo kiểm proof từ bản cập nhật OA OpenAPI tháng 4/2024.

- Trong cài đặt của ứng dụng, **bật tuỳ chọn bắt buộc App Secret Proof**: token có lộ thì người khác cũng không gọi API được khi thiếu App Secret Key. **[Cần kiểm chứng: vị trí tuỳ chọn]**
- Không cần biến mới: proof tính từ `ZALO_OA_SECRET_KEY`. Vì vậy biến này **phải là App Secret Key**.

## C4. Mô tả ứng dụng (copy dùng ngay)

**Ngắn:**
> Theo dõi giá Shopee, Lazada, TikTok Shop và báo qua Zalo khi giá giảm.

**Vừa:**
> DealHunter giúp bạn mua đúng giá. Dán link sản phẩm từ Shopee, Lazada hoặc TikTok Shop, DealHunter đọc giá thật từ sàn, lưu lịch sử giá và gửi thông báo qua Zalo khi giá giảm hoặc chạm mức bạn mong muốn.

**Đầy đủ:**
> DealHunter là công cụ theo dõi giá cho người mua sắm online tại Việt Nam.
> - Dán link sản phẩm từ Shopee, Lazada, TikTok Shop để xem giá hiện tại và lịch sử giá thật, đọc trực tiếp từ sàn.
> - Đặt giá mong muốn; khi giá giảm hoặc chạm mức đó, DealHunter gửi thông báo tới Zalo của bạn.
> - So sánh cùng sản phẩm giữa các sàn để chọn nơi rẻ hơn.
>
> DealHunter chỉ gửi tin Zalo cho người dùng đã tự liên kết số điện thoại và xác minh bằng mã OTP. Bạn có thể huỷ liên kết bất cứ lúc nào trong phần Cài đặt.

**Lý do xin quyền** (khi Zalo hỏi mục đích):
> DealHunter dùng Zalo Official Account để gửi tin ZNS cho người dùng đã đồng ý nhận: (1) mã xác minh khi người dùng liên kết số điện thoại với tài khoản DealHunter; (2) thông báo khi sản phẩm người dùng đang theo dõi giảm giá hoặc chạm giá mong muốn. Webhook được dùng để ghi nhận trạng thái tin đã nhận và đã đọc. DealHunter không gửi tin quảng cáo hàng loạt.

## C5. Sự cố thường gặp

| Hiện tượng | Nguyên nhân hay gặp | Cách xử lý |
| :--- | :--- | :--- |
| Log `Zalo OA is NOT configured` | Thiếu `ZALO_REFRESH_TOKEN` và `ZALO_OA_ACCESS_TOKEN` | Làm A4, điền biến, khởi động lại api và notifier |
| Lỗi làm mới token (refresh token không hợp lệ) | Token đã bị dùng (chạy lệnh làm mới bằng tay, hoặc Redis bị xoá) | Làm lại A4 |
| Bước A4.5 báo lỗi `code` | Code hết hạn hoặc đã dùng; hoặc thiếu / sai `code_verifier` | Lấy `code` mới (A4 bước 3); giữ cửa sổ Terminal có `VERIFIER` |
| Mọi tin ZNS bị từ chối về app secret proof | Đã bật bắt buộc proof nhưng `ZALO_OA_SECRET_KEY` không phải App Secret Key | Điền App Secret Key (menu Cài đặt), khởi động lại |
| Gửi ZNS lỗi về mẫu / tham số | Tên biến trong mẫu khác `price_before`, `price_after`, `deal_url`, `otp`; hoặc mẫu chưa duyệt | Sửa mẫu, chờ duyệt |
| Gửi ZNS lỗi về số dư | Tài khoản ZNS hết tiền | Nạp thêm |
| Liên kết Zalo trả lỗi 503 | Thiếu `ZALO_OTP_TEMPLATE_ID` | Tạo mẫu mã xác minh (A5), điền biến |
| «Kiểm tra» webhook báo **http code 0** | Zalo không kết nối được: đang chạy ở local, hoặc domain chưa trỏ DNS / chưa có HTTPS / API chưa chạy | Ở local: bỏ qua webhook. Production: làm điều kiện đầu Phần B, thử bằng `curl` |
| «Kiểm tra» webhook báo 404 / 405 | Điền nhầm URL (ví dụ link `/zalo-callback`) | Dùng `https://dealhunter.io.vn/api/v1/webhooks/zalo` |
| Log `zalo webhook rejected`, `reason=invalid signature` | `ZALO_WEBHOOK_SECRET` trống hoặc là App Secret Key | Điền **OA Secret Key** (menu Webhook) |
| Log `zalo webhook rejected`, `reason=stale timestamp` | Đồng hồ máy chủ lệch nhiều | Bật đồng bộ giờ (NTP) |
| Log `zalo webhook ignored` | Request không có chữ ký (như request «Kiểm tra») hoặc chưa điền khoá Zalo: bỏ qua, không phải lỗi | Không cần làm gì |
