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

## 3. Thong Nhat 100% Giua Arm Sniper va Schedule

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

## 4. Co Che Tu Toi Uu Phong Thu Kep (Dual-Defense Reload)

### 4.1. Quy trinh hoat dong
1. **Pre-warm (T-60s hoac tuy chinh)**: Background Scheduler danh thuc tab, tai moi trang va can chinh lai dong ho truoc gio G.
2. **Autonomous Reload (T+250ms)**:
   - Neu qua gio G 250ms ma so luot click van bang 0 va nut van bi vo hieu hoa (trang tinh bi stale DOM cua phien cu), he thong tu dong reload ngam 1 lan duy nhat.
3. **Cua so mo rong sau reload (10 giay)**:
   - Khi co co `dh_emergency_reloaded_${targetTimestamp}`, cua so san tu dong mo rong len `10,000ms` de bu tru do tre tai HTML, khoi chay React/Vue va goi API du lieu.
   - Phan tu ngay khi xuat hien trong DOM se duoc tu dong cuon vao tam nhin (`scrollIntoView`) de kich hoat viewport lazy-loading va ban click ngay lap tuc.

### 4.2. Xu ly khi reload xong van khong co nut
Neu het toan bo 10 giay ma nut muc tieu van khong xuat hien (do server khong mo ma, campaign bi huy, hoac URL sai):
- **Khoa chong lap vo han**: Chi reload toi da 1 lan/moc gio. Tuyet doi khong reload lan 2 de tranh bi block bot / captcha.
- **Graceful Termination**: Ket thuc sach se voi ket qua `result: "not_found"` va `clicks: 0`.
- **Doi nguoi dung va Task**: HUD hien thi canh bao do, Background Scheduler danh dau task la `failed`, don sach `sessionStorage`.

---

## 5. Quy Chuan Chat Luong va Kiem Thu

- **Unit Tests**: Toan bo 89/89 tests pass xuyen suot 12 suites (`vitest run`).
- **Production Build**: Bien dich hoan tat khong loi qua `tsc` va `vite`.
- **Zero-Emoji**: Tuyet doi khong chua emoji trong ma nguon, log, giao dien va tai lieu.
