# Deal Hunter

Deal Hunter is a cross-platform e-commerce deal tracking and price comparison engine built purely in Go.
The system covers product link ingestion, periodic automated scraping, atomic price history snapshot logging, smart alert rules, Zalo notification delivery, and real-time cross-platform price comparison across Shopee, Lazada, and TikTok Shop.

## Tech Stack
- **Language**: Go 1.26+ (`chi` router, `slog`, `prometheus`)
- **Database**: PostgreSQL 15 (`pgx/v5`, connection pooling via `pgxpool`, migrations via `golang-migrate`)
- **Queue & Cache**: Redis 7 (`Redis Streams` consumer groups `XREADGROUP` / `XACK`, string caching for comparison results with TTL)
- **Marketplace Adapters**: Shopee Vietnam, Lazada Vietnam, TikTok Shop Vietnam, Mock Adapter

## Architecture

The system is organized as a Modular Monolith with Clean Architecture (Ports & Adapters), composed of 4 background and API Go services:
1. **API Server (`cmd/api`)**: Handles tracking registration, price history, alert rules, Zalo connection, and cross-platform price comparison endpoints.
2. **Worker Pool (`cmd/worker`)**: Consumes price fetch jobs from Redis Streams, invokes marketplace adapters, commits atomic price snapshot transactions in PostgreSQL, evaluates alert conditions, and invalidates Redis comparison cache.
3. **Scheduler (`cmd/scheduler`)**: Periodically queries due tracking records with `SELECT ... FOR UPDATE SKIP LOCKED`, dispatches jobs to Redis Streams, and runs background comparison snapshot refresh every 10 minutes.
4. **Notifier (`cmd/notifier`)**: Consumes notification events from Redis Streams and delivers price drop notifications via Zalo OA / ZNS (or Mock Sandbox).

## Quick Start

### 1. Start Infrastructure
```bash
docker compose up -d postgres redis
```

### 2. Run Database Migrations (Migrations 000001 to 000007)
```bash
go mod tidy
go run cmd/migrate/main.go up
```

### 3. Run Backend Services (in separate terminals)
```bash
# Terminal 1: API Server (port 8080)
go run cmd/api/main.go

# Terminal 2: Scheduler
go run cmd/scheduler/main.go

# Terminal 3: Worker Pool
go run cmd/worker/main.go

# Terminal 4: Notifier Service (Phase 2 Zalo Delivery)
go run cmd/notifier/main.go
```

## Phase Deliverables Summary

### Phase 1: Core Tracking Pipeline [100% Completed]
- [x] Database Schema & Migrations (`migrations/000001_init.up.sql`)
- [x] Domain Models (`internal/domain`, `internal/product`, `internal/pricing`)
- [x] Concrete PostgreSQL Repositories (`pgx/v5` in `product`, `tracking`, `pricing`, `jobs`)
- [x] Redis Streams Queue (`internal/queue/redis_stream.go`)
- [x] Marketplace Adapters (`internal/marketplace/mock`, `lazada`)
- [x] Worker Pool (`internal/jobs/worker.go`) with concurrency & atomic transactions
- [x] Scheduler (`internal/jobs/scheduler.go`) with `SKIP LOCKED` and next fetch scheduling
- [x] API Server (`internal/http/handler.go`) with track, list, detail, prices, pause, resume
- [x] Prometheus Metrics (`/metrics`) and structured JSON logging (`slog`)
- [x] Unit & Integration Tests (`tests/integration/...`, `internal/pricing/model_test.go`)

### Phase 2: Alert Rules & Zalo Notification [100% Completed]
- [x] Database Schema & Migrations (`migrations/000002_alerts.up.sql`)
- [x] Alert Rule Engine (`internal/alert`): drop percent, target price, lowest in N days
- [x] Notification Service (`internal/notification`): Zalo OA / ZNS client with Mock Sandbox
- [x] Notifier Worker (`cmd/notifier`): Redis Stream consumer for notification events
- [x] API Endpoints: alert rules management (`GET/POST /api/v1/tracked-products/{id}/alerts`, `DELETE /api/v1/alerts/{id}`)
- [x] Notification Center Endpoints (`GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/read`)
- [x] Zalo Account Binding Endpoints (`POST /api/v1/user/zalo/connect`, `GET /api/v1/user/zalo/status`, `DELETE /api/v1/user/zalo`)

### Phase 3: Cross-Platform Price Comparison [100% Completed]
- [x] Database Schema & Migrations (`migrations/000003_cross_platform.up.sql`): `comparison_snapshots`, `is_primary`
- [x] Marketplace Adapters: Shopee (`internal/marketplace/shopee`), TikTok Shop (`internal/marketplace/tiktok`)
- [x] Comparison Domain & Service (`internal/comparison`): `IdentifyBestDeal`, `EffectivePrice` calculation
- [x] Multi-layer Caching: Redis string cache (`dh:cmp:{product_id}`, TTL 5m) + PostgreSQL materialized snapshots
- [x] Cache Invalidation Pipeline: Worker invalidates Redis cache on each new price snapshot commit
- [x] Background Scheduler Refresh: 10-minute periodic ticker refreshing comparison snapshots
- [x] Comparison API Endpoints:
  - `GET /api/v1/tracked-products/{id}/comparison`: Shortcut resolving tracking ID or source ID
  - `GET /api/v1/products/{product_id}/comparison`: Full cross-platform comparison with Best Deal
  - `POST /api/v1/products/{product_id}/link-source`: Link another marketplace URL to a product group
  - `GET /api/v1/product-groups`: List multi-source product groups
- [x] End-to-End Full Flow Integration Tests (`tests/integration/http_phase3_flow_test.go`, `TestPhase3FullHTTPFlow`)

### Phase 3.5: Monetization & Voucher Engine [100% Completed]
- [x] Affiliate Link Transformer (`pkg/affiliate`): Shopee, Lazada, TikTok, AccessTrade affiliate URL conversion
- [x] SubID Tracking Parameter: Format `u_{user_id}_p_{product_id}` for cross-platform attribution
- [x] Database Schema & Migrations (`migrations/000007_vouchers.up.sql`): `product_vouchers`, discount columns
- [x] Voucher Intelligence Domain (`internal/voucher`): Shop vouchers, platform coupons, freeship codes
- [x] Dynamic Effective Price calculation: `ListedPrice - ShopDiscount - PlatformCoupon + ShippingFee`
- [x] Voucher API Endpoints (`GET/POST /api/v1/tracked-products/{id}/vouchers`)
- [x] Production Docker Packaging: Multi-stage Dockerfile for Go & Next.js standalone, `docker-compose.prod.yml`, `.dockerignore`
- [x] Production Deployment Guide (`docs/deployment/production-deployment-guide.md`)

## Documentation
Chi tiet tai lieu he thong duoc quan ly trong thu muc [`docs/`](docs/README.md):
- [**Cam nang Trien khai San xuat**](docs/deployment/production-deployment-guide.md): Huong dan trien khai Production (Docker Compose Prod, Systemd, Nginx SSL, Backup).
- [**Dac ta REST API Toan Dien**](docs/api/rest-api-reference.md): Danh muc 24+ HTTP endpoints, payload, auth va curl examples.
- [**Kien truc He thong**](docs/architecture/overview.md): Tong quan Modular Monolith, Ports & Adapters va Caching Pipeline.
- [**Cam nang Van hanh Local**](docs/runbooks/setup-and-run.md): Huong dan cai dat, cau hinh .env va chay cac service Go o moi truong local dev.
- [**Ke hoach Phase 1**](docs/plans/phase-1-core-tracking.md): Dac ta nghiep vu va Definition of Done Phase 1.
- [**Ke hoach Phase 2**](docs/plans/phase-2-alert-and-zalo.md): Thiet ke Alert Engine & Zalo Notification.
- [**Ke hoach Phase 3**](docs/plans/phase-3-cross-platform.md): Thiet ke So Sanh Gia Da Nen Tang & Bao cao kiem dinh.
- [**Ke hoach Phase 3.5**](docs/plans/phase-3-5-monetization-and-voucher-engine.md): Affiliate Link Engine & Voucher Intelligence 2 Buoc.
