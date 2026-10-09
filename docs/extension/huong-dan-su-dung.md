# DealHunter Assistant — Huong Dan Su Dung (User Guide)

> Tien ich mo rong Chrome chuyen dung de **san voucher Shopee va tu dong click nut tren moi website dung gio G** (dac biet la nua dem 00:00:00 hoac cac khung gio vang 9h, 12h, 15h, 18h, 21h). Chay truc tiep tren trinh duyet voi tai khoan cua ban, an toan tuyet doi va toi uu toc do mili-giay.
>
> Cap nhat: 2026-10-08 · Ap dung cho ban build Universal Sniper trong `extension/dist`.

---

## Muc Luc

1. [Tong quan tinh nang](#1-tong-quan-tinh-nang)
2. [Cai dat tien ich vao trinh duyet](#2-cai-dat-tien-ich-vao-trinh-duyet)
3. [Giao dien va tuy chon ngon ngu (EN / VI)](#3-giao-dien-va-tuy-chon-ngon-ngu-en--vi)
4. [Che do 1 — Live Sniper (San truc tiep tren moi trang web)](#4-che-do-1--live-sniper-san-truc-tiep-tren-moi-trang-web)
5. [Che do 2 — Schedule (Hen gio tu dong 100%)](#5-che-do-2--schedule-hen-gio-tu-dong-100)
6. [Che do 3 — My Hunts (Quan ly lich hen va lich su san)](#6-che-do-3--my-hunts-quan-ly-lich-hen-va-lich-su-san)
7. [Thuoc tinh ky thuat va thuat toan loi](#7-thuoc-tinh-ky-thuat-va-thuat-toan-loi)
8. [Xu ly su co thuong gap (Troubleshooting)](#8-xu-ly-su-co-thuong-gap-troubleshooting)
9. [Luu y quan trong va an toan tai khoan](#9-luu-y-quan-trong-va-an-toan-tai-khoan)

---

## 1. Tong Quan Tinh Nang

### Tinh nang vuot troi
- **Universal Web Sniper**: Khong chi gioi han tren Shopee, tien ich ho tro san ve, dang ky su kien, giat slot, dat cho, hoac bam bat ky nut nao tren **moi trang web** (Shopee, Ticketbox, Lazada, Tiki, cong dang ky hoc phan, v.v.).
- **Do gio sieu chinh xac (NTP Time Sync)**: Tinh toan do lech giua dong ho may tinh va may chu qua nhieu mau ping RTT, loai bo hoan toan sai so gio he thong.
- **Bo dem khong tre (Web Worker Timer)**: Trinh duyet Chrome luon lam cham tab nen xuong 1000ms. DealHunter dung Web Worker rieng de duy tri nhip tick 10ms chinh xac tuyet doi.
- **Mo phong chuot nguoi that (Anti-Bot Human Clicker)**: Phat day du chuoi su kien `pointerover` -> `pointerenter` -> `pointerdown` -> `mousedown` -> `focus` -> `pointerup` -> `mouseup` -> `click` voi toa do ngau nhien ben trong nut (jitter 30% - 70%) de vuot qua he thong phong ve chong bot (Cloudflare, Shopee F02/M04).
- **Bam bat dau 150ms truoc gio G**: Bup click don dap moi 35ms de hap thu do tre mang va giat ma ngay miligiay dau tien.

---

## 2. Cai Dat Tien Ich Vao Trinh Duyet

### 2.1. Bien dich ma nguon (Neu can build lai tu source)
Mo Terminal va di chuyen den thu muc extension:
```bash
cd /Users/tien.dang/Workplace/reference/deal-hunter/dealhunter/extension
npm install
npm run build
```
Thu muc thanh pham se duoc tao tai: `dealhunter/extension/dist`.

### 2.2. Nap tien ich vao Chrome / Edge / Coc Coc / Brave
1. Mo trinh duyet va truy cap dia chi: `chrome://extensions` (Edge: `edge://extensions`, Coc Coc: `coccoc://extensions`).
2. Bat cong tac **Developer mode** (Che do nha phat trien) o goc tren ben phai.
3. Bam nut **Load unpacked** (Tai tien ich da giai nen).
4. Chon thu muc:
   ```text
   /Users/tien.dang/Workplace/reference/deal-hunter/dealhunter/extension/dist
   ```
5. Tien ich **DealHunter Assistant** se xuat hien tren trinh duyet. Bam vao bieu tuong manh ghep tren thanh cong cu roi **Ghim (Pin)** de de dang su dung.

### 2.3. Cap nhat sau khi sua code
Moi khi bien dich lai code (`npm run build`), hay vao lai `chrome://extensions` va bam nut **Reload** (mui ten tron) tren the DealHunter Assistant, sau do tai lai trang web dang mo (F5).

---

## 3. Giao Dien Va Tuy Chon Ngon Ngu (EN / VI)

DealHunter Assistant duoc thiet ke theo phong cach hien dai Dark Cyber-Tactical voi 3 the chinh va ho tro 2 ngon ngu:
- **Tieng Anh (English)**: Ngon ngu mac dinh cua he thong.
- **Tieng Viet (Vietnamese)**: Tieng Viet co dau chuan xac, de hieu.

**Cach doi ngon ngu**:
- Tai Popup: Bam vao nut **`EN`** hoac **`VI`** o goc tren ben phai tieu de.
- Tai Floating HUD tren trang: Bam vao nut **`EN`** hoac **`VI`** tren thanh tieu de cua HUD.
- Cai dat ngon ngu duoc dong bo ngay lap tuc cho toan bo popup va cac tab dang mo.

---

## 4. Che Do 1 — Live Sniper (San Truc Tiep Tren Moi Trang Web)

Dung khi ban dang ngoi truoc may tinh va can bam mot nut vao dung gio G (vi du: nua dem 00:00:00 hoac cac gio flash sale).

### Buoc 1: Mo trang web can san
- Neu san voucher Shopee: Mo `https://shopee.vn/m/ma-giam-gia`, `https://shopee.vn/cart`, hoac trang chien dich sale.
- Neu san trang khac: Mo trang ban ve, dang ky hoc phan, trang su kien flash sale ma ban can bam nut.

### Buoc 2: Bat bang dieu khien Sniper HUD
1. Bam vao icon DealHunter tren thanh trinh duyet de mo Popup.
2. The **Live Sniper** se tu dong nhan dien trang web ban dang dung:
   - Hien thi domain hien tai (vi du: `ticketbox.vn active`, `shopee.vn active`) voi cham xanh san sang.
   - Dong ho dem nguoc gio G lon o giua man hinh.
3. Bam nut lon noi bat:
   - **`START SNIPER ON THIS PAGE`** (hoac **`BAT DAU SAN TREN TRANG NAY`**).
4. Bang dieu khien **Sniper HUD** se lap tuc noi len o goc duoi ben phai cua trang web.

### Buoc 3: Thiet lap tren bang Sniper HUD
1. **Chon moc gio san**:
   - **`[00:00]`**: Canh nua dem dung 00:00:00.000 (khuyen dung cho moi trang web).
   - **`[Next flash]`**: Canh gio flash sale tiep theo (0h, 9h, 12h, 15h, 18h, 21h).
   - **`[Next min]`**: Canh dau phut tiep theo de kiem tra thu nghiem.
2. **Khoa nut muc tieu**:
   - Bam nut **`Pick button`** (**`Chon nut`**): Re chuot vao bat ky nut nao ban can bam tren man hinh (nut Luu voucher, nut Dat ve, nut Mua ngay, nut Dang ky). Nut se sang vien xanh la neon. Click vao nut do de khoa.
   - Hoac bam **`Auto-detect`** (**`Tu quet nut`**): Neu dang o tren Shopee, tien ich tu dong tim nut Luu voucher hop le dau tien.
3. **Kiem tra dong bo dong ho**:
   - Bang HUD hien thi thoi gian may chu chuan xac den tung miligiay.
   - Neu can dong bo lai, bam nut lam moi ben canh do lech mili-giay.
4. **Bam thu nghiem (Tuy chon)**:
   - Bam **`Send one test click`** (**`Bam thu 1 phat click`**) de kiem tra xem click co truyen dung vao nut hay khong.

### Buoc 4: Kich hoat truc chien (Arm Sniper)
- Bam nut lon: **`Arm sniper`** (**`Kich hoat san`**).
- Nut chuyen sang mau do cam **`Disarm`** (**`Huy kich hoat`**) va he thong vao trang thai truc chien dem nguoc miligiay.
- Ban co the thu nho HUD (nut dau tru `-`) thanh mot vien thu gon nho gon.
- Dung moc gio da dinh, he thong se tu dong ban burst click don dap vao nut da khoa cho den khi trang xac nhan thanh cong.

---

## 5. Che Do 2 — Schedule (Hen Gio Tu Dong 100%)

Dung khi ban khong the truc tiep ngoi canh may (vi du: can san voucher nua dem 00:00 nhung muon di ngu som).

### Buoc 1: Chuyen sang the Schedule trong Popup
1. Bam bieu tuong tien ich tren thanh cong cu Chrome.
2. Chon the o giua: **`Schedule`** (**`Dat lich`**).

### Buoc 2: Chon khung gio va trang muc tieu
1. **Drop time (Vietnam)**: Chon gio ban muon he thong hanh dong (`00`, `09`, `12`, `15`, `18`, `21`).
2. **Target page / URL**:
   - Cac lua chon co san cua Shopee: `Shopee Hub`, `10.10 Sale`, `Cart`.
   - Hoac chon **`Custom URL`** (**`URL tuy chon`**):
     + O nhap URL se xuat hien.
     + Bam nut **`Use current page`** (**`Dung link hien tai`**) de he thong tu dong dien link trang ban dang xem.
     + Hoac dan bat ky duong link web nao ban muon.
3. **Voucher keyword** (Tu khoa voucher - khuyen dung cho Shopee):
   - Dien doan chu dac trung cua voucher, vi du: `500k`, `15%`, `freeship`.
   - He thong se chi uu tien bam dung voucher chua tu khoa nay khi mo trang.

### Buoc 3: Xac nhan tao lich
- Bam nut: **`Schedule [gio]:00 hunt`** (**`Dat lich san [gio]:00`**).
- Lich hen se duoc luu vao bo nho va xuat hien trong danh sach quan ly.

### Co che he thong thuc thi khi den gio:
1. **Truoc gio G 60 giay**: Tien ich tu dong chay ngam, do lai gio may chu va tu dong mo tab moi dan den dung link trang web ban da dat.
2. **Tab tai xong**: He thong tu dong cuon trang den vi tri voucher va khoa muc tieu.
3. **Dung gio G**: Tien ich kich hoat loat click sieu toc va ghi nhan ket qua vao danh sach lich hen.

*Luu y quan trong*: De che do hen gio hoat dong, trinh duyet Chrome phai duoc bat va may tinh khong bi dua vao che do Sleep.

---

## 6. Che Do 3 — My Hunts (Quan Ly Lich Hen Va Lich Su San)

1. Mo Popup, chon the thu ba: **`My Hunts`** (**`Lich hen`**).
2. Danh sach hien thi toan bo cac lich da len kem trang thai:
   - **Waiting for drop** (**Cho den gio**): Dang cho den moc gio hen.
   - **Hunting** (**Dang san**): Dang trong qua trinh mo tab va ban click.
   - **Voucher saved** (**Da luu ma**): San thanh cong, trang xac nhan da luu.
   - **Could not save** (**Khong luu duoc**): Hien thi chi tiet ly do (het luot, khong tim thay nut, hoac so luot click da gui).
3. Ban co the loc danh sach theo trang thai hoac bam bieu tuong thung rac de xoa lich bat ky luc nao.

---

## 7. Thuoc Tinh Ky Thuat Va Thuat Toan Loi

DealHunter Assistant duoc phat trien dua tren cac nguyen ly ky thuat cao cap danh cho trinh duyet:

| Thanh phan | File ma nguon | Co che hoat dong |
|---|---|---|
| **Hunt Coordinator (SSOT)** | `hunt_coordinator.ts` | Single Source of Truth quan ly phien san, thong nhat 100% giua Arm Sniper tren Floating HUD va Schedule tu dong tu Background. |
| **Behavioral State Machine** | `element_resolver.ts` | Loai bo 100% tu dien hardcoded text. Xac dinh ket qua san dua tren su bien doi DOM (unmount, disabled transition, text mutation, SVG icon injection) va chuan W3C ARIA. |
| **Dual-Defense Reload** | `hunt_engine.ts`, `target_diagnostics.ts` | Tu dong pre-warm tab o T-60s va emergency reload ngam o T+250ms tren trang tinh. Tu dong mo rong cua so 10s sau reload kem khoa chong lap vo han. |
| **NTP Time Calibrator** | `time_calibrator.ts`, `time_sync_client.ts` | Do do tre 2 chieu (RTT) va can chinh dong ho cuc bo theo thoi gian thuc cua server. Loai bo hoan toan do lech gio may tinh. |
| **Web Worker Ticker** | `timer_worker.ts` | Tranh tinh trang Chrome giam hieu nang tab nen xuong 1000ms. Chay tren luong Worker rieng voi tan so 10ms. |
| **Human Clicker** | `human_clicker.ts` | Phat chuoi pointer/mouse day du voi toa do ngau nhien (random jitter). Khong dung `el.click()` tho giup tranh bi bot-detector chan. |
| **Full-Auto Scheduler** | `scheduler.ts` | Dung `chrome.alarms` MV3 de danh thuc tien ich truoc gio G, tai moi tab va chuan bi phien san. |

Chi tiet kien truc toan dien duoc tai lieu hoa tai: [`docs/extension/kien-truc-universal-sniper-va-state-machine.md`](kien-truc-universal-sniper-va-state-machine.md).

---

## 8. Xu Ly Su Co Thuong Gap (Troubleshooting)

### Q1: Tai sao toi bam Start tren mot trang web ma khong thay bang HUD xuat hien?
- **Nguyen nhan**: Trang web do duoc mo truoc khi ban cai dat hoac reload extension.
- **Cach khac phuc**: Hay refresh (F5) lai trang web do mot lan, sau do mo popup va bam lai nut `START SNIPER ON THIS PAGE`.

### Q2: Dong ho bao "Not synced" hoac "Chua dong bo"?
- **Nguyen nhan**: Mat ket noi mang hoac mang qua cham khien tien ich chua do duoc RTT.
- **Cach khac phuc**: Bam nut xoay tron ben canh dong ho tren HUD hoac vao the Live Sniper bam `Re-sync` de he thong do lai.

### Q3: Nut tren trang web bi vo hieu hoa (disabled/mo di) truoc 00:00:00, co chon duoc khong?
- **Tra loi**: Hoan toan duoc. Co che **Pick button** cho phep ban re chuot va khoa ca nhung nut dang bi disabled. Tien ich se quan sat va ngay khi nut duoc mo vao dung 00:00:00, no se lap tuc ban loat click vao nut do.

### Q4: May tinh cua toi dat mui gio khac (khong phai GMT+7) thi co san dung gio khong?
- **Tra loi**: Luon luon dung. Toan bo thuat toan gio cua DealHunter deu quy doi chuan theo gio Viet Nam (GMT+7, khong DST), bat ke may tinh cua ban dang o My, Nhat Ban hay chau Au.

---

## 9. Luu Y Quan Trong Va An Toan Tai Khoan

1. **An toan thong tin**: Tien ich chay hoan toan tai phia Client tren trinh duyet cua ban, su dung phien dang nhap co san cua chinh ban. Tien ich khong bao gio luu tru hay gui mat khau hoac thong tin thanh toan cua ban ra ben ngoai.
2. **Chuan bi truoc gio G**:
   - Voi Shopee: Hay dang nhap truoc, mo thu trang voucher truoc 5 phut de vuot qua captcha neu co.
   - Voi cac trang web khac: Hay dang nhap san tai khoan, chon san thong tin can thiet de khi nut mo ra la co the click ngay.
3. **Giu may tinh hoat dong**: Khong gap man hinh may tinh hoac de may roi vao che do Sleep neu ban dat lich tu dong luc nua dem.
