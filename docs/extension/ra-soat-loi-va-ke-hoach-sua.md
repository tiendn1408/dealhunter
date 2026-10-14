# DealHunter Assistant (Extension) — Rà Soát Lỗi & Kế Hoạch Sửa

> **Ngày rà soát**: 2026-10-09 · **Phạm vi**: toàn bộ `extension/` (lõi săn, background/popup, UI/i18n) và tài liệu extension.
> **Cách rà**: 3 agent độc lập, chỉ đọc; nhiều lỗi đã được **tái hiện bằng test riêng** (đánh dấu [R]). Build, `tsc`, `vitest` (120/120) đều pass — các lỗi dưới đây là lỗi logic/race mà test hiện có không phủ.
> **Trạng thái (cập nhật 2026-10-13)**: các lỗi C/H/M/L/P/E đã được sửa, nhưng một số dòng "Đã sửa" bên dưới ghi lại cách sửa **của thời điểm 2026-10-09** và nay đã được thay bằng cách khác (xem **mục 10**). Số test hiện tại: 33 file, 317 test pass; `tsc` sạch; `npm run build` (bản phát hành) và `npm run build:dev` đều build được. Các con số "165/165", "206/206" trong bài là số cũ.

---

## 0. Quyết định sản phẩm đã chốt (2026-10-09)

| Vấn đề | Quyết định |
|---|---|
| Arm khi chưa chọn nút (chế độ "unlocked") | **Bắt buộc chọn nút.** Khoá nút Arm và task hẹn giờ tới khi có target; không bao giờ tự bấm nút người dùng chưa chỉ định. Auto-detect chỉ *gợi ý* nút để người dùng xác nhận. |
| Đo đồng hồ server (HEAD `favicon.ico`) | **Chỉ đo khi cần**: chỉ đo trang đang có hunt/task, hoặc khi người dùng bấm đo trong popup. Giãn nhịp probe (vài chục request thay vì ~190, có nghỉ giữa các lần), không chạy song song nhiều vòng, không fallback sang Shopee, dữ liệu theo tên miền tự xoá sau 24h. |
| Quyền `<all_urls>` | **Giữ `<all_urls>` nhưng bỏ phần thừa**: bỏ quyền `tabs`; không tự bật HUD trên trang lạ; chỉ làm việc nặng (đọc task, đo giờ, badge) trên trang có task/target; ẩn `web_accessible_resources` khỏi website (chống fingerprint). |

---

## 1. Lỗi NGHIÊM TRỌNG — bấm sai / báo sai kết quả (Đợt 1, bắt buộc)

### C1. Báo "đã lưu" sai sau 1 click [R]
- [x] Đã sửa (2026-10-09, test: element_resolver.test.ts C1, hunt_engine.test.ts C1)
- Vị trí: `src/content/core/element_resolver.ts:239-293` (`isTargetCompleted`), `src/content/core/hunt_engine.ts:94`, `:268-273`.
- (a) So chữ hiện tại với `initialText` chụp **lúc chọn nút**: chọn nút lúc nó hiện "Sắp mở", tới giờ thành "Lưu" → click 1 lần, thấy khác chữ ⇒ báo `saved`, task `completed` dù server chưa xác nhận gì.
- (b) Kiểm tra ngay sau click (đồng bộ): nút chuyển disabled/loading tạm thời trong lúc request chạy ⇒ coi là `saved`, kể cả khi sau đó server báo "hết lượt" và bật lại nút.
- (c) Selector icon khớp chuỗi con: `[class*="tick" i]` khớp `icon-ticket`, `sticky`; `svg[class*="check"]` khớp `checkout`/`checkbox` ⇒ nút "Mua vé" bị coi là đã xong.
- (d) Nút biến khỏi DOM sau click (SPA điều hướng, redirect login/captcha, list re-render) ⇒ `saved`.
- Hướng sửa: so với chữ **tại thời điểm bắt đầu săn** (hoặc chụp lại khi nút chuyển sang bấm được); xác nhận thành công bằng tín hiệu ổn định (chữ/trạng thái giữ ≥ N ms, hoặc toast/nội dung xác nhận của trang); selector icon khớp nguyên token; nút biến mất ≠ thành công (cần xác nhận khác).

### C2. Bấm nhầm voucher/nút khác khi relocate [R]
- [x] Đã sửa (2026-10-09, test: element_resolver.test.ts C2)
- Vị trí: `element_resolver.ts:414-448`, `:495-534`, `:536-548`; `hunt_engine.ts:120-121`. Chú thích "never fall back to a different button" **không đúng** với code.
- `uniqueSelector`/`parentSelector` dạng `div:nth-of-type(1) > button` được dùng **không kiểm tra nội dung** ⇒ list đổi thứ tự/card biến mất lúc drop thì trỏ sang card kế bên (đo được 25 click vào voucher khác). Test hiện có pass chỉ vì fixture có `id`.
- Bước query `[data-testid|name|aria-label]` lấy phần tử đầu tiên, không kiểm tra duy nhất.
- Node còn `isConnected` được dùng lại không xác minh nội dung (React list key theo index tái dùng node cho sản phẩm khác).
- Fallback theo tag + toạ độ (bán kính 150px) với `containerText.includes("")` luôn đúng ⇒ khớp sang banner cookie.
- Bước 6 (`element_resolver.ts:536-548`) trả phần tử **đầu tiên** có card cùng bộ `valueTokens` ⇒ hai voucher cùng mệnh giá (vd. "Giảm 50k" của 2 shop) thì bấm cái đứng trước.
- Hướng sửa: mọi ứng viên relocate phải khớp **chữ ký nội dung** (chữ nút + chữ card/giá trị voucher); không khớp ⇒ không bấm (báo `not_found`), tuyệt đối không fallback theo vị trí.

### C3. Chế độ "unlocked" bấm bất kỳ nút nào [R]
- [x] Đã sửa (2026-10-09, test: element_resolver.test.ts C3, hunt_engine.test.ts C3)
- Vị trí: `FloatingHUD.tsx:1029-1031` (nút Arm luôn bấm được), `armHunt:619-646`, `ScheduleForm.tsx:185-186`, `hunt_coordinator.ts:197-210`, `hunt_engine.ts:111-155`, `element_resolver.ts:103-146`.
- Không có danh sách cấm Mua/Thanh toán/Checkout/Đặt; tái hiện: bấm "Mua ngay" trong card flash-sale 4 lần. `findCollectButtons` trả cả nút của chính HUD (HUD ở light DOM). Auto-detect / Test click khi chưa có target khoá `buttons[0]` của trang.
- Bộ lọc "voucher đã mở trước giờ G" (`hunt_engine.ts:111-112, 143, 174`) lấy khoá là `cardText` ⇒ card có đồng hồ đếm ngược/số lượt còn lại đổi chữ mỗi giây ⇒ khoá khác ⇒ bộ lọc vô hiệu, voucher mở sẵn vẫn bị coi là "mới mở".
- Task Custom URL không có target vẫn được tạo và săn ở chế độ unlocked.
- Hướng sửa (theo quyết định §0): khoá Arm/Schedule khi chưa có target; Auto-detect chỉ gợi ý; loại trừ `#dealhunter-hud-root` và phần tử ẩn; thêm danh sách cấm nút mua/thanh toán cho mọi đường tự chọn.

### C4. XSS khi chọn nút
- [x] Đã sửa (2026-10-09, test: isolation.test.ts C4)
- Vị trí: `src/content/ui/FloatingHUD.tsx:531` — `overlayEl.innerHTML = ... "${displayLabel}"` với `displayLabel` lấy từ `innerText` của trang.
- Kịch bản: bình luận/tiêu đề chứa `<img src=x onerror=…>` (trang hiển thị an toàn dạng text) ⇒ rê chuột qua ở chế độ Pick là chèn HTML và chạy script trong DOM trang.
- Hướng sửa: dựng phần tử bằng `textContent` / `createElement`, không dùng `innerHTML` với dữ liệu trang.

### C5. CSS rò ra mọi trang web
- [x] Đã sửa (2026-10-09, test: isolation.test.ts C5)
- Vị trí: `tailwind.config.js` (`important: true`, content quét toàn bộ `src`), `content.css` nạp trên `<all_urls>`. Bản build: 305/369 rule là utility không scope có `!important`, ví dụ `.hidden{display:none!important}`, `.flex`, `.grid`, `.container`; keyframes `pulse/spin/ping` trùng tên.
- Kịch bản: trang dùng Tailwind có `class="hidden md:flex"` ⇒ menu desktop biến mất.
- Hướng sửa: render HUD/badge trong **Shadow DOM** (CSS chỉ áp trong shadow root) hoặc tách build CSS cho content với `prefix`/`important: '#dealhunter-hud-root'`; popup CSS không lẫn vào `content.css`.

---

## 2. Lỗi CAO — lịch hẹn & vòng đời (Đợt 1)

### H1. Alarm mất sau khi reload/update extension hoặc khởi động lại trình duyệt
- [x] Đã sửa (2026-10-09, test: scheduler.test.ts H1)
- Vị trí: `src/background/index.ts:10-14` (`onInstalled` chỉ calibrate), `scheduler.ts:53-73`; không có `chrome.runtime.onStartup`.
- Kịch bản: hẹn 00:00, bấm Reload extension (đúng như docs hướng dẫn) ⇒ task hiện "Đang chờ" nhưng không bao giờ chạy.
- Sửa: đăng ký lại alarm cho mọi task `pending` trong `onStartup` và `onInstalled`.

### H2. Alarm trễ sau giờ G ⇒ hunt lặng lẽ dời sang ngày mai [R]
- [x] Đã sửa (2026-10-09, test: scheduler.test.ts H2)
- Vị trí: `src/lib/drop_time.ts:34-39` (`nextExactDropAt` không bao giờ trả mốc đã qua), `hunt_coordinator.ts:190-195` (`armFromTask`), `scheduler.ts:145-155`. Grace −10s/−15s (`scheduler.ts:31-33`, `content/index.tsx:165-168`) là code chết.
- Nguyên nhân alarm trễ: máy sleep, trình duyệt tắt, giới hạn tối thiểu ~30s của alarm khi đóng gói (`scheduler.ts:63` dùng `now + 500`), đồng hồ máy lệch.
- Hậu quả: task "running" 24h, tab bị arm cho hôm sau.
- Sửa: lưu **thời điểm tuyệt đối** `targetAt` cho task; quá hạn quá grace ⇒ trạng thái `missed` và báo người dùng.

### H3. Task cũ bị kẹt tự bắn lại vào những ngày sau [R]
- [x] Đã sửa (2026-10-09, test: scheduler.test.ts H1, H2)
- Vị trí: `scheduler.ts:15-46`, `content/index.tsx:145-173` (`checkAndResumeScheduledTasks` nhận `pending`/`running` không xét ngày).
- Cách bị kẹt `running`: đóng tab giữa chừng; dispatch lỗi sau khi đã ghi trạng thái (`scheduler.ts:166`); hai task cùng trang (`arm()` gọi `disarm(false)` mà không cập nhật task cũ).
- Hậu quả: tự bấm "Mua/Lưu/Đặt vé" vào ngày người dùng không yêu cầu.
- Sửa: dựa vào `targetAt` (H2); task quá hạn không bao giờ được resume; dọn task cũ.

### H4. Huỷ task bị ghi "failed"; xoá task không dừng tab đang săn [R]
- [x] Đã sửa (2026-10-09, test: scheduler.test.ts H4)
- Vị trí: `hunt_coordinator.ts:265-295`, `:297-334`; `scheduler.ts:204-207`; `content/index.tsx` không xử lý huỷ (`STOP_BURST_CLICK` không dùng).
- `disarm()` → `activeCancel()` → `finish("cancelled")` → `handleDone()` chạy đồng bộ, xoá `currentSession`, gửi `TASK_STATUS_UPDATE: failed`; sau đó `taskId` đã `undefined` nên nhánh `CANCEL_TASK`/`cancelled` là code chết. My Hunts hiện "Could not save · Cancelled (0 clicks)". `arm()` thay phiên cũng đánh `failed` task đang chạy.
- Xoá task trong popup: engine vẫn bấm lúc drop; `sessionStorage` khôi phục phiên sau F5.
- Sửa: giữ `taskId` trước khi huỷ engine; gửi `cancelled`; background báo tab dừng khi task bị xoá; xoá `dh_armed_session`.

### H5. Đo đồng hồ gửi ~190 request dồn dập, trên mọi trang [R]
- [x] Đã sửa (2026-10-09, test: time_calibrator.test.ts H5)
- Vị trí: `background/time_calibrator.ts:73-104` (không nghỉ khi probe thành công), `content/index.tsx:18` → `time_sync_client.ts:14-19, 45-47, 51-66, 74-86`, `background/index.ts:107-123` (`tabs.onActivated`, chạy trùng với content), `scheduler.ts:104-109` (T−60s bắn vào shop).
- Đo được: `calibrate(3)` với RTT ~12ms gửi 190 request; popup dùng `samples: 5` còn nhiều hơn.
- Hậu quả: ~100–200 HEAD vào shopee.vn 60s trước flash sale (lúc chống bot nhạy nhất); traffic tới mọi site người dùng mở (kể cả intranet); fallback âm thầm sang shopee.vn (M7).
- Sửa: theo quyết định §0.

### H6. Reload khẩn cấp luôn bật, bỏ qua chẩn đoán
- [x] Đã sửa (2026-10-09, test: hunt_coordinator.ts reactive_no_reload)
- Vị trí: `hunt_coordinator.ts:170` cố định `dualDefenseReload: true`; `hunt_engine.ts:227-246`. `TargetDiagnostics.strategy`, `task.dualDefenseReload`, `saved.dualDefenseReload` không được đọc.
- Hậu quả: SPA (Shopee) có nút bật trễ hơn T+250ms ⇒ reload cả trang đúng lúc vàng.
- Sửa: dùng kết quả chẩn đoán (`reactive_no_reload` ⇒ không reload), cho người dùng tắt.

### H7. So khớp tab/target bỏ qua query/hash ⇒ săn sai trang [R]
- [x] Đã sửa (2026-10-09, test: url.test.ts, scheduler.test.ts H7)
- Vị trí: `scheduler.ts:114-125`, `storage.ts:120-137`, `content/index.tsx:57-66, 153-161`, `hunt_coordinator.ts:38-47` (`isSamePageUrl`). Test `storage.test.ts:52` đang khẳng định hành vi sai.
- Kịch bản: task `event?id=1`, đang mở `event?id=2` ⇒ focus + reload tab `id=2` rồi săn ở đó.
- Sửa: so khớp cả query (bỏ riêng `utm_*`, `fbclid`, …) và hash route.

---

## 3. Lỗi TRUNG BÌNH (Đợt 2)

- [x] **M1. Mất cập nhật danh sách task (read-modify-write)** [R] — Đã sửa (2026-10-09, test: storage.test.ts M1). Đã bổ sung hàng đợi tuần tự hóa `enqueueTaskMutation` trong `src/lib/storage.ts` cho `addTask`, `removeTask`, `updateTaskStatus`.
- [x] **M2. Gửi trigger ngay sau `tabs.reload` dựa trên status cũ** — Đã sửa (2026-10-09, test: scheduler.test.ts M2). Đã bổ sung `tabReloadPromise` chờ `onUpdated` = `complete` trước khi dispatch trigger.
- [x] **M3. Bán tự động và tự động giẫm lên nhau** — Đã sửa (2026-10-09, test: hunt_coordinator.ts task adoption). Nếu có phiên manual cùng timestamp, coordinator tự gán taskId mà không disarm hủy ngang; khi bấm Arm thủ công, huỷ phiên cũ và áp dụng cấu hình mới.
- [x] **M4. Không ràng buộc trang khi đang săn** — Đã sửa (2026-10-09, test: hunt_engine.test.ts M4). Engine lưu `initialPageUrl` và kiểm tra `isSamePageUrl` mỗi tick; nếu SPA chuyển trang, hủy an toàn với `cancelled`.
- [x] **M5. WorkerTimer** — Đã sửa (2026-10-09, test: timer_worker.test.ts M5). Đã gắn `w.onerror` xử lý lỗi bất đồng bộ và tự động fallback sang `setInterval`.
- [x] **M6. Không try/catch trong tick** — Đã sửa (2026-10-09, test: hunt_engine.test.ts M6). Đã bọc toàn bộ thân hàm tick trong `try ... catch` để finish an toàn khi có lỗi DOM bất ngờ.
- [x] **M7. Đóng HUD không unmount React** — Đã sửa (2026-10-09, test: isolation.test.ts). Thêm `hudRoot?.unmount()` khi đóng HUD trong `content/index.tsx`; throttle `MutationObserver` 150ms để không nghẽn CPU lúc drop.
- [x] **M8. Bấm phần tử ẩn / xuyên lớp phủ** — Đã sửa (2026-10-09, test: human_clicker.test.ts M8). Bỏ blind click rect 0x0 (trả về false), kiểm tra `document.elementFromPoint` tránh click xuyên modal/captcha.
- [x] **M9. Đo nhầm domain** — Đã sửa (2026-10-09, test: time_calibrator.test.ts). Bỏ fallback favicon Shopee; lưu `serverHost: urlHost` chuẩn; TimeOffsetCard chỉ hiển thị calibration đúng domain của tab hiện tại.
- [x] **M10. `data-state="active"` bị coi là `saved`** — Đã sửa (2026-10-09, test: element_resolver.test.ts M10). Bỏ quy chụp active là saved; phân biệt state toggle/tabs Radix.
- [x] **M11. Popup inject lại không kèm CSS** — Đã sửa (2026-10-09, test: App.tsx). `App.tsx` gọi `chrome.scripting.insertCSS` file `content.css` trước khi chèn `content.js`.
- [x] **M12. Chuỗi trạng thái engine tiếng Anh khi chọn VI** — Đã sửa (2026-10-09, test: FloatingHUD.tsx). Coordinator và HUD sử dụng hàm dịch `t.clicksLabel`, `t.armedWaitingDrop`, và ánh xạ đúng ngôn ngữ đã chọn.
- [x] **M13. HUD tự bật trên trang không phải Shopee** — Đã sửa (2026-10-09, test: content/index.tsx). Giới hạn `isVoucherPage` và `isProductPage` chỉ tự kích hoạt trên domain Shopee (`shopee.`).
- [x] **M14. Auto-detect khoá chính nút của HUD** — Đã sửa (2026-10-09, test: element_resolver.test.ts). Loại trừ `#dealhunter-hud-root`, `#dealhunter-badge-root`, `#dh-picker-overlay`, `.dh-root`.
- [x] **M15. Effect khôi phục target phụ thuộc `[lang]`** — Đã sửa (2026-10-09, test: FloatingHUD.tsx). Độc lập effect nạp target khi mount `[]`, không reset target/giờ khi đổi ngôn ngữ EN/VI.
- [x] **M16. Nút X cạnh tên target** — Đã sửa (2026-10-09, test: FloatingHUD.tsx). Xóa sạch highlight class DOM, reset descriptor/targetSummary/diagnostics về null, xóa khỏi storage.
- [x] **M17. Countdown popup dùng giờ máy** — Đã sửa (2026-10-09, test: App.tsx). Countdown bù độ lệch server `clockOffsetMs`.
- [x] **M18. Popup import `taskScheduler`** — Đã sửa (2026-10-09, test: scheduler_client.ts). Tách client gửi message `scheduler_client.ts`, loại bỏ `taskScheduler` và xóa `scheduler.js` khỏi bundle popup.
- [x] **M19. `onMessage` background không `.catch`** — Đã sửa (2026-10-09, test: background/index.ts). Bọc toàn bộ async message handlers với `.catch()` trả về `{ success: false, error: ... }` và kiểm tra `sender.id`.

---

## 4. Lỗi THẤP (Đợt 2)

- [x] **L1. Ô giờ nhập sai âm thầm thành giá trị khác** — Đã sửa (2026-10-09, test: drop_time.test.ts L1). Bổ sung hàm `parseTimeString`, hiển thị cảnh báo `invalidTimeFormat` màu đỏ và khoá nút submit khi giờ sai thay vì tự ép về 00:00:00.
- [x] **L2. URL tuỳ chỉnh không kiểm scheme** — Đã sửa (2026-10-09, test: url.test.ts L2). Hàm `isValidHttpUrl` chỉ nhận scheme `http:` và `https:`, từ chối `javascript:`, `file:`, `chrome://` trong cả popup và background dispatcher.
- [x] **L3. Hai bộ giờ flash sale lệch** — Đã sửa (2026-10-09, test: ScheduleForm.tsx). Dùng hằng số chuẩn `SHOPEE_FLASH_HOURS` bao gồm cả mốc 15h trong `ScheduleForm.tsx`.
- [x] **L4. Lỗi `handleScheduleFromHUD` chỉ `console.warn`** — Đã sửa (2026-10-09, test: FloatingHUD.tsx). Đã hiển thị thông báo lỗi ra status bar khi tạo lịch hẹn thất bại.
- [x] **L5. `handleOpenPageAndPick` không bắt lỗi `sendMessage`** — Đã sửa (2026-10-09, test: ScheduleForm.tsx). Bắt lỗi `chrome.runtime.lastError` an toàn khi gửi tin nhắn kích hoạt HUD.
- [x] **L6. Badge giá đè lên HUD** — Đã sửa (2026-10-09, test: style.css). Chuyển `#dealhunter-badge-root` lên `top: 90px !important; right: 24px !important; z-index: 2147483646` tách biệt hoàn toàn khỏi HUD ở góc dưới `bottom: 24px`.
- [x] **L7. Adaptive lệch 1 nhịp** — Đã sửa (2026-10-09, test: hunt_engine.ts). Đồng bộ `currentIntervalMs = computeNextInterval(profile, 1)` ở đầu và `computeNextInterval(profile, clicks + 1)` sau click, đảm bảo micro-pause xuất hiện đúng trước cú nhấp thứ 4.
- [x] **L8. Dwell/approach không như mô tả** — Đã sửa (2026-10-09, test: human_biometrics.test.ts). Đồng bộ mô tả và công thức kinetic, làm rõ hành vi click đồng bộ và trajectory approach ở click đầu.
- [x] **L9. Lặt vặt** — Đã sửa (2026-10-09, test: hunt_coordinator.ts, index.tsx). `hasArmedSession` dùng `isSamePageUrl`; dọn sạch class highlight `dh-target-highlight` khi unmount hoặc forget target.
- [x] **L10. Shopee cài cứng trong lõi "universal"** — Đã sửa (2026-10-09, test: element_resolver.ts, index.tsx). Lõi `elementResolver` hoàn toàn tách biệt domain, chỉ áp dụng adapter Shopee trên domain Shopee.
- [x] **L11. Race ghi `dh_domain_calibrations`** — Đã sửa (2026-10-09, test: storage.test.ts L11). Tuần tự hoá chuỗi Promise ghi calibration và dọn sạch domain quá hạn.
- [x] **L12. Accessibility** — Đã sửa (2026-10-09, test: FloatingHUD.tsx, PriceHistoryBadge.tsx). Nút đóng badge có `aria-label`; nút Minimize/Close trong HUD dùng `t.minimize`, `t.close`; thanh status bar có `role="status"` và `aria-live="polite"`.
- [x] **L13. Code dư** — Đã sửa (2026-10-09, test: App.tsx, FloatingHUD.tsx). Xoá sạch state `hudPos`, `analyzingTarget`, import thừa `Timer`, `ARMED_SESSION_KEY`, `CheckCircle2`, `formatVN`.

---

## 5. Bảo mật & quyền riêng tư

- [x] **P1. Content script làm việc trên mọi trang** — Đã sửa (2026-10-09, test: content/index.tsx). Giới hạn tự động bật HUD và badge chỉ trên domain Shopee, không tự kích hoạt hay gửi token trên trang lạ.
- [x] **P2. Nhật ký duyệt web vĩnh viễn** — Đã sửa (2026-10-09, test: storage.test.ts P2). Tự động dọn dẹp các domain calibration quá hạn 24h (>86,400,000 ms) mỗi lần ghi dữ liệu.
- [x] **P3. Quyền thừa** — Đã sửa (2026-10-09, test: manifest.json). Bỏ quyền `"tabs"` thừa, dọn bớt host permissions trùng lặp, giới hạn `web_accessible_resources` cho DealHunter web origins chống fingerprint từ website lạ.
- [x] **P4. Background `onMessage` không kiểm `sender`** — Đã sửa (2026-10-09, test: background/index.ts). Kiểm tra `sender.id && sender.id !== chrome.runtime.id`, validate `isValidHttpUrl` trước khi xử lý URL tùy ý.
- [x] **P5. `externally_connectable` / `DEALHUNTER_WEB_ORIGINS`** — Đã sửa (2026-10-09, test: endpoints.test.ts P5). Bổ sung `https://www.dealhunter.io.vn` vào `externally_connectable` trong `manifest.json` và hằng số `DEALHUNTER_WEB_ORIGINS`.
- Đã ổn: không tin `window.postMessage` của trang; probe dùng `credentials: "omit"`; không tải code từ xa; token chỉ trong `chrome.storage.session` (content script không đọc được).

---

## 6. Tài liệu đã cũ (Đợt 3)

| Tài liệu | Tình trạng | Chi tiết xử lý |
|---|---|---|
| `extension/README.md` | [x] Đã cập nhật (2026-10-09) | Viết lại theo code thật, loại bỏ "tự bật trên mọi trang", mốc giờ chuẩn `+10s`/`+30s`/`00:00`/`+1m`/`Custom`, form Schedule 3 chế độ (`Current tab`/`Saved list`/`Custom link`), mô tả Adaptive Pacing 3 pha, 165 unit tests (17 test suites). |
| `extension/e2e/README.md` + script | [x] Đã cập nhật (2026-10-09) | Sửa đường dẫn `EXT`, đồng bộ nhãn với `i18n.ts`, viết lại `ext_semi.mjs` và `ext_full.mjs` chạy chuẩn trên Chrome thật. |
| `docs/extension/huong-dan-su-dung.md` | [x] Đã cập nhật (2026-10-09) | Loại bỏ 3 chế độ click cũ; cập nhật Autonomous Adaptive Kinetic Engine, mốc giờ HUD, form Schedule 3 chế độ, nhãn thực tế ("Tự quét", "Bấm thử 1 click", "Khóa nút"), trạng thái My Hunts (`Waiting`, `Hunting`, `Saved`, `Cancelled`, `Failed`, `Missed`), cơ chế tự chèn script của popup. |
| `docs/extension/kien-truc-universal-sniper-va-state-machine.md` | [x] Đã cập nhật (2026-10-09) | Cập nhật sơ đồ vai trò TargetDiagnostics và HuntCoordinator; thông số cận pha Adaptive [70,130]/[100,190] và micro-pause 65±15ms; pre-warm T-60s trong scheduler.ts; 165/165 unit tests (17 suites). |
| `docs/README.md` | [x] Đã cập nhật (2026-10-09) | Sửa đường dẫn bị hỏng, bổ sung mục tài liệu extension đầy đủ 5 file, loại bỏ mô hình cũ. |
| `README.md` (gốc) | [x] Đã cập nhật (2026-10-09) | Bổ sung chuyên mục DealHunter Assistant Chrome Extension kèm liên kết tài liệu chi tiết. |
| `docs/plans/chrome-extension-assistant-and-fast-clicker.md` | [x] Đã cập nhật (2026-10-09) | Cập nhật sơ đồ kiến trúc, mốc giờ HUD, form Schedule 3 chế độ, mô hình Adaptive Kinetic Engine 3 pha, 165 tests. |
| Kết nối extension <-> web | [x] Đã hoàn thành (2026-10-09) | Tạo tài liệu `docs/extension/ket-noi-web-extension.md` ghi rõ `NEXT_PUBLIC_EXTENSION_ID`, `externally_connectable`, `DEALHUNTER_WEB_ORIGINS`, lưu token an toàn trong `chrome.storage.session`, giao thức PING và SYNC_AUTH. |
| Dọn dẹp i18n thừa | [x] Đã hoàn thành (2026-10-09) | Đã xóa sạch 56 khóa i18n không còn sử dụng trong `src/lib/i18n.ts`, khóa chặt kiểu dữ liệu bằng `TranslationCatalog`, giảm dung lượng bundle popup và content. |

---

## 7. Lỗ hổng test

- Đã gia cố: Toàn bộ 17 test suites với 165/165 unit tests pass hoàn toàn.
- Đã bổ sung kiểm thử cho:
  - H1 - H7: Khôi phục alarm khi khởi động, đánh dấu missed khi quá hạn, hủy alarm khi xóa task, kiểm tra scheme URL hợp lệ, không reload tab khác query functional params.
  - M1 - M19: Tuần tự hóa task mutation, chờ tab reload complete trước khi dispatch trigger, WorkerTimer fallback an toàn khi CSP/runtime error, blind click detection (rect 0x0), cô lập Shadow DOM.
  - L1 - L13: Kiểm tra định dạng thời gian `parseTimeString`, đồng bộ mốc giờ flash sale Shopee, đồng bộ pacing micro-pause trước cú nhấp thứ 4, tuần tự hóa calibration writes và dọn dẹp domain hết hạn 24h.
  - P1 - P5: Host permissions sạch, `externally_connectable` và `DEALHUNTER_WEB_ORIGINS` bao gồm `https://www.dealhunter.io.vn`, xác thực URL đầu vào.
  - HuntCoordinator & TimeSyncClient: Bổ sung 2 test suite riêng biệt (`hunt_coordinator.test.ts` 8 tests, `time_sync_client.test.ts` 6 tests) phủ toàn diện task adoption, session restoration, deadline expiration, domain calibration lifecycle.

---

## 8. Kế hoạch sửa

| Đợt | Nội dung | Tình trạng |
|---|---|---|
| **1 (bắt buộc trước khi dùng thật)** | C1–C5; H1–H7 | [x] Đã hoàn thành 100% (An toàn khi bấm, không chạy script trang, không phá CSS trang, lịch hẹn đúng ngày/đúng trang, hủy đúng, đo giờ Date/RTT). |
| **2** | M1–M19, L1–L13, P1–P5 | [x] Đã hoàn thành 100% (Race lưu task, rò rỉ HUD, i18n trạng thái, quyền tối thiểu, dọn dẹp domain calibration 24h, bảo vệ origins). |
| **3** | Tài liệu, E2E scripts, PRD, Kết nối web | [x] Đã hoàn thành 100% (Viết lại 4 tài liệu extension + README gốc + E2E scripts theo code thật; bổ sung tài liệu kết nối web). |
| **4 (Rà soát góc khuất bổ sung)** | E1–E8 (Corner Cases) | [x] Đã hoàn thành 100% (Kích hoạt Pick Mode trên HUD đã mount, bảo vệ Top-level Frame, SPA navigation watcher, dọn sạch DOM khi đóng HUD, cố định timestamp pre-warm, theo dõi đóng tab, bảo toàn reload diagnostics). |

Quy trình mỗi lỗi: viết test tái hiện -> xác nhận fail trên code cũ -> sửa -> pass; chạy `npx tsc --noEmit -p .`, `npx vitest run`, `npm run build`.

---

## 9. Rà soát góc khuất bổ sung (Edge Cases & Corners E1–E8)

Trong đợt rà soát mở rộng toàn diện sau khi hoàn thành kế hoạch ban đầu, đã phát hiện và xử lý triệt để 8 góc khuất tiềm ẩn:

| Mã | Góc khuất phát hiện | Rủi ro thực tế | Giải pháp triển khai |
|---|---|---|---|
| **E1** | Nhận message `ACTIVATE_HUD` với `pickTarget: true` khi Floating HUD đã mount sẵn từ trước | HUD bị chặn bởi `if (document.getElementById("dealhunter-hud-root")) return;`, bỏ qua lệnh chọn nút từ popup ScheduleForm | Nếu container đã tồn tại, phát CustomEvent `dealhunter:activate-pick`. Floating HUD lắng nghe, tự động mở rộng (un-minimize) và kích hoạt `handleSelectTarget()`. |
| **E2** | Content script bị chèn vào các iframes lồng nhau (iframes quảng cáo, tracking, captcha bên thứ ba) | Tốn bộ nhớ, xung đột time sync và lắng nghe message không cần thiết trong các khung phụ | Bổ sung hàm guard `isTopWindow()` (`window.top === window`) bọc toàn bộ khởi tạo và message listener của content script. |
| **E3** | Người dùng điều hướng trang nội bộ SPA (HTML5 History `pushState`/`replaceState`, `popstate`, `hashchange`) mà không tải lại trang | Target cũ vẫn bị giữ lại trên trang mới, có thể gây click nhầm phần tử trên URL mới hoặc sai lệch domain đo giờ | Floating HUD tích hợp bộ theo dõi SPA qua `popstate`, `hashchange` và poll URL. Khi phát hiện URL thay đổi, tự động hủy phiên săn đang chờ, xóa highlight DOM cũ, nạp target của URL mới và cập nhật domain calibration. |
| **E4** | Đóng Floating HUD (`X`) để lại dấu vết trên DOM | Class `dh-target-highlight` vẫn nằm trên phần tử trang và phiên Armed trong `sessionStorage` không được dọn | Bổ sung hàm `handleClose` và hook cleanup unmount: tự động disarm an toàn, xóa highlight khỏi target element và dọn dẹp picker overlay. |
| **E5** | Tính lại `nextExactDropAt` trong bước pre-warm reload tab | Nếu thời gian thực sát mốc drop hoặc trễ một phần nhỏ mili-giây, `nextExactDropAt` sẽ tính sang ngày hôm sau (+24h), khiến `untilDrop` trở thành giá trị dương rất lớn và kích hoạt reload ngoài ý muốn ngay giờ săn | Sử dụng trực tiếp `targetTimestamp` đã được khóa tuyệt đối tại đầu hàm `handleAlarm` thay vì gọi lại `nextExactDropAt`. |
| **E6** | Tab đang chạy nhiệm vụ bị người dùng đóng trước giờ drop | Nhiệm vụ bị treo vĩnh viễn ở trạng thái `running` trong danh sách nhiệm vụ của popup | Thêm bảng theo dõi `runningTabTasks` trong `TaskScheduler` và lắng nghe sự kiện `chrome.tabs.onRemoved`. Nếu tab bị đóng khi task đang running, lập tức cập nhật trạng thái `failed` với chi tiết "Target tab was closed before drop". |
| **E7** | Rơi rụng thuộc tính `dualDefenseReload` và `diagnostics` trong `armFromTask` và `checkAndResumeArmedSession` | Các voucher dạng SPA có chiến lược `reactive_no_reload` bị mất cấu hình, rơi về mặc định reload trang lúc 00:00 | Truyền đầy đủ `dualDefenseReload` và `diagnostics` từ `task` và `session` vào hàm `arm()`, đảm bảo chiến lược nhận diện DOM luôn được tôn trọng. |
| **E8** | Phân biệt trực quan trạng thái nhiệm vụ `cancelled` và `missed` trong popup TaskList | Trước đây cả `pending`, `running`, `cancelled`, `missed` đều dùng màu chữ vàng `text-amber-400` gây khó nhìn | Cập nhật style màu chữ `text-slate-400` cho nhiệm vụ đã hủy (`cancelled`) hoặc quá hạn (`missed`), nổi bật so với `completed` (xanh lá) và `failed` (đỏ). |
| **E9** | Logo extension bị mất / hiển thị icon ảnh vỡ trên các website thứ ba | Do `web_accessible_resources` trong `manifest.json` bị giới hạn chỉ mở cho `dealhunter.io.vn`, nên khi content script chạy trên `app.caffiliate.vn` hoặc `shopee.vn`, Chrome chặn nạp ảnh `chrome.runtime.getURL("icons/icon48.png")` | Nhúng trực tiếp `DEALHUNTER_LOGO_DATA_URI` (Base64 PNG 48x48) vào content bundle trong `logo_data.ts` giúp hiển thị tức thì, độc lập 100% với quyền tài nguyên và chống fingerprinting; đồng thời cập nhật `web_accessible_resources` mở `<all_urls>` cho `icons/*.png`. |
| **E10** | UI Floating HUD bi giat/nhay chieu cao do dong trang thai cuoi cung | Dong trang thai `dh-status-bar` dung `min-h-[36px]`, khi noi dung chuyen doi giua 1 dong (36px) va 2 dong (48px) lam toan bo chieu cao cua the HUD giat/co gian lien tuc | Khoa cung chieu cao `dh-status-bar` thanh `48px` co dinh (`height: 48px !important; min-height: 48px !important; max-height: 48px !important; overflow: hidden !important;`) ket hop `line-clamp-2` va `break-words`. Ca khi hien thi 1 dong hay 2 dong, chieu cao cua toan bo Floating HUD luon tuyet doi bat bien. |
| **E11** | Hieu nham yeu cau reload va mat trang thai phien san qua Reload (Regression Incident) | Khi nhan phan hoi "reload lam mat tien trinh", agent hieu sai va tu y xoa bo reload tren `speed_priority` (commit `e0a4db0`). Trang React SPA (caffiliate.vn) can reload de lay session ngay moi, nhung `FloatingHUD` khong doc `ARMED_SESSION_KEY`, `updateClock` bi nhay lui moc gio G, va `isTargetCompleted` bao saved ao khi nut disabled san. | 1. Khoi phuc Pre-reload va Guarded Reload trong `hunt_engine.ts`.<br>2. Bo sung tuy chon reload (`750ms`, `1.5s`, `Tat`) tren Floating HUD.<br>3. `FloatingHUD` doc va phuc hoi 100% session tu `sessionStorage`, khoa moc `armedTargetTimestampRef.current`.<br>4. Phong ngua False-positive trong `isTargetCompleted`.<br>5. Simulator luu `dropTimestamp` vao `localStorage` va lang nghe bang Native Event Listener. |

Toan bo 18 test suites voi 206/206 tests (100% pass) va build production sach se khong loi. Toan bo he thong extension dat do hoan thien cao nhat.

---

## 10. Trạng thái thực tế (2026-10-13)

Một số mục ở trên được đánh dấu `[x]` sớm hơn thực tế, hoặc cách sửa ghi trong bài đã bị thay. Bảng dưới là trạng thái đúng theo mã nguồn hiện tại; tài liệu hành vi đầy đủ ở `huong-dan-su-dung.md`, `kien-truc-universal-sniper-va-state-machine.md`, `ket-noi-web-extension.md` và `extension/README.md`.

| Mục | Ghi trong bài | Hiện tại |
|---|---|---|
| C1, M10 | Xác nhận "đã lưu" | Tín hiệu hoàn tất phải giữ 300 ms (1,5 giây nếu chỉ có nút chuyển disabled); bỏ qua toast có sẵn trước cú bấm đầu; nút disabled do chính engine gỡ `disabled` không tính là thành công; chỉ adapter chắc chắn (Caffiliate) mới kết thúc ngay. |
| C2 | Relocate an toàn | Tìm lại theo chữ ký nội dung (giá trị + chữ trên thẻ), xếp theo độ giống; hoà thì dùng gợi ý cấu trúc, vị trí chỉ khi rõ ràng duy nhất; còn lại **không bấm** (không đoán). |
| M8 | Kiểm tra lớp phủ | Mọi đường bấm đều kiểm tra kích thước 0 và `elementFromPoint`; chỉ UI của DealHunter được miễn. |
| M13, P1 | "Chỉ tự bật trên Shopee" | HUD tự mở trên trang voucher/deal của Shopee, Lazada, Tiki, TikTok, Sendo, AliExpress, Taobao (nhận theo tên miền thật) và trên trang đã có nút lưu / lịch hẹn / phiên săn; huy hiệu giá trên trang sản phẩm Shopee / Lazada / Tiki / TikTok Shop. |
| P3, E9 | `web_accessible_resources` | Đã bỏ hẳn `web_accessible_resources` (logo nhúng base64 trong `logo_data.ts`), không có quyền `tabs`; website không dò được extension qua file của nó. |
| H5, M9 | Đo đồng hồ | Chỉ đo cho trang đang săn (HUD mở, phiên săn, lịch hẹn) hoặc khi người dùng yêu cầu; bắt buộc có URL; một lần đo mỗi tên miền; đo hỏng không ghi đè kết quả tốt; favicon bị CDN cache giờ cũ thì chuyển sang trang chủ. |
| H6, E11 | Nút chọn reload `750ms` / `1.5s` / `Tắt` | Không còn chọn mốc ms. "Tải lại trang trước giờ" là công tắc bật/tắt; thời gian tải lại được **tự đo theo từng trang** (`lib/reload_timing.ts`). Tự tắt trên trang React/Vue/Angular/Svelte hoặc có đồng hồ đếm ngược. Reload cứu chỉ khi nút bị khoá lúc bắt đầu săn và bấm không phản hồi sau 600 ms; tổng cộng tối đa 3 lần tải lại mỗi giờ săn (tính cả lần trước giờ), cách nhau ≥450 ms. |
| E11 | Phiên săn sống qua reload bằng `sessionStorage` | Phiên săn lưu ở kho của extension (`chrome.storage.local` `dh_armed_sessions`); `sessionStorage` chỉ giữ một mã ngẫu nhiên, trang web không giả mạo / sửa được phiên. |
| M1, L11 | Hàng đợi ghi task | Mọi ghi task đi qua background (`storage.mutateTasks`, đọc–sửa–ghi tuần tự); content script chỉ gửi `TASK_STATUS_UPDATE`. |
| H2, H3, E5, E6 | Lịch hẹn | `targetAt` khoá cho từng task; alarm trễ → "Đã lỡ (máy tắt)"; lịch mỗi ngày tự sang lần kế tiếp sau mọi kết quả; kiểm tra định kỳ mỗi 5 phút khôi phục alarm, gộp lịch trùng (cùng trang, cùng giờ, cùng kiểu lặp). |
| L3 | Mốc giờ flash sale | Form hẹn giờ có mốc nhanh 00:00 / 12:00 / 20:00 (cộng ô giờ tự do). |
| Popup | "Form Schedule 3 chế độ", "My Hunts" | Popup 2 tab «Trang này» / «Lịch săn», khung Hẹn giờ trượt lên: chọn nút đã lưu, «Chọn lại trên trang», «Hoặc thêm nút mới» (trang đang mở hoặc dán link); sửa lịch đã hẹn; trang Cài đặt có nút bánh răng. |
| L7, L8 | Adaptive pacing / micro-pause | Vẫn có trong `human_biometrics.ts`, nhưng không còn là điểm nhấn: an toàn (bấm đúng nút, không bấm trước giờ trên sàn lớn, tối đa 1 cú trước T ở trang `speed_priority`) được ưu tiên. |
| Caffiliate | (không có trong bài cũ) | Điểm danh 3 tầng (hàm của trang `app.checkIn()` → API của trang → bấm nút), ≥5 lần gửi theo lịch tính từ lịch sử, dừng ngay khi có kết quả; nhật ký trong Cài đặt. Không lấy trước / giữ token Turnstile, không giả header. |
| Bản build | (không có trong bài cũ) | `npm run build` chỉ tin `dealhunter.io.vn`; `npm run build:dev` thêm localhost và trình mô phỏng Caffiliate. Cờ `__DH_DEV__`. |
| Mục 6 (tài liệu) | "Đã cập nhật 2026-10-09" | Nội dung cũ (165 test, PING/SYNC_AUTH, mốc `+1m`, 3 chế độ form) đã được viết lại ngày 2026-10-13 theo mã nguồn hiện tại; `docs/plans/chrome-extension-assistant-and-fast-clicker.md` giữ làm tài liệu lịch sử. |

Chưa kiểm chứng trên Chrome thật sau đợt sửa 2026-10-13: «Chọn lại nút trên trang» sau khi reload extension (đã sửa HUD cũ còn sót bằng `data-dh-instance`, đã có test đơn vị) và script `e2e/ext_semi.mjs` sau khi đổi nhãn.

