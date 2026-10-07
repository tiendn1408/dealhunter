package router

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/internal/notification"
)

const (
	maxZaloWebhookBody = 64 << 10
	zaloWebhookMaxSkew = 15 * time.Minute
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

	// Signature verification is mandatory; never trust a secret supplied by the caller.
	if h.zaloAppID == "" || h.zaloWebhookSecret == "" {
		http.Error(w, "zalo webhook not configured", http.StatusServiceUnavailable)
		return
	}

	bodyBytes, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxZaloWebhookBody))
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}

	var envelope struct {
		Timestamp json.RawMessage `json:"timestamp"`
	}
	if err := json.Unmarshal(bodyBytes, &envelope); err != nil {
		http.Error(w, "invalid json payload", http.StatusBadRequest)
		return
	}
	timestamp := strings.Trim(string(envelope.Timestamp), `"`)

	sigHeader := r.Header.Get("X-ZEvent-Signature")
	if sigHeader == "" || !verifyZaloSignature(sigHeader, h.zaloAppID, bodyBytes, timestamp, h.zaloWebhookSecret) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	// Reject stale or replayed callbacks
	eventAt := parseEpoch(timestamp)
	if eventAt == nil || absDuration(time.Since(*eventAt)) > zaloWebhookMaxSkew {
		http.Error(w, "stale webhook timestamp", http.StatusUnauthorized)
		return
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

// verifyZaloSignature checks Zalo's X-ZEvent-Signature header:
// mac = sha256(appId + rawBody + timestamp + OASecretKey), hex encoded.
func verifyZaloSignature(signature, appID string, body []byte, timestamp, secretKey string) bool {
	cleanSig := strings.TrimPrefix(strings.TrimSpace(signature), "mac=")
	cleanSig = strings.ToLower(strings.TrimSpace(cleanSig))

	sum := sha256.Sum256([]byte(appID + string(body) + timestamp + secretKey))
	expected := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(cleanSig), []byte(expected)) == 1
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}
