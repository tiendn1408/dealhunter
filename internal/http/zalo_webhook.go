package router

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/internal/notification"
)

type ZaloWebhookPayload struct {
	AppID        string `json:"app_id"`
	OAID         string `json:"oa_id"`
	EventName    string `json:"event_name"`
	MsgID        string `json:"msg_id"`
	Status       string `json:"status"`
	DeliveryTime any    `json:"delivery_time"`
	Timestamp    any    `json:"timestamp"`
	Recipient    string `json:"user_id_by_app"`
	Data         *struct {
		MsgID  string `json:"msg_id"`
		Status string `json:"status,omitempty"`
	} `json:"data,omitempty"`
	Message *struct {
		MsgID string `json:"msg_id"`
	} `json:"message,omitempty"`
}

// HandleZaloWebhook handles incoming Zalo OA / ZNS delivery status callbacks
// POST /api/v1/webhooks/zalo
func (h *Handler) HandleZaloWebhook(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "notification repository unavailable", http.StatusServiceUnavailable)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}

	// Resolve webhook secret
	webhookSecret := h.zaloWebhookSecret
	if webhookSecret == "" {
		webhookSecret = r.Header.Get("X-DealHunter-Secret")
	}
	if webhookSecret == "" {
		webhookSecret = r.URL.Query().Get("secret")
	}

	// Extract signature from headers or query
	sigHeader := r.Header.Get("X-ZEvent-Signature")
	if sigHeader == "" {
		sigHeader = r.Header.Get("X-Zalo-Signature")
	}
	if sigHeader == "" {
		sigHeader = r.URL.Query().Get("mac")
	}
	if sigHeader == "" {
		sigHeader = r.URL.Query().Get("signature")
	}

	// Verify signature if secret is configured
	if webhookSecret != "" {
		if sigHeader == "" || !verifyZaloSignature(sigHeader, bodyBytes, webhookSecret) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
	}

	var payload ZaloWebhookPayload
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		http.Error(w, "invalid json payload", http.StatusBadRequest)
		return
	}

	msgID := payload.MsgID
	if msgID == "" && payload.Data != nil {
		msgID = payload.Data.MsgID
	}
	if msgID == "" && payload.Message != nil {
		msgID = payload.Message.MsgID
	}

	if msgID != "" {
		event := strings.ToLower(payload.EventName)
		statusField := strings.ToLower(payload.Status)
		if statusField == "" && payload.Data != nil {
			statusField = strings.ToLower(payload.Data.Status)
		}

		var targetStatus notification.Status
		if event == "user_read_message" || statusField == "read" || statusField == "seen" {
			targetStatus = notification.StatusRead
		} else if event == "user_received_message" || statusField == "delivered" || event == "delivery" {
			targetStatus = notification.StatusDelivered
		} else if statusField == "failed" {
			targetStatus = notification.StatusFailed
		}

		if targetStatus != "" {
			eventTime := parseEpoch(payload.DeliveryTime)
			if eventTime == nil {
				eventTime = parseEpoch(payload.Timestamp)
			}

			_ = h.notifRepo.UpdateDeliveryStatus(r.Context(), msgID, targetStatus, eventTime)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error":   0,
		"message": "Success",
	})
}

func parseEpoch(v any) *time.Time {
	if v == nil {
		return nil
	}
	var sec int64
	switch val := v.(type) {
	case float64:
		sec = int64(val)
	case int64:
		sec = val
	case int:
		sec = int64(val)
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return nil
		}
		var err error
		sec, err = strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil
		}
	default:
		return nil
	}

	if sec <= 0 {
		return nil
	}
	if sec > 1e11 {
		t := time.UnixMilli(sec)
		return &t
	}
	t := time.Unix(sec, 0)
	return &t
}

func verifyZaloSignature(signature string, body []byte, secretKey string) bool {
	cleanSig := strings.TrimPrefix(signature, "sha256=")
	cleanSig = strings.TrimPrefix(cleanSig, "mac=")
	cleanSig = strings.ToLower(strings.TrimSpace(cleanSig))

	mac := hmac.New(sha256.New, []byte(secretKey))
	mac.Write(body)
	expectedMAC := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(cleanSig), []byte(expectedMAC))
}
