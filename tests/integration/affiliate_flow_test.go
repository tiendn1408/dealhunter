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
	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/comparison"
	router "github.com/tiendang/deal-hunter/internal/http"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/mock"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/notification/zalo"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func TestAffiliateLinkEngineFlow(t *testing.T) {
	ctx := context.Background()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable"
	}

	dbPool, err := database.NewPostgresPool(ctx, dbURL)
	if err != nil {
		t.Skipf("PostgreSQL not reachable: %v", err)
	}
	defer dbPool.Close()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not reachable: %v", err)
	}
	defer rdb.Close()

	streamName := "dh:test:aff:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "test-aff")
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
	compCache := comparison.NewRedisCache(rdb)
	compSvc := comparison.NewComparisonService(comparisonRepo, compCache)
	jwtMgr := auth.NewJWTManager("test-affiliate-secret-key-32b!", 1*time.Hour)
	authSvc := auth.NewAuthService(authRepo, jwtMgr, "")

	// Configure Affiliate Transformer
	affCfg := affiliate.Config{
		Enabled:             true,
		ShopeeID:            "dealhunter-shopee-vn",
		ShopeeTemplate:      "https://s.shopee.vn/universal-link?url={URL}&sub_id={SUB_ID}&aff_id={AFFILIATE_ID}",
		LazadaID:            "dealhunter-lazada-vn",
		LazadaTemplate:      "https://s.lazada.vn/s.test?url={URL}&aff_sub={SUB_ID}",
		TikTokID:            "dealhunter-tiktok-vn",
		TikTokTemplate:      "https://vt.tiktok.com/aff?url={URL}&sub_id={SUB_ID}",
		AccessTradeTemplate: "https://go.isclix.com/deep_link?url={URL}&utm_content={SUB_ID}",
	}
	affTr := affiliate.NewTransformer(affCfg)

	compSvc.SetAffiliateTransformer(affTr)
	notifRepo.SetAffiliateTransformer(affTr)

	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(authSvc, jwtMgr)
	handler.SetAffiliateTransformer(affTr)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	server := httptest.NewServer(r)
	defer server.Close()

	client := server.Client()

	// 1. Create a user session
	userID := uuid.New()
	loginBody, _ := json.Marshal(map[string]string{
		"email": fmt.Sprintf("affiliate-%s@dealhunter.vn", userID.String()[:8]),
		"name":  "Affiliate Tester",
	})
	loginResp, err := client.Post(server.URL+"/api/v1/auth/demo-login", "application/json", bytes.NewBuffer(loginBody))
	if err != nil || loginResp.StatusCode != http.StatusOK {
		t.Fatalf("Login failed: %v", err)
	}
	var loginData auth.LoginResponse
	_ = json.NewDecoder(loginResp.Body).Decode(&loginData)
	loginResp.Body.Close()
	userToken := loginData.Token
	authUserID := loginData.User.ID

	// 2. Track a Shopee product
	mockShopeeURL := fmt.Sprintf("https://mock.dealhunter.vn/item/shopee-mouse-%s", uuid.New().String()[:8])
	trackPayload, _ := json.Marshal(map[string]string{"url": mockShopeeURL})
	reqTrack, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/tracked-products", bytes.NewBuffer(trackPayload))
	reqTrack.Header.Set("Content-Type", "application/json")
	reqTrack.Header.Set("Authorization", "Bearer "+userToken)
	respTrack, err := client.Do(reqTrack)
	if err != nil || respTrack.StatusCode != http.StatusCreated {
		t.Fatalf("Track product failed: %v, status: %d", err, respTrack.StatusCode)
	}
	var trackData struct {
		ID              uuid.UUID `json:"id"`
		ProductSourceID uuid.UUID `json:"product_source_id"`
	}
	_ = json.NewDecoder(respTrack.Body).Decode(&trackData)
	respTrack.Body.Close()

	trackingID := trackData.ID
	sourceID := trackData.ProductSourceID

	// 3. Verify ListTrackings returns AffiliateURL
	reqList, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/tracked-products", nil)
	reqList.Header.Set("Authorization", "Bearer "+userToken)
	respList, err := client.Do(reqList)
	if err != nil || respList.StatusCode != http.StatusOK {
		t.Fatalf("List trackings failed: %v", err)
	}
	var listData struct {
		Data []struct {
			ID           uuid.UUID `json:"ID"`
			CanonicalURL string    `json:"CanonicalURL"`
			AffiliateURL string    `json:"AffiliateURL"`
		} `json:"data"`
	}
	_ = json.NewDecoder(respList.Body).Decode(&listData)
	respList.Body.Close()

	if len(listData.Data) == 0 {
		t.Fatalf("Expected tracked products, got 0")
	}

	foundAffURL := ""
	for _, item := range listData.Data {
		if item.ID == trackingID {
			foundAffURL = item.AffiliateURL
			break
		}
	}
	if foundAffURL == "" {
		t.Fatalf("Expected AffiliateURL on tracked product, got empty string")
	}
	if !strings.Contains(foundAffURL, "https://go.isclix.com/deep_link") && !strings.Contains(foundAffURL, "s.shopee.vn") {
		t.Fatalf("Unexpected affiliate URL format: %s", foundAffURL)
	}

	// 4. Verify GetTracking returns AffiliateURL
	reqGet, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s", server.URL, trackingID), nil)
	reqGet.Header.Set("Authorization", "Bearer "+userToken)
	respGet, err := client.Do(reqGet)
	if err != nil || respGet.StatusCode != http.StatusOK {
		t.Fatalf("Get tracking failed: %v", err)
	}
	var singleData struct {
		ID           uuid.UUID `json:"ID"`
		CanonicalURL string    `json:"CanonicalURL"`
		AffiliateURL string    `json:"AffiliateURL"`
	}
	_ = json.NewDecoder(respGet.Body).Decode(&singleData)
	respGet.Body.Close()

	if singleData.AffiliateURL == "" {
		t.Fatalf("Expected AffiliateURL on single tracking, got empty string")
	}

	// 5. Verify Comparison table returns affiliate_url for all sources
	reqCmp, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/comparison", server.URL, trackingID), nil)
	reqCmp.Header.Set("Authorization", "Bearer "+userToken)
	respCmp, err := client.Do(reqCmp)
	if err != nil || respCmp.StatusCode != http.StatusOK {
		t.Fatalf("Get comparison failed: %v", err)
	}
	var cmpData comparison.ComparisonResult
	_ = json.NewDecoder(respCmp.Body).Decode(&cmpData)
	respCmp.Body.Close()

	if len(cmpData.Sources) == 0 {
		t.Fatalf("Expected comparison sources, got 0")
	}
	if cmpData.Sources[0].AffiliateURL == "" {
		t.Fatalf("Expected AffiliateURL on comparison source, got empty")
	}

	// 6. Verify Notifier Service injects deal_url and affiliate_url into Zalo params
	mockZalo := zalo.NewMockZaloClient()
	notifierSvc := notification.NewNotifierService(notifRepo, q, mockZalo, "template-deal-test", logger)
	notifierSvc.SetAffiliateTransformer(affTr)

	ruleID := uuid.New()
	rule := &alert.AlertRule{
		ID:              ruleID,
		UserID:          authUserID,
		ProductSourceID: sourceID,
		RuleType:        alert.RuleTypeTargetPrice,
		ThresholdValue:  1000000,
		Active:          true,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	_ = alertRepo.CreateRule(ctx, rule)

	logEntry := &notification.NotificationLog{
		ID:          uuid.New(),
		UserID:      authUserID,
		AlertRuleID: ruleID,
		Channel:     "zalo",
		Recipient:   "0988001122",
		Status:      notification.StatusQueued,
		PriceBefore: 1200000,
		PriceAfter:  950000,
		CreatedAt:   time.Now(),
	}
	_ = notifRepo.InsertLog(ctx, logEntry)

	payloadBytes, _ := json.Marshal(notification.QueuePayload{
		NotificationLogID: logEntry.ID,
		UserID:            authUserID,
		AlertRuleID:       ruleID,
		Recipient:         "0988001122",
		Channel:           "zalo",
		ProductSourceID:   sourceID,
		PriceBefore:       1200000,
		PriceAfter:        950000,
		ProductURL:        mockShopeeURL,
		Platform:          "shopee",
	})

	testMsg := queue.Message{
		MsgID: "msg-test-aff-1",
		JobID: string(payloadBytes),
	}
	if err := notifierSvc.ProcessMessage(ctx, testMsg); err != nil {
		t.Fatalf("ProcessMessage failed: %v", err)
	}

	// 7. Verify ListUserNotifications returns affiliate_url in feed
	reqFeed, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/notifications", nil)
	reqFeed.Header.Set("Authorization", "Bearer "+userToken)
	respFeed, err := client.Do(reqFeed)
	if err != nil || respFeed.StatusCode != http.StatusOK {
		t.Fatalf("Get notifications feed failed: %v", err)
	}
	var feedData struct {
		Data []struct {
			ID           uuid.UUID `json:"id"`
			ProductURL   string    `json:"product_url"`
			AffiliateURL string    `json:"affiliate_url"`
		} `json:"data"`
	}
	_ = json.NewDecoder(respFeed.Body).Decode(&feedData)
	respFeed.Body.Close()

	if len(feedData.Data) == 0 {
		t.Fatalf("Expected notifications in feed, got 0")
	}
	if feedData.Data[0].AffiliateURL == "" {
		t.Fatalf("Expected affiliate_url in notification feed item, got empty string")
	}
	if !strings.Contains(feedData.Data[0].AffiliateURL, "sub_id=") && !strings.Contains(feedData.Data[0].AffiliateURL, "utm_content=") {
		t.Fatalf("Expected sub_id tracking in feed affiliate_url, got: %s", feedData.Data[0].AffiliateURL)
	}
}
