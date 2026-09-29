# Deal Hunter — Thư Viện Tài Liệu Dự Án (Documentation Index)

Chào mừng bạn đến với kho tài liệu của hệ thống **Deal Hunter**. Tài liệu được tổ chức theo từng chuyên mục rõ ràng để phục vụ việc phát triển, vận hành và mở rộng các giai đoạn tiếp theo.

---

## 🗂️ Mục Lục Tài Liệu

### 1. 🏗️ Kiến Trúc Hệ Thống (`docs/architecture/`)
Chứa các tài liệu mô tả kiến trúc tổng thể, quyết định kỹ thuật và thiết kế dữ liệu dài hạn:
- [**overview.md**](file:///Users/tien.dang/Workplace/reference/deal_hunter/docs/architecture/overview.md): Tổng quan kiến trúc hệ thống (Modular Monolith, Ports & Adapters, phân tầng mã nguồn).

---

### 2. 📋 Kế Hoạch & Đặc Tả Nghiệp Vụ Theo Phase (`docs/plans/`)
Chứa tài liệu PRD, đặc tả BA/PM và kế hoạch triển khai chi tiết cho từng giai đoạn:
- [**phase-1-core-tracking.md**](file:///Users/tien.dang/Workplace/reference/deal_hunter/docs/plans/phase-1-core-tracking.md): Đặc tả gốc & tiêu chuẩn nghiệm thu Phase 1 (Core Price Tracking Pipeline).
- [**phase-2-alert-and-zalo.md**](file:///Users/tien.dang/Workplace/reference/deal_hunter/docs/plans/phase-2-alert-and-zalo.md): Kế hoạch và thiết kế kiến trúc chuẩn bị cho Phase 2 (Alert Engine + Zalo Notification).

---

### 3. 🚀 Cẩm Nang Vận Hành & Hướng Dẫn (`docs/runbooks/`)
Chứa các hướng dẫn cài đặt môi trường, chạy ứng dụng, cấu hình và xử lý sự cố:
- [**setup-and-run.md**](file:///Users/tien.dang/Workplace/reference/deal_hunter/docs/runbooks/setup-and-run.md): Hướng dẫn cấu hình môi trường (.env), chạy Docker Compose, migration và khởi động 3 tiến trình Go (`api`, `worker`, `scheduler`).

---

## 📐 Quy Chuẩn Đặt Tên Tài Liệu (Documentation Conventions)

Để chuẩn bị cho các giai đoạn tiếp theo (Phase 2, Phase 3, ...), tất cả tài liệu trong thư mục `docs/` tuân thủ các quy tắc sau:
1. **Định dạng file**: Sử dụng chữ thường kết hợp dấu gạch ngang (`kebab-case`), ví dụ: `phase-2-alert-and-zalo.md`.
2. **Phân nhóm đúng thư mục**:
   - `docs/plans/`: Chỉ chứa kế hoạch và đặc tả nghiệp vụ theo từng Phase (`phase-X-*.md`).
   - `docs/architecture/`: Chứa sơ đồ, thiết kế database, queue, bảo mật dùng chung.
   - `docs/runbooks/`: Chứa hướng dẫn thao tác, vận hành thực tế.
