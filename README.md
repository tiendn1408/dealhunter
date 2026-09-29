# Deal Hunter

Deal Hunter is a cross-platform e-commerce deal tracking engine built purely in Go.
Phase 1 delivers the core backend tracking pipeline: from product link ingestion, periodic price checks, snapshot history logging, to observability and metrics.

## Tech Stack
- **Language**: Go 1.23+ (`chi` router, `slog`, `prometheus`)
- **Database**: PostgreSQL 15 (`pgx/v5`, connection pooling via `pgxpool`)
- **Queue**: Redis 7 (`Redis Streams` consumer groups `XREADGROUP` / `XACK`)
- **Migrations**: `golang-migrate/migrate/v4`

## Architecture

The system consists of 3 distinct background/API Go services:
1. **API Server (`cmd/api`)**: Handles URL ingestion, listing, detail, price history, pause/resume endpoints.
2. **Worker Pool (`cmd/worker`)**: Consumes fetch jobs from Redis Streams, invokes marketplace adapters, and executes atomic price snapshot transactions in PostgreSQL.
3. **Scheduler (`cmd/scheduler`)**: Periodically queries due tracking records with `SELECT ... FOR UPDATE SKIP LOCKED` and dispatches jobs to Redis Streams.

## Quick Start

### 1. Start Infrastructure
```bash
docker compose up -d postgres redis
```

### 2. Run Database Migrations
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
```

## Phase 1 Deliverables
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
