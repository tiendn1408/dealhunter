package domain

import (
	"context"
	"errors"
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
	IsPrimary              bool
}

// TrackingRepository defines persistence operations for tracked products.
// ErrTrackingNotFound: no tracking with that ID belongs to the user.
var ErrTrackingNotFound = errors.New("tracking not found")

type TrackingRepository interface {
	CreateTracking(ctx context.Context, t *TrackedProduct) error
	GetTracking(ctx context.Context, id uuid.UUID) (*TrackedProduct, error)
	GetTrackingForUser(ctx context.Context, id, userID uuid.UUID) (*TrackedProduct, error)
	GetTrackingBySource(ctx context.Context, userID, sourceID uuid.UUID) (*TrackedProduct, error)
	ListTrackingsByUser(ctx context.Context, userID uuid.UUID) ([]*TrackedProduct, error)
	// UserTracksProduct reports whether the user tracks any source of the product group.
	UserTracksProduct(ctx context.Context, tx pgx.Tx, userID, productID uuid.UUID) (bool, error)
	// OtherUsersTrackProduct reports whether anyone except userID tracks a source of the product group.
	OtherUsersTrackProduct(ctx context.Context, tx pgx.Tx, productID, userID uuid.UUID) (bool, error)
	// WithGroupLock runs fn in a transaction holding exclusive locks on the product groups.
	WithGroupLock(ctx context.Context, productIDs []uuid.UUID, fn func(tx pgx.Tx) error) error
	UpdateNextFetchAt(ctx context.Context, tx pgx.Tx, id uuid.UUID, nextFetch time.Time) error
	UpdateNextFetchAtForUser(ctx context.Context, tx pgx.Tx, id, userID uuid.UUID, nextFetch time.Time) error
	ClaimDueTrackings(ctx context.Context, limit int) ([]*TrackedProduct, error)
	SetTrackingActive(ctx context.Context, id uuid.UUID, active bool) error
	SetTrackingActiveForUser(ctx context.Context, id, userID uuid.UUID, active bool) error
}
