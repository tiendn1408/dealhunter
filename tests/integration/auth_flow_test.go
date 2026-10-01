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

	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(authSvc, jwtMgr)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	server := httptest.NewServer(r)
	defer server.Close()

	guestID := uuid.New()
	_, _ = dbPool.Exec(ctx, "INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", guestID)

	// Step 1: Guest tracks a product with X-User-ID
	prodURL := fmt.Sprintf("https://mock.dealhunter.vn/item/sony-%s", uuid.New().String()[:8])
	trackBody, _ := json.Marshal(map[string]string{"url": prodURL})
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", guestID.String())

	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("Guest tracking failed: %v, status: %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// Step 2: User logs in via Demo Login
	loginBody, _ := json.Marshal(map[string]string{
		"email": fmt.Sprintf("user-%s@dealhunter.vn", uuid.New().String()[:8]),
		"name":  "DealHunter Explorer",
	})
	loginReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/demo-login", bytes.NewBuffer(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")

	loginResp, err := http.DefaultClient.Do(loginReq)
	if err != nil || loginResp.StatusCode != http.StatusOK {
		t.Fatalf("Demo login failed: %v, status: %d", err, loginResp.StatusCode)
	}

	var authResult auth.LoginResponse
	_ = json.NewDecoder(loginResp.Body).Decode(&authResult)
	loginResp.Body.Close()

	if authResult.Token == "" {
		t.Fatal("Expected non-empty JWT token")
	}
	token := authResult.Token
	authUserID := authResult.User.ID

	// Step 3: Call Migrate API with JWT token
	migrateBody, _ := json.Marshal(map[string]interface{}{
		"guest_user_id": guestID,
	})
	migrateReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migrateBody))
	migrateReq.Header.Set("Content-Type", "application/json")
	migrateReq.Header.Set("Authorization", "Bearer "+token)

	migResp, err := http.DefaultClient.Do(migrateReq)
	if err != nil || migResp.StatusCode != http.StatusOK {
		t.Fatalf("Migrate API failed: %v, status: %d", err, migResp.StatusCode)
	}

	var migResult auth.MigrationResult
	_ = json.NewDecoder(migResp.Body).Decode(&migResult)
	migResp.Body.Close()

	if migResult.MigratedProducts != 1 {
		t.Errorf("Expected 1 migrated product, got %d", migResult.MigratedProducts)
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
