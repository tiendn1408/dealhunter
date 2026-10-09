//go:build integration
// +build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/comparison"
	router "github.com/tiendang/deal-hunter/internal/http"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
	"github.com/tiendang/deal-hunter/tests/fakemarket"
)

func TestPhase3FullHTTPFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := getTestDatabaseURL(t)

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("PostgreSQL not reachable: %v", err)
	}
	defer dbPool.Close()

	rdb := getTestRedisClient(t)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not reachable: %v", err)
	}
	defer rdb.Close()

	// Initialize dependencies matching cmd/api/main.go
	registry := marketplace.NewRegistry()
	registry.RegisterForHosts(fakemarket.NewMockAdapter(), "mock.dealhunter.vn")

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)
	alertRepo := alert.NewPostgresRepository(dbPool)
	notifRepo := notification.NewPostgresRepository(dbPool)
	comparisonRepo := comparison.NewPostgresRepository(dbPool)

	q := queue.NewRedisStreamQueue(rdb, "dh:test:stream:"+uuid.New().String(), "test-workers")
	_ = q.Init(ctx)

	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)
	pricingSvc := pricing.NewPricingService(pricingRepo)
	comparisonCache := comparison.NewRedisCache(rdb)
	comparisonSvc := comparison.NewComparisonService(comparisonRepo, comparisonCache)

	handler := router.NewHandler(trackingSvc, pricingSvc)
	jwtMgr := auth.NewJWTManager("test-integration-access-secret-32-bytes!", time.Hour)
	handler.SetAuthService(nil, jwtMgr)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(comparisonSvc)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	server := httptest.NewServer(r)
	defer server.Close()

	client := server.Client()
	userID := uuid.New().String()
	createGuestUser(t, dbPool, uuid.MustParse(userID))
	slug := uuid.New().String()

	// Step 1: User tracks initial product (Shopee) via POST /api/v1/tracked-products
	t.Log("Step 1: Tracking initial product on Shopee...")
	trackPayload, _ := json.Marshal(map[string]string{
		"url": "https://mock.dealhunter.vn/shopee/headphones-" + slug,
	})
	req, _ := http.NewRequest("POST", server.URL+"/api/v1/tracked-products", bytes.NewReader(trackPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Failed to track initial product, status: %d, err: %v", resp.StatusCode, err)
	}

	var trackResp struct {
		ID              string `json:"id"`
		ProductSourceID string `json:"product_source_id"`
		ProductID       string `json:"product_id"`
	}
	json.NewDecoder(resp.Body).Decode(&trackResp)
	resp.Body.Close()

	if trackResp.ID == "" {
		t.Fatal("Expected non-empty tracking id")
	}

	// Insert realistic snapshot for source 1 (Shopee price = 6.290.000 + 15.000 shipping = 6.305.000)
	source1UUID, _ := uuid.Parse(trackResp.ProductSourceID)
	inStock := true
	_ = pricingRepo.InsertSnapshot(ctx, nil, &pricing.PriceSnapshot{
		ProductSourceID: source1UUID,
		Price:           6290000,
		ShippingFee:     ptrInt64(15000),
		EffectivePrice:  6305000,
		Currency:        "VND",
		InStock:         &inStock,
		CapturedAt:      time.Now(),
	})

	// Step 2: User opens Detail Page -> calls GET /api/v1/tracked-products/{id}/comparison
	t.Log("Step 2: Checking comparison before second source is linked...")
	req, _ = http.NewRequest("GET", server.URL+"/api/v1/tracked-products/"+trackResp.ID+"/comparison", nil)
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))
	resp, err = client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Failed to get comparison for single source, status: %d, err: %v", resp.StatusCode, err)
	}

	var cmp1 struct {
		ProductID           string `json:"product_id"`
		ComparisonAvailable bool   `json:"comparison_available"`
		Sources             []any  `json:"sources"`
	}
	json.NewDecoder(resp.Body).Decode(&cmp1)
	resp.Body.Close()

	if cmp1.ComparisonAvailable {
		t.Error("Expected comparison_available to be false for single source")
	}
	if len(cmp1.Sources) != 1 {
		t.Errorf("Expected 1 source, got %d", len(cmp1.Sources))
	}
	canonicalProductID := cmp1.ProductID
	if canonicalProductID == "" {
		t.Fatal("Expected canonical product_id in comparison result")
	}

	// Step 3: User opens LinkSourceModal -> calls POST /api/v1/products/{product_id}/link-source
	t.Log("Step 3: Linking second marketplace source (TikTok)...")
	linkPayload, _ := json.Marshal(map[string]string{
		"url": "https://mock.dealhunter.vn/tiktok/headphones-" + slug,
	})
	req, _ = http.NewRequest("POST", server.URL+"/api/v1/products/"+canonicalProductID+"/link-source", bytes.NewReader(linkPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))
	resp, err = client.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Failed to link second source, status: %d, err: %v", resp.StatusCode, err)
	}

	var linkResp struct {
		SourceID string `json:"source_id"`
		Platform string `json:"platform"`
		Message  string `json:"message"`
	}
	json.NewDecoder(resp.Body).Decode(&linkResp)
	resp.Body.Close()

	if linkResp.SourceID == "" || linkResp.Platform == "" {
		t.Fatal("Expected valid source_id and platform in link response")
	}

	// Step 4: Test duplicate link returns 409 Conflict
	t.Log("Step 4: Testing duplicate link returns 409 Conflict...")
	req, _ = http.NewRequest("POST", server.URL+"/api/v1/products/"+canonicalProductID+"/link-source", bytes.NewReader(linkPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))
	resp, err = client.Do(req)
	if err != nil || resp.StatusCode != http.StatusConflict {
		t.Fatalf("Expected 409 Conflict on duplicate link, got status: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Insert price snapshot for source 2 (TikTok price = 6.190.000 + 12.000 shipping = 6.202.000)
	source2UUID, _ := uuid.Parse(linkResp.SourceID)
	_ = pricingRepo.InsertSnapshot(ctx, nil, &pricing.PriceSnapshot{
		ProductSourceID: source2UUID,
		Price:           6190000,
		ShippingFee:     ptrInt64(12000),
		EffectivePrice:  6202000,
		Currency:        "VND",
		InStock:         &inStock,
		CapturedAt:      time.Now(),
	})

	// Invalidate backend cache
	canonicalUUID, _ := uuid.Parse(canonicalProductID)
	_ = comparisonSvc.Invalidate(ctx, canonicalUUID)

	// Step 5: Frontend refetches comparison -> calls GET /api/v1/tracked-products/{id}/comparison
	t.Log("Step 5: Verifying multi-platform comparison after link...")
	req, _ = http.NewRequest("GET", server.URL+"/api/v1/tracked-products/"+trackResp.ID+"/comparison", nil)
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))
	resp, err = client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Failed to get multi-source comparison, status: %d", resp.StatusCode)
	}

	var cmp2 struct {
		ProductID           string `json:"product_id"`
		ComparisonAvailable bool   `json:"comparison_available"`
		Sources             []struct {
			Platform       string `json:"platform"`
			EffectivePrice int64  `json:"effective_price"`
			IsBestDeal     bool   `json:"is_best_deal"`
		} `json:"sources"`
		BestDeal *struct {
			Platform              string  `json:"platform"`
			EffectivePrice        int64   `json:"effective_price"`
			SavingVsMostExpensive int64   `json:"saving_vs_most_expensive"`
			SavingPercent         float64 `json:"saving_percent"`
		} `json:"best_deal"`
	}
	json.NewDecoder(resp.Body).Decode(&cmp2)
	resp.Body.Close()

	if !cmp2.ComparisonAvailable {
		t.Error("Expected comparison_available to be true after 2 sources are linked")
	}
	if len(cmp2.Sources) != 2 {
		t.Errorf("Expected exactly 2 sources, got %d", len(cmp2.Sources))
	}
	if cmp2.BestDeal == nil {
		t.Fatal("Expected best_deal to be calculated")
	}
	if cmp2.BestDeal.EffectivePrice != 6202000 {
		t.Errorf("Expected best price 6202000, got %d", cmp2.BestDeal.EffectivePrice)
	}
	if cmp2.BestDeal.SavingVsMostExpensive != 103000 {
		t.Errorf("Expected saving 103000 (6305000 - 6202000), got %d", cmp2.BestDeal.SavingVsMostExpensive)
	}

	// Step 6: Verify GET /api/v1/product-groups returns the product group
	t.Log("Step 6: Verifying product group summary in GET /api/v1/product-groups...")
	req, _ = http.NewRequest("GET", server.URL+"/api/v1/product-groups", nil)
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))
	resp, err = client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Failed to list product groups, status: %d", resp.StatusCode)
	}

	var groupsResp struct {
		Groups []struct {
			ProductID    string `json:"product_id"`
			BestPrice    *int64 `json:"best_price"`
			BestPlatform string `json:"best_platform"`
			SourceCount  int    `json:"source_count"`
		} `json:"groups"`
	}
	json.NewDecoder(resp.Body).Decode(&groupsResp)
	resp.Body.Close()

	if len(groupsResp.Groups) == 0 {
		t.Fatal("Expected at least 1 multi-source product group")
	}
	foundGroup := false
	for _, g := range groupsResp.Groups {
		if g.ProductID == canonicalProductID {
			foundGroup = true
			if g.SourceCount != 2 {
				t.Errorf("Expected source_count 2, got %d", g.SourceCount)
			}
			if g.BestPrice == nil || *g.BestPrice != 6202000 {
				t.Errorf("Expected best price 6202000, got %v", g.BestPrice)
			}
		}
	}
	if !foundGroup {
		t.Errorf("Canonical product %s not found in groups response", canonicalProductID)
	}

	// Step 7: Verify GET /api/v1/tracked-products lists both trackings with shared ProductID
	t.Log("Step 7: Verifying tracking list returns shared ProductID for multi-source badge...")
	req, _ = http.NewRequest("GET", server.URL+"/api/v1/tracked-products", nil)
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, uuid.MustParse(userID)))
	resp, err = client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("Failed to list trackings, status: %d", resp.StatusCode)
	}

	var trackingsResp struct {
		Data []struct {
			ID        string `json:"ID"`
			ProductID string `json:"ProductID"`
			IsPrimary bool   `json:"IsPrimary"`
			Platform  string `json:"Platform"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&trackingsResp)
	resp.Body.Close()

	if len(trackingsResp.Data) != 2 {
		t.Fatalf("Expected 2 tracked products for user, got %d", len(trackingsResp.Data))
	}

	sharedCount := 0
	hasPrimary := false
	hasSecondary := false
	for _, item := range trackingsResp.Data {
		if item.ProductID == canonicalProductID {
			sharedCount++
		}
		if item.IsPrimary {
			hasPrimary = true
		} else {
			hasSecondary = true
		}
	}

	if sharedCount != 2 {
		t.Errorf("Expected both trackings to share canonical ProductID, found %d", sharedCount)
	}
	if !hasPrimary || !hasSecondary {
		t.Errorf("Expected 1 primary and 1 secondary tracking, got hasPrimary=%v, hasSecondary=%v", hasPrimary, hasSecondary)
	}

	t.Log("ALL PHASE 3 FULL FLOW VERIFICATION STEPS PASSED SUCCESSFULLY!")
}
