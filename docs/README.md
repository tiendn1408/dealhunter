# Deal Hunter — Thu Vien Tai Lieu Du An (Documentation Index)

Chao mung ban den voi kho tai lieu cua he thong **Deal Hunter**. Tai lieu duoc to chuc theo tung chuyen muc ro rang de phuc vu viec phat trien, van hanh va mo rong cac giai doan tiep theo.

---

## Muc Luc Tai Lieu

### 1. Kien Truc He Thong (`docs/architecture/`)
Chua cac tai lieu mo ta kien truc tong the, quyet dinh ky thuat va thiet ke du lieu dai han:
- [**overview.md**](file:///Users/tien.dang/Workplace/reference/dealhunter/docs/architecture/overview.md): Tong quan kien truc he thong (Modular Monolith, Ports & Adapters, phan tang ma nguon).

---

### 2. Ke Hoach & Dac Ta Nghiep Vu Theo Phase (`docs/plans/`)
Chua tai lieu PRD, dac ta BA/PM va ke hoach trien khai chi tiet cho tung giai doan:
- [**phase-1-core-tracking.md**](file:///Users/tien.dang/Workplace/reference/dealhunter/docs/plans/phase-1-core-tracking.md): Dac ta goc va tieu chuan nghiem thu Phase 1 (Core Price Tracking Pipeline).
- [**phase-2-alert-and-zalo.md**](file:///Users/tien.dang/Workplace/reference/dealhunter/docs/plans/phase-2-alert-and-zalo.md): Ke hoach va thiet ke kien truc chuan bi cho Phase 2 (Alert Engine + Zalo Notification).
- [**phase-3-cross-platform.md**](file:///Users/tien.dang/Workplace/reference/dealhunter/docs/plans/phase-3-cross-platform.md): Ke hoach va thiet ke kien truc Phase 3 (Cross-platform Price Comparison).

---

### 3. Cam Nang Van Hanh & Huong Dan (`docs/runbooks/`)
Chua cac huong dan cai dat moi truong, chay ung dung, cau hinh va xu ly su co:
- [**setup-and-run.md**](file:///Users/tien.dang/Workplace/reference/dealhunter/docs/runbooks/setup-and-run.md): Huong dan cau hinh moi truong (.env), chay Docker Compose, migration va khoi dong cac tien trinh Go.

---

## Quy Chuan Dat Ten Tai Lieu (Documentation Conventions)

De chuan bi cho cac giai doan tiep theo (Phase 2, Phase 3, ...), tat ca tai lieu trong thu muc `docs/` tuan thu cac quy tac sau:
1. **Dinh dang file**: Su dung chu thuong ket hop dau gach ngang (`kebab-case`), vi du: `phase-2-alert-and-zalo.md`.
2. **Phan nhom dung thu muc**:
   - `docs/plans/`: Chi chua ke hoach va dac ta nghiep vu theo tung Phase (`phase-X-*.md`).
   - `docs/architecture/`: Chua so do, thiet ke database, queue, bao mat dung chung.
   - `docs/runbooks/`: Chua huong dan thao tac, van hanh thuc te.
