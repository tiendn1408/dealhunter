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

## Việc Cần Làm Tiếp (bàn giao 2026-10-08)

**Trạng thái**: Bước 1 + 1.5 + 2 **hoàn tất** sau 4 đợt rà soát độc lập (2026-10-08 → 2026-10-09: "Rà soát lại …", "Rà soát lần 3", "Đợt sửa phần còn lại", "Rà soát lần 5"). Kiểm tra `git status` để biết phần nào chưa commit.

**Việc đầu tiên khi làm tiếp**
1. Chạy migration (`make migrate-up`: tới `000017`).
2. Sang Bước 3 (queue/worker).
3. Kiểm chứng (E2E trình duyệt, Google/Zalo thật) làm sau khi hoàn thành toàn bộ kế hoạch này.

**Bước 2 — Phân quyền & validate input** [DONE] 2026-10-08
- [x] SEC-07, SEC-08, SEC-09, SEC-11 (phần còn lại), SEC-12; comparison/match-suggestions yêu cầu token + quyền; rate limit `POST /auth/guest`.
- [x] (Đã xử lý 2026-10-09) IP client: `TrustedRealIP` chỉ tin header từ `TRUSTED_PROXIES` và lấy hop ngoài cùng bên phải không thuộc proxy tin cậy — proxy **nối thêm** vào `X-Forwarded-For` (`$proxy_add_x_forwarded_for` của nginx) là đúng; API chỉ bind `127.0.0.1`.

**Bước 3 → 9** (chi tiết ở các mục 2–8 bên dưới)
- [ ] Bước 3 — Queue/worker: REL-01 (XAUTOCLAIM reclaim), REL-02 (retry/backoff, `pkg/retry`), REL-03 (claim nguyên tử), REL-04 (lập lịch theo product_source), REL-05 (alert trùng), REL-06/07 (outbox, fetch ngay khi track), REL-10 (Consume quay vòng CPU).
- [ ] Bước 4 — Notifier/Zalo: REL-08/09/11/12, DATA-13 (payload ZNS đúng template), webhook: sự kiện `user_seen_message` + `msg_ids`, không bỏ qua lỗi `UpdateDeliveryStatus`, guard trạng thái `read`.
- [ ] Bước 5 — Dữ liệu: DATA-05 (encode URL affiliate, nhận diện host), DATA-06 (SubID đúng spec), DATA-07 (một hàm EffectivePrice), DATA-08 (cột voucher trong snapshot), DATA-09 (mô hình voucher), các lỗi nhỏ nhóm DATA.
- [ ] Bước 6 — Matching: DATA-10 (dương tính giả model code), phần còn lại DATA-11 (lưu giá khi track / chạy auto-match trong worker sau lần fetch đầu — hiện auto-match nền đang **tắt** vì chưa có giá), GAP-03a/b.
- [ ] Bước 7 — Production: OPS-03 (bind 127.0.0.1, `/metrics` nội bộ), OPS-04 (TARGETARCH), OPS-05 (mật khẩu Postgres/Redis), OPS-06 (healthcheck), OPS-08/09; chạy `make prod-up` toàn stack.
- [ ] Bước 8 — PERF-01 → 08. Bước 9 — DOC-01, 02, 04, 05.

**Cần kiểm chứng với hệ thống thật** — hướng dẫn thiết lập: [`real-integration-setup.md`](real-integration-setup.md) (chờ bạn tạo Google Client ID / thông tin Zalo OA)
- [ ] Đăng nhập Google thật trên trình duyệt: tạo OAuth Client ID (Web), thêm origin `http://localhost:3000`, đặt `GOOGLE_CLIENT_ID` (backend) và `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web).
- [ ] Chữ ký webhook Zalo `sha256(appId + body + timestamp + OASecretKey)` với một callback thật.

**Ghi chú môi trường / nợ kỹ thuật nhỏ phát hiện trong ngày**
- DB local đã sạch dữ liệu giả sau migration `000010` (không còn sản phẩm nào) — cần sản phẩm thật sau khi có tầng scraper A.
- Cổng 3000 trên máy đang bị một container Docker khác chiếm; khi chạy thử web local dùng `npx next dev -p 3100` và đặt `CORS_ALLOWED_ORIGINS=http://localhost:3100` cho API.
- [x] `internal/notification/zalo/token_manager_test.go` không còn `FlushDB`; chỉ xoá key của chính nó (2026-10-08).
- [x] `internal/marketplace/shopee/adapter_test.go` không còn gọi Shopee thật (item API trỏ vào server test); test adapter/crawler/matching đạt trong sandbox chặn mạng (2026-10-08).
- Script E2E trình duyệt (Chrome headless + puppeteer-core) đã lưu tại `dealhunter-web/e2e/` (`session.mjs`, `member.mjs`, `nomock.mjs`, hướng dẫn trong `README.md`) — chạy lại sau mỗi bước.

---

## 0. Tiến Độ Thực Hiện

> **Nguyên tắc từ 2026-10-07: KHÔNG dữ liệu mock.** Không demo login, token giả, catalog seed, voucher bịa, adapter sàn giả, Zalo client giả hay nút "giả lập" trong code sản phẩm (kể cả sau cờ dev). Khi dữ liệu thật không có, hệ thống báo lỗi / hiển thị trạng thái rỗng thay vì thay bằng dữ liệu giả. Test double chỉ được phép trong `*_test.go` / `tests/`.

| Bước | Trạng thái | Hạng mục đã xong |
|---|---|---|
| **1. Bảo mật xác thực** | [DONE] Hoàn thành + rà soát độc lập (2026-10-07), rà soát lại và hoàn tất (2026-10-08) | SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-10, OPS-01, OPS-02, OPS-07 (API), GAP-02a, GAP-02c, DOC-03; một phần SEC-11 (webhook) |
| **1.5. Loại bỏ toàn bộ mock (NOMOCK)** | [DONE] Hoàn thành (2026-10-07), rà soát lại và hoàn tất (2026-10-08) | NOMOCK-01 → NOMOCK-18; DATA-01, DATA-02, DATA-03, DATA-04, DATA-12; một phần DATA-11 |
| **2. Phân quyền & validate input** | [DONE] Hoàn thành (2026-10-08) | SEC-07, SEC-08, SEC-09, SEC-11, SEC-12; phân quyền comparison/match-suggestions/prices/vouchers/alerts; rate limit guest; validate alert & Zalo |
| 3 → 9 | [PENDING] Chưa bắt đầu | |

**Kết quả Bước 1**:
- Định danh chỉ từ access token (`Authorization: Bearer`): JWT 15 phút, claim `role` (`guest`/`user`), bắt buộc `iss` + `exp`. Không còn `X-User-ID` hay user mặc định `...0001`. Token guest bị từ chối ngay khi guest đã được di trú.
- Refresh token 30 ngày (cookie `dh_refresh` HttpOnly, SameSite=Lax, Secure ngoài môi trường dev), lưu hash SHA-256 theo **họ token** (`family_id`, migration `000009`). Xoay vòng **nghiêm ngặt** — dùng lại token đã xoay vòng ⇒ thu hồi mọi phiên; token bị thu hồi do logout chỉ đơn giản là không hợp lệ. Logout thu hồi cả họ token. Dọn token hết hạn/thu hồi > 7 ngày mỗi giờ. Frontend tuần tự hoá refresh giữa các tab bằng Web Locks API.
- **Không còn demo login hay token giả.** Đăng nhập duy nhất qua Google (Google Identity Services): kiểm tra `aud`, `iss`, `email_verified`, `sub`; tài khoản gắn với Google `sub` (email bị cấp lại cho người khác không kế thừa tài khoản ⇒ `409`); upsert nguyên tử theo email. Migration `000009` xoá toàn bộ tài khoản `demo` cũ (115 tài khoản ở DB local).
- Di trú guest chỉ khi đăng nhập kèm token guest của chính người dùng; chuyển cả Zalo/phone, bỏ alert rule trùng, thu hồi phiên guest. `POST /auth/migrate` đã gỡ.
- Liên kết Zalo chỉ dành cho thành viên (`403` với guest) — guest không thể chiếm số điện thoại người khác.
- Chống CSRF cho `POST /auth/*`: bắt buộc `application/json` (`415`) và Origin hợp lệ (`403`).
- `cfg.ValidateAPI()`: mọi `APP_ENV` khác `development`/`test` (kể cả `staging`, `Production`) áp dụng quy tắc nghiêm ngặt: JWT secret mạnh, có `GOOGLE_CLIENT_ID`, CORS cụ thể, cookie Secure, đủ thông tin ký webhook khi bật Zalo. `docker-compose.prod.yml` bắt buộc các biến này và `NEXT_PUBLIC_API_URL`.
- Webhook Zalo: secret chỉ từ cấu hình (thiếu ⇒ 503; `ZALO_WEBHOOK_SECRET` rỗng dùng `ZALO_OA_SECRET_KEY`), chữ ký `sha256(appId + body + timestamp + OASecretKey)`, từ chối timestamp lệch > 15 phút, body ≤ 64KB.
- `migrate down` lùi 1 bước (`-steps N`); `down-all` bắt buộc `-force`.
- Frontend: access token chỉ trong bộ nhớ (có theo dõi hạn), tự khôi phục phiên; khi phiên thành viên hết hạn **không** gửi lại request dưới danh nghĩa guest mà báo "Phiên đăng nhập đã hết hạn"; đổi danh tính ⇒ reset toàn bộ cache (không lộ dữ liệu người trước); logout thất bại thì báo lỗi, không giả vờ thành công; Docker image web build được.

**Kiểm chứng Bước 1**: unit test (`-race`), 10 integration test với Postgres/Redis thật (25 test + subtest, gồm mọi kịch bản tấn công SEC), E2E trình duyệt thật (Chrome headless, 23 kiểm tra: tạo guest, khôi phục phiên qua reload, 2 tab refresh đồng thời, logout, phiên thành viên khôi phục từ cookie, phiên thành viên hết hạn trong tab, chặn guest kết nối Zalo, không có `X-User-ID`, cookie không đọc được bằng JS). Hai reviewer độc lập (backend, frontend) đã rà soát; mọi phát hiện đã xử lý trừ các mục chuyển sang bước sau dưới đây.

**Kết quả Bước 1.5 (NOMOCK)**:
- Binary không còn đăng ký adapter sàn giả; registry chỉ nhận host thật của Shopee/Lazada/TikTok (adapter giả chuyển sang `tests/fakemarket`, chỉ test dùng).
- Scraper không bao giờ trả dữ liệu thay thế: bị chặn/không đọc được ⇒ `ErrProductUnavailable` (API trả `502` kèm thông báo rõ), không còn tiêu đề từ URL, giá cũ giả làm giá mới, người bán mặc định, phí ship 15.000đ hay "còn hàng" mặc định. Sản phẩm chỉ hợp lệ khi trang có **cả tiêu đề và giá** (chặn trường hợp lấy `<title>` của trang anti-bot "Security Check" / trang lỗi làm tên sản phẩm). Tình trạng tồn kho không xác định được lưu là `NULL`.
- Không còn voucher bịa; GET voucher chỉ đọc dữ liệu thật (danh sách rỗng là câu trả lời hợp lệ).
- Auto-match: bỏ catalog seed; Lazada/TikTok chưa có tìm kiếm thật (cần tầng headless GAP-01b) nên không trả ứng viên thay vì trả ứng viên giả; không tự chạy auto-match khi chưa có giá thật (phần của DATA-11 — test phát hiện auto-match nền chạy với giá 0 và liên kết sai).
- Zalo: bỏ `MockZaloClient` và token giả; chưa cấu hình Zalo ⇒ không gửi gì, thông báo ghi `failed` với lý do "zalo OA is not configured" (fake client chuyển sang `tests/fakezalo`).
- Affiliate tắt mặc định, không còn template placeholder; chỉ chuyển link khi có affiliate ID thật.
- Frontend: bỏ link/giá mẫu, thẻ minh hoạ có giá cứng, tiến trình tải giả bằng timer, nút "Giả lập giảm giá", nút "Số thử nghiệm Sandbox", platform "Mock Store"; thẻ trang chủ hiển thị sản phẩm thật gần nhất của người dùng hoặc trạng thái trống.
- Phát hiện thêm và đã sửa: **NOMOCK-15** bộ trích xuất HTML tự gán còn hàng/phí ship/người bán (`og:site_name`)/tiêu đề từ URL; **NOMOCK-16** trang chi tiết tự bịa "giá mục tiêu đã lưu" = 95% giá hiện tại và lưu mục tiêu trong `localStorage` (không theo người dùng) — nay chỉ lấy từ alert rule thật trên server, lưu thất bại thì báo lỗi; **NOMOCK-17** cache metadata sản phẩm trong `localStorage` dùng làm dữ liệu hiển thị; **NOMOCK-18** cài đặt chu kỳ quét giả (nay hiển thị giá trị thật, chỉ đọc).
- Migration `000010` xoá dữ liệu giả đã lưu: nguồn sàn `mock`, nguồn có tiêu đề placeholder/anti-bot/trang lỗi, trang kết quả tìm kiếm, người bán bịa, voucher bịa, sản phẩm mồ côi. Ở DB local **toàn bộ** sản phẩm/nguồn/voucher hiện có đều là dữ liệu giả và đã bị xoá.
- Kiểm chứng: unit test (`-race`), integration test (26 test + subtest, không còn gọi mạng tới sàn thật từ test — dùng test double), E2E trình duyệt: 13 kiểm tra no-mock (4 trang không còn dữ liệu giả; dán link Shopee thật bị chặn ⇒ API `502`, người dùng thấy lỗi thật, không có sản phẩm giả được thêm) + 17 kiểm tra phiên của Bước 1 vẫn đạt.

**Hệ quả cần biết**: từ máy hiện tại Shopee trả `403` và Lazada trả trang captcha cho HTTP client thường, nên theo dõi sản phẩm thật sẽ báo lỗi cho tới khi có tầng headless/proxy (GAP-01b/GAP-01c). Đây là trạng thái thật của hệ thống, không còn bị che bởi dữ liệu giả.

**Kết quả Bước 2 (phân quyền & validate input)**:
- **Quy tắc quyền nhóm sản phẩm**: người dùng chỉ đọc/thay đổi một nhóm sản phẩm (so sánh, gợi ý ghép, auto-match, lịch sử giá, voucher, alert, chi tiết nguồn) khi đang theo dõi ít nhất một nguồn trong nhóm đó (`TrackingService.ResolveProductForUser` / `ResolveSourceForUser`, truy vấn `UserTracksProduct`). Không có quyền ⇒ `404` (không lộ sự tồn tại). Mọi endpoint này bắt buộc access token. Vẫn nhận cả product ID, tracked_product ID và product_source ID như trước (frontend không phải đổi).
- **SEC-07**: `link-source` yêu cầu caller theo dõi nhóm đích; nguồn đã thuộc nhóm khác chỉ được chuyển khi không ai khác ngoài caller theo dõi nhóm đó, ngược lại `409` (`ErrSourceInOtherGroup`). Auto-match/accept gợi ý đi qua cùng kiểm tra.
- **SEC-08**: accept/dismiss kiểm tra gợi ý thuộc `product_id` trên path và caller theo dõi sản phẩm đó (`ErrSuggestionNotFound` ⇒ `404`).
- **SEC-09**: tạo voucher chỉ dành cho admin (`ADMIN_EMAILS`, email tài khoản Google; để trống ⇒ không ai tạo được). Validate `voucher_type` enum, tiêu đề 1–200 ký tự, mã ≤ 64, amount/min_order ≥ 0, percent 0–100, phải có mức giảm, `expires_at` **bắt buộc** (tương lai, ≤ 1 năm — thay `expires_in_days`), `collect_url` chỉ `https` và host thuộc đúng sàn của nguồn, từ chối field lạ.
- **SEC-11**: mọi request `/api/v1` giới hạn body 64KB (`LimitBody`).
- **SEC-12**: lỗi 500 trả "internal server error", chi tiết ghi log kèm `request_id`; `link-source` không còn trả lỗi DB dạng 400; số điện thoại/Zalo ID trong log notifier được mask (`09*****678`), log lỗi parse payload không in payload.
- **Rate limit `POST /auth/guest`**: 20 lần / 10 phút / IP, bộ đếm Redis dùng chung giữa các instance (`429` + `Retry-After`); Redis lỗi ⇒ cho qua và ghi cảnh báo.
- Validate thêm: alert `drop_percent` 1–99, `lowest_in_days` 1–365, `expires_in_days` 0–365; Zalo `phone` `^\+?[0-9]{9,15}$`, `zalo_id` `^[0-9A-Za-z_-]{1,64}$`; `GET /notifications?limit` tối đa 100.

**Kiểm chứng Bước 2**: unit test (`-race`), integration test với Postgres/Redis thật — thêm `TestProductGroupAuthorization` (13 endpoint bị chặn với người ngoài, chủ sở hữu vẫn truy cập được, SEC-07 không chiếm được nguồn của người khác nhưng vẫn gộp được nguồn của chính mình, SEC-08 qua 5 tổ hợp path/người dùng, body 70KB ⇒ 400, validate alert/Zalo, guest thứ 4 ⇒ 429) và 13 ca voucher không hợp lệ + guest/member thường bị chặn trong `TestVoucherIntelligenceAndComboFlow`. Đã thử tắt kiểm tra SEC-07/SEC-08 ⇒ test fail đúng chỗ. E2E trình duyệt: session 17/17, member 7/7, no-mock 13/13 vẫn đạt.

**Rà soát lại Bước 1 + 1.5 (2026-10-08)** — đối chiếu code với từng khẳng định ở trên:
- [x] **Migration `000010` xoá cả sản phẩm thật**: `TrackURL` không ghi `product_sources.raw_title` (tên chỉ nằm ở `products.title`), còn `000010` coi mọi nguồn `raw_title IS NULL` là giả ⇒ mọi sản phẩm thêm qua `POST /tracked-products` bị xoá kèm tracking/snapshot/alert. Đã sửa: `TrackURL` ghi `raw_title`; `000010` xét tên theo `raw_title`, nếu trống thì theo `products.title`. Câu "toàn bộ sản phẩm ở DB local đều là giả" ở trên **không đáng tin** — có thể là hệ quả của lỗi này. Kiểm chứng trên Postgres tạm: nguồn thật (có/không `raw_title`) được giữ, nguồn `mock` / tiêu đề placeholder / anti-bot / không tên bị xoá.
- [x] API trả `Title` rỗng cho sản phẩm vừa track (cùng nguyên nhân). Migration `000011` điền lại `raw_title` từ `products.title`.
- [x] **DATA-03 thiếu unique key voucher** (upsert dùng `ON CONFLICT (id)` với id luôn mới ⇒ POST lặp lại tạo bản trùng). Migration `000011` dọn bản trùng (giữ bản cập nhật mới nhất) và tạo unique index `(product_source_id, voucher_type, COALESCE(voucher_code, ''))`; upsert dùng khoá này và trả về id thật của dòng.
- [x] **DATA-11 còn hở ở auto-match thủ công**: `POST /products/{id}/auto-match` và `/tracked-products/{id}/auto-match` chạy với giá 0 ⇒ điểm giá trung tính có thể đạt đúng ngưỡng tự liên kết 0.85. `DiscoverAndMatch` nay trả `ErrNoReferencePrice` (API `409`) khi chưa có giá, và ứng viên không có giá chỉ được gợi ý, không tự liên kết. Có unit test.
- [x] **Email Google đã gắn với `sub` khác trả `500` thay vì `409`** như mô tả. Đã map `ErrAccountConflict` ⇒ `409`, có test HTTP; frontend hiển thị thông báo riêng.
- [x] **Refresh lỗi tạm thời (500) xoá cookie** ⇒ thành viên mất phiên vì DB chập chờn. Nay chỉ xoá cookie khi token không hợp lệ / bị dùng lại; nếu lỗi xảy ra **sau** khi đã xoay vòng thì vẫn gửi cookie mới (giữ cookie cũ sẽ bị coi là dùng lại và thu hồi mọi phiên). Có test HTTP cho 5 trường hợp.
- [x] **Web — phiên thành viên hết hạn vẫn gửi request dưới danh nghĩa guest**: chỉ chặn ở nhánh 401, còn nhánh refresh chủ động trước khi gửi (token sắp hết hạn) thì không. `safeFetch` nay ghi danh tính trước khi gửi và ném `SessionExpiredError` nếu danh tính đổi (cả trước khi gửi lẫn sau 401); chỉ ép refresh khi token chưa được request khác thay; refresh trả về guest (tab khác đã logout) cũng báo "phiên đã hết hạn".
- [x] **Web — vòng lặp render vô hạn ở trang chi tiết** (`useAlerts` với mặc định `= []` tạo mảng mới mỗi render ⇒ effect `setAlerts` chạy mãi khi đang tải hoặc lỗi).
- [x] Đợt sửa tiếp (2026-10-08):
  - `APP_ENV` không đặt ⇒ áp quy tắc production (fail-closed); local dev đặt `development` trong `.env`.
  - `GET /auth/zalo/status`, `POST /auth/zalo/disconnect` chuyển vào nhóm `/auth` ⇒ có CSRF guard (web gửi `application/json`).
  - Chỉ tài khoản `google` là thành viên (`RoleFor`); không cấp token cho tài khoản `migrated`/provider lạ; JWT chỉ nhận `HS256`.
  - Race logout ↔ refresh: rotation và logout cùng lấy khoá theo họ token (`pg_advisory_xact_lock`) trước mọi khoá dòng ⇒ logout không còn bỏ sót token vừa xoay vòng. Integration test 20 vòng song song; tắt khoá thì test fail.
  - 2 lần đăng nhập Google đầu tiên đồng thời ⇒ cùng một tài khoản (trước: lần sau `409`); đổi email trùng email tài khoản khác ⇒ `409` thay vì `500`.
  - Di trú guest chuyển liên kết Zalo theo cặp (`zalo_id` + `phone`), chỉ khi tài khoản đích chưa liên kết (trước có thể ghép Zalo ID của người này với số của người kia).
  - Web: đăng nhập Google và đăng xuất chạy dưới cùng khoá với refresh (refresh guest ở tab khác không ghi đè cookie thành viên); trang Cài đặt báo lỗi khi không tải được hồ sơ Zalo; cấu hình ESLint (`next/core-web-vitals`, `npm run lint` sạch).
- [x] Hoàn tất Bước 1 + 1.5 (2026-10-08):
  - **DATA-01 phân loại lỗi**: crawler không bao giờ đọc trang non-2xx (trang lỗi vẫn có thể có `og:price`) và trả `retry.MarketplaceError` đã phân loại: `blocked` (403), `rate_limited` (429), `timeout`, `server_error` (5xx), `network` — có thể thử lại; `not_found` (404/410), `http_<status>` — không. Trang tải được nhưng không có dữ liệu sản phẩm (anti-bot trả 200) ⇒ `unreadable_page` (có thể thử lại). Adapter bọc nguyên nhân trong `marketplace.Unavailable` (vẫn khớp `ErrProductUnavailable`). Worker: lỗi vĩnh viễn ⇒ `dead` ngay, lỗi tạm thời ⇒ `failed` với mã lỗi cụ thể; `MarkDead` lưu mã + thông báo. Lịch thử lại vẫn là REL-02 (Bước 3).
  - Affiliate: template không chứa `{URL}`/`{RAW_URL}` ⇒ giữ link gốc (trước: mọi sản phẩm bị thay bằng cùng một URL).
  - Guest bị gộp vào tài khoản thành viên không còn nhận được bản ghi mới: trigger migration `000013` (`tracked_products`, `alert_rules`) khoá `FOR SHARE` dòng user ⇒ ghi đồng thời với di trú hoặc chờ rồi bị từ chối (`DH001` ⇒ API `401`), hoặc được di trú chuyển theo.
  - Token đã xoay vòng được giữ tới khi hết hạn (không bị dọn sau 7 ngày) ⇒ dùng lại vẫn bị phát hiện là đánh cắp.
  - Web: phiên đầu tiên của lần tải trang không còn reset cache ⇒ mỗi request chỉ gửi một lần.
- Quyết định thiết kế (giữ nguyên): refresh token xoay vòng nghiêm ngặt, không có thời gian ân hạn — nếu response của `/auth/refresh` bị mất trên mạng và trình duyệt gửi lại cùng cookie, mọi phiên bị thu hồi (người dùng đăng nhập lại). Thêm ân hạn sẽ làm yếu khả năng phát hiện token bị đánh cắp.

**Rà soát lại Bước 2 (2026-10-08)** — các khẳng định ở "Kết quả Bước 2" đúng với code, không còn IDOR theo ID (alert/notification/tracking đều lọc theo user). Đã sửa các lỗ hổng phát hiện thêm:
- [x] **Nhóm so sánh dùng chung** (SEC-07): track cùng URL công khai ⇒ dùng chung source ⇒ "theo dõi" nhóm của người khác, trước đây ghi được nguồn (kể cả sản phẩm giả rẻ) vào nhóm so sánh của họ. **Quyết định**: chỉ người theo dõi duy nhất mới thay đổi nhóm bằng tay (`link-source`, accept, dismiss ⇒ `409` + thông báo nếu nhóm có người khác theo dõi); auto-match do người dùng bấm chỉ tạo gợi ý trên nhóm dùng chung (sửa ở "Rà soát lần 3"). Không bao giờ lấy nguồn ra khỏi nhóm có người khác theo dõi.
- [x] **TOCTOU link-source**: kiểm tra và thay đổi chạy trong một transaction giữ `FOR UPDATE` trên cả hai nhóm (thứ tự cố định); tracking mới khoá nhóm `FOR SHARE` qua trigger (migration `000015`) ⇒ không chen được vào giữa. `AssignProductSource` chỉ chuyển nếu nguồn còn ở nhóm đã kiểm tra.
- [x] **Liên kết Zalo xác minh chủ số bằng OTP qua ZNS** (**quyết định**): `POST /users/me/zalo/otp` gửi mã 6 số (hết hạn 5 phút, chỉ lưu hash, dùng 1 lần, sai 5 lần ⇒ huỷ mã, gửi lại sau 60s; quota xem "Rà soát lần 3"); `POST /users/me/zalo` nhận `{phone, code}`. Không còn nhận `zalo_id` từ người dùng; người chứng minh sở hữu số tiếp quản số đó (không còn `409` để dò số). Migration `000014` xoá mọi liên kết Zalo cũ chưa xác minh. Cần mẫu ZNS OTP (`ZALO_OTP_TEMPLATE_ID`, biến `otp`); chưa cấu hình ⇒ `503`.
- [x] **Chuẩn hoá số điện thoại** (`pkg/phone`): chỉ số di động VN, một dạng duy nhất `84xxxxxxxxx` (ZNS cần dạng này); Zalo client nhận diện số theo chuẩn này (trước: `+84…` bị gửi như Zalo ID).
- [x] **Rate limit endpoint gọi ra sàn**: `POST /tracked-products`, `link-source`, `auto-match` (2 route), accept ⇒ 30 lần / 10 phút / người dùng, `429` + `Retry-After`. Rate limiter chuyển sang **cửa sổ trượt** (Lua trên Redis, trước: cửa sổ cố định cho qua ~2× ở ranh giới), trả đúng thời gian chờ.
- [x] **Auth middleware** (DoD Nhóm 1): mọi route ngoài danh sách công khai đi qua `requireAccessToken` ở router trước handler; test duyệt toàn bộ route (`chi.Walk`) ⇒ route mới tự được kiểm tra.
- [x] **SEC-12**: 500 ở guest/logout/me được log; lỗi DB không còn bị che thành 404 (pause/resume, xoá alert, log alert, resolve nguồn, tạo voucher); đánh dấu đã đọc ID lạ ⇒ `404`.
- [x] **SEC-11**: body khai báo > 64KB ⇒ `413` trước handler (mọi `/api/v1`, kể cả webhook); body không khai báo độ dài vẫn bị cắt ở 64KB.
- [x] **Test tái hiện còn thiếu**: SEC-07 nhóm dùng chung (link/accept/dismiss ⇒ 409, gợi ý giữ pending, auto-link hệ thống vẫn chạy), SEC-09 (`ADMIN_EMAILS` rỗng, thành viên không có trong danh sách, guest; bảng validate voucher gồm title > 200, code > 64 ký tự), SEC-11 (413 API + webhook, body chunked), SEC-12 (body 500 chung chung, chi tiết chỉ ở log), OTP (mã chưa gửi, gửi lại quá sớm, dùng lại mã, đoán mã 5 lần, số giữ nguyên khi chiếm thất bại), rate limit (cửa sổ trượt, 429 + Retry-After).
- [ ] Còn lại: `/prices` không giới hạn khoảng thời gian ⇒ PERF-02 (Bước 8). OTP thật cần mẫu ZNS được Zalo duyệt (kiểm chứng sau). (`X-Forwarded-For` đã xử lý ở "Đợt sửa phần còn lại".)

**Rà soát lần 3 (2026-10-08)** — 3 agent rà độc lập Bước 1 + 1.5 + 2 trên code đã commit; các lỗi đã sửa:
- [x] **OTP đoán quá 5 lần khi gửi đồng thời** (tái hiện: 353/400 lần đoán được so sánh): kiểm tra + đếm + so sánh + xoá là một script Lua; lần đoán sau khi mã bị huỷ không tạo lại key. Lưu mã và TTL trong một transaction. Quota (cooldown, theo thành viên, theo thành viên+số, theo số) kiểm tra rồi mới trừ trong một script; ZNS gửi lỗi ⇒ hoàn quota. Theo số: 3 mã/giờ cho mỗi (thành viên, số), 10 mã/giờ cho mỗi số ⇒ một tài khoản không đốt hết quota của chủ số. Liên kết cùng số đồng thời được khoá theo số (không còn 500). Test đồng thời: 200 lần đoán song song ⇒ đúng 1 "quá số lần", mã thật bị từ chối; 20 yêu cầu song song ⇒ 1 mã.
- [x] **Auto-match do người dùng bấm tự ghép vào nhóm dùng chung** (kẻ xấu đưa listing giả "Official" vào so sánh của người khác): nay chỉ tự ghép khi không ai khác theo dõi nhóm (kiểm tra lại dưới khoá); nhóm dùng chung chỉ nhận gợi ý. Tự ghép nhóm dùng chung dành cho matching của hệ thống (Bước 6).
- [x] **Deadlock refresh guest ↔ di trú guest** (tái hiện `40P01`): khoá phiên theo user (advisory) — rotation/logout lấy dạng shared trước mọi khoá dòng, di trú và "thu hồi mọi phiên khi token bị dùng lại" lấy dạng exclusive ⇒ không deadlock, và thu hồi thấy cả token vừa xoay vòng ở họ khác. Test 20 vòng song song; bỏ khoá ⇒ fail 3/3.
- [x] **Trigger 000015 khoá nhầm nhóm cũ**: `000016` khoá dòng nguồn trước (chờ lần chuyển nhóm đang chạy, đọc nhóm hiện tại) rồi mới khoá nhóm; `WithGroupLock` dùng `FOR NO KEY UPDATE`. Test bằng transaction thủ công (bản `FOR SHARE OF ps, p` dạng JOIN vẫn sai — EvalPlanQual không tìm lại nhóm mới).
- [x] CORS gửi `Access-Control-Expose-Headers: Retry-After` (web khác origin đọc được thời gian chờ).
- [x] Crawler: lỗi chờ rate limiter và lỗi đọc body là lỗi tạm thời (trước bị đánh `dead`).
- [x] SEC-12 còn sót: lỗi DB khi kiểm tra guest ⇒ 500 (không phải 401); auto-match lỗi comparison ⇒ 500; tạo voucher / gắn nguồn không nuốt lỗi; tìm kiếm Shopee bị chặn ⇒ auto-match `502` thay vì "không tìm thấy".
- [x] Lỗi sau khi đã xoay vòng token (kể cả lúc ký JWT) vẫn gửi cookie mới (`RotatedError`).
- [x] Best deal không trộn giá có ship với giá chưa rõ ship: có nguồn chưa rõ ship ⇒ mọi nguồn so trên giá hàng, `shipping_included: false`. Voucher: phí ship chưa rõ ⇒ không có `best_freeship_voucher`.
- [x] Migration `000017` dọn dữ liệu bịa còn sót trên DB chưa reset: người bán = tên sàn (`og:site_name`) ⇒ NULL; mọi phí ship đã lưu ⇒ NULL (chưa có đường nào đo được phí ship), giá hiệu dụng = giá hàng.
- [x] Nhỏ: `ParseVNDPrice("6290000.000")`; guard DB test chặn `?dbname=`; comparison lưu người bán rỗng là NULL.
- [x] Web: đăng nhập sau khi phiên đầu thất bại vẫn cập nhật UI; thành viên hết phiên mà tạo guest lỗi vẫn hiện banner; khoá localStorage chỉ gia hạn/nhả khi còn là chủ; đăng xuất/đổi tài khoản lan sang tab khác (BroadcastChannel, fallback storage event); OTP bị huỷ (429) ⇒ quay về bước xin mã mới; thống kê "90 ngày" tính đúng 90 ngày, bộ lọc 7/30 ngày không còn hiện toàn bộ lịch sử, đạt mục tiêu ⇒ 100%; bỏ hiển thị `zalo_id`.
- [x] Extension: URL API/web production do web gửi sang (kiểm tra host: localhost hoặc dealhunter.vn), mặc định localhost cho dev; "rẻ hơn X%" tính so với giá Shopee đang xem.
- [x] Tài liệu API: payload thật của comparison, gợi ý ghép, voucher.
- Ghi chú: phí ship hiện **luôn** NULL (chưa có đường nào đọc được phí ship); tin Zalo và web cùng tính giá chưa gồm ship nên khớp nhau. Logout không cần "storm" refresh: tab nhận broadcast chỉ refresh một lần dưới khoá.

**Đợt sửa phần còn lại (2026-10-09)**:
- [x] **IP client & rate limit bị nhân lên** (kéo sớm một phần OPS-03): bỏ `middleware.RealIP` (tin `X-Forwarded-For` của bất kỳ ai); `TrustedRealIP` chỉ tin header từ `TRUSTED_PROXIES` và lấy hop ngoài cùng bên phải không thuộc proxy tin cậy (client không chèn được IP). Compose production: API chỉ bind `127.0.0.1:8080` (nginx trên host là đường vào duy nhất), `TRUSTED_PROXIES` mặc định `127.0.0.1/32,::1/128,172.16.0.0/12`. Thêm giới hạn **theo IP** cho các thao tác gọi ra sàn (120 / 10 phút) ngoài giới hạn theo người dùng ⇒ tạo nhiều guest không nhân được hạn mức.
- [x] Gắn nguồn: tracking của người gọi được tạo **trong cùng transaction** với việc gắn (cả hai cùng thành công hoặc cùng không); `CreateTracking` không còn tự tạo dòng user "ma".
- [x] Script E2E (`session`, `nomock`, `member`) chạy `preflight.mjs` trước: tạo một guest qua API và kiểm tra nó nằm trong `E2E_DB`; API chạy trên DB khác ⇒ dừng ngay.
- [x] Trang chi tiết: mũi tên/màu biến động giá theo đúng chiều tăng/giảm.
- Không sửa được: giá trị tồn kho bịa từ trước Bước 1.5 trong DB cũ (không phân biệt được với dữ liệu thật) — DB dev đã reset.
- Còn lại cho Bước 7 (OPS-03): `/metrics` tách cổng nội bộ; cổng web `3000` cũng nên bind `127.0.0.1`.

**Rà soát lần 5 (2026-10-09)** — 2 agent rà độc lập code sửa ở đợt 3 và "Đợt sửa phần còn lại". Mỗi lỗi dưới đây có test viết **trước** khi sửa, xác nhận fail trên code cũ rồi pass sau khi sửa:
- [x] **Deadlock gắn nguồn ↔ theo dõi cùng nguồn** (do 000016 gây ra: trigger khoá nguồn rồi nhóm, gắn nguồn khoá nhóm rồi nguồn — tái hiện `40P01`): `WithGroupLock(sourceIDs, productIDs)` khoá dòng nguồn **trước** rồi mới khoá nhóm, cùng thứ tự với trigger. Test `TestLinkSourceVsNewTrackingNoDeadlock` (fail ngay vòng đầu với thứ tự cũ).
- [x] **Lách quota OTP bằng cách ngắt kết nối** (tin vẫn tới nạn nhân nhưng quota được hoàn — tái hiện 20/20): gửi ZNS bằng context tách khỏi request (`WithoutCancel` + timeout 20s); chỉ hoàn quota khi chắc chắn **không gửi** (`zalo.ErrNotSent`: thiếu token, lỗi tạo request, HTTP 4xx, mã lỗi nghiệp vụ Zalo); timeout, 5xx, thiếu `msg_id` ⇒ coi như có thể đã gửi, giữ mã và quota. Test phân loại lỗi của Zalo client (server giả) và 3 test OTP mới.
- [x] **Shopee trả 200 kèm JSON lỗi bị coi là "không có ứng viên"**: `error ≠ 0`, thiếu/`null` `items`, HTTP khác 200 ⇒ `ErrSearchUnavailable` (502); `items: []` mới là "không có". Test 6 dạng phản hồi.
- [x] **Gợi ý đã bỏ/đã nhận bị đặt lại `pending`**: `SaveSuggestion` không bao giờ đổi trạng thái đã quyết định (`dismissed`/`accepted`/`auto_linked`); `DiscoverAndMatch` không còn nuốt lỗi: lỗi đọc nhóm ⇒ lỗi; lỗi tra cứu gợi ý ⇒ bỏ qua ứng viên (không lưu, không ghép); không làm được gì vì lỗi ⇒ lỗi; làm được một phần ⇒ `incomplete: true`.
- [x] **Proxy tin cậy**: compose production cố định subnet (`DEALHUNTER_SUBNET`, mặc định `172.30.240.0/24`) và chỉ tin gateway (`DEALHUNTER_GATEWAY`, `172.30.240.1`), không tin cả dải Docker (container khác giả được IP; subnet không cố định có thể gom mọi client về một IP).
- [x] IPv6: khoá rate limit theo /64 (guest và thao tác gọi ra sàn); hop `X-Forwarded-For` có cổng (`1.2.3.4:5678`, `[v6]:443`) hoặc rỗng ở cuối được đọc đúng; giới hạn theo IP kiểm tra trước giới hạn theo người dùng (bị chặn theo IP không trừ hạn mức người dùng).
- [x] `GetUserProfile` không còn tự tạo dòng user (chỉ tạo guest / đăng nhập Google mới tạo user); user không tồn tại ⇒ 401.
- [x] Giá dạng `6.290.000 ₫` có dấu cách không ngắt (định dạng vi-VN) parse đúng.
- [x] Web/extension: xem báo cáo cùng đợt (thống kê 90 ngày và "Tất cả" lấy đúng khoảng; mũi tên ở trang danh sách; banner hết phiên khi đăng xuất chủ động; chặn gửi mã theo từng số; extension so giá cùng cơ sở và lưu token cùng URL API nguyên tử; preflight E2E kiểm cả Redis).
- Ghi chú: script Lua của OTP và rate limiter dùng nhiều key ⇒ sẽ lỗi `CROSSSLOT` nếu chuyển sang Redis Cluster (hiện dùng Redis 1 node). `GetUserMultiSourceProducts` dùng giá có ship nếu biết — lệch với best deal khi có nguồn chưa rõ ship (hiện phí ship luôn chưa rõ).

**Chỉ dùng dữ liệu thật (2026-10-08)** — dự án đang phát triển, toàn bộ dữ liệu local là dữ liệu test/mock:
- [x] **Nguyên nhân dữ liệu mock quay lại**: integration test ghi thẳng vào DB dev (`DATABASE_URL`, mặc định `dealdb`) và Redis DB 0 — sau migration `000010` DB dev vẫn có 645 user test (`*@dealhunter.vn`) và 132 sản phẩm, phần lớn `mock.dealhunter.vn`. Nay test dùng `TEST_DATABASE_URL` / `TEST_REDIS_URL` (mặc định `dealdb_test`, Redis DB 15) và **từ chối chạy** nếu tên DB không kết thúc bằng `_test` hoặc Redis là DB 0. `make test-integration` tự tạo + migrate `dealdb_test`.
- [ ] **Xoá dữ liệu dev**: `make db-reset` (drop mọi bảng, migrate lại, `FLUSHDB` Redis DB 0) — cần chạy thủ công.
- [x] Giá trị không rõ là `NULL`, không phải `0`/`false`/giá trị cũ (migration `000012`):
  - Phí ship: adapter không còn chép phí ship lần trước vào snapshot mới; không đo được ⇒ `NULL`, giá hiệu dụng = giá hàng (`pricing.EffectivePriceOf`). `price_snapshots.shipping_fee`, `comparison_snapshots.shipping_fee` cho phép `NULL`.
  - Comparison: `listed_price`, `shipping_fee`, `effective_price`, `in_stock` trả `null` khi không rõ (trước ép `0`/`FALSE`); tồn kho không rõ vẫn được xét deal tốt nhất, chỉ "hết hàng" rõ ràng mới bị loại; giá không rõ không được xét.
  - `marketplace.ProductData` bỏ `InStock bool` (ép không rõ thành hết hàng).
  - Người bán rỗng lưu `NULL`.
  - GET voucher: `calculation: null` khi chưa có giá (trước trả "giá về tay 0đ"); thêm `shipping_fee_known`.
- [x] Alert không bắn khi trang báo rõ hết hàng (`shouldEvaluateAlerts`, có test).
- [x] `ParseVNDPrice` đọc đúng `6.290.000,00` / `6,290,000.00` (trước ra gấp 100 lần); xoá `ExtractSlugTitle` (code chết sinh tiêu đề từ URL).
- [x] Zalo trả 200 nhưng không có `msg_id` ⇒ ghi `failed` (không xác nhận được), không còn đánh dấu `sent`.
- [x] `POST /tracked-products` trả `polling_interval_seconds` (web hiển thị chu kỳ quét thật thay vì chữ cứng "30 phút").
- [x] Web: bỏ giá mục tiêu điền sẵn 95%/90%, sàn giả 10% của thanh tiến độ, "khoảng cách 0 ₫" khi chưa có mục tiêu, thống kê 90 ngày bịa từ giá hiện tại; chỉ một rule `target_price` hoạt động (rule cũ bị xoá khi lưu mục tiêu mới); lỗi API hiện là lỗi (trang chủ, thông báo, cài đặt, voucher, gợi ý ghép, auto-match) thay vì trạng thái trống; "đánh dấu tất cả đã đọc" báo lỗi khi có request thất bại; logout thành công không báo lỗi khi tạo guest thất bại; khoá chéo tab qua `localStorage` khi không có Web Locks; giá/ship/tồn kho `null` hiển thị "Chưa có dữ liệu" / "Chưa rõ".

**Chuyển sang bước sau (từ Bước 1)**: `GET /products/{id}/comparison` và `/match-suggestions` chưa yêu cầu token (→ Bước 2, SEC-07/08); `POST /tracked-products/{id}/vouchers` vẫn cho mọi người dùng tạo voucher (→ Bước 2, SEC-09); chưa có rate limit cho `POST /auth/guest` (→ Bước 2); chưa kiểm thử với Google Client ID thật trên trình duyệt.

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
| **1. SEC** | Bảo mật, xác thực, phân quyền | 12 | [CRITICAL] Bắt buộc trước deploy |
| **2. REL** | Độ tin cậy job queue, worker, scheduler, notifier | 12 | [CRITICAL] Bắt buộc trước deploy |
| **3. DATA** | Tính đúng đắn dữ liệu, giá, voucher, affiliate, matching | 13 | [HIGH] Trước Phase 4 |
| **4. OPS** | Docker, cấu hình production, tài liệu vận hành | 9 | [HIGH] Trước deploy |
| **5. PERF** | Tối ưu truy vấn, index, retention | 8 | [LOW] Có thể làm song song |
| **6. DOC** | Đồng bộ tài liệu API và plan | 5 | [LOW] Cuối đợt |
| **7. DOD-GAP** | Tính năng spec yêu cầu nhưng chưa làm | 10 | [MEDIUM] Quyết định làm / dời |

---

## 2. Nhóm 1 — Bảo Mật & Phân Quyền (SEC) [CRITICAL]

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
- [x] Mỗi SEC-xx có test (unit hoặc integration) tái hiện kịch bản tấn công và khẳng định bị từ chối.
- [x] Không còn đường dẫn code nào đọc `X-User-ID` hoặc trả về user `...0001`.
- [x] `APP_ENV=production` với secret yếu → process thoát với lỗi rõ ràng.
- [x] Mọi route ghi dữ liệu đều đi qua auth middleware và kiểm tra ownership.

---

## 3. Nhóm 2 — Độ Tin Cậy Job Queue, Worker, Notifier (REL) [CRITICAL]

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

## 4. Nhóm 3 — Tính Đúng Đắn Dữ Liệu (DATA) [HIGH]

| ID | Vấn đề | Vị trí | Giải pháp |
|---|---|---|---|
| **DATA-01** [DONE — lịch thử lại thuộc REL-02] | Scraper bị chặn → 3 adapter trả **giá lần trước** như lần đo mới với `InStock=true`, `CapturedAt=now` | `marketplace/shopee/adapter.go:234-250`, `lazada/adapter.go:135-151`, `tiktok/adapter.go:134-150` | Bỏ fallback; trả `MarketplaceError` retryable (403/429/timeout) để REL-02 xử lý; metrics ghi nhận thất bại |
| **DATA-02** [DONE] | `ResolveProduct` khi bị chặn vẫn thành công với tiêu đề placeholder ("San pham Shopee") và giá 0 | `shopee/adapter.go:151-167` | Trả lỗi rõ ràng cho người dùng ("không lấy được thông tin, thử lại sau") hoặc tạo tracking ở trạng thái `pending_resolve` |
| **DATA-03** [DONE] | Voucher bịa: GET tự sinh voucher giả (`SHOP15K`, `PLAT24K`) và lưu DB; lỗi lưu bị bỏ qua; GET đồng thời sinh trùng | `internal/http/voucher_handler.go:80-81,125-211`; `internal/voucher/repository_pg.go:36` | Xoá hoàn toàn logic sinh voucher giả; GET chỉ đọc; unique key voucher theo `(product_source_id, voucher_type, voucher_code)`; migration dọn voucher giả đã lưu |
| **DATA-04** [DONE] | Affiliate bật mặc định với template placeholder `s.lazada.vn/s.xxxx`, `vt.tiktok.com/xxxx`; `Transform` không kiểm tra ID rỗng | `pkg/config/config.go:116-122`; `pkg/affiliate/affiliate.go:81-94` | Mặc định `AFFILIATE_ENABLED=false`, template rỗng; thiếu ID hoặc template → giữ link gốc (fail-safe theo spec) |
| **DATA-05** | Ghép URL affiliate không encode `{RAW_URL}`/`{AFFILIATE_ID}`; `detectPlatform` so khớp substring; AccessTrade bọc mọi URL | `pkg/affiliate/affiliate.go:77-123` | `url.QueryEscape`; nhận diện nền tảng theo host (`url.Parse` + so hậu tố domain); chỉ bọc URL thuộc whitelist sàn |
| **DATA-06** | SubID không đúng spec (cắt 8 ký tự UUID); notifier dùng `ProductSourceID`, API dùng `ProductID`; khách ẩn danh đều là `u_00000000` | `pkg/affiliate/affiliate.go:98-110`; `notifier.go:65`; `voucher_handler.go:65` | Thống nhất `u_{user_id}_p_{product_id}` đầy đủ (hoặc bảng mapping short-id) và cùng 1 nguồn ID ở mọi nơi |
| **DATA-07** | Công thức giá thứ 2 không có `max(0, …)`, dùng `SalePrice` thay `ListedPrice`; adapter tự tính `price + shipping` inline; `pricing.Price.EffectivePrice()` không dùng | `internal/pricing/model.go:17-22` | Một hàm `EffectivePrice` duy nhất, có floor 0, dùng ở adapter, voucher engine và API |
| **DATA-08** | Cột `price_snapshots.shop_discount` / `platform_coupon` (migration 000007) không bao giờ được ghi/đọc | `migrations/000007_vouchers.up.sql:24-26` | Ghi giá trị khi tính snapshot, hoặc xoá cột nếu không dùng; đồng bộ tài liệu API |
| **DATA-09** | Mô hình voucher mơ hồ: `DiscountAmount` vừa là số tiền cố định vừa là trần; voucher freeship % tính trên giá hàng; min order so với giá niêm yết thay vì subtotal sau giảm shop; ví dụ spec §4.2 sai | `internal/voucher/model.go:71-86` | Tách `discount_amount` và `max_discount`; freeship tính trên phí ship; min order so với subtotal sau shop voucher; sửa ví dụ spec |
| **DATA-10** | Matching dương tính giả: regex coi `128gb` là mã model; `strings.Contains` khiến `a5` khớp `a54`; overlap bất kỳ nâng điểm text ≥ 0.9 | `internal/matching/normalizer.go:30`; `internal/matching/scoring.go:31-46` | Loại token dung lượng khỏi model code; so khớp nguyên token; model code khác nhau → loại hẳn |
| **DATA-11** (một phần) | Auto-match lúc mới track: giá = 0 → điểm giá trung tính 0.5 → có thể auto-link sai giá 10 lần; thiếu lọc cứng ±35% | `internal/http/handler.go:166-174`; `scoring.go:106-107` | Chỉ auto-match sau khi có giá đầu tiên; áp lọc cứng ±35% theo spec GAP-03 |
| **DATA-12** [DONE] | Searcher production trả catalog seed (TikTok luôn seed; Lazada/Shopee fallback seed khi bị chặn); Lazada dùng URL trang tìm kiếm làm URL sản phẩm | `internal/matching/searcher.go:93-140` | Seed chỉ dùng khi `APP_ENV != production`; bị chặn → trả rỗng; chỉ chấp nhận URL trang sản phẩm |
| **DATA-13** | Payload ZNS không khớp template: giá thô thay vì `27.990.000đ`; thiếu `product_name`, `tracking_id`; gửi `user_id` thay vì phone; phone định dạng `0xxx`; `COALESCE(zalo_id, phone)` ưu tiên Zalo ID | `notifier.go:59-73`; `zalo/client.go:38-75`; `notification/repository_pg.go:344` | Map đúng các biến template spec Phase 2 §5.2-5.3; chuẩn hoá phone `84xxxxxxxxx`; ZNS luôn dùng phone |

**Các lỗi nhỏ thuộc nhóm DATA (gom chung)**:
- `lowest_in_days` kích hoạt lại khi bằng giá (dùng `>` thay vì `>=`) — `internal/alert/engine_impl.go:115`.
- Lỗi đánh giá rule bị nuốt không log — `engine_impl.go:40-44`.
- Webhook Zalo: sự kiện đọc tin của Zalo là `user_seen_message` với mảng `message.msg_ids`, code đang khớp `user_read_message` — `zalo_webhook.go:100`.
- Webhook bỏ qua lỗi `UpdateDeliveryStatus` và vẫn trả 200 — `zalo_webhook.go:114`.
- Cập nhật `read` không guard trạng thái, có thể ghi đè `failed` — `notification/repository_pg.go:151-157`.
- `msg_id` rỗng/không parse được → log `sent` không có msg_id — `zalo/client.go:108-117`.
- [DONE] Thuật toán ký webhook sai so với Zalo (Zalo dùng `sha256(appId + body + timestamp + OASecretKey)`, không phải HMAC body) — `zalo_webhook.go:163-171`. Đã sửa cùng SEC-10 (Bước 1).
- [DONE] `MockZaloClient` được dùng âm thầm khi `ZALO_ENABLED=true` mà thiếu token, đánh dấu `sent` — `cmd/notifier/main.go:73-81`. Đã sửa ở NOMOCK-02.
- [DONE] TokenManager ghi `mock_zalo_access_token_active` đè lên token tĩnh hợp lệ trong Redis; `SendMessage` ưu tiên token này → mọi tin gửi thất bại — `token_manager.go:87-93`, `client.go:47-51`. Đã sửa ở NOMOCK-03.
- Huỷ liên kết source không invalidate cache `dh:cmp:` của sản phẩm cũ; sản phẩm cũ còn < 2 nguồn giữ `comparison_snapshots` (có thể `is_best_deal=TRUE`) mãi — `handler.go:913`, `matching/service.go:113,194`, `comparison/repository_pg.go:203-209`.
- Ghi nhiều bước không có transaction: reset `is_best_deal` + upsert (lỗi reset bị bỏ qua) — `comparison/repository_pg.go:117-138`; `TrackURL` tạo product/source/tracking riêng lẻ → product mồ côi khi 2 user thêm cùng URL — `tracking/service.go:54-89,198-240`; link + `SaveSuggestion` — `matching/service.go:108-126`.
- Worker không cập nhật `tracked_products.next_fetch_at` trong transaction thành công (spec Phase 1 §14) — `worker.go:189-226`.

**DoD Nhóm 3**:
- [ ] Không còn dữ liệu giả (giá cũ, voucher, catalog seed) trên đường production; test khẳng định.
- [ ] Unit test bảng cho `EffectivePrice` và voucher engine với các ca: %, cố định, trần, freeship, min order, giá âm.
- [ ] Unit test matching cho các cặp dương tính giả đã biết (`iPhone 14` vs `iPhone 15`, `A5` vs `A54`).
- [ ] Test affiliate: URL chứa `&`/`#`, host giả mạo, thiếu ID → giữ link gốc.

---

## 5. Nhóm 4 — Cấu Hình Production & Vận Hành (OPS) [HIGH]

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

## 6. Nhóm 5 — Tối Ưu Hiệu Năng & Dữ Liệu (PERF) [LOW]

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

## 7. Nhóm 6 — Đồng Bộ Tài Liệu (DOC) [LOW]

| ID | Vấn đề | Giải pháp |
|---|---|---|
| **DOC-01** | `docs/api/rest-api-reference.md` lệch code: response `GET /vouchers` là object chứ không phải mảng; `GET /prices` trả `{product_source_id, snapshots}` và struct snapshot không có JSON tag (field ra dạng `ID`, `Price`); `DELETE /alerts/{id}` trả 200 chứ không phải 204; `/auth/me` và `/users/me` là 2 handler khác nhau; tài liệu liệt kê 409/422 nhưng không handler nào trả | Thêm JSON tag snake_case cho `pricing.PriceSnapshot`; cập nhật tài liệu theo code sau khi sửa |
| **DOC-02** | Khoảng 9 route chưa có tài liệu: `GET /alert-rules`, `GET /alerts/{id}/logs`, `POST/DELETE /users/me/zalo`, `GET /auth/zalo/status`, `POST /auth/zalo/disconnect`, `POST /user/zalo/connect`, `GET /user/zalo/status`, `DELETE /user/zalo` | Bổ sung tài liệu hoặc gộp/xoá các route Zalo trùng lặp (`/user/zalo` vs `/users/me/zalo` vs `/auth/zalo`) |
| **DOC-03** | Mục header xác thực vẫn mô tả `X-User-ID` cho guest | Cập nhật theo cơ chế guest token (SEC-05) |
| **DOC-04** | Trạng thái "Đã hoàn thành" / "100%" trong `gap-resolution-and-foundation-completion.md`, `phase-3-5-monetization-and-voucher-engine.md`, `README.md` chưa chính xác | Cập nhật sau khi hoàn thành kế hoạch này, liên kết về tài liệu này |
| **DOC-05** | Thiếu runbook cho reclaim/retry, xoay vòng token Zalo, khôi phục khi OA bị khoá | Bổ sung vào `docs/runbooks/` sau khi làm REL |

---

## 8. Nhóm 7 — Tính Năng Spec Yêu Cầu Nhưng Chưa Triển Khai (DOD-GAP) [MEDIUM]

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

## 8b. Nhóm NOMOCK — Loại Bỏ Toàn Bộ Dữ Liệu Mock [CRITICAL]

Theo yêu cầu "dữ liệu thật, việc thật". Phần auth (demo login, token `mock-google-*`, nút demo) **đã xoá ở Bước 1**. Còn lại:

| ID | Mock còn lại | Vị trí | Thay bằng |
|---|---|---|---|
| **NOMOCK-01** | Adapter sàn giả `mock` được đăng ký trong binary; registry chuyển mọi host chứa "mock" tới adapter giả (giá sinh ra) | `cmd/api/main.go:75`, `cmd/worker/main.go:62`, `internal/marketplace/registry.go:35`, `internal/marketplace/mock/` | Bỏ đăng ký khỏi `cmd/*`; adapter giả chỉ dùng trong test; dọn `products`/`product_sources` có URL `mock.dealhunter.vn` |
| **NOMOCK-02** | Notifier dùng `MockZaloClient` khi thiếu token (đánh dấu `sent` dù không gửi) | `cmd/notifier/main.go:79-80`, `internal/notification/zalo/mock_client.go` | Thiếu cấu hình Zalo ⇒ không gửi, ghi trạng thái `failed`/`skipped` rõ ràng, log cảnh báo |
| **NOMOCK-03** | TokenManager ghi token giả `mock_zalo_access_token_active` vào Redis | `internal/notification/zalo/token_manager.go:86-93` | Trả lỗi cấu hình; không ghi đè token thật |
| **NOMOCK-04** | Voucher bịa (`SHOP15K`, `PLAT24K`, freeship) sinh và lưu khi GET | `internal/http/voucher_handler.go:80-81,125-211` | = DATA-03: xoá; GET chỉ đọc; migration dọn voucher giả đã lưu |
| **NOMOCK-05** | Scraper trả giá lần trước như lần đo mới khi bị chặn; `ResolveProduct` trả tiêu đề placeholder, giá 0 | `internal/marketplace/{shopee,lazada,tiktok}/adapter.go` | = DATA-01/02: trả lỗi thật |
| **NOMOCK-06** | Catalog seed trong tìm kiếm auto-match (TikTok luôn seed) | `internal/matching/searcher.go:92-140` | = DATA-12: bị chặn ⇒ không có ứng viên |
| **NOMOCK-07** | Template affiliate placeholder `s.lazada.vn/s.xxxx`, `vt.tiktok.com/xxxx` | `pkg/config/config.go:140-142` | = DATA-04: mặc định rỗng, giữ link gốc |
| **NOMOCK-08** | Trang chủ: link mẫu `mock.dealhunter.vn` với giá/giảm giá cứng; thẻ minh hoạ Sony với giá cứng; tham số `?sample=`; tiến trình tải giả bằng timer | `dealhunter-web/app/page.tsx:46,64-65,85-113,257-297,495-516,591` | Xoá link/giá mẫu; minh hoạ không chứa số liệu giả; tiến trình theo trạng thái thật |
| **NOMOCK-09** | EmptyState: 3 sản phẩm mẫu `mock.dealhunter.vn` | `dealhunter-web/components/ui/EmptyState.tsx:29-45,70-77` | Hướng dẫn dán link thật |
| **NOMOCK-10** | Nút "Giả lập giảm giá 12%" chèn thông báo giả vào cache | `dealhunter-web/app/notifications/page.tsx:187-211` | Xoá |
| **NOMOCK-11** | Nút "Dùng số thử nghiệm (Sandbox)" điền số `0988123456` | `dealhunter-web/components/settings/ZaloConnectModal.tsx:70-73,176-186` | Xoá |
| **NOMOCK-12** | Platform `"mock"` / badge "Mock Store"; biến `NEXT_PUBLIC_ENABLE_MOCK_SANDBOX` | `dealhunter-web/lib/formatting.ts:163,213-220`, `.env.example` | Xoá |
| **NOMOCK-13** | Cài đặt chu kỳ quét chỉ lưu localStorage, báo "đã lưu" nhưng backend không dùng | `dealhunter-web/app/settings/page.tsx:43-57` | Lưu thật qua API hoặc xoá tuỳ chọn |
| **NOMOCK-14** | Chuỗi i18n cho tính năng mẫu/giả lập | `dealhunter-web/lib/i18n/dictionaries/{vi,en}.ts` | Xoá cùng các mục trên |
| **NOMOCK-15** | Bộ trích xuất HTML tự gán còn hàng, phí ship 15.000đ, người bán = `og:site_name`, tiêu đề từ URL | `internal/marketplace/crawler/extractor.go` | Chỉ giá trị có trên trang; tồn kho không rõ = `NULL` |
| **NOMOCK-16** | "Giá mục tiêu đã lưu" tự bịa (95% giá hiện tại); mục tiêu lưu `localStorage`; lưu thất bại vẫn báo đã lưu | `dealhunter-web/app/tracking/[id]/page.tsx`, `lib/hooks.ts` | Chỉ từ alert rule `target_price` trên server; báo lỗi khi lưu thất bại |
| **NOMOCK-17** | Cache metadata sản phẩm trong `localStorage` dùng làm dữ liệu hiển thị | `dealhunter-web/lib/api.ts` | Xoá; chỉ dùng dữ liệu server |
| **NOMOCK-18** | Dữ liệu giả đã lưu trong DB (nguồn `mock`, tiêu đề anti-bot, voucher bịa, người bán bịa) | DB | Migration `000010` |

**Trạng thái**: [DONE] toàn bộ NOMOCK-01 → NOMOCK-18 đã hoàn thành (2026-10-07).

**DoD NOMOCK**: `grep -riE "mock|sandbox|seed|simulat|sample|fake"` trên code sản phẩm (ngoài `*_test.go`, `tests/`) không còn kết quả mang nghĩa dữ liệu giả; binary không đăng ký adapter giả; khi sàn/Zalo không khả dụng, UI và API báo lỗi thật.

---

## 9. Thứ Tự Thực Hiện Đề Xuất

| Bước | Nội dung | Hạng mục |
|---|---|---|
| **1** | Bảo mật xác thực [DONE] | SEC-01 → SEC-06, SEC-10, OPS-01, OPS-02, OPS-07, GAP-02a/c |
| **1.5** | Loại bỏ toàn bộ mock [DONE] | NOMOCK-01 → NOMOCK-18 (gồm DATA-01/02/03/04/12, một phần DATA-11) |
| **2** | Phân quyền & validate input | SEC-07 → SEC-09, SEC-11, SEC-12 |
| **3** | Độ tin cậy queue & worker | REL-01 → REL-07, REL-10 |
| **4** | Notifier & Zalo | REL-08, REL-09, REL-11, REL-12, DATA-13, các lỗi webhook Zalo |
| **5** | Dữ liệu thật | DATA-05 → DATA-09 (+ phần retryable của DATA-01, mục còn mở của đợt rà soát lại) |
| **6** | Matching | DATA-10, phần còn lại DATA-11, GAP-03a/b |
| **7** | Production packaging | OPS-03 → OPS-06, OPS-08, OPS-09, chạy `make prod-up` toàn stack |
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
