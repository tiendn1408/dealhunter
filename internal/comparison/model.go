package comparison

import (
	"time"

	"github.com/google/uuid"
)

// SourcePrice describes the current price snapshot of a single product source on a marketplace platform.
type SourcePrice struct {
	SourceID       uuid.UUID  `json:"source_id"`
	ProductID      uuid.UUID  `json:"product_id"`
	Platform       string     `json:"platform"`
	SellerName     string     `json:"seller_name"`
	CanonicalURL   string     `json:"canonical_url"`
	ListedPrice    int64      `json:"listed_price"`
	ShippingFee    int64      `json:"shipping_fee"`
	EffectivePrice int64      `json:"effective_price"`
	InStock        bool       `json:"in_stock"`
	IsBestDeal     bool       `json:"is_best_deal"`
	CapturedAt     *time.Time `json:"captured_at"`
}

// ComparisonResult encapsulates the full multi-platform comparison table for a canonical product.
type ComparisonResult struct {
	ProductID           uuid.UUID        `json:"product_id"`
	ProductTitle        string           `json:"product_title"`
	ComparisonAvailable bool             `json:"comparison_available"`
	Sources             []SourcePrice    `json:"sources"`
	BestDeal            *BestDealSummary `json:"best_deal"`
	ComputedAt          time.Time        `json:"computed_at"`
}

// BestDealSummary summarizes the best deal across all active sources.
type BestDealSummary struct {
	Platform              string  `json:"platform"`
	EffectivePrice        int64   `json:"effective_price"`
	SavingVsMostExpensive int64   `json:"saving_vs_most_expensive"`
	SavingPercent         float64 `json:"saving_percent"`
}

// ProductGroupSummary represents a product with multiple sources tracked by a user.
type ProductGroupSummary struct {
	ProductID    uuid.UUID `json:"product_id"`
	ProductTitle string    `json:"product_title"`
	BestPrice    *int64    `json:"best_price"`
	BestPlatform string    `json:"best_platform"`
	SourceCount  int       `json:"source_count"`
}

// IdentifyBestDeal evaluates sources and determines the source with the lowest effective price.
// Only sources that are InStock and have EffectivePrice > 0 are eligible.
// It sets IsBestDeal = true on the winning source in-place and returns a BestDealSummary.
func IdentifyBestDeal(sources []SourcePrice) *BestDealSummary {
	var (
		bestIdx   = -1
		bestPrice int64
		maxPrice  int64
	)

	for i, s := range sources {
		if !s.InStock || s.EffectivePrice <= 0 {
			continue
		}
		if bestIdx == -1 || s.EffectivePrice < bestPrice {
			bestIdx = i
			bestPrice = s.EffectivePrice
		}
		if s.EffectivePrice > maxPrice {
			maxPrice = s.EffectivePrice
		}
	}

	if bestIdx == -1 {
		return nil
	}

	sources[bestIdx].IsBestDeal = true
	saving := maxPrice - bestPrice
	savingPct := 0.0
	if maxPrice > 0 {
		savingPct = float64(saving) / float64(maxPrice) * 100
	}

	return &BestDealSummary{
		Platform:              sources[bestIdx].Platform,
		EffectivePrice:        bestPrice,
		SavingVsMostExpensive: saving,
		SavingPercent:         savingPct,
	}
}
