package marketplace

import (
	"context"
	"errors"
	"fmt"

	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/pkg/retry"
)

// ErrProductUnavailable means the marketplace page/API could not be read (blocked, removed or changed).
// Adapters return it instead of substituting placeholder titles or previously stored prices.
var ErrProductUnavailable = errors.New("could not read product data from the marketplace")

// Unavailable reports that a marketplace page or API could not be read. It matches ErrProductUnavailable
// and keeps the classified cause (retry.MarketplaceError) so the worker can tell a temporary block from
// a removed product; a page that loaded without product data counts as unreadable.
func Unavailable(what, url string, cause error) error {
	if cause == nil {
		cause = retry.Unreadable()
	}
	return fmt.Errorf("%w: %s %s: %w", ErrProductUnavailable, what, url, cause)
}

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
