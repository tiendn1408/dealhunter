# DealHunter Assistant (Extension) — Rà Soát Lỗi & Kế Hoạch Sửa

> **Ngày rà soát**: 2026-10-09 · **Phạm vi**: toàn bộ `extension/` (lõi săn, background/popup, UI/i18n) và tài liệu extension.
> **Cách rà**: 3 agent độc lập, chỉ đọc; nhiều lỗi đã được **tái hiện bằng test riêng** (đánh dấu [R]). Build, `tsc`, `vitest` (120/120) đều pass — các lỗi dưới đây là lỗi logic/race mà test hiện có không phủ.
> **Trạng thái**: CHƯA SỬA. Mỗi lỗi khi sửa phải có test tái hiện viết **trước** (fail trên code cũ → pass sau khi sửa), như quy trình hardening backend.

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
- Vị trí: `src/content/core/element_resolver.ts:239-293` (`isTargetCompleted`), `src/content/core/hunt_engine.ts:94`, `:268-273`.
- (a) So chữ hiện tại với `initialText` chụp **lúc chọn nút**: chọn nút lúc nó hiện "Sắp mở", tới giờ thành "Lưu" → click 1 lần, thấy khác chữ ⇒ báo `saved`, task `completed` dù server chưa xác nhận gì.
- (b) Kiểm tra ngay sau click (đồng bộ): nút chuyển disabled/loading tạm thời trong lúc request chạy ⇒ coi là `saved`, kể cả khi sau đó server báo "hết lượt" và bật lại nút.
- (c) Selector icon khớp chuỗi con: `[class*="tick" i]` khớp `icon-ticket`, `sticky`; `svg[class*="check"]` khớp `checkout`/`checkbox` ⇒ nút "Mua vé" bị coi là đã xong.
- (d) Nút biến khỏi DOM sau click (SPA điều hướng, redirect login/captcha, list re-render) ⇒ `saved`.
- Hướng sửa: so với chữ **tại thời điểm bắt đầu săn** (hoặc chụp lại khi nút chuyển sang bấm được); xác nhận thành công bằng tín hiệu ổn định (chữ/trạng thái giữ ≥ N ms, hoặc toast/nội dung xác nhận của trang); selector icon khớp nguyên token; nút biến mất ≠ thành công (cần xác nhận khác).

### C2. Bấm nhầm voucher/nút khác khi relocate [R]
- Vị trí: `element_resolver.ts:414-448`, `:495-534`, `:536-548`; `hunt_engine.ts:120-121`. Chú thích "never fall back to a different button" **không đúng** với code.
- `uniqueSelector`/`parentSelector` dạng `div:nth-of-type(1) > button` được dùng **không kiểm tra nội dung** ⇒ list đổi thứ tự/card biến mất lúc drop thì trỏ sang card kế bên (đo được 25 click vào voucher khác). Test hiện có pass chỉ vì fixture có `id`.
- Bước query `[data-testid|name|aria-label]` lấy phần tử đầu tiên, không kiểm tra duy nhất.
- Node còn `isConnected` được dùng lại không xác minh nội dung (React list key theo index tái dùng node cho sản phẩm khác).
- Fallback theo tag + toạ độ (bán kính 150px) với `containerText.includes("")` luôn đúng ⇒ khớp sang banner cookie.
- Hướng sửa: mọi ứng viên relocate phải khớp **chữ ký nội dung** (chữ nút + chữ card/giá trị voucher); không khớp ⇒ không bấm (báo `not_found`), tuyệt đối không fallback theo vị trí.

### C3. Chế độ "unlocked" bấm bất kỳ nút nào [R]
- Vị trí: `FloatingHUD.tsx:1029-1031` (nút Arm luôn bấm được), `armHunt:619-646`, `ScheduleForm.tsx:185-186`, `hunt_coordinator.ts:197-210`, `hunt_engine.ts:111-155`, `element_resolver.ts:103-146`.
- Không có danh sách cấm Mua/Thanh toán/Checkout/Đặt; tái hiện: bấm "Mua ngay" trong card flash-sale 4 lần. `findCollectButtons` trả cả nút của chính HUD (HUD ở light DOM). Auto-detect / Test click khi chưa có target khoá `buttons[0]` của trang.
- Hướng sửa (theo quyết định §0): khoá Arm/Schedule khi chưa có target; Auto-detect chỉ gợi ý; loại trừ `#dealhunter-hud-root` và phần tử ẩn; thêm danh sách cấm nút mua/thanh toán cho mọi đường tự chọn.

### C4. XSS khi chọn nút
- Vị trí: `src/content/ui/FloatingHUD.tsx:531` — `overlayEl.innerHTML = ... "${displayLabel}"` với `displayLabel` lấy từ `innerText` của trang.
- Kịch bản: bình luận/tiêu đề chứa `<img src=x onerror=…>` (trang hiển thị an toàn dạng text) ⇒ rê chuột qua ở chế độ Pick là chèn HTML và chạy script trong DOM trang.
- Hướng sửa: dựng phần tử bằng `textContent` / `createElement`, không dùng `innerHTML` với dữ liệu trang.

### C5. CSS rò ra mọi trang web
- Vị trí: `tailwind.config.js` (`important: true`, content quét toàn bộ `src`), `content.css` nạp trên `<all_urls>`. Bản build: 305/369 rule là utility không scope có `!important`, ví dụ `.hidden{display:none!important}`, `.flex`, `.grid`, `.container`; keyframes `pulse/spin/ping` trùng tên.
- Kịch bản: trang dùng Tailwind có `class="hidden md:flex"` ⇒ menu desktop biến mất.
- Hướng sửa: render HUD/badge trong **Shadow DOM** (CSS chỉ áp trong shadow root) hoặc tách build CSS cho content với `prefix`/`important: '#dealhunter-hud-root'`; popup CSS không lẫn vào `content.css`.

---

## 2. Lỗi CAO — lịch hẹn & vòng đời (Đợt 1)

### H1. Alarm mất sau khi reload/update extension hoặc khởi động lại trình duyệt
- Vị trí: `src/background/index.ts:10-14` (`onInstalled` chỉ calibrate), `scheduler.ts:53-73`; không có `chrome.runtime.onStartup`.
- Kịch bản: hẹn 00:00, bấm Reload extension (đúng như docs hướng dẫn) ⇒ task hiện "Đang chờ" nhưng không bao giờ chạy.
- Sửa: đăng ký lại alarm cho mọi task `pending` trong `onStartup` và `onInstalled`.

### H2. Alarm trễ sau giờ G ⇒ hunt lặng lẽ dời sang ngày mai [R]
- Vị trí: `src/lib/drop_time.ts:34-39` (`nextExactDropAt` không bao giờ trả mốc đã qua), `hunt_coordinator.ts:190-195` (`armFromTask`), `scheduler.ts:145-155`. Grace −10s/−15s (`scheduler.ts:31-33`, `content/index.tsx:165-168`) là code chết.
- Nguyên nhân alarm trễ: máy sleep, trình duyệt tắt, giới hạn tối thiểu ~30s của alarm khi đóng gói (`scheduler.ts:63` dùng `now + 500`), đồng hồ máy lệch.
- Hậu quả: task "running" 24h, tab bị arm cho hôm sau.
- Sửa: lưu **thời điểm tuyệt đối** `targetAt` cho task; quá hạn quá grace ⇒ trạng thái `missed` và báo người dùng.

### H3. Task cũ bị kẹt tự bắn lại vào những ngày sau [R]
- Vị trí: `scheduler.ts:15-46`, `content/index.tsx:145-173` (`checkAndResumeScheduledTasks` nhận `pending`/`running` không xét ngày).
- Cách bị kẹt `running`: đóng tab giữa chừng; dispatch lỗi sau khi đã ghi trạng thái (`scheduler.ts:166`); hai task cùng trang (`arm()` gọi `disarm(false)` mà không cập nhật task cũ).
- Hậu quả: tự bấm "Mua/Lưu/Đặt vé" vào ngày người dùng không yêu cầu.
- Sửa: dựa vào `targetAt` (H2); task quá hạn không bao giờ được resume; dọn task cũ.

### H4. Huỷ task bị ghi "failed"; xoá task không dừng tab đang săn [R]
- Vị trí: `hunt_coordinator.ts:265-295`, `:297-334`; `scheduler.ts:204-207`; `content/index.tsx` không xử lý huỷ (`STOP_BURST_CLICK` không dùng).
- `disarm()` → `activeCancel()` → `finish("cancelled")` → `handleDone()` chạy đồng bộ, xoá `currentSession`, gửi `TASK_STATUS_UPDATE: failed`; sau đó `taskId` đã `undefined` nên nhánh `CANCEL_TASK`/`cancelled` là code chết. My Hunts hiện "Could not save · Cancelled (0 clicks)". `arm()` thay phiên cũng đánh `failed` task đang chạy.
- Xoá task trong popup: engine vẫn bấm lúc drop; `sessionStorage` khôi phục phiên sau F5.
- Sửa: giữ `taskId` trước khi huỷ engine; gửi `cancelled`; background báo tab dừng khi task bị xoá; xoá `dh_armed_session`.

### H5. Đo đồng hồ gửi ~190 request dồn dập, trên mọi trang [R]
- Vị trí: `background/time_calibrator.ts:73-104` (không nghỉ khi probe thành công), `content/index.tsx:18` → `time_sync_client.ts:14-19, 45-47, 51-66, 74-86`, `background/index.ts:107-123` (`tabs.onActivated`, chạy trùng với content), `scheduler.ts:104-109` (T−60s bắn vào shop).
- Đo được: `calibrate(3)` với RTT ~12ms gửi 190 request; popup dùng `samples: 5` còn nhiều hơn.
- Hậu quả: ~100–200 HEAD vào shopee.vn 60s trước flash sale (lúc chống bot nhạy nhất); traffic tới mọi site người dùng mở (kể cả intranet); fallback âm thầm sang shopee.vn (M7).
- Sửa: theo quyết định §0.

### H6. Reload khẩn cấp luôn bật, bỏ qua chẩn đoán
- Vị trí: `hunt_coordinator.ts:170` cố định `dualDefenseReload: true`; `hunt_engine.ts:227-246`. `TargetDiagnostics.strategy`, `task.dualDefenseReload`, `saved.dualDefenseReload` không được đọc.
- Hậu quả: SPA (Shopee) có nút bật trễ hơn T+250ms ⇒ reload cả trang đúng lúc vàng.
- Sửa: dùng kết quả chẩn đoán (`reactive_no_reload` ⇒ không reload), cho người dùng tắt.

### H7. So khớp tab/target bỏ qua query/hash ⇒ săn sai trang [R]
- Vị trí: `scheduler.ts:114-125`, `storage.ts:120-137`, `content/index.tsx:57-66, 153-161`, `hunt_coordinator.ts:38-47` (`isSamePageUrl`). Test `storage.test.ts:52` đang khẳng định hành vi sai.
- Kịch bản: task `event?id=1`, đang mở `event?id=2` ⇒ focus + reload tab `id=2` rồi săn ở đó.
- Sửa: so khớp cả query (bỏ riêng `utm_*`, `fbclid`, …) và hash route.

---

## 3. Lỗi TRUNG BÌNH (Đợt 2)

- **M1. Mất cập nhật danh sách task (read-modify-write)** [R] — `lib/storage.ts:19-43`: 2 alarm cùng giờ ⇒ một task kẹt `pending`; HUD Disarm (`CANCEL_TASK` xoá task) song song content ghi `cancelled` (`hunt_coordinator.ts:283-284`) ⇒ task đã xoá sống lại. Sửa: mọi ghi task qua một hàng đợi ở background; content không ghi storage trực tiếp.
- **M2. Gửi trigger ngay sau `tabs.reload` dựa trên status cũ** — `scheduler.ts:150-155, 184-186`: message vào document sắp huỷ; chỉ được cứu nhờ `onUpdated` gửi lại. Sửa: chờ `onUpdated` = `complete` sau reload.
- **M3. Bán tự động và tự động giẫm lên nhau** — `hunt_coordinator.ts:104-113`: trigger task huỷ phiên tay đang arm; arm tay cùng timestamp bị bỏ qua lặng lẽ.
- **M4. Không ràng buộc trang khi đang săn** — engine không kiểm tra `location` mỗi tick; SPA `pushState` sang trang khác (giỏ hàng) vẫn relocate và bấm.
- **M5. WorkerTimer** — `timer_worker.ts:35-58`: không có `w.onerror` (worker hỏng bất đồng bộ ⇒ không tick, kẹt "Armed"); fallback `setInterval` bị throttle mạnh ở tab ẩn.
- **M6. Không try/catch trong tick** — `hunt_engine.ts:165-277` (`scrollIntoView` ở `:178` không bọc): lỗi lặp mỗi tick, không `onDone`, UI kẹt; `startHunt` đọc `sessionStorage` có thể throw sau khi đã `isArmed: true`.
- **M7. Đóng HUD không unmount React** — `content/index.tsx:81` `onClose={() => container.remove()}`: interval 50ms/350ms, `MutationObserver(body, subtree)` (`FloatingHUD.tsx:165-199`, không throttle, gọi `relocateUniversal` mỗi đợt mutation — tranh main thread lúc drop), subscriber vẫn chạy; mở lại HUD tạo root thứ hai.
- **M8. Bấm phần tử ẩn / xuyên lớp phủ** — `human_clicker.ts:35-43` (rect 0×0 ⇒ `el.click()`), kiểm tra hiển thị chỉ inline style (`element_resolver.ts:113`), không kiểm tra `elementFromPoint` ⇒ bấm xuyên modal/captcha.
- **M9. Đo nhầm domain** — `time_calibrator.ts:89-99` fallback favicon Shopee, content áp offset đó cho site khác (`time_sync_client.ts:87-88`); `serverHost` không khớp ⇒ đo lại mỗi lần focus. Popup vẫn ghi "Offset vs. <domain>" (`TimeOffsetCard.tsx:75-76`).
- **M10. `data-state="active"` bị coi là `saved`** — `element_resolver.ts:169` (toggle/tab kiểu Radix).
- **M11. Popup inject lại không kèm CSS** — `App.tsx:135-138` chỉ `executeScript({files:["content.js"]})`, không `insertCSS` ⇒ HUD không có style.
- **M12. Chuỗi trạng thái engine tiếng Anh khi chọn VI** — `hunt_coordinator.ts:156` ("Armed · X" ghi đè `t.armedWaitingDrop`), `hunt_engine.ts:182, 237`, `FloatingHUD.tsx:230, 246` ("clicks"), `task.lastResult.detail`.
- **M13. HUD tự bật trên trang không phải Shopee** — `content/index.tsx:22-27` khớp `/m/`, `/cart` mọi hostname. (Theo §0: không tự bật HUD trên trang lạ.)
- **M14. Auto-detect khoá chính nút của HUD** — `findCollectButtons` không loại `#dealhunter-hud-root`; "Found N button(s)" tính cả nút HUD.
- **M15. Effect khôi phục target phụ thuộc `[lang]`** — `FloatingHUD.tsx:131-155`: đổi EN/VI reset slot/giờ custom và ghi đè status (kể cả khi đang armed).
- **M16. Nút X cạnh tên target** — `FloatingHUD.tsx:945-953`: chưa lưu thì không làm gì; đã lưu thì không xoá highlight/descriptor ⇒ vẫn dùng khi Arm.
- **M17. Countdown popup dùng giờ máy** — `App.tsx:82` dùng `Date.now()`, HUD dùng giờ server ⇒ hai bên lệch.
- **M18. Popup import `taskScheduler`** — `ScheduleForm.tsx:6`, `TaskList.tsx:4`: constructor đăng ký thêm `tabs.onUpdated` trong popup ⇒ trigger gửi trùng. Sửa: tách client gửi message khỏi scheduler.
- **M19. `onMessage` background không `.catch`** — `background/index.ts:24-75`: promise reject ⇒ không `sendResponse`; popup fallback gọi `scheduleTask` lần nữa ⇒ có thể thêm task 2 lần.

---

## 4. Lỗi THẤP (Đợt 2)

- **L1. Ô giờ nhập sai âm thầm thành giá trị khác** — `ScheduleForm.tsx:103-109`, `FloatingHUD.tsx:305-310`: "12:60" → 12:00:00, "abc"/"24:00" → 00:00:00; key `invalidTimeFormat` không dùng.
- **L2. URL tuỳ chỉnh không kiểm scheme** — `ScheduleForm.tsx:164-173`, background `SCHEDULE_TASK` (`index.ts:47-54`): nhận `javascript:`, `file:`, `chrome://`. Chỉ nhận http(s).
- **L3. Hai bộ giờ flash sale lệch** — `ScheduleForm.tsx:27` `[0,9,12,18,21]` thiếu 15h; `SHOPEE_FLASH_HOURS` (`constants.ts:26`) có 15h.
- **L4. Lỗi `handleScheduleFromHUD` chỉ `console.warn`** — `FloatingHUD.tsx:457-459`.
- **L5. `handleOpenPageAndPick` không bắt lỗi `sendMessage`** — `ScheduleForm.tsx:139`.
- **L6. Badge giá đè lên HUD** — cùng `right:24px`, z-index tối đa.
- **L7. Adaptive lệch 1 nhịp** — `hunt_engine.ts:263-266` gọi `computeNextInterval` sau `clicks++`.
- **L8. Dwell/approach không như mô tả** — engine luôn click đồng bộ (`dispatchClick`, dwell = 0ms); `dispatchClickAsync`/`startBurst` không dùng; approach bỏ qua ở click đầu (`lastCursorPos` = (0,0), `human_clicker.ts:48`); mọi sự kiện `isTrusted=false`.
- **L9. Lặt vặt** — `state.clicks` không cập nhật khi săn; class `dh-target-highlight` không gỡ; key `dh_emergency_reloaded_*` tích luỹ trong `sessionStorage`; `hasArmedSession` so URL tuyệt đối (`index.tsx:37`).
- **L10. Shopee cài cứng trong lõi "universal"** — `isVoucherPage`, `shopeeBlockReason`, ping mặc định Shopee, `valueTokens` (k/đ/tr), heuristic card (`voucher|card|mission|reward|task`), adapter `includes("shopee.vn")`; adapter `findVoucherButtons`/`isButtonFinished` là code chết.
- **L11. Race ghi `dh_domain_calibrations`** — `storage.ts:59-67`; key toàn cục `dh_clock_calibration` bị domain đo gần nhất ghi đè.
- **L12. Accessibility** — nút đóng `PriceHistoryBadge.tsx:61-67` không `aria-label`; title "Minimize"/"Close" của HUD hardcode tiếng Anh (`FloatingHUD.tsx:791, 800`); thanh status không `aria-live`.
- **L13. Code dư** — state `hudPos`, `analyzingTarget`; import `Timer`, `ARMED_SESSION_KEY`, `CheckCircle2`, `formatVN`; class `animate-in fade-in…` không có plugin.

---

## 5. Bảo mật & quyền riêng tư

- **P1. Content script làm việc trên mọi trang** — đọc toàn bộ task/saved target, kích hoạt đo giờ (H5), tự bật HUD (M13), badge giá trên mọi URL chứa `-i.`/`/product/` (`content/index.tsx:85-89`) — background gọi API DealHunter kèm token mà không kiểm host là Shopee. Sửa theo §0.
- **P2. Nhật ký duyệt web vĩnh viễn** — `dh_domain_calibrations` (`storage.ts:59-67`) lưu mọi hostname đã vào kèm timestamp, không TTL; content script mọi site đọc được. Sửa: TTL 24h (§0).
- **P3. Quyền thừa** — `"tabs"` thừa (đã có `<all_urls>`); `dealhunter.vn`, `api.dealhunter.vn`, `localhost` trùng `<all_urls>`; `web_accessible_resources` mở `icons/*.png` cho `<all_urls>` ⇒ website phát hiện được extension. Sửa theo §0.
- **P4. Background `onMessage` không kiểm `sender`** — `index.ts:22`: content script bất kỳ gửi được `SCHEDULE_TASK` URL tuỳ ý hoặc `CALIBRATE_TIME` với `targetUrl` tuỳ ý (fetch bằng quyền `<all_urls>`, vượt CORS ⇒ vào intranet). Chỉ khai thác khi renderer bị chiếm quyền ⇒ Thấp; vẫn nên kiểm `sender.tab`/`sender.id` và validate URL.
- **P5. `externally_connectable` / `DEALHUNTER_WEB_ORIGINS`** — bản production vẫn tin `http://localhost:3000/3100`; **thiếu `https://www.dealhunter.vn`** (nginx và CORS có phục vụ www) ⇒ người dùng vào bản www không truyền được phiên sang extension.
- Đã ổn: không tin `window.postMessage` của trang; probe dùng `credentials: "omit"`; không tải code từ xa; token chỉ trong `chrome.storage.session` (content script không đọc được).

---

## 6. Tài liệu đã cũ (Đợt 3)

| Tài liệu | Tình trạng | Sai chính |
|---|---|---|
| `extension/README.md` | Cũ một phần | "Tự bật HUD trên mọi trang" (thực tế chỉ `/m/`, `/cart`, trang có target/task); nút mốc giờ thực tế `+10s`, `+30s`, `00:00`, `+1m`, `Custom` (không còn "Next flash"); form Schedule thực tế là ô HH:mm:ss + 3 chế độ `Current tab` / `Saved list` / `Custom link` (không còn Hub/10.10/Cart, "Use current page", ô keyword); test liệt kê `hunt_coordinator.ts` (không có test) và "Pro Gamer" (không có); gọi là "NTP" sai (thực tế đọc header `Date`); "dwell time"/Fitts không đúng đường săn thật; thiếu Save target, nút Schedule trong HUD, khôi phục target, resume sau reload, Price badge, kết nối web, phát hiện captcha/login. |
| `extension/e2e/README.md` + script | **Không chạy được** | `EXT` sai đường dẫn (thiếu `deal-hunter/`) trong `ext_semi.mjs:3`, `ext_full.mjs:3`; `ext_semi.mjs` tìm nhãn "Phut Toi", "Tro Chon Nut", "BAT SAN MA", "DA LUU MA" — không còn trong `i18n.ts`. |
| `docs/extension/huong-dan-su-dung.md` | Gần như cũ hẳn | Còn "3 chế độ click Stealth/Pro Gamer/Turbo" (đã bỏ, mặc định `adaptive`); mốc giờ và form Schedule như README; nhãn "Tu quet nut" (thực tế "Tự quét"), "Send one test click" (thực tế "Test click (1x)"/"Bấm thử 1 click"); "luôn mở tab mới" (thực tế dùng lại tab đang mở); "lọc task theo trạng thái" (không có); thiếu trạng thái "Đã hủy"; bảng mục 7 gán dual-defense cho `hunt_engine`/`target_diagnostics` (thực tế pre-warm ở `scheduler.ts`, chẩn đoán không được dùng); Q1 cũ (popup đã tự inject). |
| `docs/extension/kien-truc-universal-sniper-va-state-machine.md` | Cũ một phần | Sơ đồ đặt `TargetDiagnostics` dưới HuntEngine (thực tế chỉ HUD gọi, kết quả không ai đọc); công thức Fitts không có trong code; dwell τ~N(35,8) không áp dụng; cận pha 2/3 sai (doc [65,130]/[95,180], code [70,130]/[100,190], thiếu micro-pause 65±15ms); "119/119 tests" (thực tế 120). Phần đúng: state machine hoàn tất, lead 150ms, reload khẩn cấp T+250ms, cửa sổ 10s sau reload, `isSamePageUrl`, `dh_armed_session`. Comment `hunt_engine.ts:52` và key `dualDefenseHint` nhắc "pre-warm reload T−15s" không tồn tại trong code. |
| `docs/README.md` | Cũ | Link `file:///Users/tien.dang/Workplace/reference/dealhunter/...` hỏng (thiếu `deal-hunter/`); thiếu file kiến trúc và `extension/README.md`; mô tả "bán tự động / tự động 100%" là mô hình cũ. |
| `README.md` (gốc) | Cũ (phần extension) | Không có mục extension hay link tới tài liệu extension. |
| `docs/plans/chrome-extension-assistant-and-fast-clicker.md` | Cũ | Sơ đồ HUD gọi `/vouchers` (thực tế badge gọi `/tracked-products` và `/comparison`); "35ms/click" (thực tế adaptive 60/95/140ms); form cũ; "giá đáy 30 ngày" (badge chỉ có giá hiện tại và chênh so best deal); "Biometric Mode", "ClickProfile", "Pro Gamer mặc định" đã bỏ; "119/119". |
| Kết nối extension ↔ web | **Chưa có tài liệu** | Cần ghi: `NEXT_PUBLIC_EXTENSION_ID` (web, `.env.example`) / `EXTENSION_ID` (`docker-compose.prod.yml`), danh sách origin trong `externally_connectable` + `DEALHUNTER_WEB_ORIGINS` (thêm www), API URL hợp lệ (`endpoints.ts:41-48`), token chỉ gửi tới `apiUrl` đi kèm. |

**i18n**: EN/VI cùng 202 khoá, không thiếu. **59 khoá không dùng** (popup: `accountConnected`, `signInSuffix`, `footerSafety`, `liveSniperBadge`, `shopeeTabActive`, `notOnShopeeTab`, `clockLatency`; form cũ: `dropTimeLabel`, `voucherHub`, `superSale1010`, `cartPage`, `customUrl`, `useCurrentTabUrl`, `targetMidnight`, `keyword*`, `recommended`, `nextSalePreset`, `noSavedTargetsFound`, `targetModeSaved`, `targetModeUrl`, `preWarm*`, `scheduleButton`; HUD: `shopeeServerTime`, `serverClockTitle`, `nextFlashSale`, `customTimePlaceholder`, `invalidTimeFormat`, `targetTimeLabel`, `targetDropLabel`, `targetPrefix`, `standbyReady`, `quick10sStandby`, `quick30sStandby`, `notPickedText`, `pickingButton`, `lockedButtonDefault`; đã gỡ khỏi UI: `diagnostics*`, `dualDefense*`, `analyzingTarget`, `standbyStateBadge`, `adaptiveEngine*`, `clickProfile*`). Chuỗi hardcode: "Member:", "Universal Web" (`App.tsx:324, 342`), "Full-Auto"/"Semi-Auto" (`TaskList.tsx:63`), "+1p"/"+1m", "Tự chọn"/"Custom" (`FloatingHUD.tsx:864-865`, khác `t.customTime` = "Tùy chỉnh"), "clicks", "Minimize", "Close". Ngữ cảnh còn "Shopee voucher sniper" (`appSubtitle`) dù sản phẩm là sniper đa trang. Chính tả: "Chuẩn đoán" → "Chẩn đoán" (`i18n.ts:387`). `I18N` khai báo `as const` không ràng buộc kiểu giữa 2 ngôn ngữ ⇒ thiếu khoá không bị `tsc` bắt.

---

## 7. Lỗ hổng test

- `hunt_engine.test`: mọi fixture có `id` (che lỗi relocate theo vị trí C2); không test chữ lúc chọn ≠ chữ lúc mở, trạng thái loading tạm thời, icon `ticket` (C1); test reload khẩn cấp để lại cờ `dh_emergency_reloaded_${DROP}` trong `sessionStorage` ⇒ test sau phụ thuộc thứ tự chạy.
- Không có test cho: `hunt_coordinator.ts` (arm trùng, disarm/task, resume), `content/index.tsx` (trigger đa nguồn, resume), `time_sync_client.ts`, `nextExactDropAt` sau giờ G, router `onMessage`, `onActivated`, listener `onUpdated`, đăng ký lại alarm, parse giờ / validate URL của `ScheduleForm`, HUD.
- `scheduler.test` (2 test): "custom preWarmSeconds" chỉ kiểm `when > now`; "reuses existing tab" khẳng định hành vi sai (khác query H7, gửi trigger ngay sau reload M2) và phụ thuộc giờ thật.
- `time_calibrator.test`: chưa test số request/ngân sách thời gian, fallback Shopee, `serverHost` sau fallback.
- `storage.test`: có test race cho settings nhưng không cho task; khẳng định bỏ qua query là đúng (H7).
- `timer_worker.test`: chỉ test `new Worker` throw đồng bộ. `human_clicker.test` test `dispatchClickAsync` — hàm engine không dùng. Test diagnostics kiểm `strategy` nhưng không chỗ nào dùng `strategy`.

---

## 8. Kế hoạch sửa

| Đợt | Nội dung | Ghi chú |
|---|---|---|
| **1 (bắt buộc trước khi dùng thật)** | C1–C5; H1–H7 | An toàn khi bấm (không báo sai, không bấm nhầm, không bấm khi chưa chọn nút), không chạy script trang, không phá CSS trang, lịch hẹn đúng ngày/đúng trang, huỷ đúng, đo giờ theo §0. |
| **2** | M1–M19, L1–L13, P1–P5 | Race lưu task, rò rỉ HUD, i18n trạng thái, quyền theo §0, thêm `www.dealhunter.vn`. |
| **3** | §6 tài liệu, §7 test, sửa script E2E | Viết lại 3 tài liệu extension + README theo code thật; thêm tài liệu kết nối web; xoá 59 khoá i18n thừa. |

Quy trình mỗi lỗi: viết test tái hiện → xác nhận fail trên code cũ → sửa → pass; chạy `npx tsc --noEmit -p .`, `npx vitest run`, `npm run build`.
