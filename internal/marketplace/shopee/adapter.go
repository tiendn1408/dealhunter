package shopee

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/crawler"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
)

var (
	shopeeItemPattern        = regexp.MustCompile(`i\.(\d+)\.(\d+)`)
	shopeeProductPathPattern = regexp.MustCompile(`/product/(\d+)/(\d+)`)
)

type shopeeApiResponse struct {
	Error int `json:"error"`
	Data  struct {
		Name                string `json:"name"`
		Price               int64  `json:"price"`
		PriceMin            int64  `json:"price_min"`
		PriceBeforeDiscount int64  `json:"price_before_discount"`
		Stock               int    `json:"stock"`
		HistoricalSold      int    `json:"historical_sold"`
		ShopLocation        string `json:"shop_location"`
	} `json:"data"`
}

// ShopeeAdapter handles real product ingestion and price scraping for Shopee Vietnam.
type ShopeeAdapter struct {
	client *crawler.Client
}

func NewShopeeAdapter() *ShopeeAdapter {
	c, _ := crawler.NewClient(crawler.ClientOptions{
		Timeout: 10 * time.Second,
	})
	return &ShopeeAdapter{
		client: c,
	}
}

func (a *ShopeeAdapter) Name() string {
	return "shopee"
}

func (a *ShopeeAdapter) ResolveProduct(ctx context.Context, rawURL string) (*marketplace.ProductData, error) {
	// Expand shortlinks if necessary
	if strings.Contains(rawURL, "s.shopee.vn") {
		resolved, err := a.client.ResolveFinalURL(ctx, rawURL)
		if err == nil && resolved != "" {
			rawURL = resolved
		}
	}

	if !strings.Contains(rawURL, "shopee.vn") && !strings.Contains(rawURL, "shopee") {
		return nil, fmt.Errorf("invalid shopee url: %s", rawURL)
	}

	var shopID, itemID, extID string
	matches := shopeeItemPattern.FindStringSubmatch(rawURL)
	if len(matches) == 3 {
		shopID = matches[1]
		itemID = matches[2]
		extID = fmt.Sprintf("shopee-%s-%s", shopID, itemID)
	} else {
		matchesPath := shopeeProductPathPattern.FindStringSubmatch(rawURL)
		if len(matchesPath) == 3 {
			shopID = matchesPath[1]
			itemID = matchesPath[2]
			extID = fmt.Sprintf("shopee-%s-%s", shopID, itemID)
		} else {
			parts := strings.Split(strings.TrimRight(rawURL, "/"), "/")
			last := parts[len(parts)-1]
			clean := strings.Split(last, "?")[0]
			extID = fmt.Sprintf("shopee-%s", clean)
		}
	}

	// 1. Try Direct Shopee API
	if shopID != "" && itemID != "" {
		apiURL := fmt.Sprintf("https://shopee.vn/api/v4/item/get?itemid=%s&shopid=%s", itemID, shopID)
		resp, err := a.client.Fetch(ctx, apiURL, map[string]string{
			"Referer": rawURL,
		})
		if err == nil && resp.StatusCode == 200 {
			var apiResp shopeeApiResponse
			if jsonErr := json.Unmarshal(resp.Body, &apiResp); jsonErr == nil && apiResp.Error == 0 && apiResp.Data.Name != "" {
				price := apiResp.Data.Price / 100000
				if price <= 0 {
					price = apiResp.Data.PriceMin / 100000
				}
				listedPrice := apiResp.Data.PriceBeforeDiscount / 100000
				if listedPrice <= 0 {
					listedPrice = price
				}

				return &marketplace.ProductData{
					ExternalProductID: extID,
					CanonicalURL:      rawURL,
					RawTitle:          crawler.CleanTitle(apiResp.Data.Name),
					SellerName:        "Shopee Shop",
					Price: pricing.Price{
						ListedPrice: listedPrice,
						SalePrice:   price,
						ShippingFee: 15000,
					},
					InStock: apiResp.Data.Stock > 0,
				}, nil
			}
		}
	}

	// 2. Try HTML Crawler Extraction (OpenGraph / JSON-LD)
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
				seller = "Shopee Seller"
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

	// 3. Fallback: Parse slug when anti-bot prevents direct content extraction
	slugTitle := crawler.ExtractSlugTitle(rawURL)
	if slugTitle == "" || slugTitle == "San pham" {
		slugTitle = "San pham Shopee"
	}

	return &marketplace.ProductData{
		ExternalProductID: extID,
		CanonicalURL:      rawURL,
		RawTitle:          slugTitle,
		SellerName:        "Shopee Official",
		Price: pricing.Price{
			ListedPrice: 0,
			SalePrice:   0,
			ShippingFee: 0,
		},
		InStock: false,
	}, nil
}

func (a *ShopeeAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
	targetURL := source.CanonicalURL

	// 1. Try API if item and shop IDs are parseable
	matches := shopeeItemPattern.FindStringSubmatch(targetURL)
	if len(matches) < 3 {
		matches = shopeeProductPathPattern.FindStringSubmatch(targetURL)
	}

	if len(matches) == 3 {
		shopID := matches[1]
		itemID := matches[2]
		apiURL := fmt.Sprintf("https://shopee.vn/api/v4/item/get?itemid=%s&shopid=%s", itemID, shopID)
		resp, err := a.client.Fetch(ctx, apiURL, map[string]string{
			"Referer": targetURL,
		})
		if err == nil && resp.StatusCode == 200 {
			var apiResp shopeeApiResponse
			if jsonErr := json.Unmarshal(resp.Body, &apiResp); jsonErr == nil && apiResp.Error == 0 {
				price := apiResp.Data.Price / 100000
				if price <= 0 {
					price = apiResp.Data.PriceMin / 100000
				}
				if price > 0 {
					inStock := apiResp.Data.Stock > 0
					shipping := int64(15000)
					if source.LastShippingFee != nil && *source.LastShippingFee >= 0 {
						shipping = *source.LastShippingFee
					}
					return &pricing.PriceSnapshot{
						ProductSourceID: source.ID,
						Price:           price,
						ShippingFee:     shipping,
						EffectivePrice:  price + shipping,
						Currency:        "VND",
						InStock:         &inStock,
						CapturedAt:      time.Now(),
					}, nil
				}
			}
		}
	}

	// 2. Try HTML crawl
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

	// 3. Fallback: preserve last verified price without random numbers
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

	return nil, fmt.Errorf("shopee price extraction failed: %s", targetURL)
}
