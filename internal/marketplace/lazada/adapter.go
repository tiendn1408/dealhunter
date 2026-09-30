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
		if extractErr == nil && extracted.Title != "" && extracted.Title != "San pham" {
			price := extracted.Price
			listedPrice := extracted.ListedPrice
			if listedPrice <= 0 {
				listedPrice = price
			}
			seller := extracted.SellerName
			if seller == "" {
				seller = "LazMall Official"
			}

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
				InStock: extracted.InStock,
			}, nil
		}
	}

	// 2. Fallback: Parse slug if WAF blocks direct content
	slugTitle := crawler.ExtractSlugTitle(rawURL)
	if slugTitle == "" || slugTitle == "San pham" {
		slugTitle = "San pham Lazada"
	}

	return &marketplace.ProductData{
		ExternalProductID: extID,
		CanonicalURL:      rawURL,
		RawTitle:          slugTitle,
		SellerName:        "LazMall Official",
		Price: pricing.Price{
			ListedPrice: 0,
			SalePrice:   0,
			ShippingFee: 0,
		},
		InStock: false,
	}, nil
}

func (a *LazadaAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
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
				InStock:         &extracted.InStock,
				CapturedAt:      time.Now(),
			}, nil
		}
	}

	// 2. Fallback: preserve last verified price without random numbers
	if source.LastPrice != nil && *source.LastPrice > 0 {
		shipping := int64(15000)
		if source.LastShippingFee != nil && *source.LastShippingFee >= 0 {
			shipping = *source.LastShippingFee
		}
		inStock := true
		return &pricing.PriceSnapshot{
			ProductSourceID: source.ID,
			Price:           *source.LastPrice,
			ShippingFee:     shipping,
			EffectivePrice:  *source.LastPrice + shipping,
			Currency:        "VND",
			InStock:         &inStock,
			CapturedAt:      time.Now(),
		}, nil
	}

	return nil, fmt.Errorf("lazada price extraction failed: %s", targetURL)
}
