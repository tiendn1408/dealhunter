# DealHunter Assistant — Client-Side Universal Fast Clicker & Voucher Sniper

> **Huong dan su dung chi tiet cho nguoi dung:** [`docs/extension/huong-dan-su-dung.md`](../docs/extension/huong-dan-su-dung.md)

Tien ich mo rong trinh duyet (Chrome Extension) theo chuan **Manifest V3**, chuyen dung de san ma giam gia chop nhoang (flash sale 0h, 9h, 12h, 15h, 18h, 21h) tren **Shopee Viet Nam** va ho tro **Universal Web Sniper** de tu dong click nut tren **moi website** (san ve, dang ky su kien, flash drops) vao dung gio hen truoc hoac moc 00:00:00.

---

## 1. Tinh Nang Noi Bat

1. **Universal Fast Clicker & Sniper**:
   - Hoat dong tren bat ky trang web HTTP/HTTPS nao.
   - Khoa nut bam bat buoc (Required Target Locking): khong bao gio click nham nut khi chua duoc chi dinh.
   - Nhac lai nut da luu (Saved Targets): tu dong nhan dien va khoi phuc nut muc tieu theo tung URL.
2. **Dong bo gio may chu chinh xac mili-giay (Server Time Calibration)**:
   - Do do tre 2 chieu (RTT) va bat moc doi giay qua header Date cua file tinh nho de triet tieu sai so dong ho may tinh.
   - Du lieu can chinh luu rieng theo tung ten mien voi co che tu dong xoa sau 24 gio (24h TTL) bao ve quyen rieng tu.
3. **Web Worker Ticker doc lap**:
   - Duy tri nhip tick 10ms on dinh, tranh tinh trang trinh duyet Chrome bop nghet hieu nang tab nen (bypass background tab throttling). Co che tu dong chuyen doi fallback an toan khi CSP chan Worker.
4. **Mo phong chuot nguoi that sinh trac hoc (Anti-Bot Human Biometrics)**:
   - Bien doi Box-Muller Gaussian cho khoang cach thoi gian giua cac click.
   - Toa do click phan bo Gauss 2 chieu tap trung trong tam nut, tranh click co dinh 1 diem.
   - Quy dao tiep can Cubic Bezier mo phong thao tac di chuot nguoi that o click dau tien.
   - **Dong co thich ung dong hoc (Autonomous Adaptive Kinetic Engine)**: Tu dong dieu chinh 3 pha sinh hoc (But toc gio G -> Gian nhip thich ung kem vi nghi micro-pause -> On dinh dai han) chong he thong phat hien bot tu dong.
5. **Giao dien Dark Tactical & Song ngu (EN / VI)**:
   - Thiet ke 3 the tien dung: `[Live Sniper]`, `[Schedule]`, `[My Hunts]`.
   - Song ngu Tieng Anh va Tieng Viet chuyen doi tuc thi 1-click.
   - Floating HUD linh hoat: co the keo tha, thu nho thanh thanh trang thai mini, hoac dong an toan.
6. **Hai che do san tien tien**:
   - **Live Sniper (Ban tu dong)**: Bat Floating HUD truc tiep tren trang, chon nut, chon moc gio (+10s, +30s, +1m, 00:00, hoac gio tu chon HH:mm:ss) va kich hoat trang thai truc chien.
   - **Schedule (Tu dong 100%)**: Len lich truoc voi gio chinh xac va URL tuy chon (trang hien tai, nut da luu, hoac link tuy y). Background Service Worker tu dong danh thuc va mo tab truoc 60 giay de chuan bi san.
7. **Bao mat va Cach ly giao dien**:
   - CSS cua HUD va Badge duoc co lap tuyet doi voi CSS Reset `all: initial` va pham vi ID, khong anh huong den layout cua trang web goc.
   - Khong su dung `innerHTML` voi du lieu nguoi dung hoac noi dung DOM cua website goc, triet tieu nguy co XSS.
   - Tu dong loc cac tham so theo doi tiep thi (utm_*, fbclid) khi so khop trang, bao toan duong dan va trang thai hash route SPA.

---

## 2. Huong Dan Cai Dat (Developer Mode)

### Buoc 1: Bien dich ma nguon
Tai thu muc `dealhunter/extension`:
```bash
npm install
npm run build
```
Thu muc build duoc tao tai: `dist/`.

### Buoc 2: Nap tien ich vao trinh duyet (Chrome / Edge / Coc Coc / Brave)
1. Mo trinh duyet va truy cap: `chrome://extensions/`.
2. Bat cong tac **Developer mode** (Che do nha phat trien) o goc tren ben phai.
3. Nhan vao nut **Load unpacked** (Tai tien ich da giai nen).
4. Chon thu muc `dist/` ben trong thu muc `extension` cua du an.
5. Bieu tuong **DealHunter Assistant** se xuat hien tren thanh cong cu. Hay Ghim (Pin) tien ich de su dung tien loi.

---

## 3. Huong Dan Su Dung Nhanh

### 3.1. Che do Live Sniper (San truc tiep tren trang)
1. Mo trang web co nut can bam (Shopee, Ticketbox, Lazada, trang dang ky, v.v.).
2. Bam bieu tuong DealHunter tren thanh trinh duyet.
3. Popup nhan dien ten mien trang va hien nut:
   - **`START SNIPER ON THIS PAGE`** (hoac **`BAT DAU SAN TREN TRANG NAY`**).
4. Bang HUD noi len tren man hinh:
   - Chon moc gio: `[+10s]`, `[+30s]`, `[00:00]` (nua dem), `[+1m]`, hoac `[Custom]` (nhap gio HH:mm:ss).
   - Nhan **`Pick button`** (**`Chon nut`**) va click vao nut can san de khoa muc tieu.
   - Nhan **`Save target`** neu muon luu lai nut nay cho cac lan sau.
   - Nhan **`Arm sniper`** (**`Bat san ma`**) de he thong vao trang thai truc chien dem nguoc.
   - Den gio G, he thong tu dong click theo dong co sinh trac hoc adaptive.

### 3.2. Che do Schedule (Hen gio tu dong 100%)
1. Mo popup DealHunter, chuyen sang the **`Schedule`** (**`Dat lich`**).
2. Chon che do muc tieu:
   - **Current page** (Trang hien tai): dung URL cua tab dang mo.
   - **Saved list** (Danh sach da luu): chon nut da tung luu truoc do.
   - **Custom link** (Link tuy y): nhap duong dan HTTP/HTTPS cu the.
3. Nhap gio san chinh xac theo dinh dang `HH:mm:ss` hoac chon nhanh cac moc sale pho bien (00:00, 09:00, 12:00, 15:00, 18:00, 21:00).
4. Nhan **`Schedule Hunt`** de luu lich vao bo nho.
5. Truoc gio hen 60 giay, tien ich se tu dong mo hoac focus tab, nap san script va san hoan toan tu dong.

---

## 4. Kiem Thu Ma Nguon (Quality Assurance)

Chay toan bo test suite:
```bash
npm test
```
Bao gom **165 unit tests (17 test suites)** pass 100%:
- `hunt_engine.test.ts` (21 tests): May trang thai san ma, relocate nut theo chu ky noi dung, bao cao ket qua xac nhan thuc te (saved, exhausted, not_found, timeout, cancelled), huy an toan khi chuyen trang SPA, va pacing adaptive.
- `web_session.test.ts` (19 tests): Giao tiep session token voi Web app DealHunter qua externally_connectable, xac thuc domain va luu tru phien trong chrome.storage.session.
- `endpoints.test.ts` (21 tests) va `api_client.test.ts` (12 tests): Xac thuc va phan giai URL API, validate origin DealHunter hop le.
- `element_resolver.test.ts` (11 tests): Trich xuat chu ky nut, may trang thai hanh vi khong hardcode chuoi, loai tru phan tu noi bo HUD/Badge, phong ngua bao da luu sai.
- `human_biometrics.test.ts` (11 tests): Thuat toan Box-Muller Gaussian, toa do Gauss 2 chieu, quy dao tiep can Cubic Bezier theo Fitts's Law, va dong co dong hoc 3 pha.
- `storage.test.ts` (10 tests): Hang doi tuan tu hoa write mutations tranh race condition (M1), luu va phuc hoi muc tieu, TTL 24h tu dong don dep domain calibrations (P2, L11).
- `drop_time.test.ts` (9 tests): Tinh toan moc gio Viet Nam (GMT+7), dinh dang dem nguoc chuan HH:mm:ss.SS, va xac thuc chuoi gio nhap parseTimeString (L1).
- `hunt_coordinator.test.ts` (8 tests): Dieu phoi phien san, task adoption hop nhat phien thu cong va tu dong (M3), danh dau missed khi qua han grace (H2), gui cancelled khi disarm (H4), va phuc hoi phien tu sessionStorage.
- `url.test.ts` (7 tests): Chuan hoa URL bo tham so tracking utm_*, fbclid giu nguyen hash route va query chuc nang (H7), xac thuc URL scheme hop le (L2).
- `scheduler.test.ts` (7 tests): Chrome alarm lifecycle, phuc hoi alarm khi startup (H1), danh dau task missed khi tre gio (H2), huy task sach se (H4), cho reload hoan tat truoc khi trigger (M2).
- `target_diagnostics.test.ts` (7 tests): Nhan dien framework SPA dong va chien luoc phong thu kep.
- `human_clicker.test.ts` (6 tests): Chuoi su kien chuot chuan W3C Pointer Events, chan click xuyen modal/overlay qua elementFromPoint (M8).
- `time_calibrator.test.ts` (6 tests): Do do tre mang RTT, ngan chan spam request va loai bo fallback Shopee ngam (H5, M9).
- `time_sync_client.test.ts` (6 tests): Client dong bo gio miligiay in-page, nhan dien domain chuan hoa, cap nhat offset va phat su kien thay doi dong bo.
- `timer_worker.test.ts` (2 tests): Web Worker ticker doc lap va co che fallback window interval khi gap loi hoac chan CSP (M5).
- `isolation.test.ts` (2 tests): Kiem tra an toan XSS khi chon nut (C4) va pham vi cach ly CSS khong ro ri sang trang web khac (C5).

---

## 5. Quy Chuan Zero-Emoji

Toan bo ma nguon, giao dien nguoi dung, log he thong, commit message va tai lieu cua DealHunter Assistant tuan thu 100% quy chuan **Zero-Emoji**. Khong su dung unicode emoji o bat ky vi tri nao.
