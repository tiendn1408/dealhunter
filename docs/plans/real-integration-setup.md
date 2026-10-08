# Thiết Lập Kiểm Chứng Với Hệ Thống Thật (phần còn lại của Bước 1)

> Phần code của Bước 1 / 1.5 đã xong và đã test bằng test double. Hai việc dưới đây chỉ kiểm chứng được với dịch vụ thật nên cần bạn tạo tài khoản / khoá trước. Làm xong phần nào thì báo, tôi sẽ chạy kiểm tra phần đó.
>
> **Không dán secret vào chat.** Chỉ điền vào `.env` / `.env.local` (cả hai đã được gitignore) rồi báo "xong".

---

## A. Đăng nhập Google thật

### Bạn làm (khoảng 10 phút)

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → chọn hoặc tạo project (ví dụ `dealhunter-dev`).
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**; App name: `DealHunter`; điền support email và developer email.
   - Scopes: không cần thêm (đăng nhập chỉ dùng ID token với `openid email profile` mặc định).
   - Publishing status giữ **Testing**, thêm email Google bạn dùng để thử vào **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: `http://localhost:3100`, `http://localhost:3000`, `http://localhost`.
     (Cổng 3000 trên máy đang bị container khác chiếm nên khi thử dùng 3100.)
   - Authorized redirect URIs: để trống (luồng Google Identity Services trả ID token, không redirect).
   - Chỉ cần **Client ID**; Client secret không dùng.
   - Origin mới có thể mất vài phút mới có hiệu lực.
4. Điền cấu hình:
   - `dealhunter/.env`:
     ```
     GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
     ADMIN_EMAILS=<email Google của bạn>      # để thử quyền tạo voucher (Bước 2)
     CORS_ALLOWED_ORIGINS=http://localhost:3100
     ```
   - `dealhunter-web/.env.local`:
     ```
     NEXT_PUBLIC_GOOGLE_CLIENT_ID=<cùng client-id>
     NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
     ```
     Xoá dòng `NEXT_PUBLIC_ENABLE_MOCK_SANDBOX` (biến cũ, code không còn đọc).
5. Báo tôi "xong phần Google".

### Tôi kiểm tra
Tôi khởi động API + web (cổng 3100). Bạn bấm **Đăng nhập Google** đúng **một lần** trên Chrome thật (Google chặn đăng nhập tự động nên bước này phải do bạn làm). Sau đó tôi kiểm tra:

- [ ] `POST /auth/google` trả 200; DB có user `auth_provider=google`, `google_sub` khớp tài khoản, email đúng.
- [ ] Cookie `dh_refresh` HttpOnly, path `/api/v1/auth`; access token chỉ nằm trong bộ nhớ.
- [ ] Reload trang vẫn giữ phiên thành viên; logout thu hồi họ refresh token.
- [ ] Đang là guest rồi đăng nhập ⇒ guest được di trú vào tài khoản, token guest cũ bị từ chối.
- [ ] ID token của client ID khác / hết hạn ⇒ 401.
- [ ] Tài khoản trong `ADMIN_EMAILS` tạo được voucher, tài khoản khác bị 403.

---

## B. Chữ ký webhook Zalo với callback thật

Mục tiêu: xác nhận công thức `sha256(appId + body + timestamp + OASecretKey)` khớp header `X-ZEvent-Signature` mà Zalo gửi thật. Chỉ cần **một** sự kiện bất kỳ từ Zalo, nên không cần ZNS template (gửi ZNS thật thuộc Bước 4).

### Bạn làm

1. **Zalo OA + app**: cần một Official Account và một app trên [developers.zalo.me](https://developers.zalo.me/) đã liên kết với OA đó.
2. Lấy trong trang app:
   - **App ID**.
   - **OA Secret Key** (mục Official Account / Webhook của app; khác với App Secret Key).
3. Điền `dealhunter/.env`:
   ```
   ZALO_APP_ID=<app id>
   ZALO_OA_SECRET_KEY=<oa secret key>
   ZALO_WEBHOOK_SECRET=            # để trống ⇒ dùng ZALO_OA_SECRET_KEY
   ZALO_ENABLED=false              # chưa gửi tin; webhook vẫn được xác thực
   ```
4. **URL HTTPS public** trỏ về API local (Zalo không gọi được `localhost`). Chọn một cách:
   - `brew install cloudflared` (máy chưa có). Tôi sẽ chạy `cloudflared tunnel --url http://localhost:8080` và gửi bạn URL. URL quick tunnel đổi mỗi lần chạy.
   - Hoặc ngrok với **static domain** miễn phí (`brew install ngrok`, đăng ký tài khoản, `ngrok config add-authtoken ...`).
   - Nếu Zalo bắt **xác thực domain** cho webhook thì cần domain cố định (ngrok static domain hoặc domain riêng qua cloudflared named tunnel); quick tunnel sẽ không dùng được.
5. Trong trang app Zalo → **Webhook**: đặt URL `https://<domain>/api/v1/webhooks/zalo` và bật sự kiện **người dùng gửi tin nhắn văn bản** (`user_send_text`); bật thêm các sự kiện ZNS nếu có.
6. Báo tôi "xong phần Zalo". Khi tôi chạy API + tunnel, bạn dùng Zalo cá nhân **nhắn một tin bất kỳ cho OA**.

### Tôi kiểm tra
- [ ] Log API có `zalo webhook accepted` với `event_name=user_send_text` (chữ ký thật khớp).
- [ ] Nếu log `zalo webhook rejected` thì `reason` sẽ chỉ ra nguyên nhân (`invalid signature` / `stale timestamp` / `invalid json`). Log không bao giờ chứa secret hay body.
- [ ] Request giả mạo (sai chữ ký, timestamp lệch > 15 phút, body > 64KB) gửi qua cùng URL public ⇒ 401 / 400.
- [ ] Sau khi xong thì tắt tunnel; nhớ gỡ hoặc đổi URL webhook trên Zalo nếu là quick tunnel.

---

## Đã xử lý (không cần bạn làm)
- `internal/marketplace/shopee/adapter_test.go` không còn gọi `shopee.vn`: item API trỏ vào server test. Đã chạy toàn bộ test adapter/crawler/matching trong sandbox chặn mạng ra ngoài ⇒ đều đạt.
- `internal/notification/zalo/token_manager_test.go` không còn `FlushDB`: chỉ xoá 2 key của token manager trước/sau mỗi test. Đã kiểm chứng key khác trong DB 15 vẫn còn sau khi chạy test.
- Webhook Zalo ghi log lý do khi từ chối và `zalo webhook accepted` khi nhận (phục vụ kiểm chứng ở mục B).
