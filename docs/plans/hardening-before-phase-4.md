# DealHunter — Kế Hoạch Gia Cố Hệ Thống Trước Phase 4 (Hardening Plan)

> **Mục tiêu tài liệu**: Liệt kê đầy đủ các sai sót, thiếu sót và điểm cần tối ưu phát hiện qua đợt rà soát toàn bộ Phase 1 → Phase 3.5 (bao gồm GAP-01 → GAP-05 và đóng gói Docker), kèm giải pháp và tiêu chí nghiệm thu (DoD) cho từng hạng mục. Toàn bộ hạng mục **Nhóm 1 và Nhóm 2 phải hoàn thành trước khi deploy production hoặc bắt đầu Phase 4**.
>
> **Ngày rà soát**: 2026-10-07
>
> **Vị trí trong lộ trình tổng thể**:
> * **Phase 1 → 3.5, GAP-01 → 05**: Đã triển khai chức năng, nhưng **chưa đạt DoD đầy đủ** (xem tài liệu này)
> * **HARDENING**: **Gia cố bảo mật, độ tin cậy và tính đúng đắn dữ liệu (GIAI ĐOẠN HIỆN TẠI)**
> * **Phase 4**: Price Intelligence (Deal Score 1-10, Fake Discount Detector, Volatility)
> * **Phase 5**: Auto Hunt
> * **Phase 6**: Triển khai Cloud

---

## 0. Tiến Độ Thực Hiện

| Bước | Trạng thái | Hạng mục đã xong | Ghi chú |
|---|---|---|---|
| **1. Bảo mật xác thực** | ✅ Hoàn thành (2026-10-07) | SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-10, OPS-01, OPS-02, OPS-07 (API), GAP-02a, GAP-02c, DOC-03; thêm: chống payload webhook quá lớn (một phần SEC-11), thuật toán chữ ký Zalo (từ nhóm DATA) | Xem chi tiết bên dưới |
| 2. Phân quyền & validate input | ⏳ Chưa bắt đầu | | |
| 3 → 9 | ⏳ Chưa bắt đầu | | |

**Chi tiết Bước 1**:
- Định danh chỉ lấy từ access token (`Authorization: Bearer`), JWT 15 phút có claim `role` (`guest`/`user`), kiểm tra `iss` và `exp`. `X-User-ID` và user mặc định `...0001` đã bị loại bỏ.
- Refresh token 30 ngày trong cookie `dh_refresh` (HttpOnly, SameSite=Lax, Secure ở production), lưu hash SHA-256 trong bảng `refresh_tokens` (migration `000008`), xoay vòng mỗi lần refresh, phát hiện dùng lại (thu hồi toàn bộ phiên) với 30 giây ân hạn cho nhiều tab.
- Endpoint mới: `POST /auth/guest`, `/auth/refresh`, `/auth/logout`. Đã gỡ `POST /auth/migrate`; di trú guest chỉ xảy ra khi đăng nhập kèm access token guest của chính người dùng, sau đó phiên guest bị thu hồi.
- Demo login và token `mock-google-*` chỉ hoạt động khi `ENABLE_DEV_LOGIN=true`; demo login không bao giờ trả về tài khoản Google có sẵn (409).
- Google login kiểm tra `aud == GOOGLE_CLIENT_ID`, `iss`, `email_verified`.
- `cfg.ValidateAPI()`: API từ chối khởi động ở production nếu JWT secret yếu/mặc định, thiếu `GOOGLE_CLIENT_ID`, CORS rỗng hoặc `*`, bật dev login, cookie không Secure, hoặc bật Zalo mà thiếu thông tin ký webhook. `docker-compose.prod.yml` bắt buộc các biến này.
- CORS đọc từ `CORS_ALLOWED_ORIGINS`, chỉ cấp `Allow-Credentials` cho origin được cấu hình.
- Webhook Zalo: secret chỉ lấy từ cấu hình (thiếu → 503), chữ ký `sha256(appId + body + timestamp + OASecretKey)`, từ chối timestamp lệch quá 15 phút, giới hạn body 64KB.
- `migrate down` chỉ lùi 1 bước (`-steps N`); `down-all` bắt buộc `-force`.
- Frontend (`dealhunter-web`): access token chỉ trong bộ nhớ, tự khôi phục phiên bằng `/auth/refresh` hoặc tạo phiên guest, tự refresh và thử lại 1 lần khi gặp 401; nút Google Sign-In thật (Google Identity Services); nút demo/mock chỉ hiện ở môi trường dev.

**Còn mở sau Bước 1**: chưa kiểm thử frontend trên trình duyệt thật với Google Client ID thật; chưa có rate limit cho `POST /auth/guest`.

---

## 1. Tổng Quan Kết Quả Rà Soát

- `go build ./...`, `go vet ./...` và `go test -short -race ./internal/... ./pkg/...` đều **PASS**.
- Tuy nhiên rà soát code đối chiếu với các tài liệu plan phát hiện:
  - **Lớp xác thực có thể bị vượt qua theo nhiều cách độc lập**, trong đó 3 cách đủ để chiếm tài khoản bất kỳ.
  - **Hàng đợi job không có retry / reclaim** dù DoD Phase 1 yêu cầu.
  - **Một số dữ liệu hiển thị cho người dùng là dữ liệu giả** (giá cũ khi scraper bị chặn, voucher tự sinh).
- Trạng thái "Đã hoàn thành" / "100%" trong các tài liệu plan cần được điều chỉnh sau khi hoàn thành kế hoạch này.

| Nhóm | Phạm vi | Số hạng mục | Ưu tiên |
|---|---|---|---|
| **1. SEC** | Bảo mật, xác thực, phân quyền | 12 | 🔴 Bắt buộc trước deploy |
| **2. REL** | Độ tin cậy job queue, worker, scheduler, notifier | 12 | 🔴 Bắt buộc trước deploy |
| **3. DATA** | Tính đúng đắn dữ liệu, giá, voucher, affiliate, matching | 13 | 🟠 Trước Phase 4 |
| **4. OPS** | Docker, cấu hình production, tài liệu vận hành | 9 | 🟠 Trước deploy |
| **5. PERF** | Tối ưu truy vấn, index, retention | 8 | 🟢 Có thể làm song song |
| **6. DOC** | Đồng bộ tài liệu API và plan | 5 | 🟢 Cuối đợt |
| **7. DOD-GAP** | Tính năng spec yêu cầu nhưng chưa làm | 10 | 🟡 Quyết định làm / dời |

---

## 2. Nhóm 1 — Bảo Mật & Phân Quyền (SEC) 🔴

| ID | Vấn đề | Vị trí | Kịch bản lỗi | Giải pháp |
|---|---|---|---|---|
| **SEC-01** | Mock Google token bỏ qua xác minh: `id_token` bắt đầu bằng `mock-google-` / `demo-` được chấp nhận ở mọi môi trường | `internal/auth/service.go:93-99` | `POST /auth/google {"id_token":"mock-google-victim@gmail.com"}` → nhận JWT 7 ngày của nạn nhân | Chỉ cho phép khi `APP_ENV != production`; mặc định tắt |
| **SEC-02** | `/auth/demo-login` luôn bật, trả token của **tài khoản có sẵn** theo email | `internal/http/router.go:53`, `internal/auth/service.go:40-71` | `POST /auth/demo-login {"email":"victim@..."}` → chiếm tài khoản | Chỉ đăng ký route khi không phải production; demo-login không bao giờ trả về tài khoản có `auth_provider = google` |
| **SEC-03** | Google token thật không kiểm tra `aud`, `iss`, `email_verified`; `googleClientID` không được dùng | `internal/auth/service.go:102-129` | Token Google cấp cho app khác bị replay để đăng nhập DealHunter | So `aud == GOOGLE_CLIENT_ID`, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `email_verified == true`; ưu tiên verify JWKS cục bộ (`google.golang.org/api/idtoken`) |
| **SEC-04** | `JWT_SECRET` mặc định công khai trong repo; compose prod truyền chuỗi rỗng khi chưa set → khóa HMAC rỗng | `pkg/config/config.go:112`, `docker-compose.prod.yml:67`, `.env.example:13` | Kẻ tấn công tự ký JWT cho user bất kỳ | Khi `APP_ENV=production`: fail khởi động nếu secret rỗng, < 32 byte hoặc bằng giá trị mặc định; compose dùng `${JWT_SECRET:?JWT_SECRET is required}` |
| **SEC-05** | API vẫn tin header `X-User-ID`; request không header dùng chung user `...0001`; không có auth middleware; kiểm tra "registered member" fail-open khi lỗi DB | `internal/http/handler.go:93-105`, `internal/http/router.go` | Biết UUID guest (lộ qua `sub_id` affiliate) → đọc/sửa tracked products, alerts, Zalo của guest đó; mọi khách ẩn danh dùng chung 1 kho dữ liệu | Thêm auth middleware: Bearer JWT cho user đăng nhập; guest dùng **guest token ký bởi server** (JWT `role=guest`) thay vì UUID thô; bỏ hẳn fallback `...0001`; lỗi DB → từ chối |
| **SEC-06** | `/auth/migrate` không chứng minh quyền sở hữu guest | `internal/http/auth_handler.go:68-74`, `internal/auth/repository.go:104-175` | User bất kỳ gửi UUID guest của người khác → chuyển toàn bộ dữ liệu về mình | Yêu cầu guest token hợp lệ (SEC-05) cùng request; `guest_user_id` lấy từ token, không lấy từ body |
| **SEC-07** | `link-source` chuyển product source giữa các nhóm mà không kiểm tra quyền | `internal/tracking/service.go:194-201`, `internal/http/handler.go:868-913` | User A gửi URL của B vào sản phẩm của A → nguồn của B rời khỏi nhóm so sánh của B | Không di chuyển source dùng chung; chỉ tạo liên kết trong phạm vi tracking của caller, hoặc yêu cầu caller sở hữu cả hai phía |
| **SEC-08** | Accept/dismiss match suggestion là IDOR; `product_id` trên path bị bỏ qua; dismiss bỏ qua user | `internal/matching/service.go:172-203`, `internal/http/matching_handler.go:91-159` | Khách ẩn danh dismiss toàn bộ gợi ý của 1 sản phẩm, hoặc accept gợi ý sai → liên kết toàn cục | Kiểm tra suggestion thuộc `product_id` trên path và caller có tracking sản phẩm đó |
| **SEC-09** | `POST /tracked-products/{id}/vouchers` không xác thực, không kiểm tra quyền, không validate input | `internal/http/voucher_handler.go:214-287` | Gửi `discount_percent:100` → giá về tay = 0 cho mọi user; `collect_url` phishing được gửi qua Zalo | Yêu cầu đăng nhập + quyền admin (hoặc chỉ cho voucher riêng user); validate `voucher_type` enum, `0 ≤ percent ≤ 100`, amount ≥ 0, `collect_url` chỉ `https` và host thuộc whitelist sàn, giới hạn độ dài, bắt buộc `expires_at`; `MaxBytesReader` |
| **SEC-10** | Webhook Zalo lấy secret từ chính request (`X-DealHunter-Secret` / `?secret=`); bỏ qua xác minh nếu không có secret; không chống replay | `internal/http/zalo_webhook.go:50-76` | Giả mạo callback đánh dấu read/delivered tùy ý; replay callback cũ | Secret chỉ lấy từ config; thiếu secret → trả 503 và không xử lý; kiểm tra `timestamp` trong cửa sổ 5 phút |
| **SEC-11** | Webhook Zalo không giới hạn kích thước body | `internal/http/zalo_webhook.go:43` | Body cực lớn làm cạn bộ nhớ | `http.MaxBytesReader(w, r.Body, 64<<10)` |
| **SEC-12** | Lộ thông tin nội bộ & PII: lỗi DB trả thẳng cho client; số điện thoại / Zalo ID ghi log plaintext | `voucher_handler.go:75,287`; `internal/notification/notifier.go:54,109,121` | Lộ cấu trúc DB; lộ PII trong log | Trả lỗi chung, log chi tiết phía server; mask recipient (`09****123`) |

**DoD Nhóm 1**:
- [ ] Mỗi SEC-xx có test (unit hoặc integration) tái hiện kịch bản tấn công và khẳng định bị từ chối.
- [x] Không còn đường dẫn code nào đọc `X-User-ID` hoặc trả về user `...0001`.
- [x] `APP_ENV=production` với secret yếu → process thoát với lỗi rõ ràng.
- [ ] Mọi route ghi dữ liệu đều đi qua auth middleware và kiểm tra ownership.

---

## 3. Nhóm 2 — Độ Tin Cậy Job Queue, Worker, Notifier (REL) 🔴

| ID | Vấn đề | Vị trí | Kịch bản lỗi | Giải pháp |
|---|---|---|---|---|
| **REL-01** | `ReclaimPending` là stub `return nil`; consumer chỉ đọc `">"`; nhiều nhánh lỗi return mà không XACK | `internal/queue/redis_stream.go:50-97`; `internal/jobs/worker.go:143-226` | DB chập chờn / SIGTERM giữa transaction → message nằm trong PEL mãi, `fetch_jobs` kẹt `running` | Goroutine `XAUTOCLAIM` định kỳ (min-idle 5 phút) cho cả worker và notifier; xử lý xong mới XACK |
| **REL-02** | Không có retry/backoff: fetch lỗi → `failed` + XACK, không bao giờ chạy lại; `pkg/retry` không được import; `MarkDead` không bao giờ kích hoạt | `worker.go:176-182`; `internal/jobs/repository_pg.go:119-131`; `pkg/retry` | 429/timeout → mất dữ liệu đến chu kỳ sau; job không bao giờ `dead` | Phân loại lỗi bằng `retry.MarketplaceError`; lỗi retryable → tăng `attempt`, set `available_at` theo backoff + jitter, re-enqueue; quá `MAX_RETRY` → `dead` |
| **REL-03** | `MarkRunning` không điều kiện (check-then-act); `MarkSucceeded` không guard trạng thái | `worker.go:128-146`; `repository_pg.go:84-97` | Khi đã có reclaim, 2 consumer cùng xử lý 1 job → 2 snapshot | `UPDATE fetch_jobs SET status='running' ... WHERE id=$1 AND (status IN ('queued','failed') OR (status='running' AND picked_at < now()-interval '5 min')) RETURNING` |
| **REL-04** | Scheduler tạo 1 job cho **mỗi tracking (mỗi user)** thay vì mỗi `product_source` | `internal/tracking/repository_pg.go:207-250`; `internal/jobs/scheduler.go:66-85` | 50 user theo dõi 1 sản phẩm → 50 lần scrape mỗi 30 phút, tăng nguy cơ bị chặn | Lập lịch theo `product_sources.next_fetch_at`; một job / source / chu kỳ |
| **REL-05** | Alert trùng: các job đồng thời đọc cùng `LastPrice` ngoài transaction; dedup `ShouldSuppress` → `InsertLog` không nguyên tử; lỗi dedup fail-open | `worker.go:149,201-204,231,268-303` | Giá giảm → mỗi rule có thể gửi 2-3 tin Zalo | Đọc `last_price` bằng `SELECT ... FOR UPDATE` trong transaction; partial unique index trên `notification_logs (alert_rule_id, dedup_bucket)`; lỗi dedup → không gửi |
| **REL-06** | Scheduler: claim (`next_fetch_at`) → `CreateJob` → `Enqueue` không nguyên tử | `tracking/repository_pg.go:209-210`; `scheduler.go:76-84` | Redis down khi tick → tracking bị bỏ qua 1 chu kỳ, `fetch_jobs` kẹt `queued` | Outbox: chỉ tạo `fetch_jobs` trong transaction; reconciler định kỳ enqueue các job `queued` quá hạn |
| **REL-07** | `TrackURL` không enqueue fetch ngay lần đầu thành công; `NextFetchAt = now+30m` | `internal/tracking/service.go:99,122-128` | Người dùng chờ ~30 phút mới thấy giá đầu tiên | Set `next_fetch_at = now()` cho tracking mới hoặc enqueue ngay qua outbox (REL-06) |
| **REL-08** | Notifier không retry: lỗi gửi → `failed` + XACK; SIGTERM huỷ ctx khiến `UpdateStatus`/`Ack` thất bại | `internal/notification/notifier.go:104-124` | Zalo 5xx tạm thời → mất cảnh báo vĩnh viễn | Retry với backoff (spec Phase 2 §2); dùng context riêng (`context.WithoutCancel` + timeout) cho bước cập nhật trạng thái & ACK |
| **REL-09** | `InsertLog` thành công nhưng `XADD` thất bại → bản ghi `queued` mồ côi, chặn rule đó 6h | `worker.go:299-327`; `notification/repository_pg.go:182` | Cảnh báo đầu tiên không bao giờ được gửi | Outbox cho notification + sweeper enqueue lại bản ghi `queued` quá 1 phút |
| **REL-10** | `Consume` quay vòng không sleep khi Redis lỗi; không tự `Init` lại khi `NOGROUP`; dùng `fmt.Printf` | `redis_stream.go:58-67` | Redis restart → 10 goroutine chạy 100% CPU, ngập stdout | Backoff khi lỗi; tái tạo group khi `NOGROUP`; dùng `slog` |
| **REL-11** | Token Zalo: không lock giữa nhiều process; mất refresh token xoay vòng khi ghi Redis lỗi (chỉ `Warn`); không refresh khi gặp lỗi token hết hạn | `internal/notification/zalo/token_manager.go:74-156`; `zalo/client.go:108-110` | 2 notifier cùng refresh bằng 1 refresh token → 1 bên lỗi; restart → dùng refresh token đã bị tiêu → OA bị khoá | Redis lock (`SET NX PX`) + double-check cache; lưu refresh token mới bắt buộc thành công (lỗi → không dùng token mới, alert); refresh-on-401 |
| **REL-12** | Tên consumer notifier hardcode `notifier-1` | `cmd/notifier/main.go:117` | Nhiều replica dùng chung danh tính, PEL không rõ chủ | Tên consumer = hostname + PID (giống worker) |

**DoD Nhóm 2**:
- [ ] Integration test: worker bị kill giữa chừng → message được reclaim và xử lý lại đúng 1 snapshot (spec Phase 1 §23).
- [ ] Integration test: adapter trả timeout 2 lần rồi thành công → job `succeeded` với `attempt = 2`; lỗi vượt `MAX_RETRY` → `dead`.
- [ ] Integration test: N user theo dõi cùng source, giá giảm → mỗi rule chỉ có đúng 1 notification.
- [ ] Redis restart trong lúc chạy → worker/notifier tự phục hồi, CPU không tăng vọt.

---

## 4. Nhóm 3 — Tính Đúng Đắn Dữ Liệu (DATA) 🟠

| ID | Vấn đề | Vị trí | Giải pháp |
|---|---|---|---|
| **DATA-01** | Scraper bị chặn → 3 adapter trả **giá lần trước** như lần đo mới với `InStock=true`, `CapturedAt=now` | `marketplace/shopee/adapter.go:234-250`, `lazada/adapter.go:135-151`, `tiktok/adapter.go:134-150` | Bỏ fallback; trả `MarketplaceError` retryable (403/429/timeout) để REL-02 xử lý; metrics ghi nhận thất bại |
| **DATA-02** | `ResolveProduct` khi bị chặn vẫn thành công với tiêu đề placeholder ("San pham Shopee") và giá 0 | `shopee/adapter.go:151-167` | Trả lỗi rõ ràng cho người dùng ("không lấy được thông tin, thử lại sau") hoặc tạo tracking ở trạng thái `pending_resolve` |
| **DATA-03** | Voucher bịa: GET tự sinh voucher giả (`SHOP15K`, `PLAT24K`) và lưu DB; lỗi lưu bị bỏ qua; GET đồng thời sinh trùng | `internal/http/voucher_handler.go:80-81,125-211`; `internal/voucher/repository_pg.go:36` | Xoá hoàn toàn logic sinh voucher giả; GET chỉ đọc; unique key voucher theo `(product_source_id, voucher_type, voucher_code)`; migration dọn voucher giả đã lưu |
| **DATA-04** | Affiliate bật mặc định với template placeholder `s.lazada.vn/s.xxxx`, `vt.tiktok.com/xxxx`; `Transform` không kiểm tra ID rỗng | `pkg/config/config.go:116-122`; `pkg/affiliate/affiliate.go:81-94` | Mặc định `AFFILIATE_ENABLED=false`, template rỗng; thiếu ID hoặc template → giữ link gốc (fail-safe theo spec) |
| **DATA-05** | Ghép URL affiliate không encode `{RAW_URL}`/`{AFFILIATE_ID}`; `detectPlatform` so khớp substring; AccessTrade bọc mọi URL | `pkg/affiliate/affiliate.go:77-123` | `url.QueryEscape`; nhận diện nền tảng theo host (`url.Parse` + so hậu tố domain); chỉ bọc URL thuộc whitelist sàn |
| **DATA-06** | SubID không đúng spec (cắt 8 ký tự UUID); notifier dùng `ProductSourceID`, API dùng `ProductID`; khách ẩn danh đều là `u_00000000` | `pkg/affiliate/affiliate.go:98-110`; `notifier.go:65`; `voucher_handler.go:65` | Thống nhất `u_{user_id}_p_{product_id}` đầy đủ (hoặc bảng mapping short-id) và cùng 1 nguồn ID ở mọi nơi |
| **DATA-07** | Công thức giá thứ 2 không có `max(0, …)`, dùng `SalePrice` thay `ListedPrice`; adapter tự tính `price + shipping` inline; `pricing.Price.EffectivePrice()` không dùng | `internal/pricing/model.go:17-22` | Một hàm `EffectivePrice` duy nhất, có floor 0, dùng ở adapter, voucher engine và API |
| **DATA-08** | Cột `price_snapshots.shop_discount` / `platform_coupon` (migration 000007) không bao giờ được ghi/đọc | `migrations/000007_vouchers.up.sql:24-26` | Ghi giá trị khi tính snapshot, hoặc xoá cột nếu không dùng; đồng bộ tài liệu API |
| **DATA-09** | Mô hình voucher mơ hồ: `DiscountAmount` vừa là số tiền cố định vừa là trần; voucher freeship % tính trên giá hàng; min order so với giá niêm yết thay vì subtotal sau giảm shop; ví dụ spec §4.2 sai | `internal/voucher/model.go:71-86` | Tách `discount_amount` và `max_discount`; freeship tính trên phí ship; min order so với subtotal sau shop voucher; sửa ví dụ spec |
| **DATA-10** | Matching dương tính giả: regex coi `128gb` là mã model; `strings.Contains` khiến `a5` khớp `a54`; overlap bất kỳ nâng điểm text ≥ 0.9 | `internal/matching/normalizer.go:30`; `internal/matching/scoring.go:31-46` | Loại token dung lượng khỏi model code; so khớp nguyên token; model code khác nhau → loại hẳn |
| **DATA-11** | Auto-match lúc mới track: giá = 0 → điểm giá trung tính 0.5 → có thể auto-link sai giá 10 lần; thiếu lọc cứng ±35% | `internal/http/handler.go:166-174`; `scoring.go:106-107` | Chỉ auto-match sau khi có giá đầu tiên; áp lọc cứng ±35% theo spec GAP-03 |
| **DATA-12** | Searcher production trả catalog seed (TikTok luôn seed; Lazada/Shopee fallback seed khi bị chặn); Lazada dùng URL trang tìm kiếm làm URL sản phẩm | `internal/matching/searcher.go:93-140` | Seed chỉ dùng khi `APP_ENV != production`; bị chặn → trả rỗng; chỉ chấp nhận URL trang sản phẩm |
| **DATA-13** | Payload ZNS không khớp template: giá thô thay vì `27.990.000đ`; thiếu `product_name`, `tracking_id`; gửi `user_id` thay vì phone; phone định dạng `0xxx`; `COALESCE(zalo_id, phone)` ưu tiên Zalo ID | `notifier.go:59-73`; `zalo/client.go:38-75`; `notification/repository_pg.go:344` | Map đúng các biến template spec Phase 2 §5.2-5.3; chuẩn hoá phone `84xxxxxxxxx`; ZNS luôn dùng phone |

**Các lỗi nhỏ thuộc nhóm DATA (gom chung)**:
- `lowest_in_days` kích hoạt lại khi bằng giá (dùng `>` thay vì `>=`) — `internal/alert/engine_impl.go:115`.
- Lỗi đánh giá rule bị nuốt không log — `engine_impl.go:40-44`.
- Webhook Zalo: sự kiện đọc tin của Zalo là `user_seen_message` với mảng `message.msg_ids`, code đang khớp `user_read_message` — `zalo_webhook.go:100`.
- Webhook bỏ qua lỗi `UpdateDeliveryStatus` và vẫn trả 200 — `zalo_webhook.go:114`.
- Cập nhật `read` không guard trạng thái, có thể ghi đè `failed` — `notification/repository_pg.go:151-157`.
- `msg_id` rỗng/không parse được → log `sent` không có msg_id — `zalo/client.go:108-117`.
- Thuật toán ký webhook sai so với Zalo (Zalo dùng `sha256(appId + body + timestamp + OASecretKey)`, không phải HMAC body) — `zalo_webhook.go:163-171`. Phải sửa cùng SEC-10.
- `MockZaloClient` được dùng âm thầm khi `ZALO_ENABLED=true` mà thiếu token, đánh dấu `sent` — `cmd/notifier/main.go:73-81`.
- TokenManager ghi `mock_zalo_access_token_active` đè lên token tĩnh hợp lệ trong Redis; `SendMessage` ưu tiên token này → mọi tin gửi thất bại — `token_manager.go:87-93`, `client.go:47-51`.
- Huỷ liên kết source không invalidate cache `dh:cmp:` của sản phẩm cũ; sản phẩm cũ còn < 2 nguồn giữ `comparison_snapshots` (có thể `is_best_deal=TRUE`) mãi — `handler.go:913`, `matching/service.go:113,194`, `comparison/repository_pg.go:203-209`.
- Ghi nhiều bước không có transaction: reset `is_best_deal` + upsert (lỗi reset bị bỏ qua) — `comparison/repository_pg.go:117-138`; `TrackURL` tạo product/source/tracking riêng lẻ → product mồ côi khi 2 user thêm cùng URL — `tracking/service.go:54-89,198-240`; link + `SaveSuggestion` — `matching/service.go:108-126`.
- Worker không cập nhật `tracked_products.next_fetch_at` trong transaction thành công (spec Phase 1 §14) — `worker.go:189-226`.

**DoD Nhóm 3**:
- [ ] Không còn dữ liệu giả (giá cũ, voucher, catalog seed) trên đường production; test khẳng định.
- [ ] Unit test bảng cho `EffectivePrice` và voucher engine với các ca: %, cố định, trần, freeship, min order, giá âm.
- [ ] Unit test matching cho các cặp dương tính giả đã biết (`iPhone 14` vs `iPhone 15`, `A5` vs `A54`).
- [ ] Test affiliate: URL chứa `&`/`#`, host giả mạo, thiếu ID → giữ link gốc.

---

## 5. Nhóm 4 — Cấu Hình Production & Vận Hành (OPS) 🟠

| ID | Vấn đề | Vị trí | Giải pháp |
|---|---|---|---|
| **OPS-01** | `migrate down` gọi `m.Down()` → **xoá toàn bộ bảng**, trong khi cẩm nang ghi "rollback 1 migration" | `cmd/migrate/main.go:45`; `docs/deployment/production-deployment-guide.md:358-360` | `down` mặc định `m.Steps(-1)`; thêm `down-all` yêu cầu flag xác nhận `-force` |
| **OPS-02** | CORS hardcode `*`; `CORS_ALLOWED_ORIGINS` không được dùng | `internal/http/router.go:23`; `config.go:111` | Middleware CORS đọc danh sách origin từ config; production không cho phép `*` |
| **OPS-03** | Cổng API `8080` publish trên mọi interface, vượt qua nginx & allow-list `/metrics` (Docker bỏ qua ufw); `middleware.RealIP` tin `X-Forwarded-For` từ client | `docker-compose.prod.yml:58`; `router.go:16` | Bind `127.0.0.1:8080:8080`; `/metrics` tách port nội bộ; chỉ tin `X-Forwarded-For` từ proxy tin cậy |
| **OPS-04** | `GOARCH=amd64` hardcode trong Dockerfile | `Dockerfile:18-22` | Dùng `ARG TARGETOS TARGETARCH` + `--platform=$BUILDPLATFORM` |
| **OPS-05** | Postgres mặc định `dealpass`; Redis không mật khẩu | `docker-compose.prod.yml:10,43,…` | `${POSTGRES_PASSWORD:?…}`; Redis `requirepass` + `REDIS_URL` có mật khẩu |
| **OPS-06** | Thiếu healthcheck cho `api`, `worker`, `notifier`; `web` chỉ chờ api start, không chờ healthy | `docker-compose.prod.yml` | Healthcheck `/healthz` cho api; liveness đơn giản cho worker/notifier; `condition: service_healthy` |
| **OPS-07** | Không validate cấu hình khi khởi động ở production (JWT, Zalo, affiliate, Google client ID) | `pkg/config/config.go` | Hàm `cfg.Validate()` gọi ở mọi `cmd/*` |
| **OPS-08** | Cẩm nang: `ACCESSTRADE_DEEPLINK_URL=...?url=` thiếu placeholder `{URL}`; `.env` mẫu có `DATABASE_URL`, `REDIS_PORT` nhưng compose tự ghép giá trị riêng | `production-deployment-guide.md:53,85` | Sửa ví dụ; ghi rõ biến nào compose bỏ qua |
| **OPS-09** | `.dockerignore` chỉ loại `.env`, `.env.local`, không loại `.env.*` khác | `.dockerignore` | Thêm `.env*` và `!.env.example` |

**DoD Nhóm 4**:
- [ ] `docker compose -f docker-compose.prod.yml config` lỗi khi thiếu `JWT_SECRET` / `POSTGRES_PASSWORD`.
- [ ] `make prod-up` chạy toàn stack (bao gồm image web) thành công, mọi service `healthy`.
- [ ] Từ máy ngoài không truy cập được `:8080` và `/metrics`.
- [x] `migrate down` chỉ lùi 1 phiên bản (đã kiểm tra thủ công trên DB local: 8 → 7; `down-all` không có `-force` bị từ chối).

---

## 6. Nhóm 5 — Tối Ưu Hiệu Năng & Dữ Liệu (PERF) 🟢

| ID | Vấn đề | Vị trí | Giải pháp |
|---|---|---|---|
| **PERF-01** | N+1: `enrichTracking` gọi `GetProductSource` cho từng tracking khi list | `internal/http/handler.go:222,259-261` | Một truy vấn JOIN |
| **PERF-02** | Lịch sử giá không giới hạn khoảng thời gian, không LIMIT, không downsample | `handler.go:346-359`; `pricing/repository_pg.go:73-108` | Giới hạn tối đa 180 ngày; downsample theo giờ/ngày (`date_trunc`) khi khoảng thời gian dài |
| **PERF-03** | `lowest_in_days` tải toàn bộ snapshot N ngày vào Go cho mỗi rule | `internal/alert/engine_impl.go:103` | `SELECT MIN(price) ... WHERE captured_at < $new` |
| **PERF-04** | Mỗi rule khớp tốn 3 round-trip (dedup, recipient, insert) | `worker.go:268-303` | `INSERT ... SELECT ... WHERE NOT EXISTS` (gộp với REL-05) |
| **PERF-05** | Index `idx_fetch_jobs_available` không truy vấn nào dùng; FK `fetch_jobs.product_source_id` thiếu index | `migrations/000001_init.up.sql:76` | Dùng lại index khi làm REL-02/06, hoặc xoá; thêm index FK |
| **PERF-06** | Không có retention cho `fetch_jobs`, `price_snapshots`, `notification_logs` | — | Job dọn `fetch_jobs` > 7 ngày; downsample/partition `price_snapshots` > 90 ngày |
| **PERF-07** | Redis Stream không bao giờ trim | `redis_stream.go:32-36` | `XADD MAXLEN ~ 100000` |
| **PERF-08** | Notifier xử lý tuần tự (`Count:1`, 1 goroutine) | `cmd/notifier/main.go`, `notifier.go` | Worker pool có cấu hình + rate limit theo quota Zalo |

---

## 7. Nhóm 6 — Đồng Bộ Tài Liệu (DOC) 🟢

| ID | Vấn đề | Giải pháp |
|---|---|---|
| **DOC-01** | `docs/api/rest-api-reference.md` lệch code: response `GET /vouchers` là object chứ không phải mảng; `GET /prices` trả `{product_source_id, snapshots}` và struct snapshot không có JSON tag (field ra dạng `ID`, `Price`); `DELETE /alerts/{id}` trả 200 chứ không phải 204; `/auth/me` và `/users/me` là 2 handler khác nhau; tài liệu liệt kê 409/422 nhưng không handler nào trả | Thêm JSON tag snake_case cho `pricing.PriceSnapshot`; cập nhật tài liệu theo code sau khi sửa |
| **DOC-02** | Khoảng 9 route chưa có tài liệu: `GET /alert-rules`, `GET /alerts/{id}/logs`, `POST/DELETE /users/me/zalo`, `GET /auth/zalo/status`, `POST /auth/zalo/disconnect`, `POST /user/zalo/connect`, `GET /user/zalo/status`, `DELETE /user/zalo` | Bổ sung tài liệu hoặc gộp/xoá các route Zalo trùng lặp (`/user/zalo` vs `/users/me/zalo` vs `/auth/zalo`) |
| **DOC-03** | Mục header xác thực vẫn mô tả `X-User-ID` cho guest | Cập nhật theo cơ chế guest token (SEC-05) |
| **DOC-04** | Trạng thái "Đã hoàn thành" / "100%" trong `gap-resolution-and-foundation-completion.md`, `phase-3-5-monetization-and-voucher-engine.md`, `README.md` chưa chính xác | Cập nhật sau khi hoàn thành kế hoạch này, liên kết về tài liệu này |
| **DOC-05** | Thiếu runbook cho reclaim/retry, xoay vòng token Zalo, khôi phục khi OA bị khoá | Bổ sung vào `docs/runbooks/` sau khi làm REL |

---

## 8. Nhóm 7 — Tính Năng Spec Yêu Cầu Nhưng Chưa Triển Khai (DOD-GAP) 🟡

Các mục này cần **quyết định làm ngay hay dời** sang phase sau; không chặn deploy nếu Nhóm 1-4 đã xong.

| ID | Spec gốc | Còn thiếu | Đề xuất |
|---|---|---|---|
| **GAP-01a** | Scraper Tầng 1 (JSON API) | Chỉ Shopee có; Lazada, TikTok chỉ đọc HTML/OpenGraph | Làm trước Phase 4 (Phase 4 cần dữ liệu giá chính xác) |
| **GAP-01b** | Scraper Tầng 2 (Headless/FlareSolverr khi 403) | Chưa có; không phát hiện 403/captcha | Dời Phase 6, nhưng phải có phát hiện 403 (DATA-01) |
| **GAP-01c** | Proxy xoay vòng | `ProxyURL` có trong client nhưng adapter không dùng | Dời Phase 6 |
| **GAP-02a** | Access token 15 phút + refresh token 30 ngày HttpOnly | Chỉ 1 JWT 7 ngày, không thu hồi được | Làm cùng SEC-05 |
| **GAP-02b** | Đăng nhập email magic link | Chưa có | Dời |
| **GAP-02c** | Migrate guest tự động khi đăng nhập | Là endpoint thủ công riêng | Làm cùng SEC-06 |
| **GAP-03a** | Levenshtein + Jaccard, lọc cứng ±35%, chọn top 3 theo lượt bán/đánh giá | Chỉ Jaccard; không lọc cứng; không top 3 | Làm cùng DATA-10/11 |
| **GAP-03b** | Matching chạy trong worker | Chạy trong goroutine của API | Chuyển sang job queue |
| **P1-METRICS** | Metrics `queue_depth`, `active_tracked_products` (spec Phase 1 §22) | Khai báo nhưng không cập nhật | Làm cùng REL |
| **P35-V2** | Scraper bóc tách voucher thật từ trang sản phẩm | Chưa có (`UpsertVoucher` chỉ gọi từ HTTP) | Làm sau DATA-03; trong lúc chờ, ẩn tính năng "giá về tay" khi không có voucher thật |

---

## 9. Thứ Tự Thực Hiện Đề Xuất

| Bước | Nội dung | Hạng mục |
|---|---|---|
| **1** | Bảo mật xác thực | SEC-01 → SEC-06, SEC-10, OPS-01, OPS-07, GAP-02a/c |
| **2** | Phân quyền & validate input | SEC-07 → SEC-09, SEC-11, SEC-12 |
| **3** | Độ tin cậy queue & worker | REL-01 → REL-07, REL-10 |
| **4** | Notifier & Zalo | REL-08, REL-09, REL-11, REL-12, DATA-13, các lỗi webhook Zalo |
| **5** | Dữ liệu thật | DATA-01 → DATA-09 |
| **6** | Matching | DATA-10 → DATA-12, GAP-03a/b |
| **7** | Production packaging | OPS-02 → OPS-06, OPS-08, OPS-09, chạy `make prod-up` toàn stack |
| **8** | Tối ưu | PERF-01 → PERF-08 |
| **9** | Tài liệu | DOC-01 → DOC-05 |

Mỗi bước là một commit (hoặc PR) riêng, kèm test tương ứng, và đánh dấu checkbox DoD trong tài liệu này khi hoàn thành.

---

## 10. Tiêu Chí Hoàn Thành Toàn Bộ Kế Hoạch

- [ ] Tất cả hạng mục SEC, REL, DATA, OPS đã sửa và có test.
- [ ] `go test -race ./...` (bao gồm integration) PASS.
- [ ] `make prod-up` chạy toàn stack thành công trên máy sạch.
- [ ] Các hạng mục DOD-GAP đã được quyết định: làm xong hoặc ghi rõ phase sẽ làm.
- [ ] Tài liệu plan, README và API reference phản ánh đúng trạng thái thực tế.
