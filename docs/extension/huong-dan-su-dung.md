# DealHunter Assistant — Huong Dan Su Dung (User Guide)

> Tien ich mo rong Chrome chuyen dung de **san voucher va tu dong click nut tren moi website dung gio G** (dac biet la nua dem 00:00:00 hoac cac khung gio vang 9h, 12h, 15h, 18h, 21h). Chay truc tiep tren trinh duyet voi tai khoan cua ban, an toan tuyet doi va toi uu toc do mili-giay.
>
> Cap nhat: 2026-10-09 · Ap dung cho ban build Universal Sniper trong `extension/dist`.

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
- **Universal Web Sniper**: Khong gioi han rieng tren Shopee. Tien ich ho tro san voucher, mua flash sale, giat ve su kien (Ticketbox), dang ky hoc phan, hoac click bat ky nut nao tren **moi trang web** dung gio G.
- **Can chinh gio mili-giay theo tung domain (Domain Time Calibration)**: Tinh toan do lech giua dong ho may tinh va may chu cua trang web dang mo thong qua tieu de `Date` va do do tre 2 chieu (RTT), loai bo sai so gio he thong.
- **Bo dem khong tre (Web Worker Timer)**: Trinh duyet Chrome bop toc do tab nen xuong 1000ms. DealHunter su dung luong Web Worker rieng biet de duy tri nhip tick 10ms on dinh, tu dong fallback sang `setInterval` neu trang bat CSP nghiem ngat.
- **Dong co dinh hinh nhip do sinh hoc tu dong (Autonomous Adaptive Kinetic Engine)**:
  - **Pha 1 — But toc gio G (Clicks 1-3)**: Chu ky 60ms ± 10ms (~14-16 CPS) de giat deal trong cua so vang mili-giay dau tien.
  - **Pha 2 — Gian nhip thich ung (Clicks 4-8)**: Chu ky 95ms ± 16ms, bo sung vi nghi phuc hoi co hoc 65ms ± 15ms ngay truoc cu click thu 4 de pha vo hoan toan pho tu tuong quan (Autocorrelation) cua bo loc bot.
  - **Pha 3 — On dinh dai han (Clicks 9+)**: Chu ky 140ms ± 22ms kem vi nghi dinh ky sau moi 5 clicks nham bao ve tai khoan an toan khi cho may chu xu ly.
- **Che do Hyper Strike & Phan tang nen tang tu dong (Tiered Platform Sniper)**:
  - Tu dong nhan dien trang toc do cao (`caffiliate.vn`, diem danh doi thuong, dat ve): Kich hoat ho so `hyper` 25ms (~40 CPS), bo qua quy dao chuot, go bo thuoc tinh `disabled` tren DOM va ban don truoc 28ms de goi tin cham server dung 00:00:00.000.
  - Tu dong bao ve san lon (Shopee, Lazada, TikTok Shop): Giu nguyen mo hinh sinh trac hoc tiep can Fitts's Law de tranh bi DataDome / Cloudflare quet bot.
- **Reload don dau thong minh (Guarded Precision Pre-Reload Loop)**: Tu dong reload don dau truoc 750ms tren cac trang can phien moi va reload co kiem soat trong cua so 3 giay quanh gio G.
- **Kich hoat som 150ms truoc gio G (Lead Time)**: Bat dau quy trinh click truoc gio G 150ms de hap thu do tre mang Internet, dam bao cu click dau tien cham vao may chu dung miligiay mo deal.
- **May trang thai hanh vi (Behavioral State Machine)**: Loai bo 100% tu dien ngon ngu hardcode. Xac dinh ket qua san dua tren bien doi DOM thuc te (unmount, disabled state, text mutation, W3C ARIA, SVG icon injection).
- **Price History Intelligence Badge**: Tu dong hien thi huy hieu lich su gia va so sanh deal tren cac trang san pham Shopee, ho tro xem bien dong gia va chuyen huong ve DealHunter Web.

---

## 2. Cai Dat Tien Ich Vao Trinh Duyet

### 2.1. Bien dich ma nguon
Mo Terminal va di chuyen den thu muc extension cua du an:
```bash
cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension
npm install
npm run build
```
Thu muc build hoan tat se duoc tao tai:
```text
/Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/dist
```

### 2.2. Nap tien ich vao Chrome / Edge / Brave / Coc Coc
1. Mo trinh duyet va truy cap dia chi: `chrome://extensions`.
2. Bat cong tac **Developer mode** (Che do nha phat trien) o goc tren ben phai.
3. Bam nut **Load unpacked** (Tai tien ich da giai nen).
4. Chon thu muc:
   ```text
   /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/dist
   ```
5. Tien ich **DealHunter Assistant** se xuat hien tren thanh cong cu trinh duyet. Bam bieu tuong manh ghep va **Ghim (Pin)** tien ich de tien thao tac.

### 2.3. Cap nhat sau khi bien dich lai
Moi khi build lai ma nguon (`npm run build`), hay vao `chrome://extensions` va bam nut **Reload** (mui ten xoay tron) tren the DealHunter Assistant de ap dung code moi nhat.

---

## 3. Giao Dien Va Tuy Chon Ngon Ngu (EN / VI)

DealHunter Assistant su dung giao dien Dark Cyber-Tactical voi 3 the thao tac chinh va ho tro 2 ngon ngu:
- **Tieng Anh (English)**: Ngon ngu mac dinh quoc te.
- **Tieng Viet (Vietnamese)**: Ban dia hoa day du, chuan xac.

**Cach chuyen doi ngon ngu**:
- Tren Popup: Bam vao nut **`EN`** hoac **`VI`** o goc tren ben phai tieu de.
- Tren Floating HUD: Bam vao nut **`EN`** hoac **`VI`** tren thanh tieu de cua bang HUD.
- Thiet lap ngon ngu duoc dong bo ngay lap tuc giua popup va toan bo cac tab dang mo.

---

## 4. Che Do 1 — Live Sniper (San Truc Tiep Tren Moi Trang Web)

Dung khi ban dang theo doi truc tiep tren man hinh va can kich hoat san mot nut bam vao moc gio xac dinh.

### Buoc 1: Mo trang web can san
- Mo trang chua nut can bam: trang voucher Shopee (`https://shopee.vn/m/ma-giam-gia`), gio hang, trang ban ve Ticketbox, hoac trang su kien flash sale tren bat ky website nao.

### Buoc 2: Bat bang dieu khien Sniper HUD
1. Bam vao icon DealHunter tren thanh cong cu Chrome de mo Popup.
2. The **Live Sniper** tu dong nhan dien domain cua trang dang mo (vi du: `shopee.vn active`, `ticketbox.vn active`).
3. Bam nut noi bat:
   - **`START SNIPER ON THIS PAGE`** (hoac **`BAT DAU SAN TREN TRANG NAY`**).
   - Popup se tu dong chen tep CSS va script vao trang web (neu trang chua co) va hien thi bang **Floating HUD** o goc duoi ben phai man hinh.

### Buoc 3: Thiet lap tren bang Sniper HUD
1. **Chon moc gio san**:
   - **`+10s`**: San sau 10 giay (phu hop test nhanh).
   - **`+30s`**: San sau 30 giay.
   - **`00:00`**: San vao dung nua dem tiep theo (00:00:00).
   - **`+1m` / `+1p`**: San vao dau phut tiep theo.
   - **`Custom` / `Tuy chinh`**: Nhap gio bat ky theo dinh dang `HH:mm:ss`. He thong kiem tra tinh hop le va canh bao neu gio nhap khong dung dinh dang.
2. **Khoa nut muc tieu (Target Button)**:
   - Bam nut **`Pick button`** (**`Chon nut`**): Re chuot len man hinh den nut ban muon click (nut Luu voucher, nut Mua ngay, nut Dat cho). Nut se duoc lam noi bat voi vien xanh neon `dh-target-highlight`. Click vao nut de khoa muc tieu.
   - Hoac bam **`Auto-detect`** (**`Tu quet`**): Neu dang o tren Shopee, tien ich tu dong quet va de xuat nut voucher hop le dau tien tren man hinh.
   - Neu muon huy chon nut da khoa, bam bieu tuong nut **X** ben canh ten muc tieu de reset ve trang thai ban dau.
3. **Kiem tra dong bo dong ho**:
   - Bang HUD hien thi thoi gian thuc va do lech giua may tinh va server (vi du: `+120ms ±15ms`).
   - Bam bieu tuong xoay tron ben canh de can chinh lai neu can.
4. **Bam thu 1 click (Test click)**:
   - Bam **`Test click (1x)`** (**`Bam thu 1 click`**) de kiem tra xem chuoi pointer events co truyen dung vao nut muc tieu hay khong.

### Buoc 4: Kich hoat truc chien (Arm Sniper)
1. Bam nut lon: **`Arm sniper`** (**`Kich hoat san`**).
2. Nut chuyen sang trang thai **`Disarm`** (**`Huy kich hoat`**) va bang HUD bat dau dem nguoc mili-giay den gio G.
3. Ban co the bam nut Minimize (`-`) de thu gon HUD xuong thanh trang thai nho gon o goc man hinh.
4. Dung gio G (co tinh lead 150ms), he thong se tu dong kich hoat chuoi click adaptive cho den khi trang web xac nhan luu thanh cong hoac het thoi gian san.

---

## 5. Che Do 2 — Schedule (Hen Gio Tu Dong 100%)

Dung khi ban muon dat lich truoc va de trinh duyet tu dong mo trang, khoa muc tieu va san khi den gio (vi du: san voucher nua dem khi ban khong ngoi truoc may).

### Buoc 1: Mo the Schedule tren Popup
1. Bam icon DealHunter tren thanh cong cu Chrome.
2. Chon the o giua: **`Schedule`** (**`Dat lich`**).

### Buoc 2: Chon gio san va phuong thuc muc tieu
1. **Gio san (Drop time - Vietnam)**:
   - Nhap gio truc tiep theo dinh dang `HH:mm:ss` (gio Viet Nam GMT+7).
   - Hoac bam nhanh vao cac nut goi y flash sale Shopee: `00:00`, `09:00`, `12:00`, `15:00`, `18:00`, `21:00`.
2. **Che do muc tieu (Target Mode)**:
   - **`Current tab`** (**`Tab hien tai`**): Su dung duong dan URL cua tab dang mo lam trang muc tieu.
   - **`Saved list`** (**`Danh sach da luu`**): Chon tu danh sach cac nut voucher ban da khoa va luu truoc do tu Floating HUD.
   - **`Custom link`** (**`Link tuy chinh`**):
     - Dan duong link web bat ky vao o nhap URL (he thong chi chap nhan giao thuc `http://` hoac `https://` hop le).
     - Bam nut **`Open page and pick`** (**`Mo trang & chon nut`**) de tien ich tu dong mo trang web do trong tab moi va bat che do chon nut tren HUD de ban khoa muc tieu.

### Buoc 3: Tao lich hen
1. Bam nut **`Schedule hunt`** (**`Dat lich san`**).
2. Nhiem vu moi se duoc luu vao bo nho va hien thi trong danh sach quan ly.

### Co che he thong thuc thi ngam:
1. **Truoc gio G 60 giay (Pre-warm T-60s)**:
   - Background Alarm danh thuc service worker.
   - He thong kiem tra xem da co tab nao dang mo dung trang web do hay chua (`isSamePageUrl`). Neu da co, tien ich tai su dung tab do va focus len dau; neu chua co, tien ich mo mot tab moi.
   - Tab duoc tai moi de lam sach cache va do lai gio may chu.
2. **Khoa muc tieu tu dong**:
   - Khi tab hoan tat tai trang, content script tu dong khoi phuc target descriptor va cuon nut vao khung nhin (`scrollIntoView`).
3. **Dung gio G**:
   - Content script kich hoat dong co san adaptive va ghi nhan ket qua vao danh sach lich hen.

---

## 6. Che Do 3 — My Hunts (Quan Ly Lich Hen Va Lich Su San)

1. Mo Popup, chon the thu ba: **`My Hunts`** (**`Lich hen`**).
2. Danh sach hien thi toan bo cac lich da len kem trang thai thoi gian thuc:
   - **`Waiting`** (**`Cho den gio`**): Dang cho den moc gio hen.
   - **`Hunting`** (**`Dang san`**): Dang trong qua trinh chuan bi tab va ban click.
   - **`Saved`** (**`Da luu ma`**): San thanh cong, trang da tiep nhan va xac nhan luu deal.
   - **`Cancelled`** (**`Da huy`**): Nhiem vu da duoc nguoi dung chu dong huy.
   - **`Failed`** (**`That bai`**): Khong luu duoc (het ma, nut khong xuat hien, hoac loi ket noi).
   - **`Missed`** (**`Bo lo`**): Qua gio G do may tinh bi tat nguon hoac mat mang trong luc hen.
3. Ban co the bam bieu tuong nut thung rac de xoa nhiem vu khoi danh sach bat ky luc nao.

---

## 7. Thuoc Tinh Ky Thuat Va Thuat Toan Loi

| Thanh phan | File ma nguon | Co che hoat dong |
|---|---|---|
| **Hunt Coordinator (SSOT)** | [`hunt_coordinator.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/hunt_coordinator.ts) | Single Source of Truth quan ly phien san tap trung, thong nhat giua Arm manual tren HUD va Schedule tu dong tu Background. Xu ly ket noi lai phien qua reload. |
| **Tiered Platform Engine** | [`target_diagnostics.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/target_diagnostics.ts) | Tu dong phan tang: giu nguyen tiep can sinh trac hoc chuan tren Shopee/Lazada/TikTok, tu dong kich hoat che do Hyper Strike tren web nho/caffiliate.vn. |
| **Hyper Strike & Pre-fire** | [`human_biometrics.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/human_biometrics.ts), [`hunt_engine.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/hunt_engine.ts) | Cua so nhap chuot 25ms (~40 CPS), ban don gio G truoc 28ms bu tru mang Internet, cuong che go disabled tren DOM dung tich tac 00:00:00.000. |
| **Guarded Precision Reload** | [`hunt_engine.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/hunt_engine.ts) | Socket Keep-Alive o T-5s, Precision Pre-Reload o T-750ms neu nut con vuong trang thai cu, va vong lap reload toi da 3 lan trong cua so 3 giay quanh gio G. |
| **Autonomous Adaptive Engine** | [`hunt_engine.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/hunt_engine.ts) | Dong co dinh hinh dong hoc 3 pha tren san lon: 60ms but toc dau, 95ms kem vi nghi phuc hoi co 65ms truoc click 4, va 140ms on dinh dai han. |
| **Behavioral State Machine** | [`element_resolver.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/element_resolver.ts) | Loai bo hoan toan regex tu dien. Xac dinh ket qua dua tren DOM detachment, disabled transition, text mutation, W3C ARIA contracts va SVG icon injection. |
| **Target Diagnostics** | [`target_diagnostics.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/target_diagnostics.ts) | Chuan doan phan tu muc tieu va tinh chat trang (SPA reactive vs Static). Tu dong tat phong thu kep reload tren ung dung React de tranh mat state trang. |
| **Dual-Defense Reload** | [`scheduler.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/background/scheduler.ts), [`hunt_engine.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/hunt_engine.ts) | Pre-warm tab o T-60s tu Background; Emergency reload o T+250ms tren trang tinh neu nut bi stale DOM; cua so mo rong 10 giay sau reload voi khoa chong lap vo han. |
| **Human Biometrics** | [`human_biometrics.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/human_biometrics.ts) | Bien doi Box-Muller Gaussian cho khoang thoi gian, phan bo toa do 2 chieu Bivariate Gaussian trong tam nut, va quy dao tiep can chuot theo Dinh luat Fitts. |
| **Human Clicker** | [`human_clicker.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/human_clicker.ts) | Phat day du chuoi su kien W3C Pointer Events Level 3 (`pointerdown` -> `mousedown` -> `pointerup` -> `mouseup` -> `click`) voi toa do ngau nhien va dwell time vat ly. |
| **Time Calibrator** | [`time_calibrator.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/background/time_calibrator.ts) | Can chinh dong ho may chu theo tieu de `Date` va RTT theo tung domain; tu dong don dep cac domain calibration qua han 24 gio. |
| **Web Worker Ticker** | [`timer_worker.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/content/core/timer_worker.ts) | Chay tren luong Worker rieng voi chu ky 10ms chong throttling tab nen cua Chrome; tu dong fallback sang window timer khi gap loi CSP. |
| **Full-Auto Scheduler** | [`scheduler.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/background/scheduler.ts) | Quan ly lich trinh bang `chrome.alarms` MV3, tai su dung tab thong minh voi so khop URL chuan hoa (`isSamePageUrl`). |

Chi tiet kien truc toan dien duoc tai lieu hoa tai: [`docs/extension/kien-truc-universal-sniper-va-state-machine.md`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/extension/kien-truc-universal-sniper-va-state-machine.md).

---

## 8. Xu Ly Su Co Thuong Gap (Troubleshooting)

### Q1: Toi bam nut Start tren trang web ma khong thay bang HUD xuat hien?
- **Tra loi**: Hien tai popup da duoc tich hop co che tu dong chen tep CSS va script vao tab dang mo khi ban bam `START SNIPER ON THIS PAGE`. Neu ban van khong thay HUD, co the do tab dang o dia chi cam cua trinh duyet (vi du: `chrome://`, `about:blank`, hoac Web Store). Hay thu tren mot trang web `https://` thong thuong.

### Q2: Dong ho bao "Not synced" hoac "Chua dong bo"?
- **Tra loi**: Do ket noi mang cham hoac domain chua hoan tat do thoi gian khuu hoi RTT. Ban co the bam bieu tuong xoay tron ben canh dong ho tren HUD hoac bam `Re-sync` tren Popup de thuc hien can chinh lai ngay lap tuc.

### Q3: Nut tren trang web bi disabled (mo di) truoc gio G, tien ich co bam duoc khong?
- **Tra loi**: Hoan toan duoc. Tinh nang **Pick button** cho phep ban khoa ca nhung nut dang bi `disabled`. He thong se quan sat va ngay khi nut duoc kich hoat vao gio G, dong co san se ban loat click ngay lap tuc.

### Q4: May tinh dat mui gio khac (khong phai GMT+7) thi he thong co san dung gio khong?
- **Tra loi**: Luon luon dung. Thuat toan gio cua DealHunter luon quy doi thoi gian ve chuan gio Viet Nam (GMT+7, khong DST), dam bao chay dung gio du ban dang o bat ky quoc gia nao tren the gioi.

### Q5: Tai sao mo 3 cua so trinh duyet tren cung 1 may lai cham hon chay 1 cua so duy nhat?
- **Tra loi**: Trinh duyet Chromium tu dong ap dung co che bop nghen tai nguyen nen (Background Tab / Inactive Window Throttling) doi voi cac cua so khong duoc nguoi dung focus truc tiep. Chay nhieu tai khoan song song tren cung 1 may khien timer bi cham tre va bang thong mang bi phan manh, dan den ket qua thap hon (Top 8, 9, 15). Khuyen nghi chi su dung **1 tai khoan chinh tren 1 cua so duy nhat duoc focus** de dat toc do Top 1 tuyet doi.

---

## 9. Luu Y Quan Trong Va An Toan Tai Khoan

1. **Bao mat tuyet doi**: Tien ich hoat dong hoan toan tai phia client tren trinh duyet cua ban, su dung phien dang nhap co san cua chinh ban. Tien ich khong bao gio luu tru mat khau hay thong tin the tin dung.
2. **Uu tien 1 tai khoan / 1 cua so focus duy nhat**: Voi cac deal mili-giay khoc liet (nhu diem danh doi thuong caffiliate.vn), luon giu 1 cua so trinh duyet duy nhat tren man hinh va dam bao cua so dang duoc focus.
3. **Chuan bi truoc gio G**:
   - Voi Shopee: Dang nhap san tai khoan, mo thu trang voucher truoc 5-10 phut de vuot qua captcha neu co.
   - Voi cac trang web khac: Dang nhap va chon san thong tin can thiet tren man hinh de san sang bam nut ngay khi gio G den.
4. **Giu trinh duyet hoat dong**: Khong gap man hinh hoac de may tinh roi vao che do Sleep neu ban dat lich san tu dong khi khong ngoi truoc may.
