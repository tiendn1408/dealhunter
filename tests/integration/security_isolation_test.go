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
	"github.com/tiendang/deal-hunter/pkg/database"
	"github.com/tiendang/deal-hunter/tests/fakemarket"
	"github.com/tiendang/deal-hunter/tests/fakezalo"
)

func TestSecurityAndDataIsolationFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := getTestDatabaseURL(t)

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable at %s: %v", dbURL, err)
	}
	defer dbPool.Close()

	rdb := getTestRedisClient(t)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()

	streamName := "dh:test:sec:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "test-sec")
	_ = q.Init(ctx)

	registry := marketplace.NewRegistry()
	registry.RegisterForHosts(fakemarket.NewMockAdapter(), "mock.dealhunter.vn")

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
	authSvc := newTestAuthService(t, authRepo, jwtMgr)

	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(authSvc, jwtMgr)
	// Phone verification codes go to a test double; the verifier itself (Redis, limits) is the real one
	zaloSender := fakezalo.NewMockZaloClient()
	handler.SetPhoneVerifier(notification.NewPhoneVerifier(rdb, zaloSender, "otp-template"))

	matchingRepo := matching.NewPostgresMatchingRepository(dbPool)
	searcher := &fakemarket.Searcher{} // no live marketplace traffic from tests
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
	_, loginDataPtr, _ := googleLogin(t, server.URL, userAEmail, "")
	loginData := *loginDataPtr

	userAToken := loginData.AccessToken
	userAID := loginData.User.ID

	// User B is an anonymous guest with a server-issued guest session
	userBBearer, userBSess, _ := startGuest(t, server.URL)
	userBID := userBSess.User.ID

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
	reqTrackB.Header.Set("Authorization", userBBearer)
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
		reqListB.Header.Set("Authorization", userBBearer)
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
		reqDeactB.Header.Set("Authorization", userBBearer)
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
		reqLogsB.Header.Set("Authorization", userBBearer)
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
		reqPauseB.Header.Set("Authorization", userBBearer)
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
		reqResumeB.Header.Set("Authorization", userBBearer)
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
		reqGetTrackingB.Header.Set("Authorization", userBBearer)
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
		reqCmpB.Header.Set("Authorization", userBBearer)
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
		reqSuggB.Header.Set("Authorization", userBBearer)
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
		reqAutoB.Header.Set("Authorization", userBBearer)
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
		// User A is a registered member (auth_provider = "google").
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

	// countTrackings returns how many tracked products the bearer's account has.
	countTrackings := func(t *testing.T, bearer string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tracked-products", nil)
		req.Header.Set("Authorization", bearer)
		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			t.Fatalf("list trackings failed: %v", err)
		}
		defer resp.Body.Close()
		var out struct {
			Data []map[string]interface{} `json:"data"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return len(out.Data)
	}

	// -------------------------------------------------------------------------
	// 6. Vulnerability 6 Test: Migration Requires The Guest's Own Session (SEC-06)
	// -------------------------------------------------------------------------
	t.Run("Vulnerability6_UnauthenticatedMigrationBlocked", func(t *testing.T) {
		// The free-form migrate endpoint no longer exists
		migrateBody, _ := json.Marshal(map[string]interface{}{"guest_user_id": userBID})
		reqMigrate, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/migrate", bytes.NewBuffer(migrateBody))
		reqMigrate.Header.Set("Content-Type", "application/json")
		reqMigrate.Header.Set("Authorization", "Bearer "+userAToken)
		respMigrate, err := client.Do(reqMigrate)
		if err != nil {
			t.Fatalf("Migrate request error: %v", err)
		}
		respMigrate.Body.Close()
		if respMigrate.StatusCode == http.StatusOK {
			t.Fatal("SECURITY BREACH: /auth/migrate still accepts arbitrary guest IDs")
		}

		// Logging in while naming the victim guest through X-User-ID migrates nothing
		attackerEmail := fmt.Sprintf("attacker-%s@dealhunter.vn", uuid.New().String()[:8])
		loginReq, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/google",
			bytes.NewBufferString(fmt.Sprintf(`{"id_token":%q}`, "valid:"+attackerEmail)))
		loginReq.Header.Set("Content-Type", "application/json")
		loginReq.Header.Set("X-User-ID", userBID.String())
		loginResp, err := client.Do(loginReq)
		if err != nil || loginResp.StatusCode != http.StatusOK {
			t.Fatalf("Attacker login failed: %v", err)
		}
		var attacker auth.Session
		_ = json.NewDecoder(loginResp.Body).Decode(&attacker)
		loginResp.Body.Close()

		if attacker.Migration != nil {
			t.Fatalf("SECURITY BREACH: guest data migrated via forged X-User-ID: %+v", attacker.Migration)
		}
		if countTrackings(t, userBBearer) == 0 {
			t.Fatal("SECURITY BREACH: guest B lost its tracked products")
		}
	})

	// -------------------------------------------------------------------------
	// 7. Vulnerability 7 Test: Registered User Account Theft via Migration Blocked
	// -------------------------------------------------------------------------
	t.Run("Vulnerability7_RegisteredUserMigrationTheftBlocked", func(t *testing.T) {
		// User C logs in presenting User A's member token as if it were a guest token
		userCEmail := fmt.Sprintf("user-c-%s@dealhunter.vn", uuid.New().String()[:8])
		_, sessC, _ := googleLogin(t, server.URL, userCEmail, "Bearer "+userAToken)

		if sessC.Migration != nil {
			t.Fatalf("SECURITY BREACH: registered member data migrated to another account: %+v", sessC.Migration)
		}
		if countTrackings(t, "Bearer "+userAToken) == 0 {
			t.Fatalf("SECURITY BREACH: User A's tracked products were stolen or wiped!")
		}
	})

	// -------------------------------------------------------------------------
	// 8. Vulnerability 8 Test: Already Migrated Guest Replay Prevented
	// -------------------------------------------------------------------------
	t.Run("Vulnerability8_AlreadyMigratedGuestReplayPrevented", func(t *testing.T) {
		guestDBearer, _, guestDCookie := startGuest(t, server.URL)
		guestURL := fmt.Sprintf("https://mock.dealhunter.vn/item/camera-%s", uuid.New().String()[:8])
		trackPayload, _ := json.Marshal(map[string]string{"url": guestURL})

		reqTrackGuest, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackPayload))
		reqTrackGuest.Header.Set("Content-Type", "application/json")
		reqTrackGuest.Header.Set("Authorization", guestDBearer)
		respTrackGuest, err := client.Do(reqTrackGuest)
		if err != nil || respTrackGuest.StatusCode != http.StatusCreated {
			t.Fatalf("Guest track failed: %v", err)
		}
		respTrackGuest.Body.Close()

		// User A logs in from guest D's browser: guest D's data is migrated to A
		_, sessA, _ := googleLogin(t, server.URL, userAEmail, guestDBearer)
		if sessA.Migration == nil || sessA.Migration.MigratedProducts != 1 {
			t.Fatalf("Expected 1 migrated product, got %+v", sessA.Migration)
		}

		// Replaying guest D's (still unexpired) access token into another account migrates nothing
		replayEmail := fmt.Sprintf("replay-%s@dealhunter.vn", uuid.New().String()[:8])
		_, sessReplay, _ := googleLogin(t, server.URL, replayEmail, guestDBearer)
		if sessReplay.Migration != nil {
			t.Fatalf("Expected no migration on replay, got %+v", sessReplay.Migration)
		}

		// Guest D's refresh token was revoked by the migration
		if resp, _, _ := postSession(t, server.URL+"/api/v1/auth/refresh", nil, "", guestDCookie); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("Expected migrated guest refresh to be rejected, got %d", resp.StatusCode)
		}
	})

	// -------------------------------------------------------------------------
	// 9. Vulnerability 9 Test: Migration to Self Prevented
	// -------------------------------------------------------------------------
	t.Run("Vulnerability9_MigrationToSelfPrevented", func(t *testing.T) {
		_, sess, _ := googleLogin(t, server.URL, userAEmail, "Bearer "+userAToken)
		if sess.Migration != nil {
			t.Fatalf("Expected no self-migration, got %+v", sess.Migration)
		}
	})

	// -------------------------------------------------------------------------
	// 9b. No Demo / Mock Login Paths Exist (SEC-01, SEC-02)
	// -------------------------------------------------------------------------
	t.Run("Vulnerability9b_NoDemoOrMockLogin", func(t *testing.T) {
		demoResp, demoSess, _ := postSession(t, server.URL+"/api/v1/auth/demo-login",
			map[string]string{"email": userAEmail}, "", nil)
		if demoSess != nil || demoResp.StatusCode == http.StatusOK {
			t.Fatalf("SECURITY BREACH: demo-login endpoint still exists (status %d)", demoResp.StatusCode)
		}

		for _, token := range []string{"mock-google-" + userAEmail, "demo-" + userAEmail} {
			mockResp, mockSess, _ := postSession(t, server.URL+"/api/v1/auth/google",
				map[string]string{"id_token": token}, "", nil)
			if mockSess != nil || mockResp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("SECURITY BREACH: mock token %q accepted (status %d)", token, mockResp.StatusCode)
			}
		}
	})

	// -------------------------------------------------------------------------
	// 9c. Step 1 review follow-ups
	// -------------------------------------------------------------------------
	t.Run("Vulnerability9c_GuestCannotClaimPhone", func(t *testing.T) {
		guestBearer, _, _ := startGuest(t, server.URL)
		body, _ := json.Marshal(map[string]string{"phone": fmt.Sprintf("08%08d", time.Now().UnixNano()%100000000)})
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/users/me/zalo", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", guestBearer)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("SECURITY BREACH: guest connected a phone number (status %d)", resp.StatusCode)
		}
	})

	t.Run("Vulnerability9d_MigratedGuestTokenRejected", func(t *testing.T) {
		guestBearer, _, _ := startGuest(t, server.URL)
		googleLogin(t, server.URL, fmt.Sprintf("migrate-%s@dealhunter.vn", uuid.New().String()[:8]), guestBearer)

		// The guest's access token is still a valid JWT, but the guest no longer exists as such
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tracked-products", nil)
		req.Header.Set("Authorization", guestBearer)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 for migrated guest token, got %d", resp.StatusCode)
		}
	})

	t.Run("Vulnerability9e_LoginCSRFBlocked", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/guest", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "text/plain")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnsupportedMediaType || len(resp.Cookies()) != 0 {
			t.Fatalf("expected 415 without cookie for form-style auth POST, got %d", resp.StatusCode)
		}
	})

	t.Run("Vulnerability9g_GuestPhoneMovesOnMigration", func(t *testing.T) {
		guestBearer, guestSess, _ := startGuest(t, server.URL)
		phone := fmt.Sprintf("07%08d", time.Now().UnixNano()%100000000)
		// Legacy guest rows may still carry a phone from before guests were blocked from Zalo
		if _, err := dbPool.Exec(ctx, "UPDATE users SET phone = $2 WHERE id = $1", guestSess.User.ID, phone); err != nil {
			t.Fatal(err)
		}
		_, member, _ := googleLogin(t, server.URL, fmt.Sprintf("phone-%s@dealhunter.vn", uuid.New().String()[:8]), guestBearer)

		var memberPhone, guestPhone *string
		_ = dbPool.QueryRow(ctx, "SELECT phone FROM users WHERE id = $1", member.User.ID).Scan(&memberPhone)
		_ = dbPool.QueryRow(ctx, "SELECT phone FROM users WHERE id = $1", guestSess.User.ID).Scan(&guestPhone)
		if memberPhone == nil || *memberPhone != phone || guestPhone != nil {
			t.Fatalf("expected phone moved to member, got member=%v guest=%v", memberPhone, guestPhone)
		}
	})

	t.Run("Vulnerability9f_NoDemoAccountsRemain", func(t *testing.T) {
		var demo int
		if err := dbPool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE auth_provider = 'demo'").Scan(&demo); err != nil {
			t.Fatal(err)
		}
		if demo != 0 {
			t.Fatalf("expected no demo accounts, found %d", demo)
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

		// 4. A phone is only linked with the code sent to it; its verified owner takes it over
		post := func(path, bearer string, body map[string]string) *http.Response {
			raw, _ := json.Marshal(body)
			req, _ := http.NewRequest(http.MethodPost, server.URL+path, bytes.NewBuffer(raw))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", bearer)
			resp, err := client.Do(req)
			if err != nil {
				t.Fatalf("%s: %v", path, err)
			}
			resp.Body.Close()
			return resp
		}
		lastCode := func() string {
			return zaloSender.SentMessages[len(zaloSender.SentMessages)-1].Params["otp"]
		}
		uniquePhone := fmt.Sprintf("091%07d", time.Now().UnixNano()%10000000)
		bearerA := "Bearer " + userAToken

		// Without a code (or with a wrong one) nothing is linked
		if resp := post("/api/v1/users/me/zalo", bearerA, map[string]string{"phone": uniquePhone, "code": "000000"}); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 linking with a code that was never sent, got %d", resp.StatusCode)
		}
		if resp := post("/api/v1/users/me/zalo/otp", bearerA, map[string]string{"phone": uniquePhone}); resp.StatusCode != http.StatusAccepted {
			t.Fatalf("expected 202 requesting a code, got %d", resp.StatusCode)
		}
		codeA := lastCode()
		if got := zaloSender.SentMessages[len(zaloSender.SentMessages)-1].Recipient; got != "84"+uniquePhone[1:] {
			t.Fatalf("code sent to %q, expected the normalized number", got)
		}
		// Resending right away is refused
		if resp := post("/api/v1/users/me/zalo/otp", bearerA, map[string]string{"phone": uniquePhone}); resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
			t.Fatalf("expected 429 with Retry-After for an immediate resend, got %d", resp.StatusCode)
		}
		if resp := post("/api/v1/users/me/zalo", bearerA, map[string]string{"phone": uniquePhone, "code": codeA}); resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 with the code sent to the phone, got %d", resp.StatusCode)
		}
		// A code works once
		if resp := post("/api/v1/users/me/zalo", bearerA, map[string]string{"phone": uniquePhone, "code": codeA}); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 reusing a code, got %d", resp.StatusCode)
		}

		// Another member cannot take the number with a guessed code, and gets no hint it is linked
		otherMemberBearer, _, _ := googleLogin(t, server.URL, fmt.Sprintf("member-x-%s@dealhunter.vn", uuid.New().String()[:8]), "")
		if resp := post("/api/v1/users/me/zalo/otp", otherMemberBearer, map[string]string{"phone": uniquePhone}); resp.StatusCode != http.StatusAccepted {
			t.Fatalf("expected 202 (no 409 revealing the number is linked), got %d", resp.StatusCode)
		}
		realCode := lastCode()
		for i := 0; i < 5; i++ {
			guess := fmt.Sprintf("%06d", i)
			if guess == realCode {
				continue
			}
			post("/api/v1/users/me/zalo", otherMemberBearer, map[string]string{"phone": uniquePhone, "code": guess})
		}
		if resp := post("/api/v1/users/me/zalo", otherMemberBearer, map[string]string{"phone": uniquePhone, "code": realCode}); resp.StatusCode == http.StatusOK {
			t.Fatal("the code must be discarded after 5 wrong guesses")
		}
		var ownerPhone *string
		if err := dbPool.QueryRow(ctx, `SELECT phone FROM users WHERE id = $1`, userAID).Scan(&ownerPhone); err != nil || ownerPhone == nil || *ownerPhone != "84"+uniquePhone[1:] {
			t.Fatalf("member A must keep the number after failed takeover attempts, got %v (%v)", ownerPhone, err)
		}
	})
}
