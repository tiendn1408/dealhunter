package comparison

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIdentifyBestDeal_MultipleSources(t *testing.T) {
	now := time.Now()
	sources := []SourcePrice{
		{
			SourceID:       uuid.New(),
			Platform:       "shopee",
			EffectivePrice: i64(6290000),
			InStock:        boolp(true),
			CapturedAt:     &now,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: i64(6390000),
			InStock:        boolp(true),
			CapturedAt:     &now,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "tiktok",
			EffectivePrice: i64(6190000),
			InStock:        boolp(true),
			CapturedAt:     &now,
		},
	}

	bestDeal := IdentifyBestDeal(sources)
	if bestDeal == nil {
		t.Fatal("expected non-nil best deal")
	}

	if bestDeal.Platform != "tiktok" {
		t.Errorf("expected platform tiktok, got %s", bestDeal.Platform)
	}
	if bestDeal.EffectivePrice != 6190000 {
		t.Errorf("expected effective price 6190000, got %d", bestDeal.EffectivePrice)
	}
	if bestDeal.SavingVsMostExpensive != 200000 {
		t.Errorf("expected saving 200000, got %d", bestDeal.SavingVsMostExpensive)
	}
	if bestDeal.SavingPercent <= 0 {
		t.Errorf("expected positive saving percent, got %f", bestDeal.SavingPercent)
	}

	if !sources[2].IsBestDeal {
		t.Error("expected source[2] (tiktok) to have IsBestDeal = true")
	}
	if sources[0].IsBestDeal || sources[1].IsBestDeal {
		t.Error("expected other sources to have IsBestDeal = false")
	}
}

func TestIdentifyBestDeal_OutOfStockIgnored(t *testing.T) {
	sources := []SourcePrice{
		{
			SourceID:       uuid.New(),
			Platform:       "shopee",
			EffectivePrice: i64(5000000),
			InStock:        boolp(false), // cheaper but out of stock
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: i64(6000000),
			InStock:        boolp(true),
		},
	}

	bestDeal := IdentifyBestDeal(sources)
	if bestDeal == nil {
		t.Fatal("expected non-nil best deal")
	}

	if bestDeal.Platform != "lazada" {
		t.Errorf("expected lazada to win, got %s", bestDeal.Platform)
	}
	if bestDeal.EffectivePrice != 6000000 {
		t.Errorf("expected 6000000, got %d", bestDeal.EffectivePrice)
	}
	if sources[0].IsBestDeal {
		t.Error("out of stock source must not be marked as best deal")
	}
	if !sources[1].IsBestDeal {
		t.Error("in-stock source must be marked as best deal")
	}
}

func TestIdentifyBestDeal_AllOutOfStock(t *testing.T) {
	sources := []SourcePrice{
		{
			SourceID:       uuid.New(),
			Platform:       "shopee",
			EffectivePrice: i64(5000000),
			InStock:        boolp(false),
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: i64(6000000),
			InStock:        boolp(false),
		},
	}

	bestDeal := IdentifyBestDeal(sources)
	if bestDeal != nil {
		t.Fatalf("expected nil best deal when all are out of stock, got %+v", bestDeal)
	}
}

func TestIdentifyBestDeal_EmptySources(t *testing.T) {
	bestDeal := IdentifyBestDeal([]SourcePrice{})
	if bestDeal != nil {
		t.Fatalf("expected nil best deal for empty sources, got %+v", bestDeal)
	}
}

func TestIdentifyBestDeal_SingleSource(t *testing.T) {
	sources := []SourcePrice{
		{
			SourceID:       uuid.New(),
			Platform:       "shopee",
			EffectivePrice: i64(6290000),
			InStock:        boolp(true),
		},
	}

	bestDeal := IdentifyBestDeal(sources)
	if bestDeal == nil {
		t.Fatal("expected non-nil best deal for single in-stock source")
	}

	if bestDeal.Platform != "shopee" {
		t.Errorf("expected shopee, got %s", bestDeal.Platform)
	}
	if bestDeal.SavingVsMostExpensive != 0 {
		t.Errorf("expected 0 saving for single source, got %d", bestDeal.SavingVsMostExpensive)
	}
	if bestDeal.SavingPercent != 0.0 {
		t.Errorf("expected 0.0 saving percent, got %f", bestDeal.SavingPercent)
	}
	if !sources[0].IsBestDeal {
		t.Error("expected single source to have IsBestDeal = true")
	}
}

func TestIdentifyBestDeal_ZeroOrNegativePriceIgnored(t *testing.T) {
	sources := []SourcePrice{
		{
			SourceID:       uuid.New(),
			Platform:       "shopee",
			EffectivePrice: i64(0),
			InStock:        boolp(true),
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: i64(-1000),
			InStock:        boolp(true),
		},
		{
			SourceID:       uuid.New(),
			Platform:       "tiktok",
			EffectivePrice: i64(6190000),
			InStock:        boolp(true),
		},
	}

	bestDeal := IdentifyBestDeal(sources)
	if bestDeal == nil {
		t.Fatal("expected non-nil best deal")
	}
	if bestDeal.Platform != "tiktok" {
		t.Errorf("expected tiktok, got %s", bestDeal.Platform)
	}
}

func i64(v int64) *int64 { return &v }
func boolp(v bool) *bool { return &v }

// Unknown stock is not "out of stock"; an unknown price cannot compete.
func TestIdentifyBestDeal_UnknownValues(t *testing.T) {
	sources := []SourcePrice{
		{SourceID: uuid.New(), Platform: "shopee", EffectivePrice: nil, InStock: boolp(true)},
		{SourceID: uuid.New(), Platform: "lazada", EffectivePrice: i64(6000000), InStock: nil},
		{SourceID: uuid.New(), Platform: "tiktok", EffectivePrice: i64(5000000), InStock: boolp(false)},
	}

	bestDeal := IdentifyBestDeal(sources)
	if bestDeal == nil || bestDeal.Platform != "lazada" {
		t.Fatalf("expected lazada (stock unknown) to win, got %+v", bestDeal)
	}
	if sources[0].IsBestDeal || sources[2].IsBestDeal {
		t.Error("sources without price or out of stock must not be the best deal")
	}
}

// Item prices are compared with item prices: a known shipping fee on one source and an unknown one on
// another must not make the latter look cheaper.
func TestIdentifyBestDeal_MixedShippingKnowledge(t *testing.T) {
	sources := []SourcePrice{
		// Lazada: 980.000 + 30.000 shipping
		{SourceID: uuid.New(), Platform: "lazada", EffectivePrice: i64(1010000), ShippingFee: i64(30000)},
		// Shopee: 1.000.000, shipping unknown
		{SourceID: uuid.New(), Platform: "shopee", EffectivePrice: i64(1000000)},
	}
	best := IdentifyBestDeal(sources)
	if best == nil || best.Platform != "lazada" || best.EffectivePrice != 980000 || best.ShippingIncluded {
		t.Fatalf("expected lazada on item price 980000 without shipping, got %+v", best)
	}

	known := []SourcePrice{
		{SourceID: uuid.New(), Platform: "lazada", EffectivePrice: i64(1010000), ShippingFee: i64(30000)},
		{SourceID: uuid.New(), Platform: "shopee", EffectivePrice: i64(1000000), ShippingFee: i64(0)},
	}
	if best := IdentifyBestDeal(known); best == nil || best.Platform != "shopee" || !best.ShippingIncluded {
		t.Fatalf("with every fee known the total decides, got %+v", best)
	}
}
