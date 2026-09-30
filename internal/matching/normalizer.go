package matching

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	// Bracketed promotional tags like [Chính Hãng], (Bảo hành 12T), 【Freeship】
	bracketRegex = regexp.MustCompile(`(?i)\[.*?\]|\(.*?\)|【.*?】|\{.*?\}`)

	// Warranty expressions: "Bảo hành 12 tháng", "BH 2 năm", "BH 12T"
	warrantyRegex = regexp.MustCompile(`(?i)\b(bảo hành|bh)\s*\d+\s*(tháng|thang|năm|nam|t)\b`)

	// Common e-commerce noise words in Vietnamese and English
	noiseWords = []string{
		"chính hãng", "chinh hang", "hàng chính hãng", "hang chinh hang",
		"chính thức", "chinh thuc", "official", "authentic", "auth 100%",
		"freeship extra", "freeship", "miễn phí vận chuyển", "mien phi van chuyen",
		"giao hỏa tốc", "giao hoa toc", "giao nhanh 2h", "hỏa tốc 2h",
		"sale sốc", "sale soc", "giá rẻ", "gia re", "giảm giá", "giam gia",
		"siêu rẻ", "sieu re", "hot deal", "flash sale", "deal sốc",
		"fullbox", "new seal", "mới 100%", "moi 100%", "nguyên seal",
		"cao cấp", "cao cap", "nhập khẩu", "nhap khau",
		"quà tặng", "qua tang", "tặng kèm", "tang kem",
	}

	// Model code pattern: Alphanumeric codes with digits and letters (e.g. WH-1000XM5, MOD007, U2723QE, 3S)
	modelCodeRegex = regexp.MustCompile(`(?i)\b[a-z]{1,4}[-_]?[0-9]{1,5}[a-z0-9-_]*\b|\b[a-z]+[0-9]+[a-z0-9]*\b|\b[0-9]+[a-z]+[a-z0-9-_]*\b`)

	// Punctuation and special symbols to strip
	punctRegex = regexp.MustCompile(`[|/\-_+•~,.:;!?"'@#$%^&*()\[\]{}<>]`)
)

// NormalizedProduct contains processed title, detected model, and search query tokens.
type NormalizedProduct struct {
	OriginalTitle string   `json:"original_title"`
	CleanTitle    string   `json:"clean_title"`
	SearchQuery   string   `json:"search_query"`
	ModelCodes    []string `json:"model_codes"`
	Tokens        []string `json:"tokens"`
}

// NormalizeTitle processes a raw product title into a cleaned, noise-free representation.
func NormalizeTitle(rawTitle string) *NormalizedProduct {
	if rawTitle == "" {
		return &NormalizedProduct{
			Tokens:     []string{},
			ModelCodes: []string{},
		}
	}

	// 1. Remove bracketed text: [Chính Hãng] -> ""
	text := bracketRegex.ReplaceAllString(rawTitle, " ")

	// 2. Remove warranty mentions
	text = warrantyRegex.ReplaceAllString(text, " ")

	// 3. Lowercase for noise word replacement
	lower := strings.ToLower(text)
	for _, noise := range noiseWords {
		lower = strings.ReplaceAll(lower, noise, " ")
	}

	// 4. Extract model codes from the lowercased text before punctuation stripping
	foundModels := extractModelCodes(lower)

	// 5. Strip punctuation, preserving alphanumeric characters and spaces
	cleaned := punctRegex.ReplaceAllString(lower, " ")

	// 6. Tokenize and filter out short/stop words
	rawTokens := strings.Fields(cleaned)
	tokens := make([]string, 0, len(rawTokens))
	seen := make(map[string]bool)

	for _, token := range rawTokens {
		token = strings.TrimSpace(token)
		if len(token) <= 1 && !isDigitOnly(token) {
			continue
		}
		if !seen[token] {
			seen[token] = true
			tokens = append(tokens, token)
		}
	}

	cleanTitle := strings.Join(tokens, " ")

	// 7. Build high-precision SearchQuery (first 4-6 significant tokens, prioritizing model codes)
	searchQuery := buildSearchQuery(tokens, foundModels)

	return &NormalizedProduct{
		OriginalTitle: rawTitle,
		CleanTitle:    cleanTitle,
		SearchQuery:   searchQuery,
		ModelCodes:    foundModels,
		Tokens:        tokens,
	}
}

func extractModelCodes(text string) []string {
	matches := modelCodeRegex.FindAllString(text, -1)
	models := make([]string, 0, len(matches))
	seen := make(map[string]bool)

	for _, m := range matches {
		clean := strings.ToLower(strings.TrimSpace(m))
		// Ignore pure digit numbers like "2024", "100"
		if isDigitOnly(clean) || len(clean) < 2 {
			continue
		}
		// If length is 2, ensure it has both digit and letter (e.g. 3s, x5, a3)
		if len(clean) == 2 {
			hasDigit := false
			hasLetter := false
			for _, r := range clean {
				if unicode.IsDigit(r) {
					hasDigit = true
				}
				if unicode.IsLetter(r) {
					hasLetter = true
				}
			}
			if !hasDigit || !hasLetter {
				continue
			}
		}
		if !seen[clean] {
			seen[clean] = true
			models = append(models, clean)
		}
	}
	return models
}

func buildSearchQuery(tokens []string, models []string) string {
	if len(tokens) == 0 {
		return ""
	}

	// If model codes were extracted, ensure they are placed prominently
	queryParts := make([]string, 0, 5)
	used := make(map[string]bool)

	for _, model := range models {
		if !used[model] {
			queryParts = append(queryParts, model)
			used[model] = true
		}
	}

	for _, token := range tokens {
		if len(queryParts) >= 5 {
			break
		}
		if !used[token] {
			queryParts = append(queryParts, token)
			used[token] = true
		}
	}

	return strings.Join(queryParts, " ")
}

func isDigitOnly(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}
