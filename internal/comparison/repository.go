package comparison

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ComparisonRepository defines persistence operations for multi-platform price comparison.
type ComparisonRepository interface {
	// GetSourcesByProductID returns the canonical product title and current source prices.
	GetSourcesByProductID(ctx context.Context, productID uuid.UUID) (string, []SourcePrice, error)

	// UpsertComparisonSnapshot persists latest computed comparison results into comparison_snapshots.
	UpsertComparisonSnapshot(ctx context.Context, productID uuid.UUID, sources []SourcePrice) error

	// GetUserMultiSourceProducts returns products tracked by a user that have 2 or more sources.
	GetUserMultiSourceProducts(ctx context.Context, userID uuid.UUID) ([]ProductGroupSummary, error)

	// GetSnapshotAge returns the latest refreshed_at timestamp for a product's snapshot.
	GetSnapshotAge(ctx context.Context, productID uuid.UUID) (*time.Time, error)

	// GetAllMultiSourceProductIDs returns all product IDs that have 2 or more active sources.
	GetAllMultiSourceProductIDs(ctx context.Context) ([]uuid.UUID, error)

	// ProductExists checks if a product with the given ID exists.
	ProductExists(ctx context.Context, productID uuid.UUID) (bool, error)
}
