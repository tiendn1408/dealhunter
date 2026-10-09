# DealHunter Assistant — Client-Side Universal Fast Clicker & Voucher Sniper

> **Huong dan su dung chi tiet cho nguoi dung:** [`docs/extension/huong-dan-su-dung.md`](../docs/extension/huong-dan-su-dung.md)

Tien ich mo rong trinh duyet (Chrome Extension) theo chuan **Manifest V3**, chuyen dung de san ma giam gia chop nhoang (flash sale 0h, 9h, 12h, 15h, 18h, 21h) tren **Shopee Viet Nam** va ho tro **Universal Web Sniper** de tu dong click nut tren **moi website** (san ve, dang ky hoc phan, flash drops) vao dung 00:00:00 hoac gio hen truoc.

---

## 1. Tinh Nang Noi Bat

1. **Universal Fast Clicker & Sniper**:
   - Khong gioi han tren Shopee: Hoat dong tren bat ky trang web HTTP/HTTPS nao.
   - Ho tro moc gio nua dem `00:00:00` chuyen dung cho cac su kien mo ban ve, mo cong dang ky hoac mo sale dem.
   - Tu dong nhan dien ten mien trang web hien tai va bat HUD ngay lap tuc.
2. **Dong bo dong ho may chu chinh xac mili-giay (NTP Time Calibration)**:
   - Do do tre mang 2 chieu (RTT) va bat moc doi giay cua server de loai bo hoan toan sai so dong ho may tinh.
3. **Web Worker Ticker doc lap**:
   - Tranh tinh trang trinh duyet Chrome bop nghet hieu nang tab nen (bypass background tab throttling), duy tri nhip tick 10ms on dinh.
4. **Mo phong chuot nguoi that sinh trac hoc (Anti-Bot Human Biometrics)**:
   - Tich hop bo thuat toan sinh trac hoc toan dien: bien doi Box-Muller Gaussian cho thoi gian, toa do Gauss 2 chieu tap trung trong tam nut, quy dao tiep can Cubic Bezier theo Dinh luat Fitts, chuan hoa phan cung W3C Pointer Events Level 3, va thoi gian giu nut vat ly (dwell time).
   - **Dong co dinh hinh dong hoc tu dong (Autonomous Adaptive Kinetic Engine)**: Tu dong thich ung 3 pha sinh hoc (But toc gio G -> Gian nhip thich ung -> On dinh dai han kem vi nghi phuc hoi co), loai bo 100% dau vet bot ma nguoi dung khong can phan van chon che do.
5. **Giao dien Dark Cyber-Tactical & Song ngu (EN / VI)**:
   - Thiet ke 3 tab hien dai: `[Live Sniper]`, `[Schedule]`, `[My Hunts]`.
   - Ngon ngu Tieng Anh mac dinh, ho tro Tieng Viet co dau 1-click toggle.
   - Bieu tuong thuong hieu DealHunter tich hop chuan phong cach.
6. **Hai che do san tien tien**:
   - **Live Sniper (Ban tu dong)**: Mo Floating HUD truc tiep tren trang, cho phep chon nut bat ky va kick hoat truc chien.
   - **Schedule (Tu dong 100%)**: Len lich truoc voi khung gio va URL tuy chon (Custom URL), he thong tu dong mo tab truoc 60 giay va ban click dung gio G.

---

## 2. Huong Dan Cai Dat (Developer Mode)

### Buoc 1: Bien dich ma nguon
Tai thu muc `dealhunter/extension`:
```bash
npm install
npm run build
```
Thu muc build se duoc tao tai: `dist/`.

### Buoc 2: Nap tien ich vao trinh duyet (Chrome / Edge / Coc Coc / Brave)
1. Mo trinh duyet va truy cap: `chrome://extensions/`.
2. Bat cong tac **Developer mode** (Che do nha phat trien) o goc tren ben phai.
3. Nhan vao nut **Load unpacked** (Tai tien ich da giai nen).
4. Chon duong dan:
   ```text
   /Users/tien.dang/Workplace/reference/deal-hunter/dealhunter/extension/dist
   ```
5. Bieu tuong **DealHunter Assistant** se xuat hien tren thanh cong cu. Hay Ghim (Pin) tien ich de thao tac tien loi.

---

## 3. Huong Dan Su Dung Nhanh

### 3.1. Che do Live Sniper (San truc tiep tren trang bat ky)
1. Mo trang web co nut can bam (Shopee, Ticketbox, Lazada, trang dang ky, v.v.).
2. Bam bieu tuong DealHunter tren thanh trinh duyet.
3. Popup tu dong nhan dien domain trang va hien nut lon:
   - **`START SNIPER ON THIS PAGE`** (hoac **`BAT DAU SAN TREN TRANG NAY`**).
4. Bang HUD noi len tren trang:
   - Chon moc gio: `[00:00]` (nua dem), `[Next flash]`, hoac `[Next min]`.
   - Bam **`Pick button`** va click vao nut can bam tren man hinh de khoa muc tieu.
   - Bam **`Arm sniper`** de he thong vao trang thai truc chien dem nguoc miligiay.
    - Dung gio G, he thong se tu dong bam click theo thuat toan sinh hoc tu thich ung 3 pha.

### 3.2. Che do Schedule (Hen gio tu dong 100%)
1. Mo popup DealHunter, chuyen sang the **`Schedule`** (**`Dat lich`**).
2. Chon khung gio: `00:00`, `09:00`, `12:00`, `15:00`, `18:00`, `21:00`.
3. Chon trang muc tieu: Shopee Hub, 10.10 Sale, Cart, hoac **`Custom URL`** (bam **`Use current page`** de lay link trang hien tai).
4. Bam **`Schedule [gio]:00 hunt`** de luu lich.
5. Truoc gio G 60 giay, tien ich tu dong mo tab, canh dung gio va click hoan toan tu dong.

---

## 4. Kiem Thu Ma Nguon (Quality Assurance)

Chay toan bo test suite:
```bash
npm test
```
Bao gom toan bo **120 unit tests** (13 suites) kiem tra toan dien:
- `hunt_coordinator.ts`: Kiem tra quan ly phien san tap trung, dong bo giua HUD va Schedule.
- `human_biometrics.test.ts` (11 tests): Kiem tra thuat toan Box-Muller Gaussian sampling, toa do 2D Gauss, quy dao Cubic Bezier Fitts's Law, W3C Level 3 pointer event dispatching, co che tu dong dinh hinh dong hoc 3 pha (Adaptive Kinetic Envelope), va biological micro-pauses.
- `hunt_engine.test.ts` (17 tests): Kiem tra co che san, relocate nut khi re-render, click burst theo profile (Stealth, Pro Gamer, Turbo), fallback reload tai T+250ms, graceful timeout khi khong co nut.
- `element_resolver.test.ts` (6 tests): Kiem tra may trang thai hanh vi (W3C ARIA, data attributes, disabled transition, text mutation, icon injection) loai bo 100% hardcoded text.
- `target_diagnostics.test.ts` (7 tests): Kiem tra nhan dien framework SPA (React/Vue/Angular), dem nguoc toan hoc va chien luoc phong thu kep.
- `scheduler.test.ts` (2 tests): Kiem tra Chrome alarm scheduler va pre-warm tab T-60s.
- `human_clicker.test.ts` (4 tests): Kiem tra chuoi su kien chuot, approach trajectory, va async biological dwell duration.
- `time_calibrator.test.ts` (6 tests): Kiem tra thuat toan can chinh thoi gian qua RTT.
- `timer_worker.test.ts` (1 test): Kiem tra Web Worker ticker khong tre.
- `drop_time.test.ts` (7 tests): Kiem tra tinh toan moc gio Viet Nam (GMT+7) va countdown formatting HH:mm:ss.S.
- `storage.test.ts` (7 tests): Kiem tra doc ghi chrome.storage local (ghi settings dong thoi khong mat key).
- `web_session.test.ts` (19 tests): Kiem tra giao tiep session token voi Web app; token luu cung apiUrl/webUrl trong mot ban ghi chrome.storage.session.
- `endpoints.test.ts` (21 tests) va `api_client.test.ts` (12 tests): Kiem tra API client va endpoints.

---

## 5. Quy Chuan Zero-Emoji

Toan bo ma nguon, giao dien, thong bao va tai lieu huong dan cua DealHunter Assistant tuan thu tuyet doi 100% quy chuan **Zero-Emoji**. Khong su dung unicode emoji o bat ky vi tri nao.
