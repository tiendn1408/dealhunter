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
| `REDIS_URL` | `redis://localhost:6380` | Dia chi ket noi Redis (hang doi stream va cache). |
| `WORKER_CONCURRENCY`| `10` | So worker goroutine chay song song de xu ly fetch gia. |
| `DEFAULT_POLL_INTERVAL` | `1800` | Chu ky mac dinh giua cac lan kiem tra gia (1800 = 30 phut). |
| `FETCH_TIMEOUT` | `10s` | Thoi gian timeout toi da cho moi lan goi adapter lay gia. |
| `MAX_RETRY` | `5` | So lan thu lai toi da truoc khi danh dau job la `dead`. |
| `ZALO_ENABLED` | `false` | Bat/tat gui Zalo OA that. Khi tat (hoac thieu token), notifier khong gui gi va ghi thong bao la `failed` (ly do: chua cau hinh Zalo). |
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

He thong gom 7 phien ban migration (ap dung day du tu Phase 1 den Phase 3.5):
- `000001_init`: Khoi tao bang `users`, `products`, `product_sources`, `tracked_products`, `price_snapshots`, `fetch_jobs`.
- `000002_alerts`: Bo sung thong tin Zalo, tao bang `alert_rules`, `notification_logs`.
- `000003_cross_platform`: Tao bang `comparison_snapshots`, bo sung cot `is_primary` cho `tracked_products`.
- `000004_auth`: Tao bang `auth_identities`, bo sung cot xac thuc cho `users`.
- `000005_matching`: Tao bang `match_candidates`, `match_suggestions` cho bo may auto-matching.
- `000006_zalo_delivery`: Bo sung cac cot tracking webhook trang thai gui tin Zalo.
- `000007_vouchers`: Tao bang `product_vouchers`, bo sung cot `shop_discount` va `platform_coupon` vao `price_snapshots`.

Chay migration UP toan bo:

```bash
go mod tidy
go run cmd/migrate/main.go up
```

*(Neu muon rollback migrations: `go run cmd/migrate/main.go down`)*

---

## 5. Van hanh cac Dich vu (Services)

Deal Hunter gom cac tien trinh doc lap:

1. **API Server (`cmd/api`)**: Tiep nhan request tu nguoi dung va giao dien frontend.
2. **Scheduler (`cmd/scheduler`)**: Quet cac san pham den han kiem tra gia va refresh snapshot so sanh gia dinh ky 10 phut.
3. **Worker Pool (`cmd/worker`)**: Nhan job tu Redis Streams, goi Adapter lay gia, ghi snapshot, danh gia luat canh bao va xoa cache Redis.
4. **Notifier (`cmd/notifier`)**: Nhan su kien thong bao tu Redis Streams va gui tin nhan Zalo OA / ZNS.
5. **Migrate Tool (`cmd/migrate`)**: Cong cu chay migration database khi deploy.

Mo **4 cua so terminal rieng biet** tai thu muc du an de chay ca 4 dich vu (hoac chay 1 lenh `make dev-all`):

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

Moi API du lieu yeu cau access token. Lay token guest (hoac dang nhap Google tren giao dien web, xem muc 6.7) truoc khi goi cac lenh ben duoi:
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/guest | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

### 6.1. Dang ky theo doi san pham (`POST /api/v1/tracked-products`)
```bash
curl -X POST http://localhost:8080/api/v1/tracked-products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://shopee.vn/product/123/456"}'
```

### 6.2. Kiem tra lich su gia (`GET /api/v1/tracked-products/:id/prices`)
```bash
curl -X GET http://localhost:8080/api/v1/tracked-products/<product_source_id>/prices \
  -H "Authorization: Bearer $TOKEN"
```

### 6.3. Tao quy tac canh bao gia (Phase 2)
```bash
curl -X POST http://localhost:8080/api/v1/tracked-products/<id>/alerts \
  -H "Authorization: Bearer $TOKEN" \
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
curl -X GET http://localhost:8080/api/v1/tracked-products/<id>/comparison \
  -H "Authorization: Bearer $TOKEN"

# Hoac theo Product ID logic:
curl -X GET http://localhost:8080/api/v1/products/<product_id>/comparison \
  -H "Authorization: Bearer $TOKEN"
```

### 6.5. Lien ket them nguon san moi (Phase 3)
```bash
curl -X POST http://localhost:8080/api/v1/products/<product_id>/link-source \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tiktok.com/@shop/product/789"}'
```

### 6.6. Danh sach nhom san pham da san (Phase 3)
```bash
curl -X GET http://localhost:8080/api/v1/product-groups \
  -H "Authorization: Bearer $TOKEN"
```

### 6.7. Xac thuc Google (GAP-02)
Dang nhap duy nhat qua Google (khong co demo-login hay token gia). Can tao OAuth Client ID loai Web tren
Google Cloud Console, them `http://localhost:3000` vao Authorized JavaScript origins, roi dat cung gia tri cho
`GOOGLE_CLIENT_ID` (backend) va `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web). Dang nhap tren giao dien web; frontend gui
ID token len `POST /api/v1/auth/google`.
```bash
# Lay thong tin tai khoan nguoi dung hien tai:
curl -X GET http://localhost:8080/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### 6.8. Tu dong goi y so khop da san Auto-Matching (GAP-03)
```bash
# Kich hoat tim kiem ung vien tu dong tren cac san:
curl -X POST http://localhost:8080/api/v1/products/<product_id>/auto-match \
  -H "Authorization: Bearer $TOKEN"

# Lay danh sach goi y so khop:
curl -X GET http://localhost:8080/api/v1/products/<product_id>/match-suggestions \
  -H "Authorization: Bearer $TOKEN"
```

### 6.9. Quan ly Voucher & Gia Ve Tay EffectivePrice (Phase 3.5)
```bash
# Xem danh sach voucher kha dung cua san pham:
curl -X GET http://localhost:8080/api/v1/tracked-products/<id>/vouchers \
  -H "Authorization: Bearer $TOKEN"

# Thu cong them voucher moi:
curl -X POST http://localhost:8080/api/v1/tracked-products/<id>/vouchers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "voucher_type": "shop_voucher",
    "title": "Ma giam 50k don tu 500k",
    "discount_amount": 50000,
    "min_order_value": 500000
  }'
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
   make test-integration
   ```
   - Test chay tren DB rieng `dealdb_test` va Redis DB 15 (`TEST_DATABASE_URL`, `TEST_REDIS_URL`), `make` tu tao + migrate DB nay.
   - Test **tu choi chay** neu ten DB khong ket thuc bang `_test` hoac Redis la DB 0, de khong bao gio ghi du lieu test vao DB dev.

4. **Xoa toan bo du lieu dev (chi dung du lieu that)**:
   ```bash
   make db-reset
   ```
   - Drop moi bang cua `dealdb`, migrate lai tu dau va `FLUSHDB` Redis DB 0. Khong the hoan tac.
