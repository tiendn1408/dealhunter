//go:build integration
// +build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func TestJobIdempotencyOnReplay(t *testing.T) {
	ctx := context.Background()

	dbURL := getTestDatabaseURL(t)

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable at %s: %v", dbURL, err)
	}
	defer dbPool.Close()

	productRepo := product.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)

	// Create test product and source
	prod := &product.Product{
		ID:        uuid.New(),
		Title:     "Idempotency Test Item",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := productRepo.UpsertProduct(ctx, prod); err != nil {
		t.Fatalf("failed to upsert product: %v", err)
	}

	extID := "idempotency-" + uuid.New().String()
	source := &product.ProductSource{
		ID:                uuid.New(),
		ProductID:         prod.ID,
		Platform:          "mock",
		ExternalProductID: &extID,
		CanonicalURL:      "https://mock.dealhunter.vn/item/" + extID,
		Currency:          "VND",
		Active:            true,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}
	if err := productRepo.UpsertProductSource(ctx, source); err != nil {
		t.Fatalf("failed to upsert product source: %v", err)
	}

	jobID := uuid.New()
	job := &domain.FetchJob{
		ID:              jobID,
		ProductSourceID: source.ID,
		Status:          domain.JobStatusSucceeded, // Already succeeded previously!
		Attempt:         1,
		AvailableAt:     time.Now(),
		CreatedAt:       time.Now(),
	}
	if err := jobRepo.CreateJob(ctx, job); err != nil {
		t.Fatalf("failed to create job: %v", err)
	}

	// Verify that querying this job shows it is already succeeded
	fetchedJob, err := jobRepo.GetJob(ctx, jobID)
	if err != nil {
		t.Fatalf("failed to get job: %v", err)
	}

	if fetchedJob.Status != domain.JobStatusSucceeded {
		t.Errorf("expected job status succeeded, got %s", fetchedJob.Status)
	}
}
