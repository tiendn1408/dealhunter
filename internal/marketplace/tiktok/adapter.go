package tiktok

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/crawler"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
)

var tiktokProductPattern = regexp.MustCompile(`product/(\d+)`)

// TikTokAdapter handles product ingestion and price scraping for TikTok Shop Vietnam.
type TikTokAdapter struct {
	client *crawler.Client
}

func NewTikTokAdapter() *TikTokAdapter {
	c, _ := crawler.NewClient(crawler.ClientOptions{
		Timeout: 10 * time.Second,
	})
	return &TikTokAdapter{
		client: c,
	}
}

func (a *TikTokAdapter) Name() string {
	return "tiktok"
}

func (a *TikTokAdapter) ResolveProduct(ctx context.Context, rawURL string) (*marketplace.ProductData, error) {
	// Expand shortlinks if necessary
	if strings.Contains(rawURL, "vt.tiktok.com") {
		resolved, err := a.client.ResolveFinalURL(ctx, rawURL)
		if err == nil && resolved != "" {
			rawURL = resolved
		}
	}

	if !strings.Contains(rawURL, "tiktok.com") && !strings.Contains(rawURL, "tiktok") {
		return nil, fmt.Errorf("invalid tiktok url: %s", rawURL)
	}

	matches := tiktokProductPattern.FindStringSubmatch(rawURL)
	extID := ""
	if len(matches) == 2 {
		extID = fmt.Sprintf("tiktok-%s", matches[1])
	} else {
		parts := strings.Split(strings.TrimRight(rawURL, "/"), "/")
		last := parts[len(parts)-1]
		clean := strings.Split(last, "?")[0]
		extID = fmt.Sprintf("tiktok-%s", clean)
	}

	// 1. Try HTML Crawler Extraction (OpenGraph / JSON-LD)
	resp, err := a.client.Fetch(ctx, rawURL, nil)
	if err == nil && len(resp.Body) > 0 {
		extracted, extractErr := crawler.ExtractFromHTML(resp.Body, rawURL)
		if extractErr == nil && extracted.Title != "" && extracted.Price > 0 {
			// A real product page states both a title and a price; challenge/error pages only have a <title>
			price := extracted.Price
			listedPrice := extracted.ListedPrice
			if listedPrice <= 0 {
				listedPrice = price
			}
			seller := extracted.SellerName // empty when the page does not state it

			return &marketplace.ProductData{
				ExternalProductID: extID,
				CanonicalURL:      rawURL,
				RawTitle:          extracted.Title,
				SellerName:        seller,
				Price: pricing.Price{
					ListedPrice: listedPrice,
					SalePrice:   price,
					ShippingFee: extracted.ShippingFee,
				},
				InStock: extracted.InStock != nil && *extracted.InStock,
			}, nil
		}
	}

	return nil, fmt.Errorf("%w: tiktok %s", marketplace.ErrProductUnavailable, rawURL)
}

func (a *TikTokAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
	targetURL := source.CanonicalURL

	// 1. Try HTML crawl
	resp, err := a.client.Fetch(ctx, targetURL, nil)
	if err == nil && len(resp.Body) > 0 {
		extracted, extractErr := crawler.ExtractFromHTML(resp.Body, targetURL)
		if extractErr == nil && extracted.Price > 0 {
			shipping := extracted.ShippingFee
			if shipping <= 0 && source.LastShippingFee != nil {
				shipping = *source.LastShippingFee
			}
			return &pricing.PriceSnapshot{
				ProductSourceID: source.ID,
				Price:           extracted.Price,
				ShippingFee:     shipping,
				EffectivePrice:  extracted.Price + shipping,
				Currency:        extracted.Currency,
				InStock:         extracted.InStock,
				CapturedAt:      time.Now(),
			}, nil
		}
	}

	return nil, fmt.Errorf("%w: tiktok price %s", marketplace.ErrProductUnavailable, targetURL)
}
