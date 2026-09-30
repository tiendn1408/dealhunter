package matching

import (
	"testing"
)

func TestScoreMatch_HighConfidence(t *testing.T) {
	refTitle := "[Chính Hãng] Tai nghe Sony WH-1000XM5 Chống Ồn - Bảo hành 12T"
	candTitle := "Tai Nghe Chụp Tai Bluetooth Sony WH-1000XM5 Chính Hãng Sony VN"

	ref := NormalizeTitle(refTitle)
	refPrice := int64(6290000)
	candPrice := int64(6350000)
	candSeller := "Sony Official Store"
	isMall := true

	score := ScoreMatch(ref, refPrice, candTitle, candPrice, candSeller, isMall)

	if score < ThresholdAutoLink {
		t.Errorf("expected score >= %f for near identical product, got %f", ThresholdAutoLink, score)
	}
}

func TestScoreMatch_MediumConfidenceSuggestion(t *testing.T) {
	refTitle := "Chuột Logitech MX Master 3S Wireless"
	candTitle := "Chuột Không Dây Logitech MX Master 3S Bluetooth / Wireless Edition"

	ref := NormalizeTitle(refTitle)
	refPrice := int64(1890000)
	candPrice := int64(2290000) // ~21% higher price
	candSeller := "Shop Tin Học Gia Huy"
	isMall := false

	score := ScoreMatch(ref, refPrice, candTitle, candPrice, candSeller, isMall)

	if score < ThresholdSuggestion || score >= ThresholdAutoLink {
		t.Errorf("expected score in suggestion range [%f, %f), got %f", ThresholdSuggestion, ThresholdAutoLink, score)
	}
}

func TestScoreMatch_ModelMismatchPenalty(t *testing.T) {
	refTitle := "Tai nghe Sony WH-1000XM5"
	candTitle := "Tai nghe Sony WH-1000XM4" // XM4 instead of XM5!

	ref := NormalizeTitle(refTitle)
	refPrice := int64(6290000)
	candPrice := int64(4500000)
	candSeller := "Sony Official Store"
	isMall := true

	score := ScoreMatch(ref, refPrice, candTitle, candPrice, candSeller, isMall)

	if score >= ThresholdSuggestion {
		t.Errorf("expected score < %f for different models (XM5 vs XM4), got %f", ThresholdSuggestion, score)
	}
}

func TestScoreMatch_PriceTooFarApart(t *testing.T) {
	refTitle := "Màn Hình Dell UltraSharp U2723QE 4K"
	candTitle := "Miếng dán màn hình Dell UltraSharp U2723QE" // Accessory, cheap price

	ref := NormalizeTitle(refTitle)
	refPrice := int64(12590000)
	candPrice := int64(150000) // 150k vs 12.59M
	candSeller := "Phụ Kiện Số"
	isMall := false

	score := ScoreMatch(ref, refPrice, candTitle, candPrice, candSeller, isMall)

	if score >= ThresholdSuggestion {
		t.Errorf("expected score < %f for accessory with drastic price difference, got %f", ThresholdSuggestion, score)
	}
}
