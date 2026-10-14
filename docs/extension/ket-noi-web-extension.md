# Kết nối web DealHunter ↔ extension DealHunter Assistant

Cập nhật: 2026-10-13

Tài liệu này mô tả cách web DealHunter (Next.js) trao phiên đăng nhập cho extension, extension dùng phiên đó ở đâu, và các quy tắc an toàn đi kèm.

## 1. Mục đích

- **Đăng nhập một lần:** người dùng đăng nhập trên web, extension tự nhận tài khoản (Cài đặt › Tài khoản DealHunter).
- **Huy hiệu giá trên trang sản phẩm:** với thành viên đã đăng nhập, extension hiện giá DealHunter ghi nhận và deal tốt hơn ở sàn khác ngay trên trang sản phẩm Shopee / Lazada / Tiki / TikTok Shop.

Không đăng nhập thì extension vẫn săn bình thường, chỉ không có huy hiệu giá.

```
Web DealHunter ──chrome.runtime.sendMessage(EXTENSION_ID, DH_WEB_SESSION)──▶ Background (onMessageExternal)
                                                                              │ kiểm origin + apiUrl
                                                                              ▼
                                                                     chrome.storage.session
                                                                              │
Trang sản phẩm sàn ──GET_PRICE_CONTEXT──▶ Background ──Bearer token──▶ API DealHunter (apiUrl của phiên)
(PriceHistoryBadge)
```

## 2. Thông điệp duy nhất: `DH_WEB_SESSION`

Web gửi ở mỗi lần đăng nhập, mỗi lần làm mới token và khi đăng xuất (`dealhunter-web/lib/extension_bridge.ts`):

```json
{
  "type": "DH_WEB_SESSION",
  "accessToken": "eyJ... hoặc null khi đăng xuất / khách",
  "expiresAt": 1797000000000,
  "email": "user@example.com",
  "name": "Tên",
  "apiUrl": "https://dealhunter.io.vn/api/v1",
  "webUrl": "https://dealhunter.io.vn"
}
```

Extension (`extension/src/background/web_session.ts`) trả về `{ "accepted": true | false }`:

| Điều kiện | Xử lý |
|---|---|
| Origin gửi không thuộc `DEALHUNTER_WEB_ORIGINS` | Bỏ qua (`accepted: false`) |
| Không có token, token hết hạn, hoặc `apiUrl` không hợp lệ | Xoá phiên đang lưu (= đăng xuất) |
| Hợp lệ | Lưu `{ accessToken, expiresAt, email, name, apiUrl, webUrl }` trong **một** lần ghi vào `chrome.storage.session` |

Ghi chú:
- Extension **không bao giờ tự làm mới token** (refresh token xoay vòng chặt, tự làm mới song song với web sẽ thu hồi mọi phiên). Web đẩy token mới mỗi lần làm mới.
- Token lưu trong `chrome.storage.session` (mất khi đóng trình duyệt), content script của các trang không đọc được.
- `webUrl` hợp lệ còn được nhớ riêng (`dh_last_web_url`) để link "Mở DealHunter" vẫn dùng được sau khi đăng xuất.
- Không có `PING`, `SYNC_AUTH`, `CLEAR_AUTH` (mô tả cũ đã bỏ).

## 3. Origin và URL được tin cậy (theo bản build)

| | Bản phát hành (`npm run build`) | Bản dev (`npm run build:dev` / `npm run dev`) |
|---|---|---|
| Web được gửi phiên (`externally_connectable`, `DEALHUNTER_WEB_ORIGINS`) | `https://dealhunter.io.vn`, `https://www.dealhunter.io.vn` | thêm `http://localhost:3000`, `http://localhost:3100` |
| `apiUrl` hợp lệ | `https` trên `dealhunter.io.vn` / `*.dealhunter.io.vn` | thêm `http://localhost:*` / `127.0.0.1:*` |
| API mặc định (khi chưa có phiên) | `https://dealhunter.io.vn/api/v1` | `http://localhost:8080/api/v1` |

Bản phát hành được lọc tự động lúc build: `manifest.json` trong `dist/` không còn dòng localhost nào (`extension/src/build/manifest_env.ts`), mã nguồn dùng cờ `__DH_DEV__` (`extension/src/lib/build_env.ts`).

## 4. Biến môi trường phía web

- `NEXT_PUBLIC_EXTENSION_ID`: ID của extension (xem tại `chrome://extensions`). Trống thì web không gửi gì, web vẫn chạy bình thường.
  - Dev: `dealhunter-web/.env.local` (mẫu trong `.env.example`).
  - Production: build arg trong `docker-compose.prod.yml` (`NEXT_PUBLIC_EXTENSION_ID: ${EXTENSION_ID:-}`), nên phải có lúc **build** image web.
- `NEXT_PUBLIC_API_URL`: gửi kèm phiên làm `apiUrl`, extension gọi đúng API của bản triển khai đó.

ID của bản "Load unpacked" phụ thuộc thư mục cài; bản phát hành qua Chrome Web Store có ID cố định.

## 5. Huy hiệu giá trên trang sản phẩm

1. Content script chỉ hiện huy hiệu trên **trang sản phẩm** của Shopee / Lazada / Tiki / TikTok Shop (nhận theo tên miền thật, không theo chuỗi trong URL).
2. Huy hiệu hỏi background (`GET_PRICE_CONTEXT`). Background **tự kiểm lại** URL thuộc tên miền thật của các sàn trên rồi mới gửi token (`isPriceContextUrl`), nên trang ngoài các sàn này không thể xin được token.
3. Background gọi API bằng `apiUrl` của phiên: `GET /tracked-products` (tìm sản phẩm đang theo dõi khớp URL), rồi `GET /tracked-products/{id}/comparison` (không bắt buộc).
4. API trả 401 thì extension xoá phiên (người dùng cần đăng nhập lại trên web).

## 6. Quy tắc an toàn

- Chỉ dùng kênh `chrome.runtime.sendMessage` với danh sách origin cố định; không nghe `window.postMessage` của trang.
- `onMessage` nội bộ bỏ qua tin nhắn không đến từ chính extension; `onMessageExternal` có bắt lỗi.
- Không có `web_accessible_resources`, không có quyền `tabs`: website không dò được extension qua file của nó.
- Token chỉ được gửi tới `apiUrl` đi kèm chính token đó, và chỉ khi yêu cầu đến từ trang của các sàn được hỗ trợ.
