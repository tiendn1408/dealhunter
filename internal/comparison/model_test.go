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
			EffectivePrice: 6290000,
			InStock:        true,
			CapturedAt:     &now,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: 6390000,
			InStock:        true,
			CapturedAt:     &now,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "tiktok",
			EffectivePrice: 6190000,
			InStock:        true,
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
			EffectivePrice: 5000000,
			InStock:        false, // cheaper but out of stock
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: 6000000,
			InStock:        true,
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
			EffectivePrice: 5000000,
			InStock:        false,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: 6000000,
			InStock:        false,
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
			EffectivePrice: 6290000,
			InStock:        true,
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
			EffectivePrice: 0,
			InStock:        true,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "lazada",
			EffectivePrice: -1000,
			InStock:        true,
		},
		{
			SourceID:       uuid.New(),
			Platform:       "tiktok",
			EffectivePrice: 6190000,
			InStock:        true,
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
