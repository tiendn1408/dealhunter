package mock

import (
	"context"
	"math/rand"
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

func (m *MockAdapter) ResolveProduct(ctx context.Context, url string) (*marketplace.ProductData, error) {
	return &marketplace.ProductData{
		ExternalProductID: "mock-12345",
		CanonicalURL:      url,
		RawTitle:          "Mock Product 123",
		SellerName:        "Mock Store",
		Price: pricing.Price{
			ListedPrice: 1500000,
			SalePrice:   1200000,
			ShippingFee: 15000,
		},
		InStock: true,
	}, nil
}

func (m *MockAdapter) FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error) {
	// Simulate some random price fluctuation for testing
	base := int64(1200000)
	fluctuation := int64((rand.Intn(20) - 10) * 10000) // -100k to +100k
	currentPrice := base + fluctuation

	return &pricing.PriceSnapshot{
		ProductSourceID: source.ID,
		Price:           currentPrice,
		ShippingFee:     15000,
		EffectivePrice:  currentPrice + 15000,
		Currency:        "VND",
		InStock:         boolPtr(true),
		CapturedAt:      time.Now(),
	}, nil
}

func boolPtr(b bool) *bool { return &b }
