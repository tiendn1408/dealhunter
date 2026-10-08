package notification

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusSent      Status = "sent"
	StatusDelivered Status = "delivered"
	StatusRead      Status = "read"
	StatusFailed    Status = "failed"
)

type NotificationLog struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	AlertRuleID  uuid.UUID  `json:"alert_rule_id"`
	Channel      string     `json:"channel"`
	Recipient    string     `json:"recipient"`
	Status       Status     `json:"status"`
	MsgID        *string    `json:"msg_id,omitempty"`
	PriceBefore  int64      `json:"price_before"`
	PriceAfter   int64      `json:"price_after"`
	SentAt       *time.Time `json:"sent_at,omitempty"`
	DeliveredAt  *time.Time `json:"delivered_at,omitempty"`
	ReadAt       *time.Time `json:"read_at,omitempty"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// EnrichedNotification includes product metadata for frontend notification feed
type EnrichedNotification struct {
	NotificationLog
	ProductTitle string `json:"product_title,omitempty"`
	Platform     string `json:"platform,omitempty"`
	ProductURL   string `json:"product_url,omitempty"`
	AffiliateURL string `json:"affiliate_url,omitempty"`
}

// QueuePayload is serialized into Redis Stream dh:stream:notifications
type QueuePayload struct {
	NotificationLogID uuid.UUID `json:"notification_log_id"`
	UserID            uuid.UUID `json:"user_id"`
	AlertRuleID       uuid.UUID `json:"alert_rule_id"`
	Recipient         string    `json:"recipient"`
	Channel           string    `json:"channel"`
	ProductSourceID   uuid.UUID `json:"product_source_id"`
	PriceBefore       int64     `json:"price_before"`
	PriceAfter        int64     `json:"price_after"`
	ProductURL        string    `json:"product_url,omitempty"`
	Platform          string    `json:"platform,omitempty"`
}

// UserProfile represents user profile and connection info
type UserProfile struct {
	UserID        uuid.UUID `json:"user_id"`
	ZaloID        string    `json:"zalo_id,omitempty"`
	Phone         string    `json:"phone,omitempty"`
	ZaloConnected bool      `json:"zalo_connected"`
	CreatedAt     time.Time `json:"created_at"`
}

// Repository defines operations for notification logs and dedup checking
type Repository interface {
	InsertLog(ctx context.Context, log *NotificationLog) error
	UpdateStatus(ctx context.Context, id uuid.UUID, status Status, errorMessage *string) error
	UpdateStatusAndMsgID(ctx context.Context, id uuid.UUID, status Status, msgID string, errorMessage *string) error
	GetLogByMsgID(ctx context.Context, msgID string) (*NotificationLog, error)
	UpdateDeliveryStatus(ctx context.Context, msgID string, status Status, timestamp *time.Time) error
	CheckDedup(ctx context.Context, userID, alertRuleID uuid.UUID, within time.Duration) (bool, error)
	ListUserNotifications(ctx context.Context, userID uuid.UUID, limit int) ([]*EnrichedNotification, error)
	ListRuleLogs(ctx context.Context, alertRuleID uuid.UUID) ([]*NotificationLog, error)
	MarkAsRead(ctx context.Context, id uuid.UUID, userID uuid.UUID) error
	GetLog(ctx context.Context, id uuid.UUID) (*NotificationLog, error)
	GetUserRecipient(ctx context.Context, userID uuid.UUID, channel string) (string, error)
	GetUserProfile(ctx context.Context, userID uuid.UUID) (*UserProfile, error)
	// LinkVerifiedPhone links a phone number whose ownership was proven (OTP) to userID.
	LinkVerifiedPhone(ctx context.Context, userID uuid.UUID, phone string) error
	DisconnectUserZalo(ctx context.Context, userID uuid.UUID) error
}
