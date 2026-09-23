# Deal Hunter

Deal Hunter is a cross-platform e-commerce deal tracking engine.
Phase 1 focuses on building the core tracking pipeline.

## Tech Stack
- Go 1.23+
- PostgreSQL (Business data)
- Redis (Queue via Streams)

## Architecture

The system consists of 3 distinct services:
1. **API Server (`cmd/api`)**: Handles HTTP ingestion and queries.
2. **Worker Pool (`cmd/worker`)**: Consumes jobs from Redis Streams, invokes marketplace adapters, and updates prices.
3. **Scheduler (`cmd/scheduler`)**: Periodically finds due tracked products and queues them into Redis Streams.

## Quick Start

```bash
# 1. Start dependencies
docker compose up -d postgres redis

# 2. Run migrations
go run cmd/migrate/main.go up

# 3. Start services (in separate terminals)
go run cmd/api/main.go
go run cmd/worker/main.go
go run cmd/scheduler/main.go
```

## Implementation Plan

We have successfully bootstrapped the Phase 1 implementation according to the plan:
- [x] Database Schema & Migrations
- [x] Domain Models
- [x] PostgreSQL Repositories
- [x] Redis Stream Queue
- [x] Marketplace Adapters (Mock, Lazada skeleton)
- [x] Worker Pool & Scheduler
- [x] API (POST track, GET prices)

## Next Steps
- Implement concrete PostgreSQL database repository logic using `pgx/v5`.
- Develop integration tests and crash tests.
- Develop the Next.js frontend (`frontend/`).
