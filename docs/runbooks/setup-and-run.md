# DealHunter — Hướng dẫn Cài đặt & Vận hành Local (macOS / Apple Silicon M-series)

Tài liệu hướng dẫn từ đầu (zero-to-running) cách cài đặt, cấu hình môi trường, khởi động hạ tầng Docker, chạy database migrations và vận hành toàn bộ hệ sinh thái **DealHunter** (Go Backend, Next.js Web, và Chrome Extension).

---

## 1. Tổng quan Kiến trúc Local & Các Cổng (Ports)

| Dịch vụ | Công nghệ | Cổng Local | URL / Lệnh kiểm tra |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | Docker (`postgres:15-alpine`) | `5433` | `postgres://dealuser:dealpass@localhost:5433/dealdb` |
| **Redis** | Docker (`redis:7-alpine`) | `6380` | `redis://localhost:6380` |
| **Backend API Server** | Go 1.24+ (`cmd/api`) | `8080` | `http://localhost:8080/api/v1/health` |
| **Worker Pool** | Go 1.24+ (`cmd/worker`) | — | Xử lý cào giá & đánh giá cảnh báo qua Redis Streams |
| **Scheduler** | Go 1.24+ (`cmd/scheduler`) | — | Quét định kỳ kiểm tra giá & so sánh |
| **Notifier** | Go 1.24+ (`cmd/notifier`) | — | Gửi thông báo & Zalo |
| **Web Frontend** | Next.js 14 (`dealhunter-web`) | `3000` | `http://localhost:3000` |
| **Chrome Extension** | TypeScript + Vite/React | — | Load Unpacked tại `chrome://extensions` |

---

## 2. Yêu cầu Tiên quyết (Prerequisites)

Đảm bảo máy Mac của bạn đã cài đặt các công cụ sau:

1. **Homebrew**:
   ```bash
   brew --version
   ```
2. **Go (1.24+)**:
   Nếu chưa có, cài đặt qua Homebrew:
   ```bash
   brew install go
   go version
   ```
3. **Docker Desktop**:
   Cài đặt [Docker Desktop cho Mac (Apple Silicon)](https://www.docker.com/products/docker-desktop/).
   > [!IMPORTANT]
   > Bạn cần **mở ứng dụng Docker Desktop** để Docker daemon chạy ngầm trước khi thực hiện các lệnh tiếp theo.
4. **Node.js & npm (v20+)**:
   Dùng cho Next.js Web App và Chrome Extension:
   ```bash
   node -v
   npm -v
   ```

---

## 3. Cấu hình Môi trường Backend (`.env`)

Tạo file `.env` tại thư mục `dealhunter/` (thư mục backend):

```bash
cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
```

Tạo file `.env` với nội dung chuẩn dành riêng cho local development:

```bash
cat << 'EOF' > .env
# =====================================================
# DealHunter — Local Development Configuration
# =====================================================
APP_ENV=development

# PostgreSQL (Docker ánh xạ cổng 5433)
DATABASE_URL=postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable

# Redis (Docker ánh xạ cổng 6380)
REDIS_URL=redis://localhost:6380

# JWT Auth (Khóa mặc định an toàn cho môi trường development)
JWT_SECRET=dealhunter-super-secret-jwt-key-32bytes-secure!
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=720h

# Google OAuth (Để trống khi chạy local nếu chưa cấu hình GCP)
GOOGLE_CLIENT_ID=

# HTTP Server
HTTP_PORT=8080
LOG_LEVEL=debug

# CORS — Cho phép Web Frontend và Chrome Extension kết nối
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Worker Settings
WORKER_CONCURRENCY=5
DEFAULT_POLL_INTERVAL=1800
FETCH_TIMEOUT=10s
MAX_RETRY=3

# Zalo Notification (Tắt trên local dev)
ZALO_ENABLED=false
EOF
```

---

## 4. Khởi động Hạ tầng Docker (PostgreSQL & Redis)

Tại thư mục `dealhunter/`:

```bash
docker compose up -d postgres redis
```

Kiểm tra trạng thái container:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```
Kết quả mong đợi: Cả 2 container `dealhunter-postgres` (port 5433) và `dealhunter-redis` (port 6380) đều ở trạng thái `Up`.

---

## 5. Chạy Database Migrations

Khởi tạo các bảng dữ liệu cần thiết (Users, Products, Snapshots, Alerts, Vouchers, v.v.):

```bash
cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
go run cmd/migrate/main.go up
```
Kết quả thành công sẽ báo: `Migrated UP successfully.`

---

## 6. Vận hành Hệ sinh thái (2 Lựa chọn)

### Lựa chọn A: Chạy Tự động Toàn bộ bằng 1 Lệnh (Khuyên dùng)

Script `dev-all.sh` sẽ tự động khởi động:
- Docker Postgres & Redis
- Chạy migrations
- Chạy API Server (:8080)
- Chạy Worker Pool
- Chạy Scheduler
- Chạy Notifier
- Chạy Next.js Web Frontend (:3000)

```bash
cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
./scripts/dev-all.sh
```
> Khi muốn dừng toàn bộ dịch vụ, chỉ cần nhấn `Ctrl + C`.

---

### Lựa chọn B: Chạy Riêng Lẻ Từng Dịch Vụ (Dễ Debug)

Nếu muốn theo dõi log chi tiết từng thành phần, mở các cửa sổ Terminal riêng:

- **Terminal 1 — Backend API Server (:8080)**:
  ```bash
  cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
  go run cmd/api/main.go
  ```

- **Terminal 2 — Worker Pool (Cào giá & xử lý hàng đợi)**:
  ```bash
  cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
  go run cmd/worker/main.go
  ```

- **Terminal 3 — Scheduler (Lập lịch kiểm tra định kỳ)**:
  ```bash
  cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
  go run cmd/scheduler/main.go
  ```

- **Terminal 4 — Notifier (Động cơ thông báo)**:
  ```bash
  cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
  go run cmd/notifier/main.go
  ```

- **Terminal 5 — Web Frontend (:3000)**:
  ```bash
  cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter-web
  npm install
  npm run dev
  ```

---

## 7. Cài đặt & Nạp Chrome Extension (DealHunter Assistant)

Để sử dụng extension săn deal / voucher:

1. **Build Extension**:
   ```bash
   cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension
   npm install
   npm run build
   ```
2. **Nạp vào Google Chrome / Brave / Edge**:
   - Mở trình duyệt và truy cập: `chrome://extensions/`
   - Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
   - Nhấn nút **Load unpacked** (Tải tiện ích đã giải nén).
   - Chọn thư mục:
     `/Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/dist`

---

## 8. Kiểm tra Hoạt động (Verification)

### 8.1. Kiểm tra API Health Check
```bash
curl http://localhost:8080/api/v1/health
```
Kết quả trả về:
```json
{"status":"ok","app":"DealHunter"}
```

### 8.2. Lấy Guest Token để thử nghiệm API
Mọi endpoint dữ liệu đều yêu cầu JWT Token. Lấy token guest nhanh:
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/guest | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "Token: $TOKEN"
```

### 8.3. Thêm sản phẩm theo dõi mẫu
```bash
curl -X POST http://localhost:8080/api/v1/tracked-products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://shopee.vn/product/123/456"}'
```

---

## 9. Xử lý Sự cố Thường gặp (Troubleshooting)

1. **Lỗi Docker daemon không phản hồi (`dial unix /Users/.../docker.sock: connect: no such file or directory`)**:
   - Mở ứng dụng **Docker Desktop** trên macOS và đợi icon cá voi ở thanh menu chuyển sang trạng thái running (xanh lá).

2. **Lỗi Migration báo `Dirty database`**:
   - Nếu quá trình migrate bị ngắt đột ngột:
     ```bash
     go run cmd/migrate/main.go force <version_number>
     ```

3. **Reset toàn bộ Database về trạng thái ban đầu**:
   ```bash
   cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
   make db-reset
   ```
   *(Lệnh này sẽ xóa sạch schema database và dữ liệu Redis DB 0, sau đó chạy lại migrate từ đầu)*.

4. **Dừng toàn bộ dịch vụ Docker**:
   ```bash
   cd /Users/tiendn/Workplace/Projects/deal-hunter/dealhunter
   docker compose down
   ```
