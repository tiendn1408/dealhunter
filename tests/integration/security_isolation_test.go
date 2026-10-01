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
	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/comparison"
	router "github.com/tiendang/deal-hunter/internal/http"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/mock"
	"github.com/tiendang/deal-hunter/internal/matching"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func TestSecurityAndDataIsolationFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable"
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

	streamName := "dh:test:sec:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "test-sec")
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
	jwtMgr := auth.NewJWTManager("test-security-isolation-secret-32b!", 1*time.Hour)
	authSvc := auth.NewAuthService(authRepo, jwtMgr, "")

	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(authSvc, jwtMgr)

	matchingRepo := matching.NewPostgresMatchingRepository(dbPool)
	searcher := matching.NewMultiPlatformSearcher(nil)
	matchingSvc := matching.NewMatchingService(matchingRepo, searcher, nil, compSvc)
	handler.SetMatchingService(matchingSvc)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	server := httptest.NewServer(r)
	defer server.Close()

	client := server.Client()

	// -------------------------------------------------------------------------
	// Setup Two Separate Users: User A (Registered Member) and User B (Guest / Attacker)
	// -------------------------------------------------------------------------
	userAEmail := fmt.Sprintf("user-a-%s@dealhunter.vn", uuid.New().String()[:8])
	loginBody, _ := json.Marshal(map[string]string{
		"email": userAEmail,
		"name":  "User A DealHunter",
	})
	loginResp, err := client.Post(server.URL+"/api/v1/auth/demo-login", "application/json", bytes.NewBuffer(loginBody))
	if err != nil || loginResp.StatusCode != http.StatusOK {
		t.Fatalf("Failed to login User A: %v, status: %d", err, loginResp.StatusCode)
	}
	var loginData auth.LoginResponse
	_ = json.NewDecoder(loginResp.Body).Decode(&loginData)
	loginResp.Body.Close()

	userAToken := loginData.Token
	userAID := loginData.User.ID

	userBID := uuid.New()

	// Shared product URL tracked by both users
	sharedURL := fmt.Sprintf("https://mock.dealhunter.vn/item/laptop-%s", uuid.New().String()[:8])

	// User A tracks product
	trackPayload, _ := json.Marshal(map[string]string{"url": sharedURL})
	reqTrackA, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackPayload))
	reqTrackA.Header.Set("Content-Type", "application/json")
	reqTrackA.Header.Set("Authorization", "Bearer "+userAToken)
	respTrackA, err := client.Do(reqTrackA)
	if err != nil || respTrackA.StatusCode != http.StatusCreated {
		t.Fatalf("User A track product failed: %v, code: %d", err, respTrackA.StatusCode)
	}
	var trackDataA struct {
		ID              uuid.UUID `json:"id"`
		ProductSourceID uuid.UUID `json:"product_source_id"`
	}
	_ = json.NewDecoder(respTrackA.Body).Decode(&trackDataA)
	respTrackA.Body.Close()

	// User B tracks the exact same product
	reqTrackB, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackPayload))
	reqTrackB.Header.Set("Content-Type", "application/json")
	reqTrackB.Header.Set("X-User-ID", userBID.String())
	respTrackB, err := client.Do(reqTrackB)
	if err != nil || respTrackB.StatusCode != http.StatusCreated {
		t.Fatalf("User B track product failed: %v, code: %d", err, respTrackB.StatusCode)
	}
	var trackDataB struct {
		ID              uuid.UUID `json:"id"`
		ProductSourceID uuid.UUID `json:"product_source_id"`
	}
	_ = json.NewDecoder(respTrackB.Body).Decode(&trackDataB)
	respTrackB.Body.Close()

	if trackDataA.ProductSourceID != trackDataB.ProductSourceID {
		t.Fatalf("Expected shared productSourceID, got %s vs %s", trackDataA.ProductSourceID, trackDataB.ProductSourceID)
	}
	sourceID := trackDataA.ProductSourceID

	// -------------------------------------------------------------------------
	// 1. Vulnerability 1 Test: Alert Rules Cross-Tenant Isolation
	// -------------------------------------------------------------------------
	t.Run("Vulnerability1_AlertRulesIsolation", func(t *testing.T) {
		// User A creates alert rule on sourceID (Target Price = 15,000,000)
		alertBody, _ := json.Marshal(map[string]interface{}{
			"rule_type":       "target_price",
			"threshold_value": 15000000,
		})
		reqAlertA, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/alerts", server.URL, sourceID), bytes.NewBuffer(alertBody))
		reqAlertA.Header.Set("Content-Type", "application/json")
		reqAlertA.Header.Set("Authorization", "Bearer "+userAToken)
		respAlertA, err := client.Do(reqAlertA)
		if err != nil || respAlertA.StatusCode != http.StatusCreated {
			t.Fatalf("User A create alert failed: %v, status: %d", err, respAlertA.StatusCode)
		}
		var userAAlert alert.AlertRule
		_ = json.NewDecoder(respAlertA.Body).Decode(&userAAlert)
		respAlertA.Body.Close()

		// User B lists alerts for the same product source
		reqListB, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/alerts", server.URL, sourceID), nil)
		reqListB.Header.Set("X-User-ID", userBID.String())
		respListB, err := client.Do(reqListB)
		if err != nil || respListB.StatusCode != http.StatusOK {
			t.Fatalf("User B list alerts request failed: %v, status: %d", err, respListB.StatusCode)
		}
		var userBList struct {
			Data []*alert.AlertRule `json:"data"`
		}
		_ = json.NewDecoder(respListB.Body).Decode(&userBList)
		respListB.Body.Close()

		// User B must NOT see User A's alert
		if len(userBList.Data) != 0 {
			t.Fatalf("DATA LEAK: User B can see %d alert rules created by User A on shared source!", len(userBList.Data))
		}

		// User A lists alerts and must see their own alert
		reqListA, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/alerts", server.URL, sourceID), nil)
		reqListA.Header.Set("Authorization", "Bearer "+userAToken)
		respListA, err := client.Do(reqListA)
		if err != nil || respListA.StatusCode != http.StatusOK {
			t.Fatalf("User A list alerts request failed: %v, status: %d", err, respListA.StatusCode)
		}
		var userAList struct {
			Data []*alert.AlertRule `json:"data"`
		}
		_ = json.NewDecoder(respListA.Body).Decode(&userAList)
		respListA.Body.Close()

		if len(userAList.Data) != 1 || userAList.Data[0].ID != userAAlert.ID {
			t.Fatalf("User A expected to see their 1 alert rule, got: %d", len(userAList.Data))
		}
	})

	// -------------------------------------------------------------------------
	// 2. Vulnerability 2 Test: IDOR on Alert Deactivation
	// -------------------------------------------------------------------------
	t.Run("Vulnerability2_IDORAlertDeactivation", func(t *testing.T) {
		// User A creates alert rule
		alertBody, _ := json.Marshal(map[string]interface{}{
			"rule_type":       "drop_percent",
			"threshold_value": 20,
		})
		reqAlertA, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/alerts", server.URL, sourceID), bytes.NewBuffer(alertBody))
		reqAlertA.Header.Set("Content-Type", "application/json")
		reqAlertA.Header.Set("Authorization", "Bearer "+userAToken)
		respAlertA, _ := client.Do(reqAlertA)
		var userAAlert alert.AlertRule
		_ = json.NewDecoder(respAlertA.Body).Decode(&userAAlert)
		respAlertA.Body.Close()

		// User B attempts to deactivate User A's alert rule
		reqDeactB, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/api/v1/alerts/%s", server.URL, userAAlert.ID), nil)
		reqDeactB.Header.Set("X-User-ID", userBID.String())
		respDeactB, err := client.Do(reqDeactB)
		if err != nil {
			t.Fatalf("User B deactivate request error: %v", err)
		}
		respDeactB.Body.Close()

		if respDeactB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 Not Found when User B attempts to deactivate User A alert, got status: %d", respDeactB.StatusCode)
		}

		// Verify in database that User A's rule is still active
		dbRule, err := alertRepo.GetRule(ctx, userAAlert.ID)
		if err != nil || dbRule == nil || !dbRule.Active {
			t.Fatalf("IDOR breached: User A alert was deactivated by User B!")
		}

		// User A deactivates their own alert rule
		reqDeactA, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/api/v1/alerts/%s", server.URL, userAAlert.ID), nil)
		reqDeactA.Header.Set("Authorization", "Bearer "+userAToken)
		respDeactA, err := client.Do(reqDeactA)
		if err != nil || respDeactA.StatusCode != http.StatusOK {
			t.Fatalf("User A deactivate failed: %v, status: %d", err, respDeactA.StatusCode)
		}
		respDeactA.Body.Close()

		dbRuleAfter, _ := alertRepo.GetRule(ctx, userAAlert.ID)
		if dbRuleAfter == nil || dbRuleAfter.Active {
			t.Fatalf("Expected rule to be deactivated by owner User A")
		}
	})

	// -------------------------------------------------------------------------
	// 3. Vulnerability 3 Test: Alert Logs and PII Isolation
	// -------------------------------------------------------------------------
	t.Run("Vulnerability3_AlertLogsPIIIsolation", func(t *testing.T) {
		// Create alert rule for User A and insert a notification log with PII
		alertRule := &alert.AlertRule{
			ID:              uuid.New(),
			UserID:          userAID,
			ProductSourceID: sourceID,
			RuleType:        alert.RuleTypeTargetPrice,
			ThresholdValue:  10000000,
			Active:          true,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}
		_ = alertRepo.CreateRule(ctx, alertRule)

		logEntry := &notification.NotificationLog{
			ID:          uuid.New(),
			UserID:      userAID,
			AlertRuleID: alertRule.ID,
			Channel:     "zalo",
			Recipient:   "0909123456", // Private phone number
			Status:      notification.StatusDelivered,
			CreatedAt:   time.Now(),
		}
		_ = notifRepo.InsertLog(ctx, logEntry)

		// User B attempts to access User A's alert logs
		reqLogsB, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/alerts/%s/logs", server.URL, alertRule.ID), nil)
		reqLogsB.Header.Set("X-User-ID", userBID.String())
		respLogsB, err := client.Do(reqLogsB)
		if err != nil {
			t.Fatalf("User B get logs request error: %v", err)
		}
		respLogsB.Body.Close()

		if respLogsB.StatusCode != http.StatusNotFound {
			t.Fatalf("PII LEAK: Expected status 404 Not Found for unauthorized logs access, got: %d", respLogsB.StatusCode)
		}

		// User A accesses their own alert logs
		reqLogsA, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/alerts/%s/logs", server.URL, alertRule.ID), nil)
		reqLogsA.Header.Set("Authorization", "Bearer "+userAToken)
		respLogsA, err := client.Do(reqLogsA)
		if err != nil || respLogsA.StatusCode != http.StatusOK {
			t.Fatalf("User A failed to access their alert logs: %v, status: %d", err, respLogsA.StatusCode)
		}
		var logsA struct {
			Data []*notification.NotificationLog `json:"data"`
		}
		_ = json.NewDecoder(respLogsA.Body).Decode(&logsA)
		respLogsA.Body.Close()

		if len(logsA.Data) != 1 || logsA.Data[0].Recipient != "0909123456" {
			t.Fatalf("User A expected 1 log entry with recipient 0909123456, got: %d", len(logsA.Data))
		}
	})

	// -------------------------------------------------------------------------
	// 4. Vulnerability 4 Test: IDOR on Tracking Pause, Resume, and Details
	// -------------------------------------------------------------------------
	t.Run("Vulnerability4_IDORTrackingOperations", func(t *testing.T) {
		// User B attempts to pause User A's tracking
		reqPauseB, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/pause", server.URL, trackDataA.ID), nil)
		reqPauseB.Header.Set("X-User-ID", userBID.String())
		respPauseB, err := client.Do(reqPauseB)
		if err != nil {
			t.Fatalf("User B pause request error: %v", err)
		}
		respPauseB.Body.Close()

		if respPauseB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 when User B tries to pause User A tracking, got: %d", respPauseB.StatusCode)
		}

		// Verify User A tracking remains active
		trackingA, err := trackingRepo.GetTracking(ctx, trackDataA.ID)
		if err != nil || !trackingA.Active {
			t.Fatalf("IDOR breached: User A tracking was paused by User B!")
		}

		// User A pauses their own tracking
		reqPauseA, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/pause", server.URL, trackDataA.ID), nil)
		reqPauseA.Header.Set("Authorization", "Bearer "+userAToken)
		respPauseA, err := client.Do(reqPauseA)
		if err != nil || respPauseA.StatusCode != http.StatusOK {
			t.Fatalf("User A pause failed: %v, status: %d", err, respPauseA.StatusCode)
		}
		respPauseA.Body.Close()

		// User B attempts to resume User A's tracking
		reqResumeB, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/resume", server.URL, trackDataA.ID), nil)
		reqResumeB.Header.Set("X-User-ID", userBID.String())
		respResumeB, err := client.Do(reqResumeB)
		if err != nil {
			t.Fatalf("User B resume request error: %v", err)
		}
		respResumeB.Body.Close()

		if respResumeB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 when User B tries to resume User A tracking, got: %d", respResumeB.StatusCode)
		}

		// User B attempts to view User A's tracking details directly via tracking ID
		reqGetTrackingB, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s", server.URL, trackDataA.ID), nil)
		reqGetTrackingB.Header.Set("X-User-ID", userBID.String())
		respGetTrackingB, err := client.Do(reqGetTrackingB)
		if err != nil {
			t.Fatalf("User B get tracking request error: %v", err)
		}
		respGetTrackingB.Body.Close()

		if respGetTrackingB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 when User B queries User A tracking ID, got: %d", respGetTrackingB.StatusCode)
		}

		// User B attempts to view User A's tracking comparison
		reqCmpB, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/comparison", server.URL, trackDataA.ID), nil)
		reqCmpB.Header.Set("X-User-ID", userBID.String())
		respCmpB, err := client.Do(reqCmpB)
		if err != nil {
			t.Fatalf("User B get comparison error: %v", err)
		}
		respCmpB.Body.Close()
		if respCmpB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 when User B queries User A tracking comparison, got: %d", respCmpB.StatusCode)
		}

		// User B attempts to view User A's tracking match-suggestions
		reqSuggB, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/match-suggestions", server.URL, trackDataA.ID), nil)
		reqSuggB.Header.Set("X-User-ID", userBID.String())
		respSuggB, err := client.Do(reqSuggB)
		if err != nil {
			t.Fatalf("User B get match suggestions error: %v", err)
		}
		respSuggB.Body.Close()
		if respSuggB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 when User B queries User A tracking match-suggestions, got: %d", respSuggB.StatusCode)
		}

		// User B attempts to trigger auto-match on User A's tracking ID
		reqAutoB, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/auto-match", server.URL, trackDataA.ID), nil)
		reqAutoB.Header.Set("X-User-ID", userBID.String())
		respAutoB, err := client.Do(reqAutoB)
		if err != nil {
			t.Fatalf("User B trigger auto-match error: %v", err)
		}
		respAutoB.Body.Close()
		if respAutoB.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 when User B triggers auto-match on User A tracking ID, got: %d", respAutoB.StatusCode)
		}

		// User A resumes their own tracking
		reqResumeA, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/resume", server.URL, trackDataA.ID), nil)
		reqResumeA.Header.Set("Authorization", "Bearer "+userAToken)
		respResumeA, err := client.Do(reqResumeA)
		if err != nil || respResumeA.StatusCode != http.StatusOK {
			t.Fatalf("User A resume failed: %v, status: %d", err, respResumeA.StatusCode)
		}
		respResumeA.Body.Close()
	})

	// -------------------------------------------------------------------------
	// 5. Vulnerability 5 Test: Registered Member Impersonation via X-User-ID
	// -------------------------------------------------------------------------
	t.Run("Vulnerability5_RegisteredMemberImpersonationPrevention", func(t *testing.T) {
		// User A is a registered member (auth_provider = "demo").
		// An attacker attempts to impersonate User A by sending X-User-ID: User A ID without JWT

		// Attacker attempts GET /api/v1/auth/me
		reqMe, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/auth/me", nil)
		reqMe.Header.Set("X-User-ID", userAID.String())
		respMe, err := client.Do(reqMe)
		if err != nil {
			t.Fatalf("Impersonation request error: %v", err)
		}
		respMe.Body.Close()
		if respMe.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY BREACH: Unauthenticated request with registered X-User-ID succeeded on /auth/me! Status: %d", respMe.StatusCode)
		}

		// Attacker attempts GET /api/v1/users/me
		reqProfile, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/users/me", nil)
		reqProfile.Header.Set("X-User-ID", userAID.String())
		respProfile, err := client.Do(reqProfile)
		if err != nil {
			t.Fatalf("Impersonation request error: %v", err)
		}
		respProfile.Body.Close()
		if respProfile.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY BREACH: Unauthenticated request with registered X-User-ID succeeded on /users/me! Status: %d", respProfile.StatusCode)
		}

		// Attacker attempts GET /api/v1/tracked-products
		reqTrackings, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tracked-products", nil)
		reqTrackings.Header.Set("X-User-ID", userAID.String())
		respTrackings, err := client.Do(reqTrackings)
		if err != nil {
			t.Fatalf("Impersonation request error: %v", err)
		}
		respTrackings.Body.Close()
		if respTrackings.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY BREACH: Unauthenticated request with registered X-User-ID succeeded on /tracked-products! Status: %d", respTrackings.StatusCode)
		}

		// Attacker attempts GET /api/v1/alert-rules
		reqRules, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/alert-rules", nil)
		reqRules.Header.Set("X-User-ID", userAID.String())
		respRules, err := client.Do(reqRules)
		if err != nil {
			t.Fatalf("Impersonation request error: %v", err)
		}
		respRules.Body.Close()
		if respRules.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY BREACH: Unauthenticated request with registered X-User-ID succeeded on /alert-rules! Status: %d", respRules.StatusCode)
		}

		// Attacker attempts GET /api/v1/notifications
		reqNotifs, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/notifications", nil)
		reqNotifs.Header.Set("X-User-ID", userAID.String())
		respNotifs, err := client.Do(reqNotifs)
		if err != nil {
			t.Fatalf("Impersonation request error: %v", err)
		}
		respNotifs.Body.Close()
		if respNotifs.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY BREACH: Unauthenticated request with registered X-User-ID succeeded on /notifications! Status: %d", respNotifs.StatusCode)
		}

		// Attacker attempts POST /api/v1/users/me/zalo
		zaloBody, _ := json.Marshal(map[string]string{"phone": "0999999999"})
		reqZalo, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/users/me/zalo", bytes.NewBuffer(zaloBody))
		reqZalo.Header.Set("Content-Type", "application/json")
		reqZalo.Header.Set("X-User-ID", userAID.String())
		respZalo, err := client.Do(reqZalo)
		if err != nil {
			t.Fatalf("Impersonation request error: %v", err)
		}
		respZalo.Body.Close()
		if respZalo.StatusCode != http.StatusUnauthorized {
			t.Fatalf("SECURITY BREACH: Unauthenticated request with registered X-User-ID succeeded on /users/me/zalo! Status: %d", respZalo.StatusCode)
		}
	})

	// -------------------------------------------------------------------------
	// 6. Vulnerability 6 Test: Unauthenticated Migration Prevention
	// -------------------------------------------------------------------------
	t.Run("Vulnerability6_UnauthenticatedMigrationBlocked", func(t *testing.T) {
		guestUUID := uuid.New()
		migrateBody, _ := json.Marshal(map[string]interface{}{
			"guest_user_id": guestUUID,
		})

		// Attacker attempts to call migrate without Bearer token
		reqNoAuth, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migrateBody))
		reqNoAuth.Header.Set("Content-Type", "application/json")
		respNoAuth, err := client.Do(reqNoAuth)
		if err != nil {
			t.Fatalf("Migrate request error: %v", err)
		}
		respNoAuth.Body.Close()

		if respNoAuth.StatusCode != http.StatusUnauthorized {
			t.Fatalf("Expected 401 Unauthorized for unauthenticated migrate call, got: %d", respNoAuth.StatusCode)
		}

		// Attacker attempts to forge X-User-ID to target User A without JWT
		reqForge, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migrateBody))
		reqForge.Header.Set("Content-Type", "application/json")
		reqForge.Header.Set("X-User-ID", userAID.String())
		respForge, err := client.Do(reqForge)
		if err != nil {
			t.Fatalf("Migrate forged request error: %v", err)
		}
		respForge.Body.Close()

		if respForge.StatusCode != http.StatusUnauthorized {
			t.Fatalf("Expected 401 Unauthorized for forged X-User-ID migrate call, got: %d", respForge.StatusCode)
		}

		// Legitimate migration with User A's Bearer JWT succeeds
		reqAuth, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migrateBody))
		reqAuth.Header.Set("Content-Type", "application/json")
		reqAuth.Header.Set("Authorization", "Bearer "+userAToken)
		respAuth, err := client.Do(reqAuth)
		if err != nil || respAuth.StatusCode != http.StatusOK {
			t.Fatalf("Legitimate migrate with JWT failed: %v, status: %d", err, respAuth.StatusCode)
		}
		respAuth.Body.Close()
	})

	// -------------------------------------------------------------------------
	// 7. Vulnerability 7 Test: Registered User Account Theft via Migration Blocked
	// -------------------------------------------------------------------------
	t.Run("Vulnerability7_RegisteredUserMigrationTheftBlocked", func(t *testing.T) {
		// Create Attacker / User C as a registered member
		userCEmail := fmt.Sprintf("user-c-%s@dealhunter.vn", uuid.New().String()[:8])
		loginBodyC, _ := json.Marshal(map[string]string{
			"email": userCEmail,
			"name":  "User C Attacker",
		})
		loginRespC, err := client.Post(server.URL+"/api/v1/auth/demo-login", "application/json", bytes.NewBuffer(loginBodyC))
		if err != nil || loginRespC.StatusCode != http.StatusOK {
			t.Fatalf("Failed to login User C: %v", err)
		}
		var loginDataC auth.LoginResponse
		_ = json.NewDecoder(loginRespC.Body).Decode(&loginDataC)
		loginRespC.Body.Close()
		userCToken := loginDataC.Token

		// User C attempts to steal User A's data by passing User A's UUID as guest_user_id
		stealPayload, _ := json.Marshal(map[string]interface{}{
			"guest_user_id": userAID,
		})
		reqSteal, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(stealPayload))
		reqSteal.Header.Set("Content-Type", "application/json")
		reqSteal.Header.Set("Authorization", "Bearer "+userCToken)
		respSteal, err := client.Do(reqSteal)
		if err != nil {
			t.Fatalf("Theft migrate request error: %v", err)
		}
		respSteal.Body.Close()

		if respSteal.StatusCode != http.StatusBadRequest {
			t.Fatalf("SECURITY BREACH: Migration of registered member account did not return 400! Status: %d", respSteal.StatusCode)
		}

		// Verify User A still owns their tracked product
		reqCheckA, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tracked-products", nil)
		reqCheckA.Header.Set("Authorization", "Bearer "+userAToken)
		respCheckA, err := client.Do(reqCheckA)
		if err != nil || respCheckA.StatusCode != http.StatusOK {
			t.Fatalf("Failed to verify User A trackings: %v", err)
		}
		var trackingsA struct {
			Data []map[string]interface{} `json:"data"`
		}
		_ = json.NewDecoder(respCheckA.Body).Decode(&trackingsA)
		respCheckA.Body.Close()

		if len(trackingsA.Data) == 0 {
			t.Fatalf("SECURITY BREACH: User A's tracked products were stolen or wiped!")
		}
	})

	// -------------------------------------------------------------------------
	// 8. Vulnerability 8 Test: Already Migrated Guest Replay Prevented
	// -------------------------------------------------------------------------
	t.Run("Vulnerability8_AlreadyMigratedGuestReplayPrevented", func(t *testing.T) {
		guestDID := uuid.New()
		guestURL := fmt.Sprintf("https://mock.dealhunter.vn/item/camera-%s", uuid.New().String()[:8])
		trackPayload, _ := json.Marshal(map[string]string{"url": guestURL})

		reqTrackGuest, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackPayload))
		reqTrackGuest.Header.Set("Content-Type", "application/json")
		reqTrackGuest.Header.Set("X-User-ID", guestDID.String())
		respTrackGuest, err := client.Do(reqTrackGuest)
		if err != nil || respTrackGuest.StatusCode != http.StatusCreated {
			t.Fatalf("Guest track failed: %v", err)
		}
		respTrackGuest.Body.Close()

		// User A legitimately migrates guestDID
		migratePayload, _ := json.Marshal(map[string]interface{}{
			"guest_user_id": guestDID,
		})
		reqMigrate1, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migratePayload))
		reqMigrate1.Header.Set("Content-Type", "application/json")
		reqMigrate1.Header.Set("Authorization", "Bearer "+userAToken)
		respMigrate1, err := client.Do(reqMigrate1)
		if err != nil || respMigrate1.StatusCode != http.StatusOK {
			t.Fatalf("First migration failed: %v, status: %d", err, respMigrate1.StatusCode)
		}
		respMigrate1.Body.Close()

		// Attempt to replay migration with the same guestDID
		reqMigrate2, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migratePayload))
		reqMigrate2.Header.Set("Content-Type", "application/json")
		reqMigrate2.Header.Set("Authorization", "Bearer "+userAToken)
		respMigrate2, err := client.Do(reqMigrate2)
		if err != nil {
			t.Fatalf("Replay migration request error: %v", err)
		}
		respMigrate2.Body.Close()

		if respMigrate2.StatusCode != http.StatusBadRequest {
			t.Fatalf("Expected 400 Bad Request on replay migration of already-migrated guest, got: %d", respMigrate2.StatusCode)
		}
	})

	// -------------------------------------------------------------------------
	// 9. Vulnerability 9 Test: Migration to Self Prevented
	// -------------------------------------------------------------------------
	t.Run("Vulnerability9_MigrationToSelfPrevented", func(t *testing.T) {
		selfPayload, _ := json.Marshal(map[string]interface{}{
			"guest_user_id": userAID,
		})
		reqSelf, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(selfPayload))
		reqSelf.Header.Set("Content-Type", "application/json")
		reqSelf.Header.Set("Authorization", "Bearer "+userAToken)
		respSelf, err := client.Do(reqSelf)
		if err != nil {
			t.Fatalf("Self migrate request error: %v", err)
		}
		respSelf.Body.Close()

		if respSelf.StatusCode != http.StatusBadRequest {
			t.Fatalf("Expected 400 Bad Request on self-migration, got: %d", respSelf.StatusCode)
		}
	})

	// -------------------------------------------------------------------------
	// 10. Vulnerability 10 Test: Semantic Status Codes (400, 404, 409)
	// -------------------------------------------------------------------------
	t.Run("Vulnerability10_UXSemanticStatusCodes", func(t *testing.T) {
		// 1. Unsupported URL tracking returns 400 Bad Request instead of 500
		badURLPayload, _ := json.Marshal(map[string]string{
			"url": "https://unsupported-marketplace-domain.vn/item/123",
		})
		reqBadURL, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(badURLPayload))
		reqBadURL.Header.Set("Content-Type", "application/json")
		reqBadURL.Header.Set("Authorization", "Bearer "+userAToken)
		respBadURL, err := client.Do(reqBadURL)
		if err != nil {
			t.Fatalf("Track bad URL request error: %v", err)
		}
		respBadURL.Body.Close()
		if respBadURL.StatusCode != http.StatusBadRequest {
			t.Fatalf("Expected 400 Bad Request for unsupported URL, got: %d", respBadURL.StatusCode)
		}

		// 2. Querying prices for a non-existent / unauthorized source returns 404 Not Found
		fakeUUID := uuid.New()
		reqPrices, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/prices", server.URL, fakeUUID), nil)
		reqPrices.Header.Set("Authorization", "Bearer "+userAToken)
		respPrices, err := client.Do(reqPrices)
		if err != nil {
			t.Fatalf("Get prices request error: %v", err)
		}
		respPrices.Body.Close()
		if respPrices.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 Not Found for non-existent source prices, got: %d", respPrices.StatusCode)
		}

		// 3. Creating alert for a non-existent source returns 404 Not Found
		alertBody, _ := json.Marshal(map[string]interface{}{
			"rule_type":       "target_price",
			"threshold_value": 100000,
		})
		reqAlertFake, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/alerts", server.URL, fakeUUID), bytes.NewBuffer(alertBody))
		reqAlertFake.Header.Set("Content-Type", "application/json")
		reqAlertFake.Header.Set("Authorization", "Bearer "+userAToken)
		respAlertFake, err := client.Do(reqAlertFake)
		if err != nil {
			t.Fatalf("Create alert fake request error: %v", err)
		}
		respAlertFake.Body.Close()
		if respAlertFake.StatusCode != http.StatusNotFound {
			t.Fatalf("Expected 404 Not Found for non-existent source alert, got: %d", respAlertFake.StatusCode)
		}

		// 4. Duplicate Zalo phone connection returns 409 Conflict
		uniquePhone := fmt.Sprintf("09%08d", time.Now().UnixNano()%100000000)
		zaloBody1, _ := json.Marshal(map[string]string{"phone": uniquePhone})
		reqZalo1, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/users/me/zalo", bytes.NewBuffer(zaloBody1))
		reqZalo1.Header.Set("Content-Type", "application/json")
		reqZalo1.Header.Set("Authorization", "Bearer "+userAToken)
		respZalo1, err := client.Do(reqZalo1)
		if err != nil || respZalo1.StatusCode != http.StatusOK {
			t.Fatalf("First Zalo connection failed: %v, status: %d", err, respZalo1.StatusCode)
		}
		respZalo1.Body.Close()

		// User B attempts to connect the same phone number
		reqZalo2, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/users/me/zalo", bytes.NewBuffer(zaloBody1))
		reqZalo2.Header.Set("Content-Type", "application/json")
		reqZalo2.Header.Set("X-User-ID", userBID.String())
		respZalo2, err := client.Do(reqZalo2)
		if err != nil {
			t.Fatalf("Duplicate Zalo connection request error: %v", err)
		}
		respZalo2.Body.Close()
		if respZalo2.StatusCode != http.StatusConflict {
			t.Fatalf("Expected 409 Conflict for duplicate Zalo connection, got: %d", respZalo2.StatusCode)
		}
	})
}
