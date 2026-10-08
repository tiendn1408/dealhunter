package lazada

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

var lazadaItemPattern = regexp.MustCompile(`-i(\d+)`)

// LazadaAdapter handles product ingestion and price scraping for Lazada Vietnam.
type LazadaAdapter struct {
	client *crawler.Client
}

func NewLazadaAdapter() *LazadaAdapter {
	c, _ := crawler.NewClient(crawler.ClientOptions{
		Timeout: 10 * time.Second,
	})
	return &LazadaAdapter{
		client: c,
	}
}

func (a *LazadaAdapter) Name() string {
	return "lazada"
}

func (a *LazadaAdapter) ResolveProduct(ctx context.Context, rawURL string) (*marketplace.ProductData, error) {
	// Expand shortlinks if necessary
	if strings.Contains(rawURL, "s.lazada.vn") {
		resolved, err := a.client.ResolveFinalURL(ctx, rawURL)
		if err == nil && resolved != "" {
			rawURL = resolved
		}
	}

	if !strings.Contains(rawURL, "lazada.vn") && !strings.Contains(rawURL, "lazada") {
		return nil, fmt.Errorf("invalid lazada url: %s", rawURL)
	}

	matches := lazadaItemPattern.FindStringSubmatch(rawURL)
	extID := ""
	if len(matches) == 2 {
		extID = fmt.Sprintf("lazada-%s", matches[1])
	} else {
		parts := strings.Split(strings.TrimRight(rawURL, "/"), "/")
		last := parts[len(parts)-1]
		clean := strings.Split(last, "?")[0]
		clean = strings.TrimSuffix(clean, ".html")
		extID = fmt.Sprintf("lazada-%s", clean)
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
				},
			}, nil
		}
	}

	return nil, fmt.Errorf("%w: lazada %s", marketplace.ErrProductUnavailable, rawURL)
}

func (a *LazadaAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
	targetURL := source.CanonicalURL

	// 1. Try HTML crawl
	resp, err := a.client.Fetch(ctx, targetURL, nil)
	if err == nil && len(resp.Body) > 0 {
		extracted, extractErr := crawler.ExtractFromHTML(resp.Body, targetURL)
		if extractErr == nil && extracted.Price > 0 {
			return &pricing.PriceSnapshot{
				ProductSourceID: source.ID,
				Price:           extracted.Price,
				ShippingFee:     extracted.ShippingFee,
				EffectivePrice:  pricing.EffectivePriceOf(extracted.Price, extracted.ShippingFee),
				Currency:        extracted.Currency,
				InStock:         extracted.InStock,
				CapturedAt:      time.Now(),
			}, nil
		}
	}

	return nil, fmt.Errorf("%w: lazada price %s", marketplace.ErrProductUnavailable, targetURL)
}
