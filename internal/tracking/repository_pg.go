package tracking

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiendang/deal-hunter/internal/domain"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateTracking(ctx context.Context, t *domain.TrackedProduct) error {
	// Ensure user exists to satisfy foreign key constraint
	ensureUserQuery := `
		INSERT INTO users (id, created_at)
		VALUES ($1, NOW())
		ON CONFLICT (id) DO NOTHING;
	`
	if _, err := r.pool.Exec(ctx, ensureUserQuery, t.UserID); err != nil {
		return fmt.Errorf("ensure user exists: %w", err)
	}

	query := `
		INSERT INTO tracked_products (
			id, user_id, product_source_id, active,
			polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id, product_source_id) DO UPDATE
		SET active = TRUE,
		    is_primary = EXCLUDED.is_primary,
		    updated_at = NOW()
		RETURNING id, active, polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary;
	`
	now := time.Now()
	if t.CreatedAt.IsZero() {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	if t.PollingIntervalSeconds <= 0 {
		t.PollingIntervalSeconds = 1800
	}
	if t.NextFetchAt.IsZero() {
		t.NextFetchAt = now
	}

	return r.pool.QueryRow(ctx, query,
		t.ID,
		t.UserID,
		t.ProductSourceID,
		t.Active,
		t.PollingIntervalSeconds,
		t.NextFetchAt,
		t.CreatedAt,
		t.UpdatedAt,
		t.IsPrimary,
	).Scan(
		&t.ID,
		&t.Active,
		&t.PollingIntervalSeconds,
		&t.NextFetchAt,
		&t.CreatedAt,
		&t.UpdatedAt,
		&t.IsPrimary,
	)
}

func (r *PostgresRepository) GetTracking(ctx context.Context, id uuid.UUID) (*domain.TrackedProduct, error) {
	query := `
		SELECT id, user_id, product_source_id, active,
		       polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary
		FROM tracked_products
		WHERE id = $1 OR product_source_id = $1
		ORDER BY (id = $1) DESC
		LIMIT 1;
	`
	var t domain.TrackedProduct
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&t.ID,
		&t.UserID,
		&t.ProductSourceID,
		&t.Active,
		&t.PollingIntervalSeconds,
		&t.NextFetchAt,
		&t.CreatedAt,
		&t.UpdatedAt,
		&t.IsPrimary,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("tracking not found: %w", err)
		}
		return nil, fmt.Errorf("query tracking: %w", err)
	}

	return &t, nil
}

func (r *PostgresRepository) GetTrackingForUser(ctx context.Context, id, userID uuid.UUID) (*domain.TrackedProduct, error) {
	query := `
		SELECT id, user_id, product_source_id, active,
		       polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary
		FROM tracked_products
		WHERE (id = $1 OR product_source_id = $1) AND user_id = $2
		ORDER BY (id = $1) DESC
		LIMIT 1;
	`
	var t domain.TrackedProduct
	err := r.pool.QueryRow(ctx, query, id, userID).Scan(
		&t.ID,
		&t.UserID,
		&t.ProductSourceID,
		&t.Active,
		&t.PollingIntervalSeconds,
		&t.NextFetchAt,
		&t.CreatedAt,
		&t.UpdatedAt,
		&t.IsPrimary,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("tracking not found: %w", err)
		}
		return nil, fmt.Errorf("query tracking for user: %w", err)
	}

	return &t, nil
}

func (r *PostgresRepository) GetTrackingBySource(ctx context.Context, userID, sourceID uuid.UUID) (*domain.TrackedProduct, error) {
	query := `
		SELECT id, user_id, product_source_id, active,
		       polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary
		FROM tracked_products
		WHERE user_id = $1 AND product_source_id = $2
		LIMIT 1;
	`
	var t domain.TrackedProduct
	err := r.pool.QueryRow(ctx, query, userID, sourceID).Scan(
		&t.ID,
		&t.UserID,
		&t.ProductSourceID,
		&t.Active,
		&t.PollingIntervalSeconds,
		&t.NextFetchAt,
		&t.CreatedAt,
		&t.UpdatedAt,
		&t.IsPrimary,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // Return nil, nil when not tracked
		}
		return nil, fmt.Errorf("query tracking by source: %w", err)
	}

	return &t, nil
}

func (r *PostgresRepository) ListTrackingsByUser(ctx context.Context, userID uuid.UUID) ([]*domain.TrackedProduct, error) {
	query := `
		SELECT id, user_id, product_source_id, active,
		       polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary
		FROM tracked_products
		WHERE user_id = $1
		ORDER BY created_at DESC;
	`
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query user trackings: %w", err)
	}
	defer rows.Close()

	var trackings []*domain.TrackedProduct
	for rows.Next() {
		var t domain.TrackedProduct
		if err := rows.Scan(
			&t.ID,
			&t.UserID,
			&t.ProductSourceID,
			&t.Active,
			&t.PollingIntervalSeconds,
			&t.NextFetchAt,
			&t.CreatedAt,
			&t.UpdatedAt,
			&t.IsPrimary,
		); err != nil {
			return nil, fmt.Errorf("scan tracking row: %w", err)
		}
		trackings = append(trackings, &t)
	}

	return trackings, rows.Err()
}

func (r *PostgresRepository) ClaimDueTrackings(ctx context.Context, limit int) ([]*domain.TrackedProduct, error) {
	query := `
		UPDATE tracked_products
		SET next_fetch_at = NOW() + (polling_interval_seconds || ' seconds')::INTERVAL,
		    updated_at = NOW()
		WHERE id IN (
			SELECT id
			FROM tracked_products
			WHERE active = TRUE
			  AND next_fetch_at <= NOW()
			ORDER BY next_fetch_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, user_id, product_source_id, active,
		          polling_interval_seconds, next_fetch_at, created_at, updated_at, is_primary;
	`
	rows, err := r.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due trackings: %w", err)
	}
	defer rows.Close()

	var trackings []*domain.TrackedProduct
	for rows.Next() {
		var t domain.TrackedProduct
		if err := rows.Scan(
			&t.ID,
			&t.UserID,
			&t.ProductSourceID,
			&t.Active,
			&t.PollingIntervalSeconds,
			&t.NextFetchAt,
			&t.CreatedAt,
			&t.UpdatedAt,
			&t.IsPrimary,
		); err != nil {
			return nil, fmt.Errorf("scan due tracking: %w", err)
		}
		trackings = append(trackings, &t)
	}

	return trackings, rows.Err()
}

func (r *PostgresRepository) UpdateNextFetchAt(ctx context.Context, tx pgx.Tx, id uuid.UUID, nextFetch time.Time) error {
	query := `
		UPDATE tracked_products
		SET next_fetch_at = $1,
		    updated_at = NOW()
		WHERE id = $2;
	`
	var err error
	if tx != nil {
		_, err = tx.Exec(ctx, query, nextFetch, id)
	} else {
		_, err = r.pool.Exec(ctx, query, nextFetch, id)
	}

	if err != nil {
		return fmt.Errorf("update next_fetch_at: %w", err)
	}
	return nil
}

func (r *PostgresRepository) UpdateNextFetchAtForUser(ctx context.Context, tx pgx.Tx, id, userID uuid.UUID, nextFetch time.Time) error {
	query := `
		UPDATE tracked_products
		SET next_fetch_at = $1,
		    updated_at = NOW()
		WHERE id = $2 AND user_id = $3;
	`
	var err error
	if tx != nil {
		_, err = tx.Exec(ctx, query, nextFetch, id, userID)
	} else {
		_, err = r.pool.Exec(ctx, query, nextFetch, id, userID)
	}

	if err != nil {
		return fmt.Errorf("update next_fetch_at for user: %w", err)
	}
	return nil
}

func (r *PostgresRepository) SetTrackingActive(ctx context.Context, id uuid.UUID, active bool) error {
	query := `
		UPDATE tracked_products
		SET active = $1,
		    updated_at = NOW()
		WHERE id = $2;
	`
	res, err := r.pool.Exec(ctx, query, active, id)
	if err != nil {
		return fmt.Errorf("update tracking active state: %w", err)
	}
	if res.RowsAffected() == 0 {
		return errors.New("tracking not found")
	}
	return nil
}

func (r *PostgresRepository) SetTrackingActiveForUser(ctx context.Context, id, userID uuid.UUID, active bool) error {
	query := `
		UPDATE tracked_products
		SET active = $1,
		    updated_at = NOW()
		WHERE id = $2 AND user_id = $3;
	`
	res, err := r.pool.Exec(ctx, query, active, id, userID)
	if err != nil {
		return fmt.Errorf("update tracking active state: %w", err)
	}
	if res.RowsAffected() == 0 {
		return errors.New("tracking not found")
	}
	return nil
}
