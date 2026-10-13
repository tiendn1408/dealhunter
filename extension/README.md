# DealHunter Assistant — Chrome Extension (Manifest V3)

Tiện ích Chrome giúp người dùng **bấm đúng một nút họ đã chọn, đúng giờ** trên bất kỳ trang web nào: lưu voucher Shopee/Lazada/Tiki/TikTok lúc 0:00, điểm danh Caffiliate, flash sale... Có săn trực tiếp trên trang (bảng săn / HUD) và hẹn giờ chạy nền (background tự mở trang và săn).

Người dùng là người không làm kỹ thuật. UI không có núm chỉnh kỹ thuật; thời gian (giờ server, lúc tải lại trang, lịch gửi điểm danh) đều được đo và tính tự động.

- Hướng dẫn cho người dùng: [`docs/extension/huong-dan-su-dung.md`](../docs/extension/huong-dan-su-dung.md)
- Kiến trúc chi tiết: [`docs/extension/kien-truc-universal-sniper-va-state-machine.md`](../docs/extension/kien-truc-universal-sniper-va-state-machine.md)

---

## 1. Build

Tại thư mục `extension/`:

```bash
npm install
npm run build        # bản phát hành
npm run build:dev    # bản dev (build một lần)
npm run dev          # bản dev, watch
```

Kết quả nằm ở `dist/`.

| Lệnh | Môi trường | Khác biệt |
| --- | --- | --- |
| `npm run build` | production | Chỉ tin `https://dealhunter.vn` và `https://www.dealhunter.vn`. API mặc định `https://dealhunter.vn/api/v1`. Manifest không có mục localhost. Không có simulator. |
| `npm run build:dev`, `npm run dev` | development | Thêm `http://localhost:3000`, `http://localhost:3100` (web), `http://localhost:8080` (API) và Caffiliate Bench simulator trên `:3100`. Phiên bản trong Cài đặt hiện «(bản dev)». |

- Chế độ dev được bật bởi `--mode development` hoặc biến môi trường `DH_ENV=development` (xem `vite.config.ts`). Cờ build là `__DH_DEV__`, đọc qua `IS_DEV_BUILD` trong `src/lib/build_env.ts`.
- `public/manifest.json` chứa cả mục localhost; bản production lọc bỏ chúng (khỏi `externally_connectable` và content scripts) bằng `productionManifest` trong `src/build/manifest_env.ts`.
- `npm run build` chạy `tsc`, rồi `vite build` (popup + background) và `vite build --config vite.content.config.ts` (content script).

## 2. Nạp vào Chrome

1. Mở `chrome://extensions`, bật **Developer mode**.
2. **Load unpacked** → chọn `extension/dist`.
3. Sau mỗi lần build: bấm reload ở thẻ extension, rồi tải lại các trang đang mở. HUD/badge cũ của content script trước được thay thế tự động (`data-dh-instance`).

## 3. Cấu trúc thư mục

```
extension/
├── popup.html
├── public/
│   ├── manifest.json
│   ├── caffiliate_bridge.js     # script chạy trong main world của trang Caffiliate
│   └── icons/
├── src/
│   ├── popup/                   # cửa sổ popup (React)
│   │   ├── App.tsx              # header, tab «Trang này» / «Lịch săn», Cài đặt
│   │   ├── page_actions.ts
│   │   └── components/          # HomePanel, TaskList, ScheduleForm, SettingsPanel, CheckInLog, TimeOffsetCard
│   ├── content/
│   │   ├── index.tsx            # gắn HUD / badge giá, nhận message từ popup/background
│   │   ├── platform_block.ts    # phát hiện trang yêu cầu xác minh / đăng nhập
│   │   ├── core/                # lõi săn: hunt_engine, hunt_coordinator, element_resolver,
│   │   │                        # human_clicker, human_biometrics, session_vault,
│   │   │                        # time_sync_client, timer_worker, target_diagnostics
│   │   ├── ui/                  # FloatingHUD (bảng săn), PriceHistoryBadge, status_text, style.css
│   │   └── adapters/            # shopee, lazada, tiki, tiktok, caffiliate (+ adapter_interface)
│   ├── background/              # service worker: index (router), scheduler, time_calibrator, web_session
│   ├── lib/                     # dùng chung: storage, i18n, drop_time, reload_timing, strike_plan,
│   │                            # checkin_log, url, endpoints, api_client, scheduler_client, build_env, types
│   └── build/manifest_env.ts    # bỏ mục localhost khỏi manifest ở bản production
├── e2e/                         # kịch bản E2E trên Chrome thật (Puppeteer)
├── tailwind.config.js           # CSS popup
├── tailwind.content.config.js   # CSS content (HUD/badge), xem bên dưới
├── vite.config.ts               # popup + background
├── vite.content.config.ts       # content script
└── vitest.config.ts
```

**CSS:** popup dùng `tailwind.config.js`. Content dùng `tailwind.content.config.js`: mọi class được scope dưới `#dealhunter-hud-root` / `#dealhunter-badge-root` / `.dh-root`, tắt preflight và `container`, keyframes có tiền tố `dh-`, để không ảnh hưởng CSS của trang gốc.

**UI text:** toàn bộ nhãn nằm trong `src/lib/i18n.ts` (`vi`, `en`). Ngôn ngữ mặc định theo ngôn ngữ trình duyệt.

## 4. Nguyên tắc thiết kế chính

Chi tiết xem [kien-truc-universal-sniper-va-state-machine.md](../docs/extension/kien-truc-universal-sniper-va-state-machine.md). Tóm tắt:

1. **Chỉ bấm nút người dùng đã chọn.** «Gợi ý giúp tôi» chỉ viền cam để gợi ý; người dùng phải xác nhận. Auto-scan có deny-list cho nút mua/thanh toán (kể cả «Mua ngay -50%»).
2. **Không đoán khi tìm lại nút.** `element_resolver.relocateUniversal`: tin id duy nhất; nếu không thì lọc theo chữ ký nội dung, xếp hạng theo độ giống, hoà thì dùng gợi ý cấu trúc, chỉ dùng vị trí khi rõ ràng duy nhất; còn lại thì không chọn gì.
3. **Xác nhận hoàn tất chặt chẽ.** Tín hiệu phải giữ 300 ms (1,5 s nếu tín hiệu duy nhất là nút bị disabled); bỏ qua toast có sẵn trước cú bấm đầu; không bấm khi đang chờ xác nhận. Chỉ adapter chắc chắn (Caffiliate, `confirmsCompletion`) kết thúc ngay.
4. **An toàn khi bấm.** Không bấm phát đầu vào nút đã hết; trang `speed_priority` tối đa một cú trước giờ T; sàn lớn (Shopee/Lazada/Tiki/TikTok) không bao giờ bấm trước giờ. Mọi đường bấm kiểm tra kích thước 0 và overlay che (`elementFromPoint`).
5. **Tải lại trang có đo đạc.** Reload trước giờ tại T − lead, với lead đo theo từng trang (`lib/reload_timing.ts`, mặc định 750 ms, kẹp 0,4–6 s). Reload cứu nút chết chỉ sau 600 ms không phản hồi, tối đa 3 lần trong [T, T+2,5 s].
6. **Phiên săn sống qua reload** nhờ vault phía extension (`chrome.storage.local` khoá `dh_armed_sessions`); `sessionStorage` chỉ giữ token ngẫu nhiên, trang không thể giả hay sửa phiên.
7. **Đo giờ chỉ khi cần.** Chỉ đo cho trang đang săn (HUD mở, phiên đang chờ, lịch hẹn) hoặc khi người dùng yêu cầu; dữ liệu theo domain tự xoá sau 24 h. Background probe HEAD favicon cách nhau 80 ms, chuyển sang trang chủ nếu favicon bị CDN cache; một lượt đo mỗi host; lượt đo hỏng không ghi đè kết quả tốt.
8. **Quyền tối thiểu.** Giữ `<all_urls>` nhưng HUD chỉ tự mở trên trang voucher/deal của sàn (Shopee, Lazada, Tiki, TikTok, Sendo, AliExpress, Taobao — khớp theo host thật) hoặc trang đã có nút lưu / lịch / phiên đang chờ. Badge giá chỉ trên trang sản phẩm của sàn. Không `web_accessible_resources`, không quyền `tabs`.
9. **Lịch săn chỉ do background ghi** qua read-modify-write có hàng đợi (`storage.mutateTasks`); content chỉ gửi `TASK_STATUS_UPDATE`. `targetAt` cố định mỗi task; alarm trễ → `missed`; task mỗi ngày tự chuyển sang lần kế tiếp sau mọi kết quả. Watchdog mỗi 5 phút + `onStartup`/`onInstalled` chạy `restorePendingAlarms` (tạo lại alarm thiếu, gộp task trùng trang/giờ/cờ mỗi ngày).
10. **Caffiliate** (`caffiliate.vn`, `*.caffiliate.vn`; thêm simulator `localhost:3100` ở bản dev): không reload. `public/caffiliate_bridge.js` chạy ≥5 lần thử theo kế hoạch `lib/strike_plan.ts` quanh 00:00; mỗi lần thử: hàm của trang → API với token/chữ ký của chính trang → bấm nút; dừng khi có xác nhận. Không giữ sẵn token Turnstile, không giả header. Mọi lượt ghi vào «Nhật ký điểm danh» (`lib/checkin_log.ts`).

## 5. Message

Message dùng trường `action` (hằng `MESSAGE_ACTIONS` trong `src/lib/constants.ts`).

**Gửi tới background** (`src/background/index.ts`):

| Action | Mục đích |
| --- | --- |
| `CALIBRATE_TIME` | Đo giờ server cho một URL đích (bắt buộc có URL, không có site mặc định). |
| `GET_CALIBRATION` | Đọc kết quả đo giờ đã lưu. |
| `TASK_STATUS_UPDATE` | Content báo trạng thái/kết quả của task. |
| `SCHEDULE_TASK` | Tạo lịch (cùng trang + cùng giờ thì cập nhật task đang chờ, không tạo trùng). |
| `UPDATE_TASK` | Sửa lịch (giờ, nút/trang, mỗi ngày, tải lại trước giờ). |
| `CANCEL_TASK` | Xoá lịch. |
| `OPEN_AND_PICK` | Mở/focus trang và bật chế độ chọn nút («Chọn lại nút trên trang», «Hoặc thêm nút mới» trong khung Hẹn giờ). |
| `GET_PRICE_CONTEXT` | Ngữ cảnh giá cho badge (chỉ URL trang sản phẩm của sàn). |
| `GET_WEB_SESSION` | Phiên đăng nhập DealHunter hiện tại. |

**Gửi tới content** (`src/content/index.tsx`):

| Action | Mục đích |
| --- | --- |
| `ACTIVATE_HUD` `{ pickTarget }` | Mở HUD, tuỳ chọn bật chế độ chọn nút. |
| `TRIGGER_FULL_AUTO` | Background giao task đã hẹn cho trang. |
| `CANCEL_TASK` | Dừng phiên săn của đúng task đó. |
| `GET_HUNT_STATE` | Popup hỏi trạng thái săn đang chạy trên trang. |

**Từ web DealHunter** (external, `externally_connectable`): `{ type: "DH_WEB_SESSION", accessToken, expiresAt, email, name, apiUrl, webUrl }` → trả `{ accepted }`; thiếu token = đăng xuất. Chi tiết: [ket-noi-web-extension.md](../docs/extension/ket-noi-web-extension.md).

## 6. Kiểm thử

```bash
npx vitest run          # 30 file, 298 test (happy-dom)
npx tsc --noEmit -p .   # kiểm tra kiểu
```

`npm test` tương đương `vitest run`. Test chạy ở chế độ development (`vitest.config.ts`); `src/lib/production_build.test.ts` kiểm tra cấu hình bản phát hành.

**E2E trên Chrome thật:** xem [`e2e/README.md`](e2e/README.md) (Puppeteer nạp `dist/`).

## 7. Tài liệu liên quan

| Tài liệu | Nội dung |
| --- | --- |
| [huong-dan-su-dung.md](../docs/extension/huong-dan-su-dung.md) | Hướng dẫn cho người dùng cuối. |
| [kien-truc-universal-sniper-va-state-machine.md](../docs/extension/kien-truc-universal-sniper-va-state-machine.md) | Kiến trúc lõi săn và máy trạng thái. |
| [ket-noi-web-extension.md](../docs/extension/ket-noi-web-extension.md) | Kết nối web ↔ extension (phiên đăng nhập). |
| [ra-soat-loi-va-ke-hoach-sua.md](../docs/extension/ra-soat-loi-va-ke-hoach-sua.md) | Biên bản rà soát lỗi và kế hoạch sửa. |
