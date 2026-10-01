package alert

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tiendang/deal-hunter/internal/pricing"
)

type mockAlertRepo struct {
	rules []*AlertRule
}

func (m *mockAlertRepo) CreateRule(ctx context.Context, rule *AlertRule) error {
	m.rules = append(m.rules, rule)
	return nil
}

func (m *mockAlertRepo) GetRule(ctx context.Context, id uuid.UUID) (*AlertRule, error) {
	for _, r := range m.rules {
		if r.ID == id {
			return r, nil
		}
	}
	return nil, nil
}

func (m *mockAlertRepo) ListActiveRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*AlertRule, error) {
	var result []*AlertRule
	for _, r := range m.rules {
		if r.ProductSourceID == productSourceID && r.Active {
			result = append(result, r)
		}
	}
	return result, nil
}

func (m *mockAlertRepo) ListRulesByUser(ctx context.Context, userID uuid.UUID) ([]*AlertRule, error) {
	var result []*AlertRule
	for _, r := range m.rules {
		if r.UserID == userID {
			result = append(result, r)
		}
	}
	return result, nil
}

func (m *mockAlertRepo) ListRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*AlertRule, error) {
	var result []*AlertRule
	for _, r := range m.rules {
		if r.ProductSourceID == productSourceID {
			result = append(result, r)
		}
	}
	return result, nil
}

func (m *mockAlertRepo) ListRulesBySourceAndUser(ctx context.Context, productSourceID, userID uuid.UUID) ([]*AlertRule, error) {
	var result []*AlertRule
	for _, r := range m.rules {
		if r.ProductSourceID == productSourceID && r.UserID == userID {
			result = append(result, r)
		}
	}
	return result, nil
}

func (m *mockAlertRepo) DeactivateRule(ctx context.Context, id uuid.UUID) error {
	for _, r := range m.rules {
		if r.ID == id {
			r.Active = false
			return nil
		}
	}
	return nil
}

func (m *mockAlertRepo) DeactivateRuleForUser(ctx context.Context, id, userID uuid.UUID) error {
	for _, r := range m.rules {
		if r.ID == id && r.UserID == userID {
			r.Active = false
			return nil
		}
	}
	return nil
}

type mockPricingRepo struct {
	snapshots []*pricing.PriceSnapshot
}

func (m *mockPricingRepo) InsertSnapshot(ctx context.Context, tx pgx.Tx, snapshot *pricing.PriceSnapshot) error {
	m.snapshots = append(m.snapshots, snapshot)
	return nil
}

func (m *mockPricingRepo) ListSnapshots(ctx context.Context, productSourceID uuid.UUID, from, to time.Time) ([]*pricing.PriceSnapshot, error) {
	var res []*pricing.PriceSnapshot
	for _, s := range m.snapshots {
		if s.ProductSourceID == productSourceID && !s.CapturedAt.Before(from) && !s.CapturedAt.After(to) {
			res = append(res, s)
		}
	}
	return res, nil
}

func TestEvalDropPercent(t *testing.T) {
	tests := []struct {
		name      string
		oldPrice  int64
		newPrice  int64
		threshold int64
		want      bool
	}{
		{"10% drop when threshold is 10%", 1000000, 900000, 10, true},
		{"20% drop when threshold is 15%", 1000000, 800000, 15, true},
		{"5% drop when threshold is 10%", 1000000, 950000, 10, false},
		{"price increased", 1000000, 1200000, 10, false},
		{"price unchanged", 1000000, 1000000, 10, false},
		{"old price is 0", 0, 100000, 10, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EvalDropPercent(tt.oldPrice, tt.newPrice, tt.threshold)
			if got != tt.want {
				t.Errorf("EvalDropPercent(%d, %d, %d) = %v, want %v", tt.oldPrice, tt.newPrice, tt.threshold, got, tt.want)
			}
		})
	}
}

func TestEvalTargetPrice(t *testing.T) {
	tests := []struct {
		name     string
		newPrice int64
		target   int64
		want     bool
	}{
		{"exact match", 500000, 500000, true},
		{"below target", 450000, 500000, true},
		{"above target", 500001, 500000, false},
		{"zero price", 0, 500000, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EvalTargetPrice(tt.newPrice, tt.target)
			if got != tt.want {
				t.Errorf("EvalTargetPrice(%d, %d) = %v, want %v", tt.newPrice, tt.target, got, tt.want)
			}
		})
	}
}

func TestRuleEngineEvaluate(t *testing.T) {
	ctx := context.Background()
	sourceID := uuid.New()
	userID := uuid.New()
	now := time.Now()

	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	repo := &mockAlertRepo{
		rules: []*AlertRule{
			{
				ID:              uuid.New(),
				UserID:          userID,
				ProductSourceID: sourceID,
				RuleType:        RuleTypeDropPercent,
				ThresholdValue:  10, // >= 10% drop
				Active:          true,
				ExpiresAt:       &future,
			},
			{
				ID:              uuid.New(),
				UserID:          userID,
				ProductSourceID: sourceID,
				RuleType:        RuleTypeTargetPrice,
				ThresholdValue:  500000, // <= 500k
				Active:          true,
			},
			{
				ID:              uuid.New(),
				UserID:          userID,
				ProductSourceID: sourceID,
				RuleType:        RuleTypeDropPercent,
				ThresholdValue:  5,
				Active:          true,
				ExpiresAt:       &past, // EXPIRED!
			},
		},
	}

	pricingRepo := &mockPricingRepo{}
	engine := NewRuleEngine(repo, pricingRepo)

	// Event: Price dropped from 1,000,000 to 450,000 (55% drop, <= 500k)
	// Rule 1: drop >= 10% -> Matches!
	// Rule 2: target <= 500k -> Matches!
	// Rule 3: expired -> Skipped!
	event := PriceChangeEvent{
		ProductSourceID: sourceID,
		OldPrice:        1000000,
		NewPrice:        450000,
		CapturedAt:      now,
	}

	matched, err := engine.Evaluate(ctx, event)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(matched) != 2 {
		t.Fatalf("expected 2 matched rules, got %d", len(matched))
	}
}
