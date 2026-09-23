.PHONY: dev test test-integration build migrate-up migrate-down

dev:
	docker compose up -d postgres redis
	echo "Ready for local dev"

test:
	go test -v ./...

test-integration:
	go test -v -tags=integration ./...

build:
	go build -o bin/api ./cmd/api
	go build -o bin/worker ./cmd/worker
	go build -o bin/scheduler ./cmd/scheduler

migrate-up:
	go run cmd/migrate/main.go up

migrate-down:
	go run cmd/migrate/main.go down
