# Kien Truc Universal Sniper va May Trang Thai Hanh Vi (Behavioral State Machine)

Tai lieu nay mo ta chi tiet kien truc ky thuat, thuat toan loi, va luong xu ly dong bo cua he thong **DealHunter Universal Sniper** tren Chrome Extension (Manifest V3).

---

## 1. Tong Quan Kien Truc Loi

He thong Sniper duoc xay dung dua tren 4 thanh phan cot loi:

```
┌─────────────────────────────────────────────────────────────┐
│                    HuntCoordinator (SSOT)                   │
│   (Quan ly trang thai tap trung, dieu phoi Arm va Schedule) │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
      Floating HUD (Manual)        Background Scheduler (Auto)
               │                              │
               └──────────────┬───────────────┘
                              ▼
                      HuntEngine (Loi)
            (Ticker 10ms, Timing Window, Burst Loop)
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
       ElementResolver               TargetDiagnostics
   (Behavioral State Machine)      (Static/Reactive Analyzer)
```

1. **`HuntCoordinator`**: Single Source of Truth quan ly phien san, dong bo giua HUD truc quan tren man hinh va Background Scheduler hen gio tu dong.
2. **`HuntEngine`**: Co che click don dap sieu toc dua tren WorkerTimer (10ms tick), dieu phoi thoi gian lead (150ms truoc gio G), window timeout va co che phong thu kep.
3. **`ElementResolver`**: Thuat toan nhan dien phan tu, theo doi nut xuyen suot virtual DOM/React re-render va danh gia trang thai hoan thanh bang may trang thai hanh vi.
4. **`TargetDiagnostics`**: Bo phan tich do tuong thich SPA (React/Vue/Angular), bo dem thoi gian live trong DOM va chien luoc reload tu dong toi uu.

---

## 2. Loai Bo Triet De Hardcoded Text — Chuyen Sang May Trang Thai Hanh Vi

Truoc day, he thong su dung cac regex tu dien ngon ngu de kiem tra chu tren nut (`đã lưu`, `hết lượt`, `claimed`, `sold out`, `xem chi tiết`). Cach lam nay khong the mo rong va de bi loi khi website thay doi van ban.

Toan bo cac regex tu dien da duoc loai bo 100% va thay the bang **May trang thai hanh vi (Behavioral State Machine)** ket hop cac chuan W3C DOM va HTML5:

### 2.1. Nhan dien ket qua sau khi click (Behavioral Mutations)
Khi da thuc hien click ($clicksCount \ge 1$), trang thai hoan thanh duoc xac dinh bang su bien doi thuc te cua phan tu:

- **DOM Detachment / Unmount**: Neu `!button.isConnected`, phan tu da bi go khoi cay DOM (popup dong lai, card voucher duoc luu va bien mat). Ket qua: `saved`.
- **Idempotency Transition**: Neu phan tu chuyen sang `disabled`, `aria-disabled="true"`, hoac nhan class `.disabled` sau click. Day la co che chong click dup chuan cua ung dung web. Ket qua: `saved`.
- **Text Mutation (Bien doi nhan)**: Loai bo cac chuoi dem gio (`\d{1,2}:\d{2}`) va so sanh `cleanCurrent !== cleanInitial`. Neu nhan phan tu thay doi ngay sau chuoi click, he thong ghi nhan ung dung da tiep nhan va phan hoi tuong tac thanh cong.
- **Subtree Icon Injection**: Kiem tra viec chen moi the SVG hoac icon mang ngu nghia thanh cong (`check`, `tick`, `success`, `done`) vao ben trong nut.

### 2.2. Danh gia trang thai truoc khi click (Pre-existing State Contracts)
Doi voi cac nut da luu hoac het luot truoc khi bat dau san:

- **Chuan W3C ARIA**: `aria-pressed="true"`, `aria-checked="true"`, `aria-selected="true"`.
- **Hop dong du lieu HTML5**: `data-state="checked"|"success"|"completed"|"saved"|"done"` va `data-status="success"|"completed"|"saved"`.
- **CSS Code Tokens**:
  - Hoan thanh: `completed`, `is-saved`, `btn-saved`, `claimed`, `checked`, `done`.
  - Can kiet: `exhausted`, `expired`, `soldout`, `sold-out`, `unavailable`, `ended`, `depleted`, `out-of-stock`.
  - Quota meter: `progress[value="100"]`, `[role="progressbar"][aria-valuenow="100"]`, `[data-stock="0"]`.
- **Loc phan tu phu (Secondary/Details Elements)**:
  - Dua tren W3C Dialog Opener: `aria-haspopup="dialog"`, `aria-haspopup="true"`.
  - Accordion trigger: `aria-expanded`, `aria-controls`.
  - Lien ket dieu huong: `role="link"`, the `<a>` co `href`.
  - Class phu tro: `secondary`, `detail`, `terms`, `condition`, `rules`, `info`, `more`, `dismiss`, `cancel`, `close`.

### 2.3. Chuan doan Standby trong TargetDiagnostics
Loai bo hoan toan regex chu "sap mo" hay "coming soon". Trang thai cho duoc danh gia qua:
- Bo dem gio toan hoc: Co chuoi thoi gian `\d{1,2}:\d{2}(?::\d{2})?` trong container.
- Thuoc tinh vo hieu hoa: `disabled`, `aria-disabled="true"`, hoac class `.disabled`.
- Code tokens: `data-status="upcoming"|"standby"` hoac class `upcoming`, `standby`, `countdown`, `waiting`.

---

## 3. Thuat Toan Mo Phong Sinh Trac Hoc & Dieu Khien Co Hoc (Human Biometrics & Motor Control Engine)

De loai bo triet de cac dau vet tu dong hoa (automation signatures) ma cac he thong phong ve hien dai (DataDome, Cloudflare Turnstile, PerimeterX, Shopee Risk Engine) thuong quet va chan bot, he thong DealHunter trien khai bo thuat toan sinh trac hoc toan dien tai [`human_biometrics.ts`](file:///Users/tien.dang/Workplace/reference/deal-hunter/dealhunter/extension/src/content/core/human_biometrics.ts):

### 3.1. Thuat toan bien doi Box-Muller (Phan phoi chuan Gaussian cho thoi gian)
- **Nguyen ly**: May moc thuong click voi chu ky co dinh $\Delta t = 35\text{ms}$ ($\sigma \approx 0$). Hanh vi van dong cua con nguoi luon co phuong sai tu nhien tuan theo phan phoi Gauss $X \sim \mathcal{N}(\mu, \sigma^2)$.
- **Cong thuc Box-Muller**:
  $$Z_0 = \sqrt{-2 \ln(U_1)} \cos(2\pi U_2)$$
  $$\Delta t = \mu + Z_0 \cdot \sigma$$
  Trong do $U_1, U_2 \in (0, 1)$ la hai bien ngau nhien dong deu. Khoang cach giua hai lan click duoc tinh toan dong sau tung nhip, bi chan duoi va tren boi nguong sinh hoc $[t_{min}, t_{max}]$.

### 3.2. Phan bo diem cham 2 chieu (2D Bivariate Gaussian Spatial Distribution)
- **Nguyen ly**: Con nguoi khong bao gio click vao cung mot toa do diem anh, va cung khong rai deu dong nhat tren hinh chu nhat cua nut. Mat va tay nguoi tap trung vao trong tam nut.
- **Cong thuc**:
  $$X_{rel} \sim \mathcal{N}(0.5, 0.10^2), \quad Y_{rel} \sim \mathcal{N}(0.5, 0.10^2)$$
  Toa do vat ly duoc tinh dua tren bounding box:
  $$\text{clientX} = \text{rect.left} + \text{rect.width} \cdot X_{rel}$$
  $$\text{clientY} = \text{rect.top} + \text{rect.height} \cdot Y_{rel}$$
  Voi $X_{rel}, Y_{rel} \in [0.25, 0.75]$ nham dam bao con tro luon nam trong vung an toan cua phan tu.

### 3.3. Quy dao tiep can chuot Cubic Bezier theo Dinh luat Fitts (Fitts's Law)
- **Nguyen ly**: Chuot cua nguoi that khong bao gio "dich chuyen tuc thoi" (teleportation) den nut bam. Phai co quy dao tiep can tu vi tri truoc do.
- **Phuong trinh duong cong Bezier bac ba**:
  $$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3, \quad t \in [0, 1]$$
  Cac diem kiem soat $P_1, P_2$ duoc bo sung do lech rung tay tu nhien (hand tremor) vuong goc voi huong di chuyen.
- **Dinh luat Fitts (Ease-Out Deceleration)**: Thoi gian di chuyen $T = a + b \log_2(2D / W)$. Tham so thoi gian $t$ duoc phan bo phi tuyen tinh $t = 1 - (1 - \text{linearT})^2$, mo phong hien tuong giam toc tu nhien khi dau ngon tay tien sat vao nut muc tieu. Cac su kien `pointermove` va `mousemove` trung gian duoc phat doc theo quy dao.

### 3.4. Chuan hoa phan cung W3C Pointer Events Level 3
- Khi phat su kien gia lap, he thong dam bao day du cac thuoc tinh phan cung ma cac script chong bot (nhu FingerprintJS hay DataDome telemetry) kiem tra:
  - `pointerId: 1`
  - `pointerType: "mouse"`
  - `isPrimary: true`
  - `pressure: 0.5` o pha `pointerdown`, `0.0` o pha `pointerup`
  - `buttons: 1` khi de chuot, `buttons: 0` khi nha chuot
  - `button: 0`, `which: 1`, `detail: 1`
  - `bubbles: true`, `cancelable: true`, `composed: true`

### 3.5. Mo phong thoi gian tiep xuc phim vat ly (Dwell Time / Contact Duration)
- Con nguoi nhan nut luon co mot do tre tiep xuc giua luc an xuong (`mousedown`) va luc nha len (`mouseup`), thuong la $25\text{ms} - 70\text{ms}$ ($\tau \sim \mathcal{N}(35, 8)\text{ms}$).
- Script bot thuong phat `mousedown` va `mouseup` trong cung 1 tick voi $\Delta t = 0\text{ms}$, lap tuc bi he thong kiem tra `e.timeStamp` nhan dien. `HumanClicker` ho tro ca phuong thuc dong bo va bat dong bo (`dispatchClickAsync`) de duy tri dwell time thuc te.

### 3.6. Co che moi co va ngat nhip sinh hoc (Neuromuscular Fatigue & Burst Cadency)
- Cu sau moi chuoi $N$ lan click lien tuc ($N \in [4, 7]$), he thong tu dong chen mot vi nghi sinh hoc (micro-pause) khoang $40\text{ms} - 80\text{ms}$, pha vo hoan toan bat ky thuat toan phan tich chu ky tuan hoan (Autocorrelation) nao cua bot detector.

### 3.7. Thuat toan dinh hinh dong hoc tu thich ung (Autonomous Adaptive Kinetic Shaping Engine)

De loai bo hoan toan ganh nang lua chon che do cho nguoi dung cuoi (khong bat nguoi dung phai do doan giua toc do va an toan), DealHunter trien khai **Dong co dinh hinh dong hoc tu dong 3 pha (3-Phase Biological Kinetic Envelope)** lam thuat toan chuan mac dinh:

```
[Gio G] ───────────────────────────────────────────────────────────────►
├── Pha 1: But toc gio G (Clicks 1-3)
│   μ = 60ms, σ = 10ms (~14-16 CPS) -> Giat deal trong cua so vang mili-giay
├── Pha 2: Gian nhip thich ung (Clicks 4-8)
│   μ = 95ms, σ = 16ms + Vi nghi phuc hoi co (50ms ± 12ms) -> Chong WAF rate-limit
└── Pha 3: On dinh dai han (Clicks 9+)
    μ = 140ms, σ = 22ms + Vi nghi dinh ky moi 5 clicks -> Bao ve tai khoan tuyet doi
```

#### Chi tiet 3 pha sinh hoc:
1. **Pha 1 — Surge (But toc gio G, Clicks 1 – 3)**:
   - Thoi gian phan xa ban tay o trang thai tap trung cao do: $\mu = 60\text{ms}, \sigma = 10\text{ms}$ (gioi han $[42\text{ms}, 80\text{ms}]$).
   - Dat toc do cuc dai ~14 – 16 CPS ngay tai thoi diem mo deal de tranh tinh trang het suat vi cham chan vai chuc mili-giay.
2. **Pha 2 — Adaptation (Gian nhip thich ung, Clicks 4 – 8)**:
   - Khi server chua tra ket qua sau 3 click dau, thuat toan tu dong nhan dien nguy co va mo rong chu ky: $\mu = 95\text{ms}, \sigma = 16\text{ms}$ (gioi han $[65\text{ms}, 130\text{ms}]$).
   - Chen mot vi nghi phuc hoi co $50\text{ms} \pm 12\text{ms}$ ngay tai click thu 4, pha vo hoan toan pho tu tuong quan (Autocorrelation) cua bo loc bot.
3. **Pha 3 — Steady (On dinh dai han, Clicks > 8)**:
   - Chuyen ve chu ky on dinh cua nguoi that: $\mu = 140\text{ms}, \sigma = 22\text{ms}$ (gioi han $[95\text{ms}, 180\text{ms}]$).
   - Chen vi nghi phuc hoi dinh ky sau moi 5 click. Bao ve tai khoan an toan tuyet doi trong cac dot xep hang cho dai hoi cua trang thanh toan.

#### Bang thong so cac profile ho tro trong loi dong co:

| Profile | Toc do trung binh | Chu ky $\Delta t$ ($\mu \pm \sigma$) | Dwell Time | Co che hoat dong |
|---|---|---|---|---|
| **Adaptive (Mac dinh)** | **Tu dong 3 pha** | Clicks 1-3: $60\text{ms} \pm 10\text{ms}$<br>Clicks 4-8: $95\text{ms} \pm 16\text{ms}$<br>Clicks > 8: $140\text{ms} \pm 22\text{ms}$ | $30\text{ms} \pm 8\text{ms}$ | **Tu dong thich ung 100%**: But toc cao do luc dau deal, tu gian nhip va chen vi nghi khi can keo dai thoi gian san. |
| **Stealth Human** | ~6 – 8 CPS | $\mu = 140\text{ms}, \sigma = 25\text{ms}$ | $55\text{ms} \pm 12\text{ms}$ | 100% toc do sinh hoc binh thuong cua nguoi dung thu cong khong voi va. |
| **Pro Gamer** | ~12 – 15 CPS | $\mu = 72\text{ms}, \sigma = 14\text{ms}$ | $32\text{ms} \pm 8\text{ms}$ | Mo phong ky thuat jitter clicking thi dau co phuong sai. |
| **Turbo Blitz** | ~20 – 25 CPS | $\mu = 40\text{ms}, \sigma = 8\text{ms}$ | $18\text{ms} \pm 5\text{ms}$ | Dua mili-giay toc do cao kem Gaussian jitter. |

---

## 4. Thong Nhat 100% Giua Arm Sniper va Schedule

Hai che do "Arm Sniper" (kich hoat truc tiep tren Floating HUD) va "Schedule" (hen gio ngam tu Background) chia se cung mot co che cot loi:

```
[User bam Arm tren HUD] ──────────┐
                                  ├──► HuntCoordinator.arm() ──► startHunt(Engine)
[Alarm Scheduler kích hoạt] ──────┴──► HuntCoordinator.armFromTask() ──┘
```

1. **Quan ly tap trung**: `HuntCoordinator` dam bao tai mot thoi diem chi co dung 1 instance `HuntEngine` chay tren tab, tranh xung dot tai nguyen.
2. **Bao toan phien qua Reload (`sessionStorage`)**:
   - Khoa session `dh_armed_session` luu tru toan bo UniversalTargetDescriptor, timestamp muc tieu va thong tin task.
   - Khi tab reload (F5 thu cong hoac reload phong thu kep), content script kiem tra va tiep tuc phien san ngay lap tuc ma khong mat vi tri nut.
3. **Chuan hoa so sanh URL (`isSamePageUrl`)**:
   - So sanh dua tren origin va pathname da loai bo trailing slash.
   - Tranh truong hop bi ngat phien san chi vi trang web tu them query params quang cao (nhu `?utm_source=...` hay `#voucher`).

---

## 5. Co Che Tu Toi Uu Phong Thu Kep (Dual-Defense Reload)

### 5.1. Quy trinh hoat dong
1. **Pre-warm (T-60s hoac tuy chinh)**: Background Scheduler danh thuc tab, tai moi trang va can chinh lai dong ho truoc gio G.
2. **Autonomous Reload (T+250ms)**:
   - Neu qua gio G 250ms ma so luot click van bang 0 va nut van bi vo hieu hoa (trang tinh bi stale DOM cua phien cu), he thong tu dong reload ngam 1 lan duy nhat.
3. **Cua so mo rong sau reload (10 giay)**:
   - Khi co co `dh_emergency_reloaded_${targetTimestamp}`, cua so san tu dong mo rong len `10,000ms` de bu tru do tre tai HTML, khoi chay React/Vue va goi API du lieu.
   - Phan tu ngay khi xuat hien trong DOM se duoc tu dong cuon vao tam nhin (`scrollIntoView`) de kich hoat viewport lazy-loading va ban click ngay lap tuc.

### 5.2. Xu ly khi reload xong van khong co nut
Neu het toan bo 10 giay ma nut muc tieu van khong xuat hien (do server khong mo ma, campaign bi huy, hoac URL sai):
- **Khoa chong lap vo han**: Chi reload toi da 1 lan/moc gio. Tuyet doi khong reload lan 2 de tranh bi block bot / captcha.
- **Graceful Termination**: Ket thuc sach se voi ket qua `result: "not_found"` va `clicks: 0`.
- **Doi nguoi dung va Task**: HUD hien thi canh bao do, Background Scheduler danh dau task la `failed`, don sach `sessionStorage`.

---

## 6. Quy Chuan Chat Luong va Kiem Thu

- **Unit Tests**: Toan bo 119/119 tests pass xuyen suot 13 suites (`vitest run`).
- **Production Build**: Bien dich hoan tat khong loi qua `tsc` va `vite`.
- **Zero-Emoji**: Tuyet doi khong chua emoji trong ma nguon, log, giao dien va tai lieu.
