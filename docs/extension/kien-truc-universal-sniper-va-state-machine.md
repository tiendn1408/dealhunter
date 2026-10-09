# Kien Truc Universal Sniper va May Trang Thai Hanh Vi (Behavioral State Machine)

Tai lieu nay mo ta chi tiet kien truc ky thuat, thuat toan loi, va luong xu ly dong bo cua he thong **DealHunter Universal Sniper** tren Chrome Extension (Manifest V3).

Cap nhat: 2026-10-09 · Dong bo voi ban build production va 179 unit tests.

---

## 1. Tong Quan Kien Truc Loi

He thong Sniper duoc xay dung dua tren cac thanh phan cot loi duoc to chuc ro rang:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HuntCoordinator (SSOT)                          │
│     (Quan ly trang thai tap trung, dieu phoi Arm manual va Schedule)   │
└──────────────▲──────────────────────────────────────────▲──────────────┘
               │                                          │
    Floating HUD (Manual UI)                  Background Scheduler (Auto)
               │                                          │
               ▼                                          ▼
       TargetDiagnostics                         chrome.alarms (MV3)
   (Static vs Reactive Analyzer)                 (Pre-warm tab o T-60s)
               │                                          │
               └────────────────────┬─────────────────────┘
                                    ▼
                             HuntEngine (Loi)
                 (Ticker 10ms, Timing Window, Adaptive Loop)
                                    │
                     ┌──────────────┴──────────────┐
                     ▼                             ▼
              ElementResolver                 HumanClicker
         (Behavioral State Machine)    (W3C Pointer Events Level 3)
```

1. **`HuntCoordinator`**: Single Source of Truth quan ly phien san, dong bo giua Floating HUD truc quan tren man hinh va Background Scheduler hen gio tu dong. Xu ly hop nhat phien (task adoption) va tiep noi phien sau khi reload trang thong qua `sessionStorage`.
2. **`HuntEngine`**: Co che click don dap adaptive sieu toc dua tren `WorkerTimer` (10ms tick), dieu phoi thoi gian lead (150ms truoc gio G), timing window (8000ms mac dinh, mo rong 10000ms sau reload) va co che phong thu kep.
3. **`TargetDiagnostics`**: Bo phan tich do tuong thich SPA (React/Vue/Angular), phan biet trang tinh va trang reactive de xac dinh chien luoc `dualDefenseReload` (tat reload tu dong tren cac trang SPA nhu Shopee).
4. **`ElementResolver`**: Thuat toan nhan dien phan tu, theo doi nut xuyen suot virtual DOM/React re-render va danh gia ket qua hoan tat dua tren may trang thai hanh vi khong phu thuoc ngon ngu.
5. **`HumanClicker`**: Phat chuoi su kien W3C Pointer Events Level 3 day du voi toa do Gauss 2 chieu tap trung trong tam nut va thoi gian tiep xuc phim vat ly (dwell time).

---

## 2. Loai Bo Triet De Hardcoded Text — May Trang Thai Hanh Vi

Toan bo cac regex tu dien van ban truoc day (`đã lưu`, `hết lượt`, `claimed`, `sold out`) da duoc go bo 100% va thay the bang **May trang thai hanh vi (Behavioral State Machine)** ket hop cac tieu chuan W3C DOM va HTML5:

### 2.1. Nhan dien ket qua sau khi click (Behavioral Mutations)
Khi da thuc hien it nhat 1 cu click ($clicksCount \ge 1$), trang thai hoan tat duoc xac dinh thong qua su bien doi thuc te cua phan tu trong DOM:

- **DOM Detachment / Unmount**: Neu `!button.isConnected`, phan tu da bi go khoi cay DOM (modal dong lai, card voucher duoc luu va bien mat). Ket qua: `saved`.
- **Idempotency Transition**: Neu phan tu chuyen sang `disabled`, `aria-disabled="true"`, hoac nhan class `.disabled` sau chuoi click. Day la co che chong click lap chuan cua cac he thong frontend. Ket qua: `saved`.
- **Text Mutation (Bien doi noi dung chu)**: Loai bo cac chuoi dem nguoc thoi gian (`\d{1,2}:\d{2}`) va so sanh `cleanCurrent !== cleanInitial`. Neu chu tren nut bien doi ngay sau khi click, he thong ghi nhan trang web da tiep nhan va phan hoi tuong tac thanh cong.
- **Subtree Icon Injection**: Kiem tra viec chen moi the SVG hoac bieu tuong mang ngu nghia hoan thanh (`check`, `tick`, `success`, `done`) vao ben trong nut hoac voucher card.
- **Voucher Card Behavioral Transition**: Kiem tra su bien doi cua toan bo container (`findVoucherContainer`) qua `getButtonState(card)`:
  - Chuyen sang `saved` khi the nhan them SVG icon hoan tat hoac dat trang thai `saved`.
  - Chuyen sang `exhausted` khi thanh tien do day (`progress[value="100"]`, `[aria-valuenow="100"]`, `[data-stock="0"]`) hoac class trang thai can kiet.

### 2.2. Xac nhan thong qua Toast / Notification / Live Region toan trang
Ham `checkPageToastConfirmation` quet cac vung thong bao noi tren toan trang (`[role="alert"]`, `[role="status"]`, `.toast`, v.v.) hoan toan doc lap voi ngon ngu (hoat dong tren moi phien ban Shopee / Lazada / Tiki quoc te):
- **Thanh cong (`saved`)**:
  - Phat hien SVG icon hoan tat: `hasCompletionIcon(el)` (duong dan path hoac class chua `check`, `tick`, `success`, `done`).
  - Hop dong du lieu HTML5: `data-type="success"` hoac `data-status="success"`.
  - Code tokens quoc te: `success`, `is-success`, `positive`, `completed`, `toast-success`, `alert-success`.
  - Vung cap nhat dong W3C ARIA: `role="status"` duoc kich hoat thong bao sau tuong tac.
- **Het luot / Can kiet (`exhausted`)**:
  - Phat hien icon loi/canh bao: SVG/Icon chua `warning`, `error`.
  - Hop dong du lieu HTML5: `data-type="error|warning|exhausted|depleted"`.
  - Code tokens: `error`, `is-error`, `warning`, `danger`, `exhausted`, `depleted`.

### 2.3. Danh gia trang thai truoc khi click (Pre-existing State Contracts)
Doi voi cac nut da luu hoac het luot truoc khi bat dau san:

- **Chuan W3C ARIA**: `aria-pressed="true"`, `aria-checked="true"`, `aria-selected="true"`.
- **Hop dong du lieu HTML5**: `data-state="checked"|"success"|"completed"|"saved"|"done"` va `data-status="success"|"completed"|"saved"`.
- **CSS Code Tokens**:
  - Hoan thanh: `completed`, `is-saved`, `btn-saved`, `claimed`, `checked`, `done`.
  - Can kiet: `exhausted`, `expired`, `soldout`, `sold-out`, `unavailable`, `ended`, `depleted`, `out-of-stock`.
  - Quota meter: `progress[value="100"]`, `[role="progressbar"][aria-valuenow="100"]`, `[data-stock="0"]`.
- **Loai tru phan tu phu (Secondary Elements)**:
  - W3C Dialog Opener: `aria-haspopup="dialog"`, `aria-haspopup="true"`.
  - Accordion trigger: `aria-expanded`, `aria-controls`.
  - The lien ket dieu huong: `role="link"`, the `<a>` co `href`.
  - Class phu tro: `secondary`, `detail`, `terms`, `condition`, `rules`, `info`, `more`, `dismiss`, `cancel`, `close`.

### 2.4. Chuan doan Standby trong TargetDiagnostics
Trang thai cho gio mo deal duoc danh gia khach quan qua:
- Bo dem gio trong container: Co chuoi thoi gian `\d{1,2}:\d{2}(?::\d{2})?`.
- Thuoc tinh vo hieu hoa: `disabled`, `aria-disabled="true"`, hoac class `.disabled`.
- Code tokens: `data-status="upcoming"|"standby"` hoac class `upcoming`, `standby`, `countdown`, `waiting`.

---

## 3. Thuat Toan Mo Phong Sinh Trac Hoc & Dieu Khien Co Hoc (Human Biometrics & Motor Control)

De loai bo cac dau vet tu dong hoa (automation signatures) ma cac he thong phong ve hien dai (DataDome, Cloudflare Turnstile, Shopee Risk Engine) quet va phat hien bot, he thong trien khai bo thuat toan sinh trac hoc toan dien tai [`human_biometrics.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/human_biometrics.ts):

### 3.1. Thuat toan bien doi Box-Muller (Phan phoi Gaussian cho thoi gian)
Hanh vi van dong cua con nguoi luon co phuong sai tu nhien tuan theo phan phoi Gauss $X \sim \mathcal{N}(\mu, \sigma^2)$:
$$Z_0 = \sqrt{-2 \ln(U_1)} \cos(2\pi U_2)$$
$$\Delta t = \mu + Z_0 \cdot \sigma$$
Trong do $U_1, U_2 \in (0, 1)$ la hai bien ngau nhien dong deu. Khoang cach giua hai lan click duoc tinh toan dong sau tung nhip va bi chan boi nguong sinh hoc $[t_{min}, t_{max}]$.

### 3.2. Phan bo diem cham 2 chieu (2D Bivariate Gaussian Spatial Distribution)
Nguoi that khong bao gio click vao cung mot toa do diem anh duy nhat va cung khong rai deu dong nhat. Mat va tay tap trung vao trong tam nut:
$$X_{rel} \sim \mathcal{N}(0.5, 0.10^2), \quad Y_{rel} \sim \mathcal{N}(0.5, 0.10^2)$$
Toa do thuc te duoc tinh dua tren bounding box:
$$\text{clientX} = \text{rect.left} + \text{rect.width} \cdot X_{rel}$$
$$\text{clientY} = \text{rect.top} + \text{rect.height} \cdot Y_{rel}$$
Voi $X_{rel}, Y_{rel} \in [0.25, 0.75]$ dam bao con tro luon nam trong vung an toan cua phan tu.

### 3.3. Quy dao tiep can chuot Cubic Bezier theo Dinh luat Fitts
O cu click dau tien, he thong mo phong quy dao tiep can tu vi tri truoc do:
$$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3, \quad t \in [0, 1]$$
Dinh luat Fitts (Ease-Out Deceleration): Tham so $t$ duoc phan bo phi tuyen $t = 1 - (1 - \text{linearT})^2$, mo phong giam toc tu nhien khi con tro tien sat nut muc tieu kem cac su kien trung gian `pointermove` va `mousemove`.

### 3.4. Chuan hoa phan cung W3C Pointer Events Level 3
Moi click deu phat day du chuoi su kien phan cung:
- `pointerId: 1`
- `pointerType: "mouse"`
- `isPrimary: true`
- `pressure: 0.5` o pha `pointerdown`, `0.0` o pha `pointerup`
- `buttons: 1` khi de chuot, `buttons: 0` khi nha chuot
- `button: 0`, `which: 1`, `detail: 1`
- `bubbles: true`, `cancelable: true`, `composed: true`

### 3.5. Dong co dinh hinh dong hoc tu thich ung 3 pha (Autonomous Adaptive Kinetic Engine)
Dong co tu dong dieu chinh chu ky $\Delta t$ dua tren so luong click thuc te ma khong yeu cau nguoi dung phai chon che do thu cong:

```
[Gio G] ─────────────────────────────────────────────────────────────────►
├── Pha 1: But toc gio G (Clicks 1-3)
│   μ = 60ms, σ = 10ms (gioi han [45ms, 80ms]) -> Giat deal trong cua so vang
├── Pha 2: Gian nhip thich ung (Clicks 4-8)
│   μ = 95ms, σ = 16ms (gioi han [70ms, 130ms])
│   + Vi nghi phuc hoi co hoc 65ms ± 15ms truoc click 4 -> Pha vo chu ky bot
└── Pha 3: On dinh dai han (Clicks 9+)
    μ = 140ms, σ = 22ms (gioi han [100ms, 190ms])
    + Vi nghi dinh ky moi 5 clicks -> Bao ve tai khoan an toan
```

Thuat toan tinh pacing duoc dong bo chat che (`computeNextInterval(profile, 1)` o nhip dau va `computeNextInterval(profile, clicks + 1)` sau moi click), dam bao vi nghi phuc hoi co hoc xuat hien chinh xac ngay truoc cu click thu 4.

### 3.6. Loai bo gioi han 80 clicks co dinh (Dynamic Window Pacing)
- Truoc day he thong ton tai gioi han gia tao `maxClicks: 80`. Gioi han nay da duoc go bo hoan toan (`maxClicks: Infinity` theo mac dinh).
- Phien san duoc dieu phoi hoan toan boi:
  1. Cua so san vang thuc te (`windowMs: 8000ms`, hoac 10000ms neu reload phong thu kep).
  2. Nhip sinh hoc cua Dong co Kinetic 3 pha: Tu dong giam tan suat va nghi ngoi hop ly nhu thao tac tay con nguoi.
  3. May trang thai phan ung tu nhien: Dung ngay khi voucher duoc xac nhan da luu (`saved`) hoac het hang (`exhausted`).

---

## 4. Thong Nhat 100% Giua Arm Sniper va Schedule

Hai che do "Arm Sniper" (kich hoat truc tiep tren Floating HUD) va "Schedule" (hen gio ngam tu Background) chia se cung mot co che cot loi thong qua `HuntCoordinator`:

```
[User bam Arm tren HUD] ──────────┐
                                  ├──► HuntCoordinator.arm() ────────► HuntEngine
[Alarm Scheduler kich hoat] ──────┴──► HuntCoordinator.armFromTask() ──┘
```

1. **Quan ly phien tap trung**: `HuntCoordinator` dam bao tai mot thoi diem chi co duy nhat 1 instance `HuntEngine` hoat dong tren tab. Neu co phien manual cung thoi diem, he thong tu dong gop phien ma khong huy ngang.
2. **Bao toan phien qua Reload (`sessionStorage`)**:
   - Khoa session `dh_armed_session` luu tru target descriptor, thoi gian muc tieu va thong tin task.
   - Khi tab reload, content script kiem tra va tiep tuc phien san ngay lap tuc ma khong lam mat vi tri nut.
3. **So khop URL chuan hoa (`isSamePageUrl`)**:
   - So sanh ca origin, pathname, hash route va query parameters (loai tru rieng cac tham so tiep thi `utm_*`, `fbclid`).
   - Ngan ngua tinh trang nhan dien sai tab khi nguoi dung mo nhieu trang su kien khac nhau.

---

## 5. Co Che Tu Toi Uu Phong Thu Kep (Dual-Defense Reload)

### 5.1. Quy trinh hoat dong
1. **Pre-warm (T-60s tu Background Scheduler)**:
   - Danh thuc service worker qua `chrome.alarms`.
   - Tai su dung tab hop le (`isSamePageUrl`) hoac mo tab moi.
   - Cho su kien `tabs.onUpdated` chuyen sang `status === "complete"` truoc khi gui tin nhan kich hoat de tranh race condition.
2. **Emergency Reload (T+250ms trong HuntEngine)**:
   - Chi ap dung khi:
     - Thoi gian da qua gio G 250ms.
     - So luot click hien tai bang 0 va nut van bi vo hieu hoa (stale DOM tren trang tinh).
     - Nhiem vu cho phep reload (`task.dualDefenseReload !== false`).
     - Trang khong phai la reactive SPA (`diagnostics.strategy !== "reactive_no_reload"`).
3. **Cua so mo rong 10 giay sau reload**:
   - Dat co `dh_emergency_reloaded_${DROP}` trong `sessionStorage`.
   - Mo rong cua so thoi gian len 10,000ms de bu tru thoi gian tai lai ma HTML va API.
   - Khoa chong lap vo han: chi reload toi da 1 lan duy nhat cho moi moc gio.

---

## 6. Bao Mat va Quan Ly Du Lieu

1. **Don dep domain calibrations (P2 & L11)**:
   - Du lieu can chinh gio cua tung domain duoc quan ly qua chuoi Promise `calibrationWrites` trong `src/lib/storage.ts`.
   - Tu dong loc va xoa cac domain calibration da qua 24 gio (>86,400,000 ms) moi lan ghi du lieu, tranh luu lai lich su duyet web lau dai.
2. **Kiem tra URL nghiem ngat (L2 & P4)**:
   - Ham `isValidHttpUrl` tu choi tat ca cac giao thuc phi cau truc (`javascript:`, `file:`, `chrome://`, `data:`, `blob:`, `about:`).
3. **Xac thuc tin nhan Service Worker**:
   - Background kiem tra nguon tin nhan `sender.id === chrome.runtime.id` va chan ket noi trai phep tu cac extension khac.
   - Thiet lap `externally_connectable` trong `manifest.json` chi ket noi voi cac origin tin cay duoc phep (`DEALHUNTER_WEB_ORIGINS`).

---

## 7. Quy Chuan Chat Luong va Kiem Thu

- **Unit Tests**: 179/179 tests pass tren 17 test suites (`npx vitest run`).
- **Type Checking**: Clean 100% khong loi qua `npx tsc --noEmit`.
- **Production Build**: Bien dich hoan tat sach se `popup.js`, `background.js`, `content.js` va `content.css`.
- **Zero-Emoji**: Tuyet doi khong su dung emoji trong ma nguon, log, test va tai lieu.
