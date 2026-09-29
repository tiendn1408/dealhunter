# Deal Hunter — Hướng dẫn Cấu hình và Vận hành (Phase 1)

Tài liệu này hướng dẫn chi tiết cách cấu hình môi trường, khởi động hạ tầng phụ thuộc, chạy database migrations và vận hành các dịch vụ trong hệ thống **Deal Hunter**.

---

## 1. Yêu cầu Tiên quyết (Prerequisites)

Trước khi bắt đầu, đảm bảo máy của bạn đã cài đặt các công cụ sau:

- **Go**: Phiên bản `1.23+` ([Tải tại golang.org](https://go.dev/dl/))
- **Docker & Docker Compose**: Để chạy PostgreSQL và Redis ([Tải Docker Desktop](https://www.docker.com/products/docker-desktop/))
- **Make**: (Tùy chọn) Có sẵn trên macOS/Linux để chạy lệnh tắt qua `Makefile`.
- **curl** hoặc **Postman**: Để kiểm tra và gọi API.

---

## 2. Cấu hình Môi trường (.env)

Tạo file cấu hình `.env` tại thư mục gốc của dự án bằng cách copy từ `.env.example`:

```bash
cd /Users/tien.dang/Workplace/reference/deal_hunter
cp .env.example .env
```

### Ý nghĩa các biến môi trường:

| Biến môi trường | Mặc định | Ý nghĩa |
| :--- | :--- | :--- |
| `APP_ENV` | `development` | Môi trường chạy ứng dụng (`development` / `production`). |
| `HTTP_PORT` | `8080` | Cổng lắng nghe của API Server. |
| `DATABASE_URL` | `postgres://dealuser:dealpass@localhost:5432/dealdb?sslmode=disable` | Chuỗi kết nối PostgreSQL. |
| `REDIS_URL` | `redis://localhost:6379` | Địa chỉ kết nối Redis (dùng cho Redis Streams queue). |
| `WORKER_CONCURRENCY`| `10` | Số worker goroutine chạy song song để xử lý fetch giá. |
| `DEFAULT_POLL_INTERVAL` | `1800` | Chu kỳ mặc định giữa các lần kiểm tra giá (tính bằng giây, 1800 = 30 phút). |
| `FETCH_TIMEOUT` | `10s` | Thời gian timeout tối đa cho mỗi lần gọi adapter lấy giá. |
| `MAX_RETRY` | `5` | Số lần thử lại tối đa trước khi đánh dấu job là `dead`. |

---

## 3. Khởi động Hạ tầng (PostgreSQL & Redis)

Hệ thống phụ thuộc vào PostgreSQL (lưu trữ nghiệp vụ chính) và Redis (hàng đợi phân tán Redis Streams).

Khởi động các dịch vụ qua Docker Compose:

```bash
# Khởi động PostgreSQL và Redis ngầm
docker compose up -d postgres redis
```

Kiểm tra trạng thái container:
```bash
docker compose ps
```
Đảm bảo cả 2 container `postgres` (port `5432`) và `redis` (port `6379`) đều ở trạng thái `Up` hoặc `healthy`.

---

## 4. Chạy Database Migrations

Trước khi chạy ứng dụng, cần khởi tạo schema cơ sở dữ liệu (tạo bảng `users`, `products`, `product_sources`, `tracked_products`, `price_snapshots`, `fetch_jobs` và các indexes):

```bash
# Tải các Go module phụ thuộc (nếu chưa tải)
go mod tidy

# Chạy migration UP
go run cmd/migrate/main.go up
```

*(Nếu muốn rollback migrations: `go run cmd/migrate/main.go down` hoặc dùng `make migrate-up` / `make migrate-down`).*

---

## 5. Vận hành các Dịch vụ (Services)

Deal Hunter được thiết kế theo kiến trúc chia tách trách nhiệm thành 3 tiến trình (processes) độc lập:

1. **API Server (`cmd/api`)**: Tiếp nhận request từ người dùng.
2. **Scheduler (`cmd/scheduler`)**: Quét các sản phẩm đến hạn kiểm tra giá và đẩy job vào Redis Streams.
3. **Worker Pool (`cmd/worker`)**: Nhận job từ Redis Streams, gọi Adapter lấy giá và cập nhật lịch sử giá vào PostgreSQL.

Mở **3 cửa sổ terminal riêng biệt** tại thư mục dự án để chạy cả 3 dịch vụ:

### Terminal 1: Chạy API Server
```bash
go run cmd/api/main.go
```
*Server sẽ khởi động và lắng nghe tại cổng `http://localhost:8080`.*

### Terminal 2: Chạy Scheduler
```bash
go run cmd/scheduler/main.go
```
*Scheduler sẽ định kỳ quét các tracking tới hạn và đẩy vào Redis Streams `dh:stream:price-fetch`.*

### Terminal 3: Chạy Worker Pool
```bash
go run cmd/worker/main.go
```
*Worker pool sẽ lắng nghe job từ Redis Streams, gọi adapter và ghi snapshot giá.*

---

## 6. Kiểm tra & Kiểm thử Hệ thống (Verification)

### 6.1. Đăng ký theo dõi sản phẩm mới (`POST /api/v1/tracked-products`)

Gửi yêu cầu theo dõi một đường link sản phẩm:

```bash
# Test với link mock (đã có MockAdapter sẵn trong code)
curl -X POST http://localhost:8080/api/v1/tracked-products \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://mock.dealhunter.vn/product/12345"
  }'
```

**Phản hồi mẫu (HTTP 201 Created):**
```json
{
  "id": "c1f7a08b-626a-4d3e-908d-8a62f5bf7dc9",
  "product_source_id": "89e29a3e-7b7f-4f81-9b64-21b714571de4",
  "next_fetch_at": "2026-09-29T12:00:00Z"
}
```

### 6.2. Kiểm tra lịch sử giá (`GET /api/v1/tracked-products/:id/prices`)

Sử dụng `product_source_id` nhận được ở trên:

```bash
curl -X GET http://localhost:8080/api/v1/tracked-products/89e29a3e-7b7f-4f81-9b64-21b714571de4/prices
```

**Phản hồi mẫu:**
```json
{
  "product_source_id": "89e29a3e-7b7f-4f81-9b64-21b714571de4",
  "snapshots": [
    {
      "ID": 1,
      "ProductSourceID": "89e29a3e-7b7f-4f81-9b64-21b714571de4",
      "Price": 1200000,
      "ShippingFee": 15000,
      "EffectivePrice": 1215000,
      "Currency": "VND",
      "InStock": true,
      "CapturedAt": "2026-09-29T12:00:05Z",
      "CreatedAt": "2026-09-29T12:00:05Z"
    }
  ]
}
```

---

## 7. Khắc phục Sự cố Thường gặp (Troubleshooting)

1. **Lỗi `command not found: go`**:
   - Kiểm tra xem Go đã được cài đặt và thêm vào biến môi trường `PATH` chưa (`export PATH=$PATH:/usr/local/go/bin:/opt/homebrew/bin`).

2. **Lỗi kết nối PostgreSQL (`connection refused` hoặc `password authentication failed`)**:
   - Kiểm tra Docker container: `docker compose ps`
   - Đảm bảo biến `DATABASE_URL` trong file `.env` khớp với cấu hình trong `docker-compose.yml`.

3. **Lỗi Migration (`Dirty database`)**:
   - Nếu quá trình migration bị ngắt quãng giữa chừng, sử dụng lệnh force version:
     ```bash
     go run cmd/migrate/main.go force 1
     ```
