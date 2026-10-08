//go:build integration
// +build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	router "github.com/tiendang/deal-hunter/internal/http"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/notification/zalo"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/tests/fakezalo"
)

func TestZaloDeliveryLifecycleFlow(t *testing.T) {
	ctx := context.Background()

	// 1. Database & Redis connections
	dbPool, err := pgxpool.New(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer dbPool.Close()

	rdb := getTestRedisClient(t)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()

	// 2. Setup repos & services
	notifRepo := notification.NewPostgresRepository(dbPool)
	productRepo := product.NewPostgresRepository(dbPool)
	alertRepo := alert.NewPostgresRepository(dbPool)

	streamName := "dh:test:notif:" + uuid.New().String()
	q := queue.NewRedisStreamQueue(rdb, streamName, "zalo-group")
	_ = q.Init(ctx)

	mockZalo := fakezalo.NewMockZaloClient()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	notifier := notification.NewNotifierService(notifRepo, q, mockZalo, "test_template_001", logger)

	handler := router.NewHandler(nil, nil)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetZaloWebhookCredentials(testZaloAppID, testWebhookSecret)
	jwtMgr := auth.NewJWTManager("test-zalo-delivery-secret-32-bytes-long!", time.Hour)
	handler.SetAuthService(nil, jwtMgr)
	r := router.NewRouter(logger, handler)
	ts := httptest.NewServer(r)
	defer ts.Close()

	client := ts.Client()
	userID := uuid.New()
	_, _ = dbPool.Exec(ctx, "INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", userID)

	// 3. Seed test Product, Source & Alert Rule
	t.Log("Step 1: Creating seed product, source, and alert rule...")
	prod := &product.Product{
		ID:        uuid.New(),
		Title:     "Tai nghe Sony WH-1000XM5 Chính Hãng",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := productRepo.UpsertProduct(ctx, prod); err != nil {
		t.Fatalf("upsert product failed: %v", err)
	}

	canURL := fmt.Sprintf("https://shopee.vn/product-sony-%d", time.Now().UnixNano())
	extID := fmt.Sprintf("ext-%d", time.Now().UnixNano())
	source := &product.ProductSource{
		ID:                uuid.New(),
		ProductID:         prod.ID,
		Platform:          "shopee",
		ExternalProductID: &extID,
		CanonicalURL:      canURL,
		Currency:          "VND",
		Active:            true,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}
	if err := productRepo.UpsertProductSource(ctx, source); err != nil {
		t.Fatalf("upsert source failed: %v", err)
	}

	rule := &alert.AlertRule{
		ID:              uuid.New(),
		UserID:          userID,
		ProductSourceID: source.ID,
		RuleType:        alert.RuleTypeTargetPrice,
		ThresholdValue:  5500000,
		Active:          true,
	}
	if err := alertRepo.CreateRule(ctx, rule); err != nil {
		t.Fatalf("create rule failed: %v", err)
	}

	// 4. Create NotificationLog in 'queued' status
	t.Log("Step 2: Creating queued notification log...")
	logEntry := &notification.NotificationLog{
		UserID:      userID,
		AlertRuleID: rule.ID,
		Channel:     "zalo",
		Recipient:   "0988123456",
		Status:      notification.StatusQueued,
		PriceBefore: 6290000,
		PriceAfter:  5450000,
	}
	if err := notifRepo.InsertLog(ctx, logEntry); err != nil {
		t.Fatalf("insert notification log failed: %v", err)
	}

	// 5. Enqueue and process notification
	t.Log("Step 3: Processing notification via NotifierService...")
	payloadBytes, _ := json.Marshal(notification.QueuePayload{
		NotificationLogID: logEntry.ID,
		UserID:            userID,
		AlertRuleID:       rule.ID,
		Recipient:         "0988123456",
		Channel:           "zalo",
		ProductSourceID:   source.ID,
		PriceBefore:       6290000,
		PriceAfter:        5450000,
	})

	_ = notifier.ProcessMessage(ctx, queue.Message{
		MsgID: "test-msg-1",
		JobID: string(payloadBytes),
	})

	// Verify status updated to 'sent' and msg_id is recorded
	updatedLog, err := notifRepo.GetLog(ctx, logEntry.ID)
	if err != nil || updatedLog == nil {
		t.Fatalf("get log failed: %v", err)
	}

	if updatedLog.Status != notification.StatusSent {
		t.Fatalf("expected status 'sent', got '%s'", updatedLog.Status)
	}
	if updatedLog.MsgID == nil || *updatedLog.MsgID == "" {
		t.Fatalf("expected recorded msg_id, got nil or empty")
	}
	capturedMsgID := *updatedLog.MsgID
	t.Logf("Notification sent successfully! Captured Zalo MsgID=%s", capturedMsgID)

	// 5b. Without Zalo OA configured, nothing is sent and the log says so (never a fake "sent")
	t.Log("Step 3b: Processing a notification with Zalo OA not configured...")
	disabledNotifier := notification.NewNotifierService(notifRepo, q, zalo.NewDisabledClient(), "test_template_001", logger)
	unsentLog := &notification.NotificationLog{
		UserID: userID, AlertRuleID: rule.ID, Channel: "zalo", Recipient: "0988123456",
		Status: notification.StatusQueued, PriceBefore: 6290000, PriceAfter: 5450000,
	}
	if err := notifRepo.InsertLog(ctx, unsentLog); err != nil {
		t.Fatalf("insert notification log failed: %v", err)
	}
	unsentPayload, _ := json.Marshal(notification.QueuePayload{
		NotificationLogID: unsentLog.ID, UserID: userID, AlertRuleID: rule.ID, Recipient: "0988123456",
		Channel: "zalo", ProductSourceID: source.ID, PriceBefore: 6290000, PriceAfter: 5450000,
	})
	_ = disabledNotifier.ProcessMessage(ctx, queue.Message{MsgID: "test-msg-unconfigured", JobID: string(unsentPayload)})
	unsent, err := notifRepo.GetLog(ctx, unsentLog.ID)
	if err != nil || unsent == nil {
		t.Fatalf("get log failed: %v", err)
	}
	if unsent.Status != notification.StatusFailed || unsent.ErrorMessage == nil ||
		!strings.Contains(*unsent.ErrorMessage, "not configured") {
		t.Fatalf("expected failed log with 'not configured' reason, got status=%s err=%v", unsent.Status, unsent.ErrorMessage)
	}
	// keep the feed assertions below about the delivered message only
	_, _ = dbPool.Exec(ctx, "DELETE FROM notification_logs WHERE id = $1", unsentLog.ID)

	// 6. Simulate Zalo Webhook: Delivery callback (user_received_message)
	t.Log("Step 4: Simulating Zalo webhook callback (user_received_message -> delivered)...")
	delResp := postSignedZaloWebhook(t, client, ts.URL+"/api/v1/webhooks/zalo", map[string]interface{}{
		"app_id":        testZaloAppID,
		"event_name":    "user_received_message",
		"msg_id":        capturedMsgID,
		"delivery_time": fmt.Sprintf("%d", time.Now().Unix()),
	})
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("delivery webhook failed: status=%d", delResp.StatusCode)
	}
	delResp.Body.Close()

	// Verify database record transitioned to 'delivered'
	deliveredLog, err := notifRepo.GetLogByMsgID(ctx, capturedMsgID)
	if err != nil || deliveredLog == nil {
		t.Fatalf("get log by msg_id failed: %v", err)
	}
	if deliveredLog.Status != notification.StatusDelivered {
		t.Errorf("expected status 'delivered', got '%s'", deliveredLog.Status)
	}
	if deliveredLog.DeliveredAt == nil {
		t.Errorf("expected non-nil delivered_at timestamp")
	}

	// 7. Simulate Zalo Webhook: Read callback (user_read_message)
	t.Log("Step 5: Simulating Zalo webhook callback (user_read_message -> read)...")
	readResp := postSignedZaloWebhook(t, client, ts.URL+"/api/v1/webhooks/zalo", map[string]interface{}{
		"app_id":     testZaloAppID,
		"event_name": "user_read_message",
		"msg_id":     capturedMsgID,
	})
	if readResp.StatusCode != http.StatusOK {
		t.Fatalf("read webhook failed: status=%d", readResp.StatusCode)
	}
	readResp.Body.Close()

	// Verify database record transitioned to 'read'
	readLog, err := notifRepo.GetLogByMsgID(ctx, capturedMsgID)
	if err != nil || readLog == nil {
		t.Fatalf("get log by msg_id after read failed: %v", err)
	}
	if readLog.Status != notification.StatusRead {
		t.Errorf("expected status 'read', got '%s'", readLog.Status)
	}
	if readLog.ReadAt == nil {
		t.Errorf("expected non-nil read_at timestamp")
	}

	// 8. Verify via HTTP API GET /api/v1/notifications
	t.Log("Step 6: Verifying user notification feed API...")
	feedReq, _ := http.NewRequestWithContext(ctx, "GET", ts.URL+"/api/v1/notifications", nil)
	feedReq.Header.Set("Authorization", bearerFor(t, jwtMgr, userID))

	feedResp, err := client.Do(feedReq)
	if err != nil || feedResp.StatusCode != http.StatusOK {
		t.Fatalf("get notifications failed: status=%d, err=%v", feedResp.StatusCode, err)
	}

	var res struct {
		Data []notification.EnrichedNotification `json:"data"`
	}
	if err := json.NewDecoder(feedResp.Body).Decode(&res); err != nil {
		t.Fatalf("failed to decode notification feed: %v", err)
	}
	feedResp.Body.Close()

	notifFeed := res.Data
	if len(notifFeed) == 0 {
		t.Fatalf("expected at least 1 notification in feed")
	}
	feedItem := notifFeed[0]
	if feedItem.Status != notification.StatusRead {
		t.Errorf("expected feed item status 'read', got '%s'", feedItem.Status)
	}
	if feedItem.MsgID == nil || *feedItem.MsgID != capturedMsgID {
		t.Errorf("expected feed item msg_id '%s', got '%v'", capturedMsgID, feedItem.MsgID)
	}

	t.Log("ALL GAP-04 ZALO OA & ZNS DELIVERY STATUS FLOW STEPS PASSED SUCCESSFULLY!")
}
