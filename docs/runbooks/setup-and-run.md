# Deal Hunter — Huong dan Cau hinh va Van hanh (Phase 1, 2 & 3)

Tai lieu nay huong dan chi tiet cach cau hinh moi truong, khoi dong ha tang phu thuoc, chay database migrations va van hanh cac dich vu trong he thong **Deal Hunter**.

---

## 1. Yeu cau Tien quyet (Prerequisites)

Truoc khi bat dau, dam bao may cua ban da cai dat cac cong cu sau:

- **Go**: Phien ban `1.23+` ([Tai tai golang.org](https://go.dev/dl/))
- **Docker & Docker Compose**: De chay PostgreSQL va Redis ([Tai Docker Desktop](https://www.docker.com/products/docker-desktop/))
- **Make**: (Tuy chon) Co san tren macOS/Linux de chay lenh tat qua `Makefile`.
- **curl** hoac **Postman**: De kiem tra va goi API.

---

## 2. Cau hinh Moi truong (.env)

Tao file cau hinh `.env` tai thu muc goc cua du an bang cach copy tu `.env.example`:

```bash
cd /Users/tien.dang/Workplace/reference/dealhunter
cp .env.example .env
```

### Y nghia cac bien moi truong:

| Bien moi truong | Mac dinh | Y nghia |
| :--- | :--- | :--- |
| `APP_ENV` | `development` | Moi truong chay ung dung (`development` / `production`). |
| `HTTP_PORT` | `8080` | Cong lang nghe cua API Server. |
| `DATABASE_URL` | `postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable` | Chuoi ket noi PostgreSQL. |
| `REDIS_URL` | `redis://localhost:6379` | Dia chi ket noi Redis (hang doi stream va cache). |
| `WORKER_CONCURRENCY`| `10` | So worker goroutine chay song song de xu ly fetch gia. |
| `DEFAULT_POLL_INTERVAL` | `1800` | Chu ky mac dinh giua cac lan kiem tra gia (1800 = 30 phut). |
| `FETCH_TIMEOUT` | `10s` | Thoi gian timeout toi da cho moi lan goi adapter lay gia. |
| `MAX_RETRY` | `5` | So lan thu lai toi da truoc khi danh dau job la `dead`. |
| `ZALO_ENABLED` | `false` | Bat/tat ket noi Zalo thuc te (false dung Mock Sandbox). |
| `ZALO_OA_ACCESS_TOKEN` | | Token truy cap Zalo OA API. |
| `ZALO_TEMPLATE_ID` | | Template ID cho ZNS. |
| `ZALO_APP_ID` | | Application ID Zalo Developer. |

---

## 3. Khoi dong Ha tang (PostgreSQL & Redis)

He thong phu thuoc vao PostgreSQL (luu tru nghiep vu chinh) va Redis (hang doi phan tan Redis Streams va cache so sanh gia).

Khoi dong cac dich vu qua Docker Compose:

```bash
# Khoi dong PostgreSQL va Redis ngam
docker compose up -d postgres redis
```

Kiem tra trang thai container:
```bash
docker compose ps
```
Dam bao ca 2 container `postgres` va `redis` deu o trang thai `Up` hoac `healthy`.

---

## 4. Chay Database Migrations

He thong gom 3 phien ban migration:
- `000001_init`: Khoi tao bang `users`, `products`, `product_sources`, `tracked_products`, `price_snapshots`, `fetch_jobs`.
- `000002_alerts`: Bo sung thong tin Zalo, tao bang `alert_rules`, `notification_logs`.
- `000003_cross_platform`: Tao bang `comparison_snapshots`, bo sung cot `is_primary` cho `tracked_products`.

Chay migration UP toan bo:

```bash
go mod tidy
go run cmd/migrate/main.go up
```

*(Neu muon rollback migrations: `go run cmd/migrate/main.go down`)*

---

## 5. Van hanh cac Dich vu (Services)

Deal Hunter gom 4 tien trinh (processes) doc lap:

1. **API Server (`cmd/api`)**: Tiep nhan request tu nguoi dung va giao dien frontend.
2. **Scheduler (`cmd/scheduler`)**: Quet cac san pham den han kiem tra gia va refresh snapshot so sanh gia dinh ky 10 phut.
3. **Worker Pool (`cmd/worker`)**: Nhan job tu Redis Streams, goi Adapter lay gia, ghi snapshot, danh gia luat canh bao va xoa cache Redis.
4. **Notifier (`cmd/notifier`)**: Nhan su kien thong bao tu Redis Streams va gui tin nhan Zalo OA / ZNS.

Mo **4 cua so terminal rieng biet** tai thu muc du an de chay ca 4 dich vu:

### Terminal 1: Chay API Server
```bash
go run cmd/api/main.go
```
*Server lang nghe tai `http://localhost:8080`.*

### Terminal 2: Chay Scheduler
```bash
go run cmd/scheduler/main.go
```
*Scheduler dinh ky quet tracking toi han va refresh comparison snapshots.*

### Terminal 3: Chay Worker Pool
```bash
go run cmd/worker/main.go
```
*Worker pool lang nghe job tu Redis Streams, cao gia va commit atomic snapshot.*

### Terminal 4: Chay Notifier Service
```bash
go run cmd/notifier/main.go
```
*Notifier lang nghe su kien thong bao va gui canh bao Zalo.*

---

## 6. Kiem tra & Kiem thu He thong (Verification)

### 6.1. Dang ky theo doi san pham (`POST /api/v1/tracked-products`)
```bash
curl -X POST http://localhost:8080/api/v1/tracked-products \
  -H "Content-Type: application/json" \
  -d '{"url": "https://shopee.vn/product/123/456"}'
```

### 6.2. Kiem tra lich su gia (`GET /api/v1/tracked-products/:id/prices`)
```bash
curl -X GET http://localhost:8080/api/v1/tracked-products/<product_source_id>/prices
```

### 6.3. Tao quy tac canh bao gia (Phase 2)
```bash
curl -X POST http://localhost:8080/api/v1/tracked-products/<id>/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "rule_type": "drop_percent",
    "threshold_value": 10,
    "expires_in_days": 30
  }'
```

### 6.4. Xem bang so sanh gia da san & Best Deal (Phase 3)
```bash
# Bang so sanh theo ID san pham hoac ID theo doi
curl -X GET http://localhost:8080/api/v1/tracked-products/<id>/comparison

# Hoac theo Product ID logic:
curl -X GET http://localhost:8080/api/v1/products/<product_id>/comparison
```

### 6.5. Lien ket them nguon san moi (Phase 3)
```bash
curl -X POST http://localhost:8080/api/v1/products/<product_id>/link-source \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tiktok.com/@shop/product/789"}'
```

### 6.6. Danh sach nhom san pham da san (Phase 3)
```bash
curl -X GET http://localhost:8080/api/v1/product-groups \
  -H "X-User-ID: <user_uuid>"
```

---

## 7. Khac phuc Su co Thuong gap (Troubleshooting)

1. **Loi ket noi PostgreSQL (`connection refused`)**:
   - Kiem tra container: `docker compose ps`
   - Dam bao bien `DATABASE_URL` trong file `.env` dung cong host mapped.

2. **Loi Migration (`Dirty database`)**:
   - Neu migration bi dirty, dung lenh force:
     ```bash
     go run cmd/migrate/main.go force 3
     ```

3. **Chay test tich hop toan dien (E2E Integration Test)**:
   ```bash
   DATABASE_URL="postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable" REDIS_URL="redis://localhost:6379" go test -tags=integration -v ./tests/integration/...
   ```
