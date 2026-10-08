package marketplace

import (
	"context"
	"errors"

	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
)

// ErrProductUnavailable means the marketplace page/API could not be read (blocked, removed or changed).
// Adapters return it instead of substituting placeholder titles or previously stored prices.
var ErrProductUnavailable = errors.New("could not read product data from the marketplace")

type ProductData struct {
	ExternalProductID string
	CanonicalURL      string
	RawTitle          string
	SellerName        string
	Price             pricing.Price
}

type Marketplace interface {
	Name() string
	ResolveProduct(ctx context.Context, url string) (*ProductData, error)
	FetchPrice(ctx context.Context, source *product.ProductSource) (*pricing.PriceSnapshot, error)
}
