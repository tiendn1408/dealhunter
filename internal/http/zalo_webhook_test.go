package router

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/notification"
)

type mockWebhookNotifRepo struct {
	updatedStatus map[string]notification.Status
	updatedTime   map[string]*time.Time
}

func newMockWebhookNotifRepo() *mockWebhookNotifRepo {
	return &mockWebhookNotifRepo{
		updatedStatus: make(map[string]notification.Status),
		updatedTime:   make(map[string]*time.Time),
	}
}

func (m *mockWebhookNotifRepo) InsertLog(_ context.Context, _ *notification.NotificationLog) error {
	return nil
}
func (m *mockWebhookNotifRepo) UpdateStatus(_ context.Context, _ uuid.UUID, _ notification.Status, _ *string) error {
	return nil
}
func (m *mockWebhookNotifRepo) UpdateStatusAndMsgID(_ context.Context, _ uuid.UUID, _ notification.Status, _ string, _ *string) error {
	return nil
}
func (m *mockWebhookNotifRepo) GetLogByMsgID(_ context.Context, _ string) (*notification.NotificationLog, error) {
	return nil, nil
}
func (m *mockWebhookNotifRepo) UpdateDeliveryStatus(_ context.Context, msgID string, status notification.Status, ts *time.Time) error {
	m.updatedStatus[msgID] = status
	m.updatedTime[msgID] = ts
	return nil
}
func (m *mockWebhookNotifRepo) CheckDedup(_ context.Context, _, _ uuid.UUID, _ time.Duration) (bool, error) {
	return false, nil
}
func (m *mockWebhookNotifRepo) ListUserNotifications(_ context.Context, _ uuid.UUID, _ int) ([]*notification.EnrichedNotification, error) {
	return nil, nil
}
func (m *mockWebhookNotifRepo) ListRuleLogs(_ context.Context, _ uuid.UUID) ([]*notification.NotificationLog, error) {
	return nil, nil
}
func (m *mockWebhookNotifRepo) MarkAsRead(_ context.Context, _, _ uuid.UUID) error {
	return nil
}
func (m *mockWebhookNotifRepo) GetLog(_ context.Context, _ uuid.UUID) (*notification.NotificationLog, error) {
	return nil, nil
}
func (m *mockWebhookNotifRepo) GetUserRecipient(_ context.Context, _ uuid.UUID, _ string) (string, error) {
	return "", nil
}
func (m *mockWebhookNotifRepo) GetUserProfile(_ context.Context, _ uuid.UUID) (*notification.UserProfile, error) {
	return nil, nil
}
func (m *mockWebhookNotifRepo) UpdateUserZalo(_ context.Context, _ uuid.UUID, _, _ string) error {
	return nil
}
func (m *mockWebhookNotifRepo) DisconnectUserZalo(_ context.Context, _ uuid.UUID) error {
	return nil
}

func TestZaloWebhook_DeliveryStatusFlow(t *testing.T) {
	repo := newMockWebhookNotifRepo()
	h := NewHandler(nil, nil)
	h.SetAlertAndNotificationRepos(nil, repo)

	// 1. Test user_received_message -> delivered
	payload1 := map[string]interface{}{
		"app_id":        "123456",
		"event_name":    "user_received_message",
		"msg_id":        "zalo-msg-001",
		"delivery_time": "1727710000",
	}
	body1, _ := json.Marshal(payload1)
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body1))
	rec1 := httptest.NewRecorder()

	h.HandleZaloWebhook(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec1.Code)
	}

	if repo.updatedStatus["zalo-msg-001"] != notification.StatusDelivered {
		t.Errorf("expected status 'delivered', got '%s'", repo.updatedStatus["zalo-msg-001"])
	}

	// 2. Test user_read_message -> read
	payload2 := map[string]interface{}{
		"app_id":     "123456",
		"event_name": "user_read_message",
		"msg_id":     "zalo-msg-001",
		"timestamp":  "1727710050",
	}
	body2, _ := json.Marshal(payload2)
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body2))
	rec2 := httptest.NewRecorder()

	h.HandleZaloWebhook(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec2.Code)
	}

	if repo.updatedStatus["zalo-msg-001"] != notification.StatusRead {
		t.Errorf("expected status 'read', got '%s'", repo.updatedStatus["zalo-msg-001"])
	}
	// 3. Test nested message.msg_id (standard OA format) and millisecond epoch
	payload3 := map[string]interface{}{
		"app_id":     "123456",
		"event_name": "user_read_message",
		"timestamp":  1727710050000, // int64 millisecond epoch
		"message": map[string]interface{}{
			"msg_id": "zalo-msg-nested-002",
		},
	}
	body3, _ := json.Marshal(payload3)
	req3 := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body3))
	rec3 := httptest.NewRecorder()

	h.HandleZaloWebhook(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for nested message, got %d", rec3.Code)
	}

	if repo.updatedStatus["zalo-msg-nested-002"] != notification.StatusRead {
		t.Errorf("expected status 'read' for nested msg_id, got '%s'", repo.updatedStatus["zalo-msg-nested-002"])
	}
	if repo.updatedTime["zalo-msg-nested-002"] == nil || repo.updatedTime["zalo-msg-nested-002"].Year() < 2024 {
		t.Errorf("expected valid parsed millisecond epoch timestamp, got %v", repo.updatedTime["zalo-msg-nested-002"])
	}
}

func TestZaloWebhook_SignatureValidation(t *testing.T) {
	repo := newMockWebhookNotifRepo()
	h := NewHandler(nil, nil)
	h.SetAlertAndNotificationRepos(nil, repo)

	secret := "super-webhook-secret-123"
	h.SetZaloWebhookSecret(secret)

	payload := map[string]interface{}{
		"app_id":     "123456",
		"event_name": "user_read_message",
		"msg_id":     "zalo-msg-sig-1",
	}
	body, _ := json.Marshal(payload)

	// Missing signature when secret is configured -> 401
	reqMissing := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body))
	recMissing := httptest.NewRecorder()
	h.HandleZaloWebhook(recMissing, reqMissing)
	if recMissing.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing signature, got %d", recMissing.Code)
	}

	// Valid signature with mac= prefix
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	validSig := hex.EncodeToString(mac.Sum(nil))

	reqValid := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body))
	reqValid.Header.Set("X-ZEvent-Signature", "mac="+validSig)
	recValid := httptest.NewRecorder()

	h.HandleZaloWebhook(recValid, reqValid)
	if recValid.Code != http.StatusOK {
		t.Errorf("expected 200 for valid signature, got %d", recValid.Code)
	}

	// Invalid signature
	reqInvalid := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body))
	reqInvalid.Header.Set("X-ZEvent-Signature", "invalid-signature-hash")
	recInvalid := httptest.NewRecorder()

	h.HandleZaloWebhook(recInvalid, reqInvalid)
	if recInvalid.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid signature, got %d", recInvalid.Code)
	}
}
