package router

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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

const (
	testZaloAppID  = "123456"
	testZaloSecret = "super-webhook-secret-123"
)

func newWebhookTestHandler(repo *mockWebhookNotifRepo) *Handler {
	h := NewHandler(nil, nil)
	h.SetAlertAndNotificationRepos(nil, repo)
	h.SetZaloWebhookCredentials(testZaloAppID, testZaloSecret)
	return h
}

func zaloMac(appID string, body []byte, timestamp, secret string) string {
	sum := sha256.Sum256([]byte(appID + string(body) + timestamp + secret))
	return "mac=" + hex.EncodeToString(sum[:])
}

// signedWebhookRequest builds a request signed the way Zalo does; timestamp defaults to now (ms).
func signedWebhookRequest(t *testing.T, payload map[string]interface{}) *http.Request {
	t.Helper()
	if _, ok := payload["timestamp"]; !ok {
		payload["timestamp"] = strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	body, _ := json.Marshal(payload)
	ts := strings.Trim(fmt.Sprint(payload["timestamp"]), `"`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", bytes.NewReader(body))
	req.Header.Set("X-ZEvent-Signature", zaloMac(testZaloAppID, body, ts, testZaloSecret))
	return req
}

func TestZaloWebhook_DeliveryStatusFlow(t *testing.T) {
	repo := newMockWebhookNotifRepo()
	h := newWebhookTestHandler(repo)

	// 1. Test user_received_message -> delivered
	rec1 := httptest.NewRecorder()
	h.HandleZaloWebhook(rec1, signedWebhookRequest(t, map[string]interface{}{
		"app_id":        testZaloAppID,
		"event_name":    "user_received_message",
		"msg_id":        "zalo-msg-001",
		"delivery_time": "1727710000",
	}))
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec1.Code)
	}
	if repo.updatedStatus["zalo-msg-001"] != notification.StatusDelivered {
		t.Errorf("expected status 'delivered', got '%s'", repo.updatedStatus["zalo-msg-001"])
	}

	// 2. Test user_read_message -> read
	rec2 := httptest.NewRecorder()
	h.HandleZaloWebhook(rec2, signedWebhookRequest(t, map[string]interface{}{
		"app_id":     testZaloAppID,
		"event_name": "user_read_message",
		"msg_id":     "zalo-msg-001",
	}))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec2.Code)
	}
	if repo.updatedStatus["zalo-msg-001"] != notification.StatusRead {
		t.Errorf("expected status 'read', got '%s'", repo.updatedStatus["zalo-msg-001"])
	}

	// 3. Test nested message.msg_id (standard OA format) and numeric millisecond epoch
	rec3 := httptest.NewRecorder()
	h.HandleZaloWebhook(rec3, signedWebhookRequest(t, map[string]interface{}{
		"app_id":     testZaloAppID,
		"event_name": "user_read_message",
		"timestamp":  time.Now().UnixMilli(),
		"message": map[string]interface{}{
			"msg_id": "zalo-msg-nested-002",
		},
	}))
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

// SEC-10: verification can never be skipped or keyed by the caller
func TestZaloWebhook_SignatureValidation(t *testing.T) {
	newPayload := func() map[string]interface{} {
		return map[string]interface{}{
			"app_id":     testZaloAppID,
			"event_name": "user_read_message",
			"msg_id":     "zalo-msg-sig-1",
		}
	}

	t.Run("not configured returns 503", func(t *testing.T) {
		h := NewHandler(nil, nil)
		h.SetAlertAndNotificationRepos(nil, newMockWebhookNotifRepo())
		rec := httptest.NewRecorder()
		h.HandleZaloWebhook(rec, signedWebhookRequest(t, newPayload()))
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503, got %d", rec.Code)
		}
	})

	t.Run("valid signature", func(t *testing.T) {
		repo := newMockWebhookNotifRepo()
		rec := httptest.NewRecorder()
		newWebhookTestHandler(repo).HandleZaloWebhook(rec, signedWebhookRequest(t, newPayload()))
		if rec.Code != http.StatusOK || repo.updatedStatus["zalo-msg-sig-1"] != notification.StatusRead {
			t.Errorf("expected 200 and status update, got %d", rec.Code)
		}
	})

	t.Run("missing signature", func(t *testing.T) {
		req := signedWebhookRequest(t, newPayload())
		req.Header.Del("X-ZEvent-Signature")
		rec := httptest.NewRecorder()
		newWebhookTestHandler(newMockWebhookNotifRepo()).HandleZaloWebhook(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", rec.Code)
		}
	})

	t.Run("invalid signature", func(t *testing.T) {
		req := signedWebhookRequest(t, newPayload())
		req.Header.Set("X-ZEvent-Signature", "mac=invalid-signature-hash")
		rec := httptest.NewRecorder()
		newWebhookTestHandler(newMockWebhookNotifRepo()).HandleZaloWebhook(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", rec.Code)
		}
	})

	t.Run("caller-supplied secret is ignored", func(t *testing.T) {
		payload := newPayload()
		payload["timestamp"] = strconv.FormatInt(time.Now().UnixMilli(), 10)
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo?secret=attacker", bytes.NewReader(body))
		req.Header.Set("X-DealHunter-Secret", "attacker")
		req.Header.Set("X-ZEvent-Signature", zaloMac(testZaloAppID, body, payload["timestamp"].(string), "attacker"))
		rec := httptest.NewRecorder()
		repo := newMockWebhookNotifRepo()
		newWebhookTestHandler(repo).HandleZaloWebhook(rec, req)
		if rec.Code != http.StatusUnauthorized || len(repo.updatedStatus) != 0 {
			t.Errorf("expected 401 with no update, got %d", rec.Code)
		}
	})

	t.Run("stale timestamp is rejected", func(t *testing.T) {
		payload := newPayload()
		payload["timestamp"] = strconv.FormatInt(time.Now().Add(-2*time.Hour).UnixMilli(), 10)
		rec := httptest.NewRecorder()
		newWebhookTestHandler(newMockWebhookNotifRepo()).HandleZaloWebhook(rec, signedWebhookRequest(t, payload))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 for replayed callback, got %d", rec.Code)
		}
	})

	t.Run("oversized body is rejected", func(t *testing.T) {
		payload := newPayload()
		payload["padding"] = strings.Repeat("x", maxZaloWebhookBody+1)
		rec := httptest.NewRecorder()
		newWebhookTestHandler(newMockWebhookNotifRepo()).HandleZaloWebhook(rec, signedWebhookRequest(t, payload))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for oversized body, got %d", rec.Code)
		}
	})
}
