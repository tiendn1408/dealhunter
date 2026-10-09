# Deal Hunter — Thu Vien Tai Lieu Du An (Documentation Index)

Chao mung ban den voi kho tai lieu cua he thong **Deal Hunter**. Tai lieu duoc to chuc theo tung chuyen muc ro rang de phuc vu viec phat trien, van hanh va mo rong cac giai doan tiep theo.

Cap nhat: 2026-10-09

---

## Muc Luc Tai Lieu

### 1. Kien Truc He Thong (`docs/architecture/`)
Chua cac tai lieu mo ta kien truc tong the, quyet dinh ky thuat va thiet ke du lieu dai han:
- [**overview.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/architecture/overview.md): Tong quan kien truc he thong (Modular Monolith, Ports & Adapters, phan tang ma nguon).

---

### 2. Ke Hoach & Dac Ta Nghiep Vu Theo Phase (`docs/plans/`)
Chua tai lieu PRD, dac ta BA/PM va ke hoach trien khai chi tiet cho tung giai doan:
- [**phase-1-core-tracking.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/phase-1-core-tracking.md): Dac ta goc va tieu chuan nghiem thu Phase 1 (Core Price Tracking Pipeline).
- [**phase-2-alert-and-zalo.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/phase-2-alert-and-zalo.md): Ke hoach va thiet ke kien truc chuan bi cho Phase 2 (Alert Engine + Zalo Notification).
- [**phase-3-cross-platform.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/phase-3-cross-platform.md): Ke hoach va thiet ke kien truc Phase 3 (Cross-platform Price Comparison).
- [**gap-resolution-and-foundation-completion.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/gap-resolution-and-foundation-completion.md): Ke hoach giai quyet dut diem cac thanh phan con thieu (Scraper thuc te, Auth, Auto-matching, Local dev runner) va ghi chu trien khai Docker tai Phase 6.
- [**phase-3-5-monetization-and-voucher-engine.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/phase-3-5-monetization-and-voucher-engine.md): Ke hoach & dac ta ky thuat Phase 3.5 (Monetization & Voucher Engine - Tiep thi lien ket Affiliate & San voucher 2 buoc).
- [**chrome-extension-assistant-and-fast-clicker.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/chrome-extension-assistant-and-fast-clicker.md): Dac ta kien truc & ke hoach Chrome Extension Assistant (Universal Fast Clicker & Multi-Platform Voucher Sniper).
- [**hardening-before-phase-4.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/plans/hardening-before-phase-4.md): Ke hoach gia co bao mat, do tin cay va tinh dung dan du lieu sau dot ra soat Phase 1 -> 3.5 (bat buoc truoc khi deploy production va Phase 4).

---

### 3. Cam Nang Van Hanh & Huong Dan (`docs/runbooks/`)
Chua cac huong dan cai dat moi truong, chay ung dung, cau hinh va xu ly su co:
- [**setup-and-run.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/runbooks/setup-and-run.md): Huong dan cau hinh moi truong (.env), chay Docker Compose, migration va khoi dong cac tien trinh Go o moi truong local dev.

---

### 4. Trien Khai He Thong San Xuat (`docs/deployment/`)
Chua huong dan trien khai moi truong Production thuc te, dong goi Docker, bao mat va sao luu:
- [**production-deployment-guide.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/deployment/production-deployment-guide.md): Cam nang trien khai Production toan dien (Docker Compose Prod, Systemd, Nginx SSL, Migration Runbook, Monitoring & Backup).

---

### 5. Dac Ta Giao Dien Lap Trinh REST API (`docs/api/`)
Chua danh muc day du tat ca cac endpoint HTTP API, tham so va vi du curl:
- [**rest-api-reference.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/api/rest-api-reference.md): Dac ta chi tiet 24+ endpoint (Health, Auth, Tracking, Pricing, Alerts, Notifications, Comparison, Auto-Matching, Vouchers, Webhook).

---

### 6. Tien Ich Chrome DealHunter Assistant (`docs/extension/` & `extension/`)
Chua toan bo tai lieu ky thuat, huong dan va dac ta kien truc cua tien ich trinh duyet:
- [**extension/README.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/README.md): Huong dan cai dat, phat trien, kiem thu (151 unit tests) va dong goi extension.
- [**huong-dan-su-dung.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/extension/huong-dan-su-dung.md): Huong dan su dung chi tiet cac che do Live Sniper, Schedule, My Hunts va xu ly su co.
- [**kien-truc-universal-sniper-va-state-machine.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/extension/kien-truc-universal-sniper-va-state-machine.md): Dac ta kien truc Universal Sniper, May trang thai hanh vi (Behavioral State Machine) va Dong co sinh trac hoc Adaptive 3 pha.
- [**ket-noi-web-extension.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/extension/ket-noi-web-extension.md): Dac ta giao thuc ket noi hai chieu giua DealHunter Web App va Extension qua `externally_connectable` va `chrome.storage.session`.
- [**ra-soat-loi-va-ke-hoach-sua.md**](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/docs/extension/ra-soat-loi-va-ke-hoach-sua.md): Bien ban ra soat toan dien, theo doi khac phuc loi (Dot 1, Dot 2, Dot 3) va danh gia an toan.

---

## Quy Chuan Dat Ten Tai Lieu (Documentation Conventions)

De chuan bi cho cac giai doan tiep theo (Phase 2, Phase 3, ...), tat ca tai lieu trong thu muc `docs/` tuan thu cac quy tac sau:
1. **Dinh dang file**: Su dung chu thuong ket hop dau gach ngang (`kebab-case`), vi du: `phase-2-alert-and-zalo.md`.
2. **Phan nhom dung thu muc**:
   - `docs/plans/`: Chi chua ke hoach va dac ta nghiep vu theo tung Phase (`phase-X-*.md`).
   - `docs/architecture/`: Chua so do, thiet ke database, queue, bao mat dung chung.
   - `docs/runbooks/`: Chua huong dan thao tac, van hanh thuc te.
   - `docs/extension/`: Chua tai lieu chi tiet ve tien ich mo rong Chrome.
