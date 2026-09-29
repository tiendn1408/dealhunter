package pricing

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) InsertSnapshot(ctx context.Context, tx pgx.Tx, snapshot *PriceSnapshot) error {
	query := `
		INSERT INTO price_snapshots (
			product_source_id, price, shipping_fee, effective_price,
			currency, in_stock, captured_at, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at;
	`
	now := time.Now()
	if snapshot.CreatedAt.IsZero() {
		snapshot.CreatedAt = now
	}
	if snapshot.CapturedAt.IsZero() {
		snapshot.CapturedAt = now
	}
	if snapshot.Currency == "" {
		snapshot.Currency = "VND"
	}

	var row pgx.Row
	if tx != nil {
		row = tx.QueryRow(ctx, query,
			snapshot.ProductSourceID,
			snapshot.Price,
			snapshot.ShippingFee,
			snapshot.EffectivePrice,
			snapshot.Currency,
			snapshot.InStock,
			snapshot.CapturedAt,
			snapshot.CreatedAt,
		)
	} else {
		row = r.pool.QueryRow(ctx, query,
			snapshot.ProductSourceID,
			snapshot.Price,
			snapshot.ShippingFee,
			snapshot.EffectivePrice,
			snapshot.Currency,
			snapshot.InStock,
			snapshot.CapturedAt,
			snapshot.CreatedAt,
		)
	}

	if err := row.Scan(&snapshot.ID, &snapshot.CreatedAt); err != nil {
		return fmt.Errorf("insert price snapshot: %w", err)
	}

	return nil
}

func (r *PostgresRepository) ListSnapshots(ctx context.Context, productSourceID uuid.UUID, from, to time.Time) ([]*PriceSnapshot, error) {
	query := `
		SELECT id, product_source_id, price, shipping_fee, effective_price,
		       currency, in_stock, captured_at, created_at
		FROM price_snapshots
		WHERE product_source_id = $1
		  AND captured_at >= $2
		  AND captured_at <= $3
		ORDER BY captured_at ASC;
	`
	rows, err := r.pool.Query(ctx, query, productSourceID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query price snapshots: %w", err)
	}
	defer rows.Close()

	var snapshots []*PriceSnapshot
	for rows.Next() {
		var s PriceSnapshot
		if err := rows.Scan(
			&s.ID,
			&s.ProductSourceID,
			&s.Price,
			&s.ShippingFee,
			&s.EffectivePrice,
			&s.Currency,
			&s.InStock,
			&s.CapturedAt,
			&s.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan price snapshot: %w", err)
		}
		snapshots = append(snapshots, &s)
	}

	return snapshots, rows.Err()
}
