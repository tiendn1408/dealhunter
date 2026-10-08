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
4. **Mo phong thao tac nguoi that (Anti-Bot Human Clicker)**:
   - Phat chuoi su kien chuot day du (`pointerdown` -> `mousedown` -> `pointerup` -> `mouseup` -> `click`) voi toa do ngau nhien (jitter 30% - 70%) ben trong nut de tranh bi chan bot.
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
   - Dung gio G, he thong se tu dong bam click lien tuc voi toc do 35ms/click.

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
Bao gom 35 unit tests kiem tra toan dien:
- `human_clicker.test.ts`: Kiem tra chuoi su kien chuot va random coordinates.
- `hunt_engine.test.ts`: Kiem tra co che san, relocate nut khi re-render, click nut tuy chon tren web bat ky.
- `element_resolver.test.ts`: Kiem tra nhan dien va phan loai trang thai nut voucher.
- `time_calibrator.test.ts`: Kiem tra thuat toan can chinh thoi gian qua RTT.
- `drop_time.test.ts`: Kiem tra tinh toan moc gio Viet Nam (GMT+7).
- `web_session.test.ts`: Kiem tra giao tiep session token voi Web app.

---

## 5. Quy Chuan Zero-Emoji

Toan bo ma nguon, giao dien, thong bao va tai lieu huong dan cua DealHunter Assistant tuan thu tuyet doi 100% quy chuan **Zero-Emoji**. Khong su dung unicode emoji o bat ky vi tri nao.
