package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TrackedProduct represents a user's tracking of a product source.
type TrackedProduct struct {
	ID                     uuid.UUID
	UserID                 uuid.UUID
	ProductSourceID        uuid.UUID
	Active                 bool
	PollingIntervalSeconds int
	NextFetchAt            time.Time
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// TrackingRepository defines persistence operations for tracked products.
type TrackingRepository interface {
	CreateTracking(ctx context.Context, t *TrackedProduct) error
	GetTracking(ctx context.Context, id uuid.UUID) (*TrackedProduct, error)
	ListTrackingsByUser(ctx context.Context, userID uuid.UUID) ([]*TrackedProduct, error)
	UpdateNextFetchAt(ctx context.Context, tx pgx.Tx, id uuid.UUID, nextFetch time.Time) error
	ClaimDueTrackings(ctx context.Context, limit int) ([]*TrackedProduct, error)
}
