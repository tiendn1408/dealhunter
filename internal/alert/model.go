package alert

import (
	"time"

	"github.com/google/uuid"
)

type RuleType string

const (
	RuleTypeDropPercent  RuleType = "drop_percent"
	RuleTypeTargetPrice  RuleType = "target_price"
	RuleTypeLowestInDays RuleType = "lowest_in_days"
)

func (r RuleType) IsValid() bool {
	switch r {
	case RuleTypeDropPercent, RuleTypeTargetPrice, RuleTypeLowestInDays:
		return true
	default:
		return false
	}
}

type AlertRule struct {
	ID              uuid.UUID  `json:"id"`
	UserID          uuid.UUID  `json:"user_id"`
	ProductSourceID uuid.UUID  `json:"product_source_id"`
	RuleType        RuleType   `json:"rule_type"`
	ThresholdValue  int64      `json:"threshold_value"`
	Active          bool       `json:"active"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// IsExpired checks if the rule has passed its expiration time
func (r *AlertRule) IsExpired(now time.Time) bool {
	if r.ExpiresAt == nil {
		return false
	}
	return now.After(*r.ExpiresAt)
}

type PriceChangeEvent struct {
	ProductSourceID uuid.UUID `json:"product_source_id"`
	OldPrice        int64     `json:"old_price"`
	NewPrice        int64     `json:"new_price"`
	OldEffective    int64     `json:"old_effective"`
	NewEffective    int64     `json:"new_effective"`
	CapturedAt      time.Time `json:"captured_at"`
}
