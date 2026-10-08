package comparison

import (
	"time"

	"github.com/google/uuid"
)

// SourcePrice describes the current price snapshot of a single product source on a marketplace platform.
type SourcePrice struct {
	SourceID     uuid.UUID `json:"source_id"`
	ProductID    uuid.UUID `json:"product_id"`
	Platform     string    `json:"platform"`
	SellerName   string    `json:"seller_name"`
	CanonicalURL string    `json:"canonical_url"`
	AffiliateURL string    `json:"affiliate_url,omitempty"`
	// Unknown values (not fetched yet / not stated by the marketplace) are null, never 0 or false.
	ListedPrice    *int64     `json:"listed_price"`
	ShippingFee    *int64     `json:"shipping_fee"`
	EffectivePrice *int64     `json:"effective_price"`
	InStock        *bool      `json:"in_stock"`
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
	// ShippingIncluded is false when some source's shipping fee is unknown: then every source is compared
	// on its item price alone, and effective_price above is that price.
	ShippingIncluded bool `json:"shipping_included"`
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
// Only sources with a known EffectivePrice > 0 that are not known to be out of stock are eligible.
// It sets IsBestDeal = true on the winning source in-place and returns a BestDealSummary.
func IdentifyBestDeal(sources []SourcePrice) *BestDealSummary {
	eligible := func(s SourcePrice) bool {
		return s.EffectivePrice != nil && *s.EffectivePrice > 0 && (s.InStock == nil || *s.InStock)
	}
	// Price plus shipping is only comparable when every candidate's shipping is known; otherwise all are
	// compared on the item price, never a mix of both.
	shippingIncluded := true
	for _, s := range sources {
		if eligible(s) && s.ShippingFee == nil {
			shippingIncluded = false
		}
	}
	// Without a known shipping fee the effective price already is the item price; a known fee is taken
	// back out so every source is compared on the item price alone.
	priceOf := func(s SourcePrice) (int64, bool) {
		price := *s.EffectivePrice
		if !shippingIncluded && s.ShippingFee != nil {
			price -= *s.ShippingFee
		}
		return price, price > 0
	}

	var (
		bestIdx   = -1
		bestPrice int64
		maxPrice  int64
	)
	for i, s := range sources {
		if !eligible(s) {
			continue
		}
		price, ok := priceOf(s)
		if !ok {
			continue
		}
		if bestIdx == -1 || price < bestPrice {
			bestIdx = i
			bestPrice = price
		}
		if price > maxPrice {
			maxPrice = price
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
		ShippingIncluded:      shippingIncluded,
	}
}
