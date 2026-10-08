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
	client  *crawler.Client
	apiBase string // item API origin; tests point it at a local server so they never reach shopee.vn
}

const defaultShopeeAPIBase = "https://shopee.vn"

func NewShopeeAdapter() *ShopeeAdapter {
	c, _ := crawler.NewClient(crawler.ClientOptions{
		Timeout: 10 * time.Second,
	})
	return &ShopeeAdapter{
		client:  c,
		apiBase: defaultShopeeAPIBase,
	}
}

func (a *ShopeeAdapter) Name() string {
	return "shopee"
}

func (a *ShopeeAdapter) ResolveProduct(ctx context.Context, rawURL string) (*marketplace.ProductData, error) {
	var lastErr error // classified cause of the last failed request
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
		apiURL := fmt.Sprintf("%s/api/v4/item/get?itemid=%s&shopid=%s", a.apiBase, itemID, shopID)
		resp, err := a.client.Fetch(ctx, apiURL, map[string]string{
			"Referer": rawURL,
		})
		lastErr = err
		if err == nil && resp.StatusCode == 200 {
			var apiResp shopeeApiResponse
			if jsonErr := json.Unmarshal(resp.Body, &apiResp); jsonErr == nil && apiResp.Error == 0 && apiResp.Data.Name != "" &&
				(apiResp.Data.Price > 0 || apiResp.Data.PriceMin > 0) {
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
					// The item API exposes neither the shop name nor the shipping fee; leave them unknown
					Price: pricing.Price{
						ListedPrice: listedPrice,
						SalePrice:   price,
					},
				}, nil
			}
		}
	}

	// 2. Try HTML Crawler Extraction (OpenGraph / JSON-LD)
	resp, err := a.client.Fetch(ctx, rawURL, nil)
	lastErr = err
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

	return nil, marketplace.Unavailable("shopee", rawURL, lastErr)
}

func (a *ShopeeAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
	var lastErr error // classified cause of the last failed request
	targetURL := source.CanonicalURL

	// 1. Try API if item and shop IDs are parseable
	matches := shopeeItemPattern.FindStringSubmatch(targetURL)
	if len(matches) < 3 {
		matches = shopeeProductPathPattern.FindStringSubmatch(targetURL)
	}

	if len(matches) == 3 {
		shopID := matches[1]
		itemID := matches[2]
		apiURL := fmt.Sprintf("%s/api/v4/item/get?itemid=%s&shopid=%s", a.apiBase, itemID, shopID)
		resp, err := a.client.Fetch(ctx, apiURL, map[string]string{
			"Referer": targetURL,
		})
		lastErr = err
		if err == nil && resp.StatusCode == 200 {
			var apiResp shopeeApiResponse
			if jsonErr := json.Unmarshal(resp.Body, &apiResp); jsonErr == nil && apiResp.Error == 0 {
				price := apiResp.Data.Price / 100000
				if price <= 0 {
					price = apiResp.Data.PriceMin / 100000
				}
				if price > 0 {
					inStock := apiResp.Data.Stock > 0
					// The item API has no shipping fee, so it is recorded as unknown
					return &pricing.PriceSnapshot{
						ProductSourceID: source.ID,
						Price:           price,
						EffectivePrice:  price,
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
	lastErr = err
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

	return nil, marketplace.Unavailable("shopee price", targetURL, lastErr)
}
