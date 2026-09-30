package alert

import (
	"context"
	"fmt"
	"time"

	"github.com/tiendang/deal-hunter/internal/pricing"
)

type DefaultRuleEngine struct {
	repo        Repository
	pricingRepo pricing.PricingRepository
}

func NewRuleEngine(repo Repository, pricingRepo pricing.PricingRepository) *DefaultRuleEngine {
	return &DefaultRuleEngine{
		repo:        repo,
		pricingRepo: pricingRepo,
	}
}

func (e *DefaultRuleEngine) Evaluate(ctx context.Context, event PriceChangeEvent) ([]AlertRule, error) {
	rules, err := e.repo.ListActiveRulesBySource(ctx, event.ProductSourceID)
	if err != nil {
		return nil, fmt.Errorf("list active rules: %w", err)
	}

	now := event.CapturedAt
	if now.IsZero() {
		now = time.Now()
	}

	var matched []AlertRule
	for _, rule := range rules {
		if rule.IsExpired(now) {
			continue
		}

		isMatch, err := e.evaluateRule(ctx, event, *rule, now)
		if err != nil {
			// Log or skip, continuing evaluation of other rules
			continue
		}

		if isMatch {
			matched = append(matched, *rule)
		}
	}

	return matched, nil
}

func (e *DefaultRuleEngine) evaluateRule(ctx context.Context, event PriceChangeEvent, rule AlertRule, now time.Time) (bool, error) {
	switch rule.RuleType {
	case RuleTypeDropPercent:
		return EvalDropPercent(event.OldPrice, event.NewPrice, rule.ThresholdValue), nil

	case RuleTypeTargetPrice:
		return EvalTargetPrice(event.NewPrice, rule.ThresholdValue), nil

	case RuleTypeLowestInDays:
		return e.evalLowestInDays(ctx, event, rule, now)

	default:
		return false, fmt.Errorf("unknown rule type: %s", rule.RuleType)
	}
}

// EvalDropPercent checks if price dropped by at least threshold %
// thresholdValue = 15 means >= 15% drop
func EvalDropPercent(oldPrice, newPrice, thresholdPercent int64) bool {
	if oldPrice <= 0 || newPrice >= oldPrice {
		return false
	}
	drop := (oldPrice - newPrice) * 100 / oldPrice
	return drop >= thresholdPercent
}

// EvalTargetPrice checks if current price is less than or equal to target price
func EvalTargetPrice(newPrice, targetPrice int64) bool {
	if newPrice <= 0 || targetPrice <= 0 {
		return false
	}
	return newPrice <= targetPrice
}

// evalLowestInDays checks if newPrice is <= any price recorded in last N days
func (e *DefaultRuleEngine) evalLowestInDays(ctx context.Context, event PriceChangeEvent, rule AlertRule, now time.Time) (bool, error) {
	days := rule.ThresholdValue
	if days <= 0 {
		days = 30
	}

	from := now.AddDate(0, 0, -int(days))
	to := now

	if e.pricingRepo == nil {
		// If no pricing repo (e.g. pure unit test), price drop compared to old price
		return event.NewPrice < event.OldPrice, nil
	}

	snapshots, err := e.pricingRepo.ListSnapshots(ctx, event.ProductSourceID, from, to)
	if err != nil {
		return false, fmt.Errorf("query snapshots for lowest_in_days: %w", err)
	}

	// If no past snapshots exist yet, consider it lowest if lower than old price
	if len(snapshots) == 0 {
		return event.NewPrice < event.OldPrice, nil
	}

	// Find the minimum historical price excluding the newly captured one
	for _, s := range snapshots {
		if s.Price > 0 && event.NewPrice > s.Price {
			return false, nil
		}
	}

	return true, nil
}
