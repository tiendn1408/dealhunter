package comparison

import (
	"context"

	"github.com/google/uuid"
)

// ComparisonCache provides caching operations for multi-platform comparison results.
type ComparisonCache interface {
	// Get retrieves a cached ComparisonResult. Returns (nil, nil) on cache miss.
	Get(ctx context.Context, productID uuid.UUID) (*ComparisonResult, error)

	// Set stores a ComparisonResult in cache with a TTL.
	Set(ctx context.Context, productID uuid.UUID, result *ComparisonResult) error

	// Invalidate removes the cached comparison result for a product.
	Invalidate(ctx context.Context, productID uuid.UUID) error
}
