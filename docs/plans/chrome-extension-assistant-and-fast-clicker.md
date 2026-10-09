# DealHunter — Ke Hoach & Thiet Ke Ky Thuat Chrome Extension Assistant
# (Universal Fast Clicker, Multi-Platform Voucher Sniper & Price Intelligence)

> **Muc tieu tai lieu**: Dac ta vi tri kien truc, mo hinh du lieu, co che tuong tac API giua **Backend DealHunter** va **DealHunter Chrome Extension (Client-Side Assistant)**; mo ta toan dien nang luc **Universal Fast Clicker & Sniper tren moi trang web**, co che san voucher va bao toan hoa hong Affiliate da san TMDT.
>
> Cap nhat: 2026-10-09 · Ap dung cho ma nguon hoan thien trong `extension/src` va ban build `extension/dist`.

---

## 1. Boi Canh & Dinh Vi He Thong

### 1.1. Tu Shopee Voucher den Universal Web Sniper
Ban dau, tien ich duoc thiet ke de giai quyet bai toan san ma giam gia chop nhoang tren Shopee. Tuy nhien, qua trinh thuc te cho thay nguoi dung co nhu cau rat lon ve viec **click chinh xac vao dung thoi khac 00:00:00 hoac gio vang tren nhieu nen tang khac nhau**:
1. **San ve su kien / concert** tren cac trang ban ve (Ticketbox, Ticketmaster, v.v.): Cac su kien hot mo ban dung 00:00 hoac 12:00 thuong het ve trong 2 den 5 giay.
2. **Dang ky tin chi / hoc phan**: Cac cong dang ky cua truong dai hoc mo dung gio G, yeu cau bam nut "Dang ky" nhanh hon hang ngan sinh vien khac.
3. **Flash sale chop nhoang da san**: Ngoai Shopee, cac su kien mo ban gioi han tren Lazada, Tiki, TikTok Shop hoac cac website ban hang rieng biet.
4. **Voucher gia tri lon tren Shopee**: Cac ma giam 15% - 20%, voucher 500k - 1 trieu mo vao khung gio 0h, 9h, 12h, 15h, 18h, 21h het trong tich tac.

### 1.2. Nguyen Ly Thiet Ke Client-Side Assistant (Manifest V3)
Thay vi can thiep bang bot tu may chu backend (de bi he thong Cloudflare WAF, captcha, chan IP va khoa tai khoan F02/M04), DealHunter trien khai kien truc **Client-Side Assistant** chay truc tiep tren trinh duyet nguoi dung:
- Su dung session dang nhap chinh chu, cookie va dia chi IP hop le cua nguoi dung -> **100% an toan va khong bi coi la bot can thiep trai phep**.
- Tinh toan do lech thoi gian mili-giay giua may tinh va server (NTP Time Calibration).
- Web Worker High-Resolution Timer doc lap duy tri nhip tick 10ms khong bi trinh duyet Chrome bop nghet tai nguyen khi tab chay nen.
- Mo phong chuoi su kien chuot nguoi that (Anti-Bot Human Clicker) voi toa do ngau nhien de tranh bi phat hien.

---

## 2. Kien Truc Tong The He Thong

```mermaid
flowchart TD
    subgraph Browser ["Trinh Duyet Nguoi Dung (Client Browser)"]
        subgraph TargetPages ["Cac Trang Web Muc Tieu"]
            WebTab["Universal Web Page (Ticketbox, Dang ky hoc phan, Event URLs)"]
            ShopeeTab["Shopee Web (Voucher Hub, Cart, Product Page)"]
        end
        
        subgraph Extension ["DealHunter Chrome Extension (Manifest V3)"]
            HUD["Floating HUD (Sniper · Domain, 00:00 Preset, Target Picker, EN/VI)"]
            Scheduler["Background Scheduler (chrome.alarms, Full-Auto, Custom URL)"]
            PriceBadge["Price History Badge (Floating Widget tren Product Page)"]
            CoreEngine["Core Engine (NTP TimeSync, WebWorker, HumanizedClick)"]
            PopupApp["Popup Dashboard (3 Tabs: Live Sniper, Schedule, My Hunts)"]
        end
        
        WebDashboard["DealHunter Web (Next.js 14 Dashboard)"]
    end

    subgraph Backend ["DealHunter Backend (Go Monolith)"]
        API["REST API Server (cmd/api)"]
        VoucherService["Voucher Intelligence (internal/voucher)"]
        ComparisonService["Comparison Engine (internal/comparison)"]
        AffiliateTransformer["Affiliate Transformer (pkg/affiliate)"]
        Database[(PostgreSQL 15)]
        RedisCache[(Redis Cache & Stream)]
    end

    HUD <-->|DOM Events & Real Clicks| WebTab
    HUD <-->|DOM Events & Real Clicks| ShopeeTab
    PriceBadge <-->|Extract SKU| ShopeeTab
    Scheduler -->|chrome.tabs.create| WebTab
    Scheduler -->|chrome.tabs.create| ShopeeTab
    
    PriceBadge -->|GET /tracked-products/{id}/comparison| API
    HUD -->|GET /tracked-products/{id}/vouchers| API
    WebDashboard -->|REST API| API
    
    API <--> VoucherService
    API <--> ComparisonService
    VoucherService --> AffiliateTransformer
    ComparisonService --> RedisCache
    ComparisonService --> Database
```

---

## 3. Cac Tinh Nang Va Luong Nghiep Vu Chinh

### 3.1. Universal Live Sniper (Ban Tia Truc Tiep Tren Moi Trang Web)
- **Pham vi**: Ap dung tren moi trang web HTTP/HTTPS (`<all_urls>`).
- **Nhan dien tu dong**: Khi mo Popup, he thong tu dong phat hien domain hien tai (vi du: `ticketbox.vn active`, `shopee.vn active`) va hien nut lon noi bat:
  `START SNIPER ON THIS PAGE` / `BAT DAU SAN TREN TRANG NAY`.
- **Bang dieu khien Floating HUD**:
  - Hien thi tieu de dong theo domain: `DealHunter · Sniper · <domain>`.
  - Ba moc gio truc chien:
    + `[00:00]`: Canh nua dem dung 00:00:00.000 (khuyen dung cho moi trang web).
    + `[Next flash]`: Canh gio sale ke tiep (0h, 9h, 12h, 15h, 18h, 21h).
    + `[Next min]`: Canh dau phut ke tiep de kiem tra truoc.
  - **Khoa nut muc tieu (Target Picker)**:
    + Nut `Pick button` (`Chon nut`): Ho tro re chuot va khoa **bat ky nut nao tren DOM** cua bat ky website nao (ke ca khi nut dang bi disable/mo truoc gio G).
    + Nut `Auto-detect` (`Tu quet nut`): Quet nhanh nut Luu voucher Shopee.
  - **Phat hoa luc (Arming & Firing)**:
    + Khi bam `Arm sniper`, he thong vao trang thai truc chien dem nguoc miligiay.
    + Dung gio G (truoc 150ms de bu do tre mang), he thong ban loat click 35ms/click vao dung nut da khoa cho den khi trang xac nhan hoac het cua so 3 giay.

### 3.2. Full-Auto Schedule Voi Custom URL (Hen Gio Tu Dong 100%)
- **Pham vi**: Khong chi gioi han cac trang Hub co san cua Shopee, nguoi dung co the dat lich cho **bat ky duong link web nao** qua tuy chon `Custom URL`.
- **Quy trinh hen gio**:
  1. Mo popup -> The `Schedule`.
  2. Chon gio chay (`00`, `09`, `12`, `15`, `18`, `21`).
  3. Chon trang muc tieu: Shopee Hub, 10.10 Sale, Cart, hoac **`Custom URL`**.
  4. Voi `Custom URL`, nguoi dung co the bam nut 1-click **`Use current page`** (`Dung link hien tai`) de tu dong dien link dang xem hoac dan link tuy y.
  5. Dien tu khoa (neu can).
  6. Service Worker tao `chrome.alarms`.
- **Quy trinh thuc thi luc gio G**:
  1. **Truoc gio G 60 giay**: Service Worker danh thuc, do lai RTT dong bo gio va goi `chrome.tabs.create` mo tab moi den link muc tieu.
  2. **Tab tai xong**: Content script tu dong cuon man hinh toi vi tri nut va san sang.
  3. **Dung gio G**: Tu dong kich hoat chuoi burst click va ghi lai ket qua vao the `My Hunts`.

### 3.3. In-Page Price Intelligence (Theo Doi & So Sanh Gia Xuyen San)
- Khi nguoi dung xem san pham tren Shopee (`shopee.vn/product/...` hoac `shopee.vn/*-i.*.*`), component `PriceHistoryBadge` kiem tra voi Backend DealHunter:
  - Neu san pham da duoc theo doi: Hien thi gia day lich su 30 ngay va thong bao so sanh neu san khac (Lazada / TikTok Shop) co gia re hon.
  - Neu san pham chua theo doi: Hien thi nut de nguoi dung theo doi nhanh 1-cham vao tai khoan DealHunter.

---

## 4. Chi Tiet Kien Truc Ma Nguon Extension

Ma nguon extension tai `extension/src` duoc to chuc ro rang va toi uu theo module:

```text
extension/
├── public/
│   ├── manifest.json            # Manifest V3 (<all_urls>, scripting, storage, alarms)
│   └── icons/                   # Logo DealHunter cac kich thuoc 16, 24, 32, 48, 128, 512
├── src/
│   ├── background/
│   │   ├── index.ts             # Service Worker khoi tao, dieu phoi message
│   │   ├── scheduler.ts         # chrome.alarms quan ly lich hen, tu dong mo tab
│   │   ├── time_calibrator.ts   # Tinh toan do lech gio qua HTTP HEAD RTT
│   │   └── web_session.ts       # Quan ly phien dang nhap tu web DealHunter
│   ├── content/
│   │   ├── core/
│   │   │   ├── element_resolver.ts # Quet, trich xuat descriptor va relocate nut DOM
│   │   │   ├── human_clicker.ts    # Chuoi su kien chuot nguoi that voi random jitter
│   │   │   ├── hunt_engine.ts      # Vong lap truc chien miligiay, ho tro user-locked target
│   │   │   ├── time_sync_client.ts # Client dong bo gio miligiay
│   │   │   └── timer_worker.ts     # Web Worker Ticker 10ms khong bi throttle
│   │   ├── ui/
│   │   │   ├── FloatingHUD.tsx     # Bang dieu khien Sniper noi tren trang (00:00, pick button)
│   │   │   └── PriceHistoryBadge.tsx # Huy hieu gia tren trang san pham
│   │   └── index.tsx            # Content script entrypoint, lang nghe ACTIVATE_HUD
│   ├── popup/
│   │   ├── components/
│   │   │   ├── ScheduleForm.tsx    # Form dat lich hen (ho tro Custom URL)
│   │   │   ├── TaskList.tsx        # Danh sach lich hen va ket qua
│   │   │   └── TimeOffsetCard.tsx  # The trang thai dong bo gio va ping RTT
│   │   ├── App.tsx              # Popup giao dien 3 tab, nhan dien domain active
│   │   └── index.tsx            # Popup mount
│   └── lib/
│       ├── constants.ts         # Hang so he thong
│       ├── drop_time.ts         # Tinh toan moc gio Viet Nam (GMT+7)
│       ├── i18n.ts              # Tu dien song ngu EN (mac dinh) / VI co dau
│       ├── storage.ts           # Wrapper chrome.storage
│       └── types.ts             # TypeScript interfaces
```

---

## 5. Cac Co Che Phong Ve & Chong Chan Bot (Anti-Bot Defenses)

1. **Synthetic Pointer/Mouse Event Chain**:
   Khong bao gio goi `element.click()` don thuan. Thay vao do, `human_clicker.ts` phat day du 7 su kien lien tiep:
   `pointerover` -> `pointerenter` -> `pointerdown` -> `mousedown` -> `focus` -> `pointerup` -> `mouseup` -> `click`
2. **Random Coordinate Jitter (30% - 70%)**:
   Toa do moi cu click duoc tinh toan ngau nhien trong pham vi an toan ben trong khung nut, tranh bi he thong an ninh phat hien toa do co dinh bat thuong.
3. **Tu dong ngat va gioi han an toan**:
   Moi phien burst click gioi han toi da 80 clicks trong vong 3 giay. He thong tu dong dung ngay lap tuc khi nut chuyen sang trang thai hoan tat (Da luu, Het luot, hoac bien mat).

---

## 6. Quy Chuan Chat Luong & Kiem Thu

- **35/35 Unit Tests Vitest Pass**:
  Bao phu toan dien tu thuat toan NTP time calibrator, drop time GMT+7, human clicker jitter, element resolver den hunt engine ho tro universal locked target tren moi trang web.
- **Zero-Emoji Policy**:
  Toan bo ma nguon, giao dien nguoi dung (UI) va tai lieu he thong tuan thu tuyet doi 100% quy chuan Zero-Emoji.
- **Song ngu chuan muc**:
  Giao dien tieng Anh mac dinh toan cau, kem ho tro tieng Viet co dau chuan xac 100% co the chuyen doi tuc thi.
