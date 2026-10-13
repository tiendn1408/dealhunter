# Deal Hunter — Thu Vien Tai Lieu Du An (Documentation Index)

Chao mung ban den voi kho tai lieu cua he thong **Deal Hunter**. Tai lieu duoc to chuc theo tung chuyen muc ro rang de phuc vu viec phat trien, van hanh va mo rong cac giai doan tiep theo.

Cap nhat: 2026-10-09

---

## Muc Luc Tai Lieu

### 1. Kien Truc He Thong (`docs/architecture/`)
Chua cac tai lieu mo ta kien truc tong the, quyet dinh ky thuat va thiet ke du lieu dai han:
- [**overview.md**](architecture/overview.md): Tong quan kien truc he thong (Modular Monolith, Ports & Adapters, phan tang ma nguon).

---

### 2. Ke Hoach & Dac Ta Nghiep Vu Theo Phase (`docs/plans/`)
Chua tai lieu PRD, dac ta BA/PM va ke hoach trien khai chi tiet cho tung giai doan:
- [**phase-1-core-tracking.md**](plans/phase-1-core-tracking.md): Dac ta goc va tieu chuan nghiem thu Phase 1 (Core Price Tracking Pipeline).
- [**phase-2-alert-and-zalo.md**](plans/phase-2-alert-and-zalo.md): Ke hoach va thiet ke kien truc chuan bi cho Phase 2 (Alert Engine + Zalo Notification).
- [**phase-3-cross-platform.md**](plans/phase-3-cross-platform.md): Ke hoach va thiet ke kien truc Phase 3 (Cross-platform Price Comparison).
- [**gap-resolution-and-foundation-completion.md**](plans/gap-resolution-and-foundation-completion.md): Ke hoach giai quyet dut diem cac thanh phan con thieu (Scraper thuc te, Auth, Auto-matching, Local dev runner) va ghi chu trien khai Docker tai Phase 6.
- [**phase-3-5-monetization-and-voucher-engine.md**](plans/phase-3-5-monetization-and-voucher-engine.md): Ke hoach & dac ta ky thuat Phase 3.5 (Monetization & Voucher Engine - Tiep thi lien ket Affiliate & San voucher 2 buoc).
- [**chrome-extension-assistant-and-fast-clicker.md**](plans/chrome-extension-assistant-and-fast-clicker.md): Ke hoach ban dau cua Chrome Extension (tai lieu lich su; hanh vi hien tai xem `docs/extension/`).
- [**hardening-before-phase-4.md**](plans/hardening-before-phase-4.md): Ke hoach gia co bao mat, do tin cay va tinh dung dan du lieu sau dot ra soat Phase 1 -> 3.5 (bat buoc truoc khi deploy production va Phase 4).

---

### 3. Cam Nang Van Hanh & Huong Dan (`docs/runbooks/`)
Chua cac huong dan cai dat moi truong, chay ung dung, cau hinh va xu ly su co:
- [**setup-and-run.md**](runbooks/setup-and-run.md): Huong dan cau hinh moi truong (.env), chay Docker Compose, migration va khoi dong cac tien trinh Go o moi truong local dev.

---

### 4. Trien Khai He Thong San Xuat (`docs/deployment/`)
Chua huong dan trien khai moi truong Production thuc te, dong goi Docker, bao mat va sao luu:
- [**production-deployment-guide.md**](deployment/production-deployment-guide.md): Cam nang trien khai Production toan dien (Docker Compose Prod, Systemd, Nginx SSL, Migration Runbook, Monitoring & Backup).

---

### 5. Dac Ta Giao Dien Lap Trinh REST API (`docs/api/`)
Chua danh muc day du tat ca cac endpoint HTTP API, tham so va vi du curl:
- [**rest-api-reference.md**](api/rest-api-reference.md): Dac ta chi tiet 24+ endpoint (Health, Auth, Tracking, Pricing, Alerts, Notifications, Comparison, Auto-Matching, Vouchers, Webhook).

---

### 6. Tien Ich Chrome DealHunter Assistant (`docs/extension/` & `extension/`)
Chua toan bo tai lieu ky thuat, huong dan va dac ta kien truc cua tien ich trinh duyet:
- [**extension/README.md**](../extension/README.md): Huong dan cai dat, ban phat hanh / ban dev (`npm run build` / `npm run build:dev`), kiem thu (30 file, 298 unit test) va cau truc ma nguon extension.
- [**huong-dan-su-dung.md**](extension/huong-dan-su-dung.md): Huong dan su dung cho nguoi khong chuyen: 3 buoc (mo trang, chon nut, chon gio), bang san tren trang, Lich san (hen gio, sua, them nut moi), Cai dat va xu ly su co.
- [**kien-truc-universal-sniper-va-state-machine.md**](extension/kien-truc-universal-sniper-va-state-machine.md): Kien truc hien tai: popup / bang san / background, tim lai nut sau tai trang, xac nhan hoan tat, tai trang truoc gio tu do, hang doi lich san, canh gio may chu va Caffiliate 3 tang.
- [**ket-noi-web-extension.md**](extension/ket-noi-web-extension.md): Giao thuc `DH_WEB_SESSION` giua web va extension, origin theo ban build, bien `NEXT_PUBLIC_EXTENSION_ID`, huy hieu gia va quy tac an toan.
- [**ra-soat-loi-va-ke-hoach-sua.md**](extension/ra-soat-loi-va-ke-hoach-sua.md): Bien ban ra soat loi extension va trang thai sua thuc te cua tung muc.

---

## Quy Chuan Dat Ten Tai Lieu (Documentation Conventions)

De chuan bi cho cac giai doan tiep theo (Phase 2, Phase 3, ...), tat ca tai lieu trong thu muc `docs/` tuan thu cac quy tac sau:
1. **Dinh dang file**: Su dung chu thuong ket hop dau gach ngang (`kebab-case`), vi du: `phase-2-alert-and-zalo.md`.
2. **Phan nhom dung thu muc**:
   - `docs/plans/`: Chi chua ke hoach va dac ta nghiep vu theo tung Phase (`phase-X-*.md`).
   - `docs/architecture/`: Chua so do, thiet ke database, queue, bao mat dung chung.
   - `docs/runbooks/`: Chua huong dan thao tac, van hanh thuc te.
   - `docs/extension/`: Chua tai lieu chi tiet ve tien ich mo rong Chrome.
