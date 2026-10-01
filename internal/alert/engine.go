package alert

import (
	"context"

	"github.com/google/uuid"
)

// RuleEngine evaluates price change events against stored alert rules.
type RuleEngine interface {
	// Evaluate evaluates all active, non-expired rules for the product source in the event.
	// Returns rules that match the condition.
	Evaluate(ctx context.Context, event PriceChangeEvent) ([]AlertRule, error)
}

// Repository defines storage operations for alert rules.
type Repository interface {
	CreateRule(ctx context.Context, rule *AlertRule) error
	GetRule(ctx context.Context, id uuid.UUID) (*AlertRule, error)
	ListActiveRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*AlertRule, error)
	ListRulesByUser(ctx context.Context, userID uuid.UUID) ([]*AlertRule, error)
	ListRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*AlertRule, error)
	ListRulesBySourceAndUser(ctx context.Context, productSourceID, userID uuid.UUID) ([]*AlertRule, error)
	DeactivateRule(ctx context.Context, id uuid.UUID) error
	DeactivateRuleForUser(ctx context.Context, id, userID uuid.UUID) error
}
