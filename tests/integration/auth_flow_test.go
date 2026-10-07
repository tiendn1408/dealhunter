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
	"github.com/tiendang/deal-hunter/internal/marketplace/mock"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func TestAuthAndGuestMigrationFlow(t *testing.T) {
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

	streamName := "dh:test:auth:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "test-auth")
	_ = q.Init(ctx)

	registry := marketplace.NewRegistry()
	registry.Register(mock.NewMockAdapter())

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)
	alertRepo := alert.NewPostgresRepository(dbPool)
	notifRepo := notification.NewPostgresRepository(dbPool)
	comparisonRepo := comparison.NewPostgresRepository(dbPool)
	authRepo := auth.NewPostgresUserRepository(dbPool)

	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)
	pricingSvc := pricing.NewPricingService(pricingRepo)
	compSvc := comparison.NewComparisonService(comparisonRepo, nil)
	jwtMgr := auth.NewJWTManager("test-auth-integration-secret-32-bytes!!", 1*time.Hour)
	authSvc := auth.NewAuthService(authRepo, jwtMgr, "")
	authSvc.SetDevLoginEnabled(true)

	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(authSvc, jwtMgr)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	server := httptest.NewServer(r)
	defer server.Close()

	// Step 1: Guest bootstraps a session and tracks a product
	guestBearer, guestSess, guestCookie := startGuest(t, server.URL)
	if guestSess.User.AuthProvider != "guest" {
		t.Fatalf("expected guest user, got %s", guestSess.User.AuthProvider)
	}

	prodURL := fmt.Sprintf("https://mock.dealhunter.vn/item/sony-%s", uuid.New().String()[:8])
	trackBody, _ := json.Marshal(map[string]string{"url": prodURL})
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", guestBearer)

	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Guest tracking failed: %v, status: %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// Step 2: Login while presenting the guest token migrates the guest data automatically
	loginResp, authResult, loginCookie := postSession(t, server.URL+"/api/v1/auth/demo-login", map[string]string{
		"email": fmt.Sprintf("user-%s@dealhunter.vn", uuid.New().String()[:8]),
		"name":  "DealHunter Explorer",
	}, guestBearer, nil)
	if authResult == nil {
		t.Fatalf("Demo login failed, status: %d", loginResp.StatusCode)
	}
	if authResult.AccessToken == "" || loginCookie == nil || !loginCookie.HttpOnly {
		t.Fatal("Expected access token and HttpOnly refresh cookie")
	}
	token := authResult.AccessToken
	authUserID := authResult.User.ID

	if authResult.Migration == nil || authResult.Migration.MigratedProducts != 1 {
		t.Fatalf("Expected 1 migrated product, got %+v", authResult.Migration)
	}

	// Step 3: Refresh rotates the cookie; replaying the old cookie is rejected
	refreshResp, refreshed, rotatedCookie := postSession(t, server.URL+"/api/v1/auth/refresh", nil, "", loginCookie)
	if refreshed == nil || rotatedCookie == nil || rotatedCookie.Value == loginCookie.Value {
		t.Fatalf("Refresh failed or did not rotate cookie, status: %d", refreshResp.StatusCode)
	}
	if refreshed.User.ID != authUserID {
		t.Fatalf("Refresh returned wrong user %s", refreshed.User.ID)
	}
	// Replay after the concurrent-tab grace window is treated as theft
	_, _ = dbPool.Exec(ctx, "UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '5 minutes' WHERE token_hash = $1",
		auth.HashRefreshToken(loginCookie.Value))
	if replay, _, _ := postSession(t, server.URL+"/api/v1/auth/refresh", nil, "", loginCookie); replay.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Expected 401 replaying rotated refresh token, got %d", replay.StatusCode)
	}
	if again, _, _ := postSession(t, server.URL+"/api/v1/auth/refresh", nil, "", rotatedCookie); again.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Expected reuse detection to revoke the rotated token too, got %d", again.StatusCode)
	}

	// The migrated guest's session was revoked during migration
	if guestCookie == nil {
		t.Fatal("Expected guest refresh cookie")
	}
	if after, _, _ := postSession(t, server.URL+"/api/v1/auth/refresh", nil, "", guestCookie); after.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Expected 401 refreshing migrated guest session, got %d", after.StatusCode)
	}

	// Logout revokes the member session (the replay above already revoked this token family,
	// so use a fresh login)
	_, _, freshCookie := postSession(t, server.URL+"/api/v1/auth/demo-login",
		map[string]string{"email": *authResult.User.Email}, "", nil)
	logoutReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/logout", nil)
	logoutReq.AddCookie(freshCookie)
	logoutResp, err := http.DefaultClient.Do(logoutReq)
	if err != nil || logoutResp.StatusCode != http.StatusNoContent {
		t.Fatalf("Logout failed: %v", err)
	}
	logoutResp.Body.Close()
	if after, _, _ := postSession(t, server.URL+"/api/v1/auth/refresh", nil, "", freshCookie); after.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Expected 401 refreshing after logout, got %d", after.StatusCode)
	}

	// Step 4: Verify tracked-products returns the migrated item for the authenticated user
	listReq, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tracked-products", nil)
	listReq.Header.Set("Authorization", "Bearer "+token)

	listResp, err := http.DefaultClient.Do(listReq)
	if err != nil || listResp.StatusCode != http.StatusOK {
		t.Fatalf("List trackings failed: %v, status: %d", err, listResp.StatusCode)
	}

	var listResult struct {
		Data []map[string]interface{} `json:"data"`
	}
	_ = json.NewDecoder(listResp.Body).Decode(&listResult)
	listResp.Body.Close()

	if len(listResult.Data) != 1 {
		t.Errorf("Expected 1 tracking for authenticated user, got %d", len(listResult.Data))
	}

	// Step 5: Verify GET /api/v1/auth/me returns current user
	meReq, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+token)

	meResp, err := http.DefaultClient.Do(meReq)
	if err != nil || meResp.StatusCode != http.StatusOK {
		t.Fatalf("Get me failed: %v, status: %d", err, meResp.StatusCode)
	}

	var me auth.User
	_ = json.NewDecoder(meResp.Body).Decode(&me)
	meResp.Body.Close()

	if me.ID != authUserID {
		t.Errorf("Expected me.ID %s, got %s", authUserID, me.ID)
	}
	if me.AuthProvider != "demo" {
		t.Errorf("Expected auth_provider 'demo', got %s", me.AuthProvider)
	}
}
