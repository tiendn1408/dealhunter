#!/usr/bin/env bash
# ==============================================================================
# DealHunter — Unified Local Development Runner (Non-Docker App Mode)
# ==============================================================================
# Runs Postgres & Redis via Docker, then starts all Go services concurrently
# and Next.js frontend, handling graceful shutdown on SIGINT/SIGTERM.
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$(cd "$DIR/../dealhunter-web" 2>/dev/null && pwd || true)"

cd "$DIR"

echo "=========================================================="
echo "  Starting DealHunter Ecosystem (Local Development)"
echo "=========================================================="

# 1. Start Infrastructure (Postgres 5433 & Redis 6379)
echo "==> Ensuring Docker infra (Postgres & Redis) is running..."
docker compose up -d postgres redis

# 2. Run Database Migrations
echo "==> Running database migrations..."
go run cmd/migrate/main.go up || {
    echo "Warning: Migration command exited with status $?. Continuing..."
}

# 3. Build/Run background services
pids=()

cleanup() {
    echo ""
    echo "==> Stopping all DealHunter services gracefully..."
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo "==> All DealHunter services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Start Go API
echo "==> Launching API Server on :8080..."
go run cmd/api/main.go &
pids+=($!)

# Start Go Worker
echo "==> Launching Price Fetch Worker..."
go run cmd/worker/main.go &
pids+=($!)

# Start Go Scheduler
echo "==> Launching Periodic Scheduler..."
go run cmd/scheduler/main.go &
pids+=($!)

# Start Go Notifier
echo "==> Launching Notification Engine..."
go run cmd/notifier/main.go &
pids+=($!)

# Start Frontend if directory exists
if [ -n "$WEB_DIR" ] && [ -d "$WEB_DIR" ]; then
    echo "==> Launching DealHunter Web on :3000..."
    (cd "$WEB_DIR" && npm run dev) &
    pids+=($!)
fi

echo "=========================================================="
echo "  DealHunter is LIVE!"
echo "  - Web Frontend:  http://localhost:3000"
echo "  - Backend API:   http://localhost:8080/api/v1/health"
echo "  - Postgres Port: 5433"
echo "  - Redis Port:    6379"
echo "  Press Ctrl+C to terminate all services."
echo "=========================================================="

# Wait for all background processes
wait
