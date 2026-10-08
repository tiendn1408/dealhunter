//go:build integration
// +build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/comparison"
	router "github.com/tiendang/deal-hunter/internal/http"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/matching"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
	"github.com/tiendang/deal-hunter/tests/fakemarket"
)

type testTrackingLinker struct {
	trackingSvc *tracking.TrackingService
}

func (l *testTrackingLinker) LinkSource(ctx context.Context, userID, productID uuid.UUID, url string) error {
	_, err := l.trackingSvc.LinkSourceToProduct(ctx, userID, productID, url)
	return err
}

func TestAutoMatchingAndSuggestionsFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable"
	}

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable at %s: %v", dbURL, err)
	}
	defer dbPool.Close()

	rdb := getTestRedisClient()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()

	streamName := "dh:test:matching:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "matching-group")
	_ = q.Init(ctx)

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)
	alertRepo := alert.NewPostgresRepository(dbPool)
	notifRepo := notification.NewPostgresRepository(dbPool)
	comparisonRepo := comparison.NewPostgresRepository(dbPool)
	matchingRepo := matching.NewPostgresMatchingRepository(dbPool)

	// Test doubles only: no live marketplace traffic from tests
	registry := marketplace.NewRegistry()
	registry.RegisterForHosts(fakemarket.NewMockAdapter(), "mock.dealhunter.vn")

	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)
	pricingSvc := pricing.NewPricingService(pricingRepo)
	comparisonCache := comparison.NewRedisCache(rdb)
	comparisonSvc := comparison.NewComparisonService(comparisonRepo, comparisonCache)

	runID := uuid.New().String()[:8]
	searcher := &fakemarket.Searcher{Candidates: map[string][]matching.MatchCandidate{
		// Same model, official store, same price: should auto-link
		"tiktok": {{Platform: "tiktok", URL: "https://mock.dealhunter.vn/item/tiktok-sony-wh1000xm6-" + runID,
			Title: "Tai nghe Sony WH-1000XM6", SellerName: "Sony Official Store", Price: 6290000, IsMall: true}},
		// Same model but weaker signals: should become a suggestion for review
		"lazada": {{Platform: "lazada", URL: "https://mock.dealhunter.vn/item/lazada-sony-wh1000xm6-" + runID,
			Title: "Tai nghe Sony WH-1000XM6 chong on hang cu", SellerName: "Shop Tai Nghe", Price: 4990000, IsMall: false}},
	}}
	linker := &testTrackingLinker{trackingSvc: trackingSvc}
	matchingSvc := matching.NewMatchingService(matchingRepo, searcher, linker, comparisonSvc)

	handler := router.NewHandler(trackingSvc, pricingSvc)
	jwtMgr := auth.NewJWTManager("test-integration-access-secret-32-bytes!", time.Hour)
	handler.SetAuthService(nil, jwtMgr)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(comparisonSvc)
	handler.SetMatchingService(matchingSvc)

	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	ts := httptest.NewServer(r)
	defer ts.Close()

	client := ts.Client()
	userID := uuid.New()

	t.Log("Step 1: Tracking a product with model code (Sony WH-1000XM5) on Shopee...")
	testURL := "https://mock.dealhunter.vn/item/shopee-sony-wh1000xm6-" + runID
	trackPayload, _ := json.Marshal(map[string]string{
		"url": testURL,
	})
	req, _ := http.NewRequestWithContext(ctx, "POST", ts.URL+"/api/v1/tracked-products", bytes.NewReader(trackPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("track product failed: status=%d, err=%v", resp.StatusCode, err)
	}

	var trackResp struct {
		ID              uuid.UUID `json:"id"`
		ProductSourceID uuid.UUID `json:"product_source_id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&trackResp)
	resp.Body.Close()

	trackedID := trackResp.ID

	// Seed an initial price for comparison
	seedPrice := int64(6290000)
	effPrice := seedPrice + 15000
	_ = pricingRepo.InsertSnapshot(ctx, nil, &pricing.PriceSnapshot{
		ProductSourceID: trackResp.ProductSourceID,
		Price:           seedPrice,
		ShippingFee:     15000,
		EffectivePrice:  effPrice,
		Currency:        "VND",
		CapturedAt:      time.Now(),
	})

	// Also update the ProductSource record so comparison has the price
	if ps, err := productRepo.GetProductSource(ctx, trackResp.ProductSourceID); err == nil && ps != nil {
		ps.LastPrice = &seedPrice
		ps.LastEffectivePrice = &effPrice
		_ = productRepo.UpdateProductSourcePrice(ctx, nil, ps)
	}

	t.Log("Step 2: Triggering Auto-Match for the product...")
	autoMatchReq, _ := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/api/v1/tracked-products/%s/auto-match", ts.URL, trackedID), nil)
	autoMatchReq.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))

	amResp, err := client.Do(autoMatchReq)
	if err != nil || amResp.StatusCode != http.StatusOK {
		t.Fatalf("auto-match trigger failed: status=%d, err=%v", amResp.StatusCode, err)
	}

	var matchResult matching.AutoMatchResult
	_ = json.NewDecoder(amResp.Body).Decode(&matchResult)
	amResp.Body.Close()

	t.Logf("Auto-match completed: RefTitle=%q, Discovered=%d, AutoLinked=%d, NewSuggestions=%d",
		matchResult.ReferenceTitle, matchResult.TotalDiscovered, len(matchResult.AutoLinkedSources), len(matchResult.NewSuggestions))
	if matchResult.TotalDiscovered != 2 || len(matchResult.AutoLinkedSources) != 1 || len(matchResult.NewSuggestions) != 1 {
		t.Fatalf("expected 2 discovered, 1 auto-linked, 1 suggestion; got %d/%d/%d",
			matchResult.TotalDiscovered, len(matchResult.AutoLinkedSources), len(matchResult.NewSuggestions))
	}

	t.Log("Step 3: Querying match suggestions...")
	suggReq, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/tracked-products/%s/match-suggestions", ts.URL, trackedID), nil)
	suggReq.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))

	suggResp, err := client.Do(suggReq)
	if err != nil || suggResp.StatusCode != http.StatusOK {
		t.Fatalf("get match suggestions failed: status=%d, err=%v", suggResp.StatusCode, err)
	}

	var suggList struct {
		ProductID   uuid.UUID                   `json:"product_id"`
		Suggestions []*matching.MatchSuggestion `json:"suggestions"`
	}
	_ = json.NewDecoder(suggResp.Body).Decode(&suggList)
	suggResp.Body.Close()

	t.Logf("Retrieved %d pending suggestions for user review", len(suggList.Suggestions))

	if len(suggList.Suggestions) > 0 {
		targetSugg := suggList.Suggestions[0]
		t.Logf("Step 4: Accepting suggestion %s on %s (Score: %.2f)...", targetSugg.ID, targetSugg.CandidatePlatform, targetSugg.MatchScore)

		acceptReq, _ := http.NewRequestWithContext(ctx, "POST",
			fmt.Sprintf("%s/api/v1/products/%s/match-suggestions/%s/accept", ts.URL, suggList.ProductID, targetSugg.ID), nil)
		acceptReq.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))

		accResp, err := client.Do(acceptReq)
		if err != nil || accResp.StatusCode != http.StatusOK {
			t.Fatalf("accept suggestion failed: status=%d, err=%v", accResp.StatusCode, err)
		}
		accResp.Body.Close()

		t.Log("Step 5: Verifying cross-platform comparison after accepting suggestion...")
		cmpReq, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/products/%s/comparison", ts.URL, suggList.ProductID), nil)
		cmpReq.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))
		cmpResp, err := client.Do(cmpReq)
		if err != nil || cmpResp.StatusCode != http.StatusOK {
			t.Fatalf("get comparison failed: status=%d, err=%v", cmpResp.StatusCode, err)
		}

		var cmpResult comparison.ComparisonResult
		_ = json.NewDecoder(cmpResp.Body).Decode(&cmpResult)
		cmpResp.Body.Close()

		t.Logf("Comparison sources count: %d, Available: %v", len(cmpResult.Sources), cmpResult.ComparisonAvailable)
		if len(cmpResult.Sources) < 2 {
			t.Errorf("expected >= 2 sources after linking accepted suggestion, got %d", len(cmpResult.Sources))
		}
	} else if len(matchResult.AutoLinkedSources) > 0 {
		t.Log("Step 4b: Verifying cross-platform comparison after auto-link...")
		cmpReq, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/v1/products/%s/comparison", ts.URL, matchResult.ProductID), nil)
		cmpReq.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))
		cmpResp, err := client.Do(cmpReq)
		if err != nil || cmpResp.StatusCode != http.StatusOK {
			t.Fatalf("get comparison failed: status=%d, err=%v", cmpResp.StatusCode, err)
		}

		var cmpResult comparison.ComparisonResult
		_ = json.NewDecoder(cmpResp.Body).Decode(&cmpResult)
		cmpResp.Body.Close()

		t.Logf("Comparison sources count: %d, Available: %v", len(cmpResult.Sources), cmpResult.ComparisonAvailable)
		if len(cmpResult.Sources) < 2 {
			t.Errorf("expected >= 2 sources after auto-linking, got %d", len(cmpResult.Sources))
		}
	} else {
		t.Fatalf("expected either auto-linked sources or suggestions to be produced, got 0 of both")
	}

	t.Log("ALL GAP-03 AUTO-MATCHING AND SUGGESTIONS STEPS PASSED SUCCESSFULLY!")
}
