# DealHunter — Cam Nang Trien Khai He Thong San Xuat (Production Deployment Guide)

Tai lieu nay dac ta toan dien quy trinh, kien truc, bien moi truong, kieu trien khai va quy trinh van hanh he thong **DealHunter** tren moi truong Production.

---

## 1. Kien Truc Tong The Moi Truong San Xuat (Production Topology)

He thong Production van hanh theo mo hinh phan tang bao mat (Defense-in-Depth) voi 3 lop kien truc:

```text
[Internet / Nguoi dung]
       │
       ▼ (Port 80/443 HTTPS - SSL Let's Encrypt)
[Nginx / Caddy Reverse Proxy]
       │
       ├──► (Port 3000 HTTP) ──► DealHunter Web (Next.js 14 Standalone)
       └──► (Port 8080 HTTP) ──► DealHunter API Server (Go Gin/Chi)
                                        │
                 ┌──────────────────────┼──────────────────────┐
                 ▼                      ▼                      ▼
        [Scheduler Service]     [Worker Pool Service]   [Notifier Service]
        (cmd/scheduler)         (cmd/worker)            (cmd/notifier)
                 │                      │                      │
                 └──────────────┬───────┴──────────────┬───────┘
                                ▼                      ▼
                        [Redis 7 Cluster]      [PostgreSQL 15 DB]
                        (Streams & Cache)      (Materialized Data)
```

### Cac cong ket noi noi bo va ben ngoai:
- **Port 80 / 443**: Cong cong khai duy nhat mo ra Internet (xu ly SSL Terminate qua Nginx).
- **Port 3000**: Next.js Web Frontend (chi truy cap noi bo tu Reverse Proxy).
- **Port 8080**: Go API Server (chi truy cap noi bo tu Reverse Proxy).
- **Port 5432 (noi bo) / 5433 (host tuy chon)**: PostgreSQL Database (chan ket noi tu Internet, chi mo cho VPC/Docker Network).
- **Port 6379 (noi bo) / 6380 (host tuy chon)**: Redis Queue & Cache (chan ket noi tu Internet, chi mo cho VPC/Docker Network).

---

## 2. Danh Muc Bien Moi Truong San Xuat (Production Environment Checklist)

File `.env` tren may chu Production phai duoc bao ve nghiem ngat (`chmod 600 .env`) va cau hinh day du cac tham so sau:

```env
# ==============================================================================
# DealHunter Production Environment Configuration
# ==============================================================================

# 1. APPLICATION & SERVER
APP_ENV=production
HTTP_PORT=8080
LOG_LEVEL=info
CORS_ALLOWED_ORIGINS=https://dealhunter.vn,https://www.dealhunter.vn

# 2. AUTHENTICATION & SECURITY (BAT BUOC THAY DOI)
# Tao chuoi ngau nhien it nhat 32 bytes: openssl rand -base64 32
JWT_SECRET=THAY_THE_BANG_CHUOI_BI_MAT_NGAU_NHIEN_IT_NHAT_32_KY_TU_CHO_PROD
GOOGLE_CLIENT_ID=your-production-google-client-id.apps.googleusercontent.com

# 3. POSTGRESQL DATABASE
POSTGRES_USER=dealuser
POSTGRES_PASSWORD=MAT_KHAU_MANH_POSTGRES_PROD_123!
POSTGRES_DB=dealdb
POSTGRES_PORT=5432
DATABASE_URL=postgres://dealuser:MAT_KHAU_MANH_POSTGRES_PROD_123!@postgres:5432/dealdb?sslmode=disable

# 4. REDIS QUEUE & CACHE
REDIS_PORT=6379
REDIS_URL=redis://redis:6379

# 5. SCRAPER & WORKER CONCURRENCY
WORKER_CONCURRENCY=20
DEFAULT_POLL_INTERVAL=1800
FETCH_TIMEOUT=15s
MAX_RETRY=5

# 6. AFFILIATE MARKETING ENGINE
AFFILIATE_ENABLED=true
SHOPEE_AFFILIATE_ID=YOUR_SHOPEE_AFFILIATE_ID
SHOPEE_AFFILIATE_URL_TEMPLATE=https://s.shopee.vn/universal-link?url={URL}&sub_id={SUB_ID}
LAZADA_AFFILIATE_ID=YOUR_LAZADA_AFFILIATE_ID
LAZADA_AFFILIATE_URL_TEMPLATE=https://s.lazada.vn/s.xxxx?url={URL}&aff_sub={SUB_ID}
TIKTOK_AFFILIATE_ID=YOUR_TIKTOK_AFFILIATE_ID
TIKTOK_AFFILIATE_URL_TEMPLATE=https://vt.tiktok.com/xxxx?url={URL}&sub_id={SUB_ID}
ACCESSTRADE_DEEPLINK_URL=https://fast.accesstrade.com.vn/deep_link/YOUR_ID?url=

# 7. ZALO OA & ZNS NOTIFICATION (PROD LIVE)
ZALO_ENABLED=true
ZALO_APP_ID=YOUR_PRODUCTION_ZALO_APP_ID
ZALO_OA_SECRET_KEY=YOUR_PRODUCTION_ZALO_SECRET_KEY
ZALO_REFRESH_TOKEN=YOUR_PRODUCTION_INITIAL_REFRESH_TOKEN
ZALO_OA_ACCESS_TOKEN=
ZALO_TEMPLATE_ID=YOUR_APPROVED_ZNS_TEMPLATE_ID
ZALO_WEBHOOK_SECRET=YOUR_ZALO_WEBHOOK_SECRET_KEY

# 8. FRONTEND BUILD VARIABLE
NEXT_PUBLIC_API_URL=https://dealhunter.vn/api/v1
```

---

## 3. Phuong An 1: Trien Khai Toan Dien Bang Docker Compose (Khuyen Nghi)

Phuong an nay dong goi toan bo 6 thanh phan vao container rieng biet tren mang cach ly `dealhunter-prod-network`.

### 3.1 Cac buoc thuc hien:
1. Clone ma nguon va chuyen vao thu muc du an:
   ```bash
   git clone https://github.com/tiendang/dealhunter.git /opt/dealhunter
   git clone https://github.com/tiendang/dealhunter-web.git /opt/dealhunter-web
   cd /opt/dealhunter
   ```

2. Thiet lap file `.env` voi cac thong so Production tu Muc 2:
   ```bash
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```

3. Khoi chay toan bo he thong qua `docker-compose.prod.yml`:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. Kiem tra trang thai hoat dong cua cac container:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```
   *Yeu cau*: Tat ca cac service `postgres`, `redis`, `api`, `worker`, `scheduler`, `notifier`, `web` deu o trang thai `Up` (va `healthy`). Service `migration` hoan tat voi ma thoat `Exit 0`.

5. Theo doi log thoi gian thuc:
   ```bash
   docker compose -f docker-compose.prod.yml logs -f --tail=100
   ```

---

## 4. Phuong An 2: Trien Khai Native / Systemd (May Chu Linux VPS)

Doi voi cac ha tang may chu Linux khong dung Docker de chay app, thuc hien quy trinh bien dich binary va quan ly qua `systemd`.

### 4.1 Bien dich cac Binary toi uu:
Tai thu muc `/opt/dealhunter`:
```bash
# Bien dich Go voi flags toi uu cho production (loai bo debug symbols de giam dung luong)
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/api ./cmd/api
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/worker ./cmd/worker
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/scheduler ./cmd/scheduler
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/notifier ./cmd/notifier
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/migrate ./cmd/migrate
```

Tai thu muc `/opt/dealhunter-web`:
```bash
npm ci
NEXT_PUBLIC_API_URL=https://dealhunter.vn/api/v1 npm run build
```

### 4.2 Thiet lap cac Systemd Service Units:

#### Service 1: API Server (`/etc/systemd/system/dealhunter-api.service`)
```ini
[Unit]
Description=DealHunter Backend API Server
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=dealhunter
WorkingDirectory=/opt/dealhunter
EnvironmentFile=/opt/dealhunter/.env
ExecStart=/opt/dealhunter/bin/api
Restart=always
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

#### Service 2: Price Worker Pool (`/etc/systemd/system/dealhunter-worker.service`)
```ini
[Unit]
Description=DealHunter Price Fetch Worker Pool
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=dealhunter
WorkingDirectory=/opt/dealhunter
EnvironmentFile=/opt/dealhunter/.env
ExecStart=/opt/dealhunter/bin/worker
Restart=always
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

#### Service 3: Periodic Scheduler (`/etc/systemd/system/dealhunter-scheduler.service`)
```ini
[Unit]
Description=DealHunter Periodic Scheduler
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=dealhunter
WorkingDirectory=/opt/dealhunter
EnvironmentFile=/opt/dealhunter/.env
ExecStart=/opt/dealhunter/bin/scheduler
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

#### Service 4: Notification Engine (`/etc/systemd/system/dealhunter-notifier.service`)
```ini
[Unit]
Description=DealHunter Zalo Notification Engine
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=dealhunter
WorkingDirectory=/opt/dealhunter
EnvironmentFile=/opt/dealhunter/.env
ExecStart=/opt/dealhunter/bin/notifier
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

#### Service 5: Web Frontend (`/etc/systemd/system/dealhunter-web.service`)
```ini
[Unit]
Description=DealHunter Next.js Frontend
After=network.target

[Service]
Type=simple
User=dealhunter
WorkingDirectory=/opt/dealhunter-web
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node /opt/dealhunter-web/.next/standalone/server.js
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Kich hoat va bat cac service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dealhunter-api dealhunter-worker dealhunter-scheduler dealhunter-notifier dealhunter-web
```

---

## 5. Cau Hinh Nginx Reverse Proxy & SSL Let's Encrypt

Tao file `/etc/nginx/sites-available/dealhunter.vn`:

```nginx
# Redirect HTTP sang HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name dealhunter.vn www.dealhunter.vn;
    return 301 https://$host$request_uri;
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name dealhunter.vn www.dealhunter.vn;

    ssl_certificate /etc/letsencrypt/live/dealhunter.vn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dealhunter.vn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # API Server Reverse Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 15s;
        proxy_read_timeout 60s;
    }

    # Healthcheck & Prometheus Metrics
    location /health {
        proxy_pass http://127.0.0.1:8080/health;
    }
    location /metrics {
        # Chi cho phep may chu giam sat noi bo truy cap metrics
        allow 127.0.0.1;
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://127.0.0.1:8080/metrics;
    }

    # Frontend Next.js Reverse Proxy
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Cap nhat chung chi SSL mien phi bang Certbot:
```bash
sudo certbot --nginx -d dealhunter.vn -d www.dealhunter.vn
```

---

## 6. Quy Trinh Di Tru Database (Migrations & Rollback)

### 6.1 Chay Migration truoc khi khoi dong phien ban moi:
```bash
# Su dung binary migrate
/opt/dealhunter/bin/migrate up

# Hoac chay qua ma nguon Go neu chua build binary
go run cmd/migrate/main.go up
```

### 6.2 Quy trinh Rollback khan cap khi xay ra loi:
Neu phien ban moi gap su co va can quay ve phien ban database truoc do:
```bash
# Rollback 1 migration gan nhat
/opt/dealhunter/bin/migrate down

# Sau do restart lai cac service o phien ban on dinh cu:
sudo systemctl restart dealhunter-api dealhunter-worker dealhunter-scheduler dealhunter-notifier
```

---

## 7. Giam Sat (Monitoring), Canh Bao & Kiem Tra Suc Khoe

1. **Health Check Endpoint**:
   - `GET /health` tra ve `{"status":"ok","app":"DealHunter"}` kem HTTP 200.
   - Thiet lap UptimeRobot / Pingdom kiem tra dinh ky moi 1 phut toi `https://dealhunter.vn/health`.

2. **Prometheus Metrics Endpoint**:
   - `GET /metrics` cung cap cac metric theo thoi gian thuc:
     - `dealhunter_price_fetch_duration_seconds`: Thoi gian scrape gia theo tung san (Shopee, Lazada, TikTok).
     - `dealhunter_price_fetch_total`: So luong request scrape thanh cong va that bai.
     - `dealhunter_price_snapshots_total`: Tong so snapshot gia duoc commit vao database.
     - `dealhunter_jobs_retry_total`: So lan thu lai job cao gia do loi mang.

3. **Log Structured JSON**:
   - Khi `APP_ENV=production`, he thong tu dong ghi log theo dinh dang JSON structured qua thu vien `slog`.
   - Khuyen nghi tich hop Filebeat / Promtail de day log ve Grafana Loki hoac ELK Stack.

---

## 8. Ke Hoach Sao Luu & Phuc Hoi Du Lieu (Backup & Disaster Recovery)

### 8.1 Sao luu PostgreSQL tu dong qua Cron Job:
Tao file script sao luu `/opt/dealhunter/scripts/backup-db.sh`:
```bash
#!/usr/bin/env bash
set -e
BACKUP_DIR="/var/backups/dealhunter"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# Dump database voi dinh dang nen gzip
docker exec dealhunter-prod-postgres pg_dump -U dealuser -d dealdb | gzip > "$BACKUP_DIR/dealdb_$TIMESTAMP.sql.gz"

# Giu lai ban backup trong 14 ngay gan nhat
find "$BACKUP_DIR" -type f -name "dealdb_*.sql.gz" -mtime +14 -delete
```

Thiet lap cron chay luc 02:00 sang moi ngay (`crontab -e`):
```text
0 2 * * * /opt/dealhunter/scripts/backup-db.sh > /dev/null 2>&1
```

### 8.2 Phuc hoi du lieu tu ban sao luu (Disaster Recovery):
```bash
# Giai nen va nap lai database
gunzip < /var/backups/dealhunter/dealdb_20261001_020000.sql.gz | docker exec -i dealhunter-prod-postgres psql -U dealuser -d dealdb
```
