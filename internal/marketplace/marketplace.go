package marketplace

import (
	"context"

	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
)

type ProductData struct {
	ExternalProductID string
	CanonicalURL      string
	RawTitle          string
	SellerName        string
	Price             pricing.Price
	InStock           bool
}

type Marketplace interface {
	Name() string
	ResolveProduct(ctx context.Context, url string) (*ProductData, error)
	FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error)
}
