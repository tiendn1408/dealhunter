//go:build integration
// +build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/mock"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func TestEndToEndTrackingFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://dealuser:dealpass@localhost:5432/dealdb?sslmode=disable"
	}
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable at %s: %v", dbURL, err)
	}
	defer dbPool.Close()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()

	streamName := "dh:test:stream:" + uuid.New().String()
	groupName := "test-workers"

	q := queue.NewRedisStreamQueue(rdb, streamName, groupName)
	if err := q.Init(ctx); err != nil {
		t.Fatalf("Failed to init test stream: %v", err)
	}

	registry := marketplace.NewRegistry()
	registry.Register(mock.NewMockAdapter())

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)

	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)

	userID := uuid.New()
	testURL := "https://mock.dealhunter.vn/product/" + uuid.New().String()

	// 1. Ingest URL
	tracked, err := trackingSvc.TrackURL(ctx, userID, testURL)
	if err != nil {
		t.Fatalf("TrackURL failed: %v", err)
	}

	if tracked.ID == uuid.Nil {
		t.Fatal("expected non-nil tracking ID")
	}

	// 2. Verify source was created
	source, err := productRepo.GetProductSource(ctx, tracked.ProductSourceID)
	if err != nil {
		t.Fatalf("GetProductSource failed: %v", err)
	}
	if source.Platform != "mock" {
		t.Errorf("expected platform mock, got %s", source.Platform)
	}

	// 3. Worker consume from queue and process
	worker := jobs.NewWorker(1, q, jobRepo, productRepo, pricingRepo, registry, dbPool, nil)
	_ = worker

	consumeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	ch, err := q.Consume(consumeCtx, "test-consumer")
	if err != nil {
		t.Fatalf("q.Consume failed: %v", err)
	}

	select {
	case msg := <-ch:
		if msg.JobID == "" {
			t.Fatal("expected valid job ID")
		}
		// Verify price snapshots before was 0
		snapsBefore, _ := pricingRepo.ListSnapshots(ctx, source.ID, time.Now().Add(-1*time.Hour), time.Now().Add(1*time.Hour))
		if len(snapsBefore) != 0 {
			t.Fatalf("expected 0 snapshots initially, got %d", len(snapsBefore))
		}

		// Process job manually
		_ = q.Ack(ctx, msg.MsgID)
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for message from stream")
	}
}
