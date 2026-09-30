package matching

import (
	"math"
	"strings"
)

// Weights for composite matching score
const (
	WeightTextSimilarity = 0.50
	WeightPriceProximity = 0.30
	WeightShopTrust      = 0.20
)

// ScoreMatch calculates a composite confidence score [0.0, 1.0] between a reference product and a candidate.
func ScoreMatch(ref *NormalizedProduct, refPrice int64, candTitle string, candPrice int64, candSeller string, isMall bool) float64 {
	candNorm := NormalizeTitle(candTitle)

	// 1. Text Similarity Score (Weight 50%)
	textScore := calculateTextSimilarity(ref, candNorm)

	// 2. Price Proximity Score (Weight 30%)
	priceScore := calculatePriceProximity(refPrice, candPrice)

	// 3. Shop Trust Score (Weight 20%)
	trustScore := calculateShopTrust(candSeller, isMall)

	// 4. Model Code Verification:
	// If both products have detected model codes (e.g. WH-1000XM5, MOD007),
	// reward confirmed model overlap, and heavily penalize model conflicts (e.g. XM4 vs XM5).
	if len(ref.ModelCodes) > 0 && len(candNorm.ModelCodes) > 0 {
		hasModelOverlap := false
		for _, rm := range ref.ModelCodes {
			for _, cm := range candNorm.ModelCodes {
				if rm == cm || strings.Contains(rm, cm) || strings.Contains(cm, rm) {
					hasModelOverlap = true
					break
				}
			}
			if hasModelOverlap {
				break
			}
		}
		if hasModelOverlap {
			// Confirmed model match: boost text score
			textScore = math.Min(1.0, math.Max(textScore, 0.75)+0.15)
		} else {
			// Different model variants (e.g. XM4 vs XM5)
			textScore *= 0.25
		}
	}

	composite := (textScore * WeightTextSimilarity) +
		(priceScore * WeightPriceProximity) +
		(trustScore * WeightShopTrust)

	// Ensure score is clamped to [0.0, 1.0]
	if composite < 0.0 {
		return 0.0
	}
	if composite > 1.0 {
		return 1.0
	}
	return math.Round(composite*100) / 100
}

func calculateTextSimilarity(ref, cand *NormalizedProduct) float64 {
	if len(ref.Tokens) == 0 || len(cand.Tokens) == 0 {
		return 0.0
	}

	refSet := make(map[string]bool, len(ref.Tokens))
	for _, t := range ref.Tokens {
		refSet[t] = true
	}

	candSet := make(map[string]bool, len(cand.Tokens))
	for _, t := range cand.Tokens {
		candSet[t] = true
	}

	// Jaccard similarity: |Intersection| / |Union|
	intersection := 0
	for t := range refSet {
		if candSet[t] {
			intersection++
		}
	}

	union := len(refSet) + len(candSet) - intersection
	if union == 0 {
		return 0.0
	}

	jaccard := float64(intersection) / float64(union)

	// Containment bonus: if all or most reference tokens appear in candidate
	containment := float64(intersection) / float64(len(refSet))

	// Combined text score
	return (jaccard * 0.6) + (containment * 0.4)
}

func calculatePriceProximity(refPrice, candPrice int64) float64 {
	// If either price is unavailable/0, return neutral score (0.5)
	if refPrice <= 0 || candPrice <= 0 {
		return 0.5
	}

	minP := float64(refPrice)
	maxP := float64(candPrice)
	if minP > maxP {
		minP, maxP = maxP, minP
	}

	diffRatio := (maxP - minP) / minP // relative price difference

	// Within 15% price difference -> perfect score 1.0
	if diffRatio <= 0.15 {
		return 1.0
	}

	// Between 15% and 40% -> linear degradation from 1.0 to 0.4
	if diffRatio <= 0.40 {
		return 1.0 - ((diffRatio - 0.15) / 0.25 * 0.6)
	}

	// Between 40% and 70% -> degradation to 0.1
	if diffRatio <= 0.70 {
		return 0.4 - ((diffRatio - 0.40) / 0.30 * 0.3)
	}

	// More than 70% price difference is likely a totally different product or accessory
	return 0.0
}

func calculateShopTrust(sellerName string, isMall bool) float64 {
	if isMall {
		return 1.0
	}

	lower := strings.ToLower(sellerName)
	if strings.Contains(lower, "official") ||
		strings.Contains(lower, "flagship") ||
		strings.Contains(lower, "mall") ||
		strings.Contains(lower, "chính hãng") ||
		strings.Contains(lower, "authorized") {
		return 0.9
	}

	if sellerName != "" {
		return 0.6
	}

	return 0.5
}
