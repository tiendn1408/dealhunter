.PHONY: dev dev-all test test-integration build migrate-up migrate-down

dev:
	docker compose up -d postgres redis
	echo "Ready for local dev"

dev-all:
	./scripts/dev-all.sh

test:
	go test -v ./...

test-integration:
	go test -v -tags=integration ./...

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
