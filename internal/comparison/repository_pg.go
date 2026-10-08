package comparison

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresRepository implements ComparisonRepository with pgx connection pool.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) ProductExists(ctx context.Context, productID uuid.UUID) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM products WHERE id = $1);`
	var exists bool
	err := r.pool.QueryRow(ctx, query, productID).Scan(&exists)
	return exists, err
}

func (r *PostgresRepository) GetSourcesByProductID(ctx context.Context, productID uuid.UUID) (string, []SourcePrice, error) {
	titleQuery := `SELECT title FROM products WHERE id = $1;`
	var title string
	err := r.pool.QueryRow(ctx, titleQuery, productID).Scan(&title)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, fmt.Errorf("product not found: %w", err)
		}
		return "", nil, fmt.Errorf("query product title: %w", err)
	}

	sourcesQuery := `
		SELECT
			ps.id,
			ps.product_id,
			ps.platform,
			COALESCE(ps.seller_name, ''),
			ps.canonical_url,
			-- Values of the latest snapshot as a whole (a NULL there means "not stated"), else the source's last values
			CASE WHEN snap.captured_at IS NOT NULL THEN snap.price           ELSE ps.last_price           END,
			CASE WHEN snap.captured_at IS NOT NULL THEN snap.shipping_fee    ELSE ps.last_shipping_fee    END,
			CASE WHEN snap.captured_at IS NOT NULL THEN snap.effective_price ELSE ps.last_effective_price END,
			CASE WHEN snap.captured_at IS NOT NULL THEN snap.in_stock        ELSE ps.last_in_stock        END,
			COALESCE(snap.captured_at,     ps.last_fetched_at)
		FROM product_sources ps
		LEFT JOIN LATERAL (
			SELECT price, shipping_fee, effective_price, in_stock, captured_at
			FROM   price_snapshots
			WHERE  product_source_id = ps.id
			ORDER  BY captured_at DESC
			LIMIT  1
		) snap ON TRUE
		WHERE ps.product_id = $1
		  AND ps.active     = TRUE
		ORDER BY COALESCE(snap.effective_price, ps.last_effective_price) NULLS LAST;
	`

	rows, err := r.pool.Query(ctx, sourcesQuery, productID)
	if err != nil {
		return "", nil, fmt.Errorf("query product sources: %w", err)
	}
	defer rows.Close()

	sources := make([]SourcePrice, 0)
	for rows.Next() {
		var s SourcePrice
		var capturedAt *time.Time
		if err := rows.Scan(
			&s.SourceID,
			&s.ProductID,
			&s.Platform,
			&s.SellerName,
			&s.CanonicalURL,
			&s.ListedPrice,
			&s.ShippingFee,
			&s.EffectivePrice,
			&s.InStock,
			&capturedAt,
		); err != nil {
			return "", nil, fmt.Errorf("scan source price: %w", err)
		}
		s.CapturedAt = capturedAt
		sources = append(sources, s)
	}

	return title, sources, rows.Err()
}

func (r *PostgresRepository) UpsertComparisonSnapshot(ctx context.Context, productID uuid.UUID, sources []SourcePrice) error {
	if len(sources) == 0 {
		return nil
	}

	query := `
		INSERT INTO comparison_snapshots
			(id, product_id, source_id, platform, seller_name, canonical_url,
			 listed_price, shipping_fee, effective_price, in_stock, is_best_deal,
			 captured_at, refreshed_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
		ON CONFLICT (product_id, source_id) DO UPDATE
		SET platform        = EXCLUDED.platform,
			seller_name     = EXCLUDED.seller_name,
			canonical_url   = EXCLUDED.canonical_url,
			listed_price    = EXCLUDED.listed_price,
			shipping_fee    = EXCLUDED.shipping_fee,
			effective_price = EXCLUDED.effective_price,
			in_stock        = EXCLUDED.in_stock,
			is_best_deal    = EXCLUDED.is_best_deal,
			captured_at     = EXCLUDED.captured_at,
			refreshed_at    = NOW();
	`

	// Reset existing is_best_deal for this product to guarantee exactly one or zero best deals
	_, _ = r.pool.Exec(ctx, `UPDATE comparison_snapshots SET is_best_deal = FALSE WHERE product_id = $1;`, productID)

	for _, s := range sources {
		_, err := r.pool.Exec(ctx, query,
			productID,
			s.SourceID,
			s.Platform,
			s.SellerName,
			s.CanonicalURL,
			s.ListedPrice,
			s.ShippingFee,
			s.EffectivePrice,
			s.InStock,
			s.IsBestDeal,
			s.CapturedAt,
		)
		if err != nil {
			return fmt.Errorf("upsert comparison snapshot for source %s: %w", s.SourceID, err)
		}
	}

	return nil
}

func (r *PostgresRepository) GetUserMultiSourceProducts(ctx context.Context, userID uuid.UUID) ([]ProductGroupSummary, error) {
	query := `
		SELECT
			p.id                            AS product_id,
			p.title                         AS product_title,
			cs.effective_price              AS best_price,
			COALESCE(cs.platform, '')       AS best_platform,
			COUNT(DISTINCT ps.id)           AS source_count
		FROM tracked_products tp
		JOIN product_sources  ps ON tp.product_source_id = ps.id
		JOIN products         p  ON ps.product_id        = p.id
		LEFT JOIN comparison_snapshots cs
			ON cs.product_id = p.id AND cs.is_best_deal = TRUE
		WHERE tp.user_id = $1
		  AND tp.active  = TRUE
		  AND ps.active  = TRUE
		GROUP BY p.id, p.title, cs.effective_price, cs.platform
		HAVING COUNT(DISTINCT ps.id) >= 2
		ORDER BY p.title;
	`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query multi-source products: %w", err)
	}
	defer rows.Close()

	groups := make([]ProductGroupSummary, 0)
	for rows.Next() {
		var g ProductGroupSummary
		var bestPrice *int64
		if err := rows.Scan(
			&g.ProductID,
			&g.ProductTitle,
			&bestPrice,
			&g.BestPlatform,
			&g.SourceCount,
		); err != nil {
			return nil, fmt.Errorf("scan product group: %w", err)
		}
		g.BestPrice = bestPrice
		groups = append(groups, g)
	}

	return groups, rows.Err()
}

func (r *PostgresRepository) GetSnapshotAge(ctx context.Context, productID uuid.UUID) (*time.Time, error) {
	query := `SELECT MAX(refreshed_at) FROM comparison_snapshots WHERE product_id = $1;`
	var latest *time.Time
	err := r.pool.QueryRow(ctx, query, productID).Scan(&latest)
	if err != nil {
		return nil, err
	}
	return latest, nil
}

func (r *PostgresRepository) GetAllMultiSourceProductIDs(ctx context.Context) ([]uuid.UUID, error) {
	query := `
		SELECT product_id
		FROM product_sources
		WHERE active = TRUE
		GROUP BY product_id
		HAVING COUNT(*) >= 2;
	`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query multi-source product IDs: %w", err)
	}
	defer rows.Close()

	ids := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, rows.Err()
}
