package pricing

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type PricingRepository interface {
	InsertSnapshot(ctx context.Context, tx pgx.Tx, snapshot *PriceSnapshot) error
	ListSnapshots(ctx context.Context, productSourceID uuid.UUID, from, to time.Time) ([]*PriceSnapshot, error)
}
