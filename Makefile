.PHONY: dev dev-all test test-db test-integration db-reset build migrate-up migrate-down

# Local docker-compose services (docker-compose.yml)
PG_CONTAINER    ?= dealhunter-postgres
REDIS_CONTAINER ?= dealhunter-redis
PG_USER         ?= dealuser
DEV_DB          ?= dealdb
DEV_DATABASE_URL ?= postgres://dealuser:dealpass@localhost:5433/$(DEV_DB)?sslmode=disable

# Integration tests use their own database and Redis DB, never the development data
TEST_DB          ?= dealdb_test
TEST_DATABASE_URL ?= postgres://dealuser:dealpass@localhost:5433/$(TEST_DB)?sslmode=disable
TEST_REDIS_URL   ?= redis://localhost:6380/15

dev:
	docker compose up -d postgres redis
	echo "Ready for local dev"

dev-all:
	./scripts/dev-all.sh

test:
	go test -v ./...

# Create (if missing) and migrate the integration-test database
test-db:
	@docker exec $(PG_CONTAINER) psql -U $(PG_USER) -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$(TEST_DB)'" | grep -q 1 \
		|| docker exec $(PG_CONTAINER) createdb -U $(PG_USER) $(TEST_DB)
	DATABASE_URL="$(TEST_DATABASE_URL)" go run ./cmd/migrate -dir up

test-integration: test-db
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" TEST_REDIS_URL="$(TEST_REDIS_URL)" \
		go test -v -count=1 -p 1 -tags=integration ./tests/integration/...

# Wipe ALL local development data (every table and Redis DB 0) and recreate the schema.
# Drops the schema directly instead of running down migrations, so it also works on a dirty database.
db-reset:
	docker exec $(PG_CONTAINER) psql -U $(PG_USER) -d $(DEV_DB) -v ON_ERROR_STOP=1 \
		-c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"
	DATABASE_URL="$(DEV_DATABASE_URL)" go run ./cmd/migrate -dir up
	docker exec $(REDIS_CONTAINER) redis-cli -n 0 FLUSHDB

build:
	go build -o bin/api ./cmd/api
	go build -o bin/worker ./cmd/worker
	go build -o bin/scheduler ./cmd/scheduler
	go build -o bin/notifier ./cmd/notifier
	go build -o bin/migrate ./cmd/migrate

migrate-up:
	go run cmd/migrate/main.go up

migrate-down:
	go run cmd/migrate/main.go down

prod-up:
	docker compose -f docker-compose.prod.yml up -d --build

prod-down:
	docker compose -f docker-compose.prod.yml down
