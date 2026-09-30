package mock

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
)

type MockAdapter struct{}

func NewMockAdapter() *MockAdapter {
	return &MockAdapter{}
}

func (m *MockAdapter) Name() string {
	return "mock"
}

func (m *MockAdapter) ResolveProduct(ctx context.Context, rawURL string) (*marketplace.ProductData, error) {
	lower := strings.ToLower(rawURL)

	// Detect simulated platform tag if present in URL
	simPlatform := "mock"
	if strings.Contains(lower, "shopee") {
		simPlatform = "shopee"
	} else if strings.Contains(lower, "lazada") {
		simPlatform = "lazada"
	} else if strings.Contains(lower, "tiktok") {
		simPlatform = "tiktok"
	}

	slug := "item"
	parts := strings.Split(strings.TrimRight(rawURL, "/"), "/")
	if len(parts) > 0 && parts[len(parts)-1] != "" {
		slug = strings.Split(parts[len(parts)-1], "?")[0]
	}

	extID := fmt.Sprintf("mock-%s-%s", simPlatform, slug)
	title := fmt.Sprintf("Mock Product %s", strings.ReplaceAll(slug, "-", " "))
	seller := fmt.Sprintf("Mock %s Official", strings.ToUpper(simPlatform))
	price := int64(1200000)
	shipping := int64(15000)

	if strings.Contains(lower, "sony") || strings.Contains(lower, "wh1000") || strings.Contains(lower, "xm6") {
		title = "Tai nghe Sony WH-1000XM6"
		switch simPlatform {
		case "tiktok":
			price = 6190000
			shipping = 12000
		case "shopee":
			price = 6290000
			shipping = 15000
		case "lazada":
			price = 6390000
			shipping = 20000
		default:
			price = 6290000
			shipping = 15000
		}
	} else if strings.Contains(lower, "samsung") || strings.Contains(lower, "ssd") {
		title = "Ổ cứng SSD Samsung 2TB 990 Pro"
		switch simPlatform {
		case "tiktok":
			price = 2790000
		case "shopee":
			price = 2850000
		case "lazada":
			price = 2890000
		default:
			price = 2800000
		}
	} else if strings.Contains(lower, "iphone") {
		title = "Điện thoại iPhone 16 Pro Max 256GB"
		switch simPlatform {
		case "tiktok":
			price = 31990000
		case "shopee":
			price = 32190000
		case "lazada":
			price = 32290000
		default:
			price = 32000000
		}
	}

	return &marketplace.ProductData{
		ExternalProductID: extID,
		CanonicalURL:      rawURL,
		RawTitle:          title,
		SellerName:        seller,
		Price: pricing.Price{
			ListedPrice: price + int64(float64(price)*0.12),
			SalePrice:   price,
			ShippingFee: shipping,
		},
		InStock: true,
	}, nil
}

func (m *MockAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
	base := int64(1200000)
	if source.LastPrice != nil && *source.LastPrice > 0 {
		base = *source.LastPrice
	}

	// Fluctuation: +/- 3% around base price
	fluctuationPercent := float64(rand.Intn(7)-3) / 100.0
	currentPrice := base + int64(float64(base)*fluctuationPercent)
	if currentPrice <= 0 {
		currentPrice = base
	}

	shipping := int64(15000)
	if source.LastShippingFee != nil && *source.LastShippingFee >= 0 {
		shipping = *source.LastShippingFee
	}

	inStock := true
	return &pricing.PriceSnapshot{
		ProductSourceID: source.ID,
		Price:           currentPrice,
		ShippingFee:     shipping,
		EffectivePrice:  currentPrice + shipping,
		Currency:        "VND",
		InStock:         &inStock,
		CapturedAt:      time.Now(),
	}, nil
}
