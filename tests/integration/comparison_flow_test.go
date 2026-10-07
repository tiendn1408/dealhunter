//go:build integration
// +build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
	"github.com/tiendang/deal-hunter/tests/fakemarket"
)

func TestEndToEndComparisonFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable"
	}

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer dbPool.Close()

	rdb := getTestRedisClient()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()

	streamName := "dh:test:stream:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "test-workers")
	_ = q.Init(ctx)

	registry := marketplace.NewRegistry()
	registry.RegisterForHosts(fakemarket.NewMockAdapter(), "mock.dealhunter.vn")

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)
	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)

	comparisonRepo := comparison.NewPostgresRepository(dbPool)
	comparisonCache := comparison.NewRedisCache(rdb)
	comparisonSvc := comparison.NewComparisonService(comparisonRepo, comparisonCache)

	userID := uuid.New()
	slug := uuid.New().String()

	// 1. Ingest initial product (Shopee)
	shopeeURL := "https://mock.dealhunter.vn/shopee/sony-" + slug
	tracked1, err := trackingSvc.TrackURL(ctx, userID, shopeeURL)
	if err != nil {
		t.Fatalf("TrackURL shopee failed: %v", err)
	}

	source1, err := productRepo.GetProductSource(ctx, tracked1.ProductSourceID)
	if err != nil {
		t.Fatalf("GetProductSource 1 failed: %v", err)
	}
	canonicalProductID := source1.ProductID

	// Commit price snapshot for source 1 (Shopee price = 6.290.000 + 15.000 shipping = 6.305.000)
	inStock := true
	_ = pricingRepo.InsertSnapshot(ctx, nil, &pricing.PriceSnapshot{
		ProductSourceID: source1.ID,
		Price:           6290000,
		ShippingFee:     15000,
		EffectivePrice:  6305000,
		Currency:        "VND",
		InStock:         &inStock,
		CapturedAt:      time.Now(),
	})

	// 2. Check single-source comparison
	cmp1, err := comparisonSvc.GetComparison(ctx, canonicalProductID)
	if err != nil {
		t.Fatalf("GetComparison single source failed: %v", err)
	}
	if cmp1.ComparisonAvailable {
		t.Error("expected comparison_available = false for 1 source")
	}

	// 3. Link second source (TikTok) to canonicalProductID
	tiktokURL := "https://mock.dealhunter.vn/tiktok/sony-" + slug
	source2, err := trackingSvc.LinkSourceToProduct(ctx, userID, canonicalProductID, tiktokURL)
	if err != nil {
		t.Fatalf("LinkSourceToProduct tiktok failed: %v", err)
	}

	if source2.ProductID != canonicalProductID {
		t.Errorf("expected source2 to belong to %s, got %s", canonicalProductID, source2.ProductID)
	}

	// Verify secondary tracking was created with is_primary = false
	tracked2, err := trackingRepo.GetTrackingBySource(ctx, userID, source2.ID)
	if err != nil || tracked2 == nil {
		t.Fatalf("expected secondary tracking created, err: %v", err)
	}
	if tracked2.IsPrimary {
		t.Error("expected secondary tracking to have IsPrimary = false")
	}

	// Commit price snapshot for source 2 (TikTok price = 6.190.000 + 12.000 shipping = 6.202.000)
	_ = pricingRepo.InsertSnapshot(ctx, nil, &pricing.PriceSnapshot{
		ProductSourceID: source2.ID,
		Price:           6190000,
		ShippingFee:     12000,
		EffectivePrice:  6202000,
		Currency:        "VND",
		InStock:         &inStock,
		CapturedAt:      time.Now(),
	})

	// Invalidate cache
	_ = comparisonSvc.Invalidate(ctx, canonicalProductID)

	// 4. Query multi-platform comparison
	cmp2, err := comparisonSvc.GetComparison(ctx, canonicalProductID)
	if err != nil {
		t.Fatalf("GetComparison multi-source failed: %v", err)
	}

	if !cmp2.ComparisonAvailable {
		t.Error("expected comparison_available = true for 2 sources")
	}
	if len(cmp2.Sources) < 2 {
		t.Errorf("expected at least 2 sources, got %d", len(cmp2.Sources))
	}
	if cmp2.BestDeal == nil {
		t.Fatal("expected non-nil best deal")
	}
	if cmp2.BestDeal.EffectivePrice != 6202000 {
		t.Errorf("expected best price 6202000, got %d", cmp2.BestDeal.EffectivePrice)
	}

	// 5. Test duplicate link returns error
	_, err = trackingSvc.LinkSourceToProduct(ctx, userID, canonicalProductID, tiktokURL)
	if err != tracking.ErrSourceAlreadyLinked {
		t.Errorf("expected ErrSourceAlreadyLinked on duplicate link, got %v", err)
	}
}
