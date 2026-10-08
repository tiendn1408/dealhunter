package affiliate

import (
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// Config defines the configuration for the affiliate link generator.
type Config struct {
	Enabled             bool
	ShopeeID            string
	ShopeeTemplate      string
	LazadaID            string
	LazadaTemplate      string
	TikTokID            string
	TikTokTemplate      string
	AccessTradeTemplate string
}

// LinkTransformer transforms regular product URLs into monetized affiliate URLs.
type LinkTransformer interface {
	Transform(rawURL, platform, subID string) string
}

// Transformer implements LinkTransformer.
type Transformer struct {
	cfg Config
}

// NewTransformer creates a new Transformer with the given configuration.
func NewTransformer(cfg Config) *Transformer {
	return &Transformer{cfg: cfg}
}

// Transform converts a regular marketplace URL into an affiliate link with sub_id tracking.
// If affiliate tracking is disabled or no suitable template is found, the original URL is returned intact.
func (t *Transformer) Transform(rawURL, platform, subID string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || !t.cfg.Enabled {
		return rawURL
	}

	normPlatform := strings.ToLower(strings.TrimSpace(platform))
	if normPlatform == "" {
		normPlatform = detectPlatform(rawURL)
	}

	var template string
	var affID string

	switch normPlatform {
	case "shopee":
		template = t.cfg.ShopeeTemplate
		affID = t.cfg.ShopeeID
	case "lazada":
		template = t.cfg.LazadaTemplate
		affID = t.cfg.LazadaID
	case "tiktok":
		template = t.cfg.TikTokTemplate
		affID = t.cfg.TikTokID
	default:
		switch detectPlatform(rawURL) {
		case "shopee":
			template = t.cfg.ShopeeTemplate
			affID = t.cfg.ShopeeID
		case "lazada":
			template = t.cfg.LazadaTemplate
			affID = t.cfg.LazadaID
		case "tiktok":
			template = t.cfg.TikTokTemplate
			affID = t.cfg.TikTokID
		}
	}

	// A platform template is only usable with a real affiliate ID; otherwise keep the canonical link
	if affID == "" {
		template = ""
	}

	// AccessTrade deeplinks embed the publisher ID in the template and must carry the target URL
	if template == "" && strings.Contains(t.cfg.AccessTradeTemplate, "{URL}") {
		template = t.cfg.AccessTradeTemplate
	}

	// A template that does not carry the product URL would send every product to the same page
	if template == "" || !(strings.Contains(template, "{URL}") || strings.Contains(template, "{RAW_URL}")) {
		return rawURL
	}

	encodedURL := url.QueryEscape(rawURL)
	encodedSubID := url.QueryEscape(subID)

	res := template
	res = strings.ReplaceAll(res, "{URL}", encodedURL)
	res = strings.ReplaceAll(res, "{RAW_URL}", rawURL)
	res = strings.ReplaceAll(res, "{SUB_ID}", encodedSubID)
	res = strings.ReplaceAll(res, "{AFFILIATE_ID}", affID)

	return res
}

// FormatSubID formats a standard subID for tracking conversions per user and product.
func FormatSubID(userID, productID uuid.UUID) string {
	userPart := "guest"
	if userID != uuid.Nil {
		userPart = "u_" + userID.String()[:8]
	}

	prodPart := "all"
	if productID != uuid.Nil {
		prodPart = "p_" + productID.String()[:8]
	}

	return userPart + "_" + prodPart
}

func detectPlatform(rawURL string) string {
	low := strings.ToLower(rawURL)
	if strings.Contains(low, "shopee") {
		return "shopee"
	}
	if strings.Contains(low, "lazada") {
		return "lazada"
	}
	if strings.Contains(low, "tiktok") {
		return "tiktok"
	}
	return ""
}
