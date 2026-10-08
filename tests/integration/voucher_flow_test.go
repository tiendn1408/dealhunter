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
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/internal/voucher"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
	"github.com/tiendang/deal-hunter/pkg/database"
	"github.com/tiendang/deal-hunter/tests/fakemarket"
	"github.com/tiendang/deal-hunter/tests/fakezalo"
)

func TestVoucherIntelligenceAndComboFlow(t *testing.T) {
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

	streamName := "dh:test:vouch:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "test-vouch")
	_ = q.Init(ctx)

	registry := marketplace.NewRegistry()
	registry.RegisterForHosts(fakemarket.NewMockAdapter(), "mock.dealhunter.vn")
	registry.RegisterForHosts(fakemarket.NewNamedAdapter("shopee"), "shopee.vn")

	productRepo := product.NewPostgresRepository(dbPool)
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)
	alertRepo := alert.NewPostgresRepository(dbPool)
	notifRepo := notification.NewPostgresRepository(dbPool)
	comparisonRepo := comparison.NewPostgresRepository(dbPool)
	authRepo := auth.NewPostgresUserRepository(dbPool)
	voucherRepo := voucher.NewPostgresRepository(dbPool)

	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)
	pricingSvc := pricing.NewPricingService(pricingRepo)
	compCache := comparison.NewRedisCache(rdb)
	compSvc := comparison.NewComparisonService(comparisonRepo, compCache)
	jwtMgr := auth.NewJWTManager("test-voucher-secret-key-32b-ok!", 1*time.Hour)
	authSvc := newTestAuthService(t, authRepo, jwtMgr)

	// Affiliate Transformer
	affCfg := affiliate.Config{
		Enabled:        true,
		ShopeeID:       "dh-aff-shopee",
		ShopeeTemplate: "https://s.shopee.vn/universal-link?url={URL}&sub_id={SUB_ID}&aff_id={AFFILIATE_ID}",
	}
	affTr := affiliate.NewTransformer(affCfg)

	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(compSvc)
	handler.SetAuthService(authSvc, jwtMgr)
	handler.SetAffiliateTransformer(affTr)
	handler.SetVoucherRepository(voucherRepo)
	adminEmail := fmt.Sprintf("voucher-admin-%s@dealhunter.vn", uuid.New().String()[:8])
	handler.SetAdminEmails([]string{strings.ToUpper(adminEmail)})

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := router.NewRouter(logger, handler)
	server := httptest.NewServer(r)
	defer server.Close()

	client := server.Client()

	// 1. Authenticate user
	_, loginDataPtr, _ := googleLogin(t, server.URL, fmt.Sprintf("voucher-user-%s@dealhunter.vn", uuid.New().String()[:8]), "")
	loginData := *loginDataPtr
	userToken := loginData.AccessToken
	userID := loginData.User.ID
	_, adminDataPtr, _ := googleLogin(t, server.URL, adminEmail, "")
	adminToken := adminDataPtr.AccessToken

	// 2. Track a Shopee product
	mockShopeeURL := fmt.Sprintf("https://mock.dealhunter.vn/item/shopee-keyboard-%s", uuid.New().String()[:8])
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

	listedPrice := int64(200000)
	shippingFee := int64(15000)
	_, err = dbPool.Exec(ctx, "UPDATE product_sources SET platform = 'shopee', last_price = $1, last_shipping_fee = $2, last_effective_price = $1::bigint + $2::bigint WHERE id = $3", listedPrice, shippingFee, trackData.ProductSourceID)
	if err != nil {
		t.Fatalf("Failed to update product source prices: %v", err)
	}

	// 3. Query initial vouchers before adding any
	reqGetInitial, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/vouchers", server.URL, trackData.ID), nil)
	reqGetInitial.Header.Set("Authorization", "Bearer "+userToken)
	respGetInitial, err := client.Do(reqGetInitial)
	if err != nil || respGetInitial.StatusCode != http.StatusOK {
		t.Fatalf("Get initial vouchers failed: %v, status: %d", err, respGetInitial.StatusCode)
	}
	var initialResp struct {
		ProductSourceID uuid.UUID `json:"product_source_id"`
		Platform        string    `json:"platform"`
		Calculation     struct {
			ListedPrice    int64 `json:"listed_price"`
			ShopDiscount   int64 `json:"shop_discount"`
			PlatformCoupon int64 `json:"platform_coupon"`
			EffectivePrice int64 `json:"effective_price"`
			TotalSavings   int64 `json:"total_savings"`
		} `json:"calculation"`
		Vouchers []interface{} `json:"vouchers"`
	}
	_ = json.NewDecoder(respGetInitial.Body).Decode(&initialResp)
	respGetInitial.Body.Close()

	if len(initialResp.Vouchers) != 0 {
		t.Errorf("Expected 0 initial vouchers, got %d", len(initialResp.Vouchers))
	}
	if initialResp.Calculation.ShopDiscount != 0 || initialResp.Calculation.PlatformCoupon != 0 {
		t.Errorf("Expected 0 discounts initially, got shop: %d, coupon: %d",
			initialResp.Calculation.ShopDiscount, initialResp.Calculation.PlatformCoupon)
	}

	// SEC-09: only admins create vouchers, and every field is validated
	postVoucher := func(bearer string, body map[string]interface{}) int {
		t.Helper()
		payload, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/vouchers", server.URL, trackData.ID), bytes.NewBuffer(payload))
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("post voucher: %v", err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	validVoucher := func() map[string]interface{} {
		return map[string]interface{}{
			"voucher_type":    "shop_voucher",
			"title":           "Giam 10.000d",
			"discount_amount": 10000,
			"expires_at":      time.Now().Add(24 * time.Hour),
		}
	}
	guestBearer, _, _ := startGuest(t, server.URL)
	if code := postVoucher("", validVoucher()); code != http.StatusUnauthorized {
		t.Errorf("anonymous voucher create: expected 401, got %d", code)
	}
	if code := postVoucher(strings.TrimPrefix(guestBearer, "Bearer "), validVoucher()); code != http.StatusForbidden {
		t.Errorf("guest voucher create: expected 403, got %d", code)
	}
	if code := postVoucher(userToken, validVoucher()); code != http.StatusForbidden {
		t.Errorf("non-admin member voucher create: expected 403, got %d", code)
	}
	for name, mutate := range map[string]func(map[string]interface{}){
		"percent over 100":   func(b map[string]interface{}) { b["discount_percent"] = 101 },
		"negative amount":    func(b map[string]interface{}) { b["discount_amount"] = -1 },
		"no discount":        func(b map[string]interface{}) { b["discount_amount"] = 0 },
		"unknown type":       func(b map[string]interface{}) { b["voucher_type"] = "cashback" },
		"empty title":        func(b map[string]interface{}) { b["title"] = "  " },
		"missing expiry":     func(b map[string]interface{}) { delete(b, "expires_at") },
		"expired":            func(b map[string]interface{}) { b["expires_at"] = time.Now().Add(-time.Hour) },
		"expiry over a year": func(b map[string]interface{}) { b["expires_at"] = time.Now().AddDate(2, 0, 0) },
		"phishing host":      func(b map[string]interface{}) { b["collect_url"] = "https://shopee.vn.evil.com/claim" },
		"http collect_url":   func(b map[string]interface{}) { b["collect_url"] = "http://shopee.vn/claim" },
		"other marketplace":  func(b map[string]interface{}) { b["collect_url"] = "https://mock.dealhunter.vn/claim" },
		"javascript url":     func(b map[string]interface{}) { b["collect_url"] = "javascript:alert(1)" },
		"unknown field":      func(b map[string]interface{}) { b["expires_in_days"] = 3 },
	} {
		body := validVoucher()
		mutate(body)
		if code := postVoucher(adminToken, body); code != http.StatusBadRequest {
			t.Errorf("invalid voucher (%s): expected 400, got %d", name, code)
		}
	}

	// 4. Add Shop Voucher via POST /api/v1/tracked-products/{id}/vouchers
	shopVoucherPayload, _ := json.Marshal(map[string]interface{}{
		"voucher_type":    "shop_voucher",
		"voucher_code":    "SHOP20K",
		"title":           "Giam 20.000d tu shop",
		"discount_amount": 20000,
		"min_order_value": 50000,
		"collect_url":     "https://shopee.vn/m/voucher-shop-claim",
		"expires_at":      time.Now().Add(72 * time.Hour),
	})
	reqAddShopVoucher, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/vouchers", server.URL, trackData.ID), bytes.NewBuffer(shopVoucherPayload))
	reqAddShopVoucher.Header.Set("Content-Type", "application/json")
	reqAddShopVoucher.Header.Set("Authorization", "Bearer "+adminToken)
	respAddShopVoucher, err := client.Do(reqAddShopVoucher)
	if err != nil || respAddShopVoucher.StatusCode != http.StatusCreated {
		t.Fatalf("Add shop voucher failed: %v, status: %d", err, respAddShopVoucher.StatusCode)
	}
	respAddShopVoucher.Body.Close()

	// 5. Add Platform Coupon via POST /api/v1/tracked-products/{id}/vouchers
	platformCouponPayload, _ := json.Marshal(map[string]interface{}{
		"voucher_type":    "platform_voucher",
		"voucher_code":    "SHOPEE30K",
		"title":           "Ma giam gia Shopee 30.000d",
		"discount_amount": 30000,
		"min_order_value": 80000,
		"collect_url":     "https://shopee.vn/m/voucher-san-claim",
		"expires_at":      time.Now().Add(72 * time.Hour),
	})
	reqAddPlatform, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/tracked-products/%s/vouchers", server.URL, trackData.ID), bytes.NewBuffer(platformCouponPayload))
	reqAddPlatform.Header.Set("Content-Type", "application/json")
	reqAddPlatform.Header.Set("Authorization", "Bearer "+adminToken)
	respAddPlatform, err := client.Do(reqAddPlatform)
	if err != nil || respAddPlatform.StatusCode != http.StatusCreated {
		t.Fatalf("Add platform coupon failed: %v, status: %d", err, respAddPlatform.StatusCode)
	}
	respAddPlatform.Body.Close()

	// 6. Query vouchers again and verify 2-step calculation & Early Cookie Drop
	reqGetUpdated, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/tracked-products/%s/vouchers", server.URL, trackData.ID), nil)
	reqGetUpdated.Header.Set("Authorization", "Bearer "+userToken)
	respGetUpdated, err := client.Do(reqGetUpdated)
	if err != nil || respGetUpdated.StatusCode != http.StatusOK {
		t.Fatalf("Get updated vouchers failed: %v, status: %d", err, respGetUpdated.StatusCode)
	}

	var updatedResp struct {
		ProductSourceID uuid.UUID `json:"product_source_id"`
		ProductID       uuid.UUID `json:"product_id"`
		Platform        string    `json:"platform"`
		Calculation     struct {
			ListedPrice    int64 `json:"listed_price"`
			ShopDiscount   int64 `json:"shop_discount"`
			PlatformCoupon int64 `json:"platform_coupon"`
			ShippingFee    int64 `json:"shipping_fee"`
			EffectivePrice int64 `json:"effective_price"`
			TotalSavings   int64 `json:"total_savings"`
		} `json:"calculation"`
		Vouchers []voucher.ProductVoucher `json:"vouchers"`
	}
	_ = json.NewDecoder(respGetUpdated.Body).Decode(&updatedResp)
	respGetUpdated.Body.Close()

	if len(updatedResp.Vouchers) != 2 {
		t.Fatalf("Expected 2 vouchers, got %d", len(updatedResp.Vouchers))
	}
	if updatedResp.Calculation.ShopDiscount != 20000 {
		t.Errorf("Expected shop discount 20000, got %d", updatedResp.Calculation.ShopDiscount)
	}
	if updatedResp.Calculation.PlatformCoupon != 30000 {
		t.Errorf("Expected platform coupon 30000, got %d", updatedResp.Calculation.PlatformCoupon)
	}
	if updatedResp.Calculation.TotalSavings != 50000 {
		t.Errorf("Expected total savings 50000, got %d", updatedResp.Calculation.TotalSavings)
	}

	expectedEffective := updatedResp.Calculation.ListedPrice - 20000 - 30000 + updatedResp.Calculation.ShippingFee
	if updatedResp.Calculation.EffectivePrice != expectedEffective {
		t.Errorf("Expected effective price %d, got %d", expectedEffective, updatedResp.Calculation.EffectivePrice)
	}

	// 7. Check Early Cookie Drop affiliate_collect_url
	expectedSubID := affiliate.FormatSubID(userID, updatedResp.ProductID)
	for _, v := range updatedResp.Vouchers {
		if v.AffiliateCollectURL == "" {
			t.Errorf("Voucher %s missing AffiliateCollectURL", v.ID)
		}
		if !strings.Contains(v.AffiliateCollectURL, "s.shopee.vn") {
			t.Errorf("Voucher %s AffiliateCollectURL does not use Shopee affiliate domain: %s", v.ID, v.AffiliateCollectURL)
		}
		if !strings.Contains(v.AffiliateCollectURL, expectedSubID) {
			t.Errorf("Voucher %s AffiliateCollectURL missing sub_id %s: %s", v.ID, expectedSubID, v.AffiliateCollectURL)
		}
		if !strings.Contains(v.AffiliateCollectURL, "dh-aff-shopee") {
			t.Errorf("Voucher %s AffiliateCollectURL missing affiliate ID: %s", v.ID, v.AffiliateCollectURL)
		}
	}

	// 8. Verify Zalo Notifier 2-Step Combo Injection (Section 4.4)
	mockZalo := fakezalo.NewMockZaloClient()
	notifierSvc := notification.NewNotifierService(notifRepo, q, mockZalo, "template-voucher-test", logger)
	notifierSvc.SetAffiliateTransformer(affTr)
	notifierSvc.SetVoucherRepository(voucherRepo)

	notifLog := &notification.NotificationLog{
		ID:          uuid.New(),
		UserID:      userID,
		AlertRuleID: uuid.New(),
		Channel:     "zalo",
		Recipient:   "0987654321",
		Status:      notification.StatusQueued,
		PriceBefore: 220000,
		PriceAfter:  200000,
	}
	_ = notifRepo.InsertLog(ctx, notifLog)

	payloadBytes, _ := json.Marshal(notification.QueuePayload{
		NotificationLogID: notifLog.ID,
		UserID:            userID,
		AlertRuleID:       notifLog.AlertRuleID,
		Recipient:         notifLog.Recipient,
		Channel:           notifLog.Channel,
		ProductSourceID:   trackData.ProductSourceID,
		PriceBefore:       notifLog.PriceBefore,
		PriceAfter:        notifLog.PriceAfter,
		ProductURL:        mockShopeeURL,
		Platform:          "shopee",
	})

	err = notifierSvc.ProcessMessage(ctx, queue.Message{
		MsgID: "test-vouch-msg-1",
		JobID: string(payloadBytes),
	})
	if err != nil {
		t.Fatalf("Notifier ProcessMessage failed: %v", err)
	}

	if len(mockZalo.SentMessages) == 0 {
		t.Fatalf("Expected mock Zalo message sent, got 0")
	}
	lastZalo := mockZalo.SentMessages[len(mockZalo.SentMessages)-1]
	if lastZalo.Params["effective_price"] != "150000" {
		t.Errorf("Expected effective_price 150000 in Zalo params, got %s", lastZalo.Params["effective_price"])
	}
	if lastZalo.Params["total_savings"] != "50000" {
		t.Errorf("Expected total_savings 50000 in Zalo params, got %s", lastZalo.Params["total_savings"])
	}
	if !strings.Contains(lastZalo.Params["voucher_collect_url"], "s.shopee.vn") {
		t.Errorf("Expected voucher_collect_url to contain s.shopee.vn, got %s", lastZalo.Params["voucher_collect_url"])
	}
	if !strings.Contains(lastZalo.Params["deal_url"], "s.shopee.vn") {
		t.Errorf("Expected deal_url to contain s.shopee.vn, got %s", lastZalo.Params["deal_url"])
	}

	t.Logf("Zalo Notifier 2-step combo verified: Effective=%s, Savings=%s, CollectURL=%s, DealURL=%s",
		lastZalo.Params["effective_price"],
		lastZalo.Params["total_savings"],
		lastZalo.Params["voucher_collect_url"],
		lastZalo.Params["deal_url"],
	)

	t.Logf("Voucher flow passed: Listed=%d, ShopDisc=%d, PlatCpn=%d, EffPrice=%d, Savings=%d, Vouchers=%d",
		updatedResp.Calculation.ListedPrice,
		updatedResp.Calculation.ShopDiscount,
		updatedResp.Calculation.PlatformCoupon,
		updatedResp.Calculation.EffectivePrice,
		updatedResp.Calculation.TotalSavings,
		len(updatedResp.Vouchers),
	)
}
