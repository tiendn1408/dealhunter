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
	"strings"
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
	"github.com/tiendang/deal-hunter/internal/voucher"
	"github.com/tiendang/deal-hunter/pkg/database"
	"github.com/tiendang/deal-hunter/tests/fakemarket"
)

// TestProductGroupAuthorization covers hardening Step 2: product-group access (comparison, suggestions,
// prices, vouchers, alerts), SEC-07 (link-source), SEC-08 (suggestion IDOR), SEC-11 (body size) and
// the guest-creation rate limit.
func TestProductGroupAuthorization(t *testing.T) {
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

	q := queue.NewRedisStreamQueue(rdb, "dh:test:authz:"+uuid.New().String(), "test-authz")
	_ = q.Init(ctx)

	registry := marketplace.NewRegistry()
	registry.RegisterForHosts(fakemarket.NewMockAdapter(), "mock.dealhunter.vn")

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	authRepo := auth.NewPostgresUserRepository(dbPool)
	matchingRepo := matching.NewPostgresMatchingRepository(dbPool)

	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobs.NewPostgresRepository(dbPool), q)
	compSvc := comparison.NewComparisonService(comparison.NewPostgresRepository(dbPool), nil)
	jwtMgr := auth.NewJWTManager("test-authorization-secret-32-bytes!!", time.Hour)

	handler := router.NewHandler(trackingSvc, pricing.NewPricingService(pricing.NewPostgresRepository(dbPool)))
	handler.SetAlertAndNotificationRepos(alert.NewPostgresRepository(dbPool), notification.NewPostgresRepository(dbPool))
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(newTestAuthService(t, authRepo, jwtMgr), jwtMgr)
	handler.SetMatchingService(matching.NewMatchingService(matchingRepo, &fakemarket.Searcher{}, nil, compSvc))
	handler.SetVoucherRepository(voucher.NewPostgresRepository(dbPool))
	handler.SetGuestRateLimiter(router.NewRedisRateLimiter(rdb, "dh:test:rl:"+uuid.New().String(), 3, time.Minute))

	server := httptest.NewServer(router.NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), handler))
	defer server.Close()
	client := server.Client()

	call := func(method, path, bearer string, body interface{}) (int, string) {
		t.Helper()
		var rd io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, server.URL+path, rd)
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", bearer)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(out)
	}
	newURL := func(name string) string {
		return fmt.Sprintf("https://mock.dealhunter.vn/item/%s-%s", name, uuid.New().String()[:8])
	}
	track := func(bearer, url string) (trackingID, sourceID, productID uuid.UUID) {
		t.Helper()
		code, body := call(http.MethodPost, "/api/v1/tracked-products", bearer, map[string]string{"url": url})
		if code != http.StatusCreated {
			t.Fatalf("track %s: %d %s", url, code, body)
		}
		var res struct {
			ID              uuid.UUID `json:"id"`
			ProductSourceID uuid.UUID `json:"product_source_id"`
		}
		_ = json.Unmarshal([]byte(body), &res)
		src, err := productRepo.GetProductSource(ctx, res.ProductSourceID)
		if err != nil {
			t.Fatalf("load source: %v", err)
		}
		return res.ID, res.ProductSourceID, src.ProductID
	}
	productOf := func(sourceID uuid.UUID) uuid.UUID {
		t.Helper()
		src, err := productRepo.GetProductSource(ctx, sourceID)
		if err != nil {
			t.Fatalf("load source: %v", err)
		}
		return src.ProductID
	}

	_, sessA, _ := googleLogin(t, server.URL, fmt.Sprintf("authz-a-%s@dealhunter.vn", uuid.New().String()[:8]), "")
	bearerA := "Bearer " + sessA.AccessToken
	bearerB, _, _ := startGuest(t, server.URL)

	trackA, sourceA, productA := track(bearerA, newURL("laptop"))
	_, sourceB, productB := track(bearerB, newURL("phone"))

	t.Run("OutsiderCannotReadOrChangeProductGroup", func(t *testing.T) {
		for _, tc := range []struct{ method, path string }{
			{http.MethodGet, "/api/v1/products/" + productA.String() + "/comparison"},
			{http.MethodGet, "/api/v1/products/" + sourceA.String() + "/comparison"},
			{http.MethodGet, "/api/v1/tracked-products/" + sourceA.String() + "/comparison"},
			{http.MethodGet, "/api/v1/tracked-products/" + trackA.String() + "/comparison"},
			{http.MethodGet, "/api/v1/products/" + productA.String() + "/match-suggestions"},
			{http.MethodGet, "/api/v1/tracked-products/" + sourceA.String() + "/match-suggestions"},
			{http.MethodPost, "/api/v1/products/" + productA.String() + "/auto-match"},
			{http.MethodPost, "/api/v1/tracked-products/" + sourceA.String() + "/auto-match"},
			{http.MethodGet, "/api/v1/tracked-products/" + sourceA.String()},
			{http.MethodGet, "/api/v1/tracked-products/" + sourceA.String() + "/prices"},
			{http.MethodGet, "/api/v1/tracked-products/" + sourceA.String() + "/vouchers"},
			{http.MethodGet, "/api/v1/tracked-products/" + trackA.String() + "/vouchers"},
			{http.MethodGet, "/api/v1/tracked-products/" + sourceA.String() + "/alerts"},
		} {
			if code, body := call(tc.method, tc.path, bearerB, nil); code != http.StatusNotFound {
				t.Errorf("B %s %s: expected 404, got %d %s", tc.method, tc.path, code, body)
			}
		}
		code, _ := call(http.MethodPost, "/api/v1/tracked-products/"+sourceA.String()+"/alerts", bearerB,
			map[string]interface{}{"rule_type": "target_price", "threshold_value": 1000})
		if code != http.StatusNotFound {
			t.Errorf("B create alert on A's source: expected 404, got %d", code)
		}
		if code, _ := call(http.MethodGet, "/api/v1/products/"+productA.String()+"/comparison", "", nil); code != http.StatusUnauthorized {
			t.Errorf("anonymous comparison: expected 401, got %d", code)
		}
		// The owner still has access through every ID form.
		for _, path := range []string{
			"/api/v1/products/" + productA.String() + "/comparison",
			"/api/v1/tracked-products/" + trackA.String() + "/comparison",
			"/api/v1/tracked-products/" + sourceA.String() + "/prices",
			"/api/v1/tracked-products/" + sourceA.String() + "/vouchers",
		} {
			if code, body := call(http.MethodGet, path, bearerA, nil); code != http.StatusOK {
				t.Errorf("A GET %s: expected 200, got %d %s", path, code, body)
			}
		}
	})

	t.Run("SEC07_LinkSourceCannotStealSharedSource", func(t *testing.T) {
		urlB := ""
		if src, err := productRepo.GetProductSource(ctx, sourceB); err == nil {
			urlB = src.CanonicalURL
		}
		code, body := call(http.MethodPost, "/api/v1/products/"+productA.String()+"/link-source", bearerA, map[string]string{"url": urlB})
		if code != http.StatusConflict {
			t.Errorf("A linking B's source: expected 409, got %d %s", code, body)
		}
		if got := productOf(sourceB); got != productB {
			t.Fatalf("SEC-07: B's source moved from %s to %s", productB, got)
		}

		if code, _ := call(http.MethodPost, "/api/v1/products/"+productA.String()+"/link-source", bearerB, map[string]string{"url": newURL("tablet")}); code != http.StatusNotFound {
			t.Errorf("B linking into A's group: expected 404, got %d", code)
		}

		// A source only A tracks can be moved into A's group.
		_, ownSource, _ := track(bearerA, newURL("mouse"))
		ownURL, _ := productRepo.GetProductSource(ctx, ownSource)
		if code, body := call(http.MethodPost, "/api/v1/products/"+productA.String()+"/link-source", bearerA, map[string]string{"url": ownURL.CanonicalURL}); code != http.StatusCreated {
			t.Fatalf("A moving own source: expected 201, got %d %s", code, body)
		}
		if productOf(ownSource) != productA {
			t.Errorf("own source was not moved into A's group")
		}

		if code, body := call(http.MethodPost, "/api/v1/products/"+productA.String()+"/link-source", bearerA, map[string]string{"url": "https://evil.example.com/item/1"}); code != http.StatusBadRequest {
			t.Errorf("unsupported URL: expected 400, got %d %s", code, body)
		}
	})

	t.Run("SEC08_SuggestionsScopedToProductAndTracker", func(t *testing.T) {
		sugg := &matching.MatchSuggestion{
			ID:                uuid.New(),
			ProductID:         productA,
			CandidatePlatform: "mock",
			CandidateURL:      newURL("candidate"),
			CandidateTitle:    "Candidate",
			CandidatePrice:    100000,
			MatchScore:        0.7,
			Status:            matching.StatusPending,
		}
		if err := matchingRepo.SaveSuggestion(ctx, sugg); err != nil {
			t.Fatalf("save suggestion: %v", err)
		}
		for _, tc := range []struct {
			bearer    string
			productID uuid.UUID
			action    string
		}{
			{bearerB, productB, "dismiss"}, // own product in path, foreign suggestion
			{bearerB, productA, "dismiss"}, // product B does not track
			{bearerB, productB, "accept"},
			{bearerB, productA, "accept"},
			{bearerA, productB, "dismiss"}, // A does not track product B
		} {
			path := fmt.Sprintf("/api/v1/products/%s/match-suggestions/%s/%s", tc.productID, sugg.ID, tc.action)
			if code, body := call(http.MethodPost, path, tc.bearer, nil); code != http.StatusNotFound {
				t.Errorf("%s via %s: expected 404, got %d %s", tc.action, tc.productID, code, body)
			}
		}
		if got, _ := matchingRepo.GetSuggestionByID(ctx, sugg.ID); got == nil || got.Status != matching.StatusPending {
			t.Fatalf("SEC-08: suggestion changed by unauthorized caller: %+v", got)
		}
		path := fmt.Sprintf("/api/v1/products/%s/match-suggestions/%s/dismiss", trackA, sugg.ID)
		if code, body := call(http.MethodPost, path, bearerA, nil); code != http.StatusOK {
			t.Fatalf("A dismiss own suggestion: expected 200, got %d %s", code, body)
		}
	})

	t.Run("SEC11_OversizedBodyRejected", func(t *testing.T) {
		big := map[string]string{"url": "https://mock.dealhunter.vn/item/" + strings.Repeat("a", 70<<10)}
		if code, _ := call(http.MethodPost, "/api/v1/tracked-products", bearerA, big); code != http.StatusBadRequest {
			t.Errorf("oversized body: expected 400, got %d", code)
		}
	})

	t.Run("InputValidation", func(t *testing.T) {
		for name, body := range map[string]map[string]interface{}{
			"drop_percent over 99":   {"rule_type": "drop_percent", "threshold_value": 150},
			"lowest_in_days over 1y": {"rule_type": "lowest_in_days", "threshold_value": 1000},
			"negative expiry":        {"rule_type": "target_price", "threshold_value": 1000, "expires_in_days": -1},
		} {
			if code, _ := call(http.MethodPost, "/api/v1/tracked-products/"+trackA.String()+"/alerts", bearerA, body); code != http.StatusBadRequest {
				t.Errorf("alert %s: expected 400, got %d", name, code)
			}
		}
		for name, body := range map[string]map[string]string{
			"letters in phone": {"phone": "09abc12345"},
			"short phone":      {"phone": "0912"},
			"zalo id symbols":  {"zalo_id": "<script>"},
		} {
			if code, _ := call(http.MethodPost, "/api/v1/users/me/zalo", bearerA, body); code != http.StatusBadRequest {
				t.Errorf("zalo %s: expected 400, got %d", name, code)
			}
		}
	})

	t.Run("GuestCreationRateLimited", func(t *testing.T) {
		// The limiter allows 3 per window; this test already created one guest (B).
		codes := []int{}
		for i := 0; i < 3; i++ {
			code, _ := call(http.MethodPost, "/api/v1/auth/guest", "", nil)
			codes = append(codes, code)
		}
		if codes[0] != http.StatusOK || codes[1] != http.StatusOK || codes[2] != http.StatusTooManyRequests {
			t.Errorf("expected [200 200 429], got %v", codes)
		}
	})
}
