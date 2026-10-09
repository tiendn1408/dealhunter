package product

import (
	"context"
	"errors"
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

func (r *PostgresRepository) UpsertProduct(ctx context.Context, p *Product) error {
	query := `
		INSERT INTO products (id, title, brand, model, variant, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE
		SET title = EXCLUDED.title,
		    brand = COALESCE(EXCLUDED.brand, products.brand),
		    model = COALESCE(EXCLUDED.model, products.model),
		    variant = COALESCE(EXCLUDED.variant, products.variant),
		    updated_at = NOW()
		RETURNING id, created_at, updated_at;
	`
	now := time.Now()
	if p.CreatedAt.IsZero() {
		p.CreatedAt = now
	}
	p.UpdatedAt = now

	return r.pool.QueryRow(ctx, query,
		p.ID,
		p.Title,
		p.Brand,
		p.Model,
		p.Variant,
		p.CreatedAt,
		p.UpdatedAt,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func (r *PostgresRepository) UpsertProductSource(ctx context.Context, tx pgx.Tx, ps *ProductSource) error {
	query := `
		INSERT INTO product_sources (
			id, product_id, platform, external_product_id, canonical_url,
			seller_name, raw_title, currency, active, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (platform, external_product_id) DO UPDATE
		SET canonical_url = EXCLUDED.canonical_url,
		    seller_name = COALESCE(EXCLUDED.seller_name, product_sources.seller_name),
		    raw_title = COALESCE(EXCLUDED.raw_title, product_sources.raw_title),
		    updated_at = NOW()
		RETURNING id, product_id, platform, external_product_id, canonical_url,
		          seller_name, raw_title, currency, last_price, last_shipping_fee,
		          last_effective_price, last_in_stock, last_fetched_at, active,
		          created_at, updated_at;
	`
	now := time.Now()
	if ps.CreatedAt.IsZero() {
		ps.CreatedAt = now
	}
	ps.UpdatedAt = now

	row := r.pool.QueryRow
	if tx != nil {
		row = tx.QueryRow
	}
	return row(ctx, query,
		ps.ID,
		ps.ProductID,
		ps.Platform,
		ps.ExternalProductID,
		ps.CanonicalURL,
		ps.SellerName,
		ps.RawTitle,
		ps.Currency,
		ps.Active,
		ps.CreatedAt,
		ps.UpdatedAt,
	).Scan(
		&ps.ID,
		&ps.ProductID,
		&ps.Platform,
		&ps.ExternalProductID,
		&ps.CanonicalURL,
		&ps.SellerName,
		&ps.RawTitle,
		&ps.Currency,
		&ps.LastPrice,
		&ps.LastShippingFee,
		&ps.LastEffectivePrice,
		&ps.LastInStock,
		&ps.LastFetchedAt,
		&ps.Active,
		&ps.CreatedAt,
		&ps.UpdatedAt,
	)
}

func (r *PostgresRepository) GetProductSource(ctx context.Context, id uuid.UUID) (*ProductSource, error) {
	query := `
		SELECT id, product_id, platform, external_product_id, canonical_url,
		       seller_name, raw_title, currency, last_price, last_shipping_fee,
		       last_effective_price, last_in_stock, last_fetched_at, active,
		       created_at, updated_at
		FROM product_sources
		WHERE id = $1;
	`
	var ps ProductSource
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&ps.ID,
		&ps.ProductID,
		&ps.Platform,
		&ps.ExternalProductID,
		&ps.CanonicalURL,
		&ps.SellerName,
		&ps.RawTitle,
		&ps.Currency,
		&ps.LastPrice,
		&ps.LastShippingFee,
		&ps.LastEffectivePrice,
		&ps.LastInStock,
		&ps.LastFetchedAt,
		&ps.Active,
		&ps.CreatedAt,
		&ps.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("product source not found: %w", err)
		}
		return nil, fmt.Errorf("query product source: %w", err)
	}

	return &ps, nil
}

func (r *PostgresRepository) GetProductSourceByExternalID(ctx context.Context, platform, externalID string) (*ProductSource, error) {
	query := `
		SELECT id, product_id, platform, external_product_id, canonical_url,
		       seller_name, raw_title, currency, last_price, last_shipping_fee,
		       last_effective_price, last_in_stock, last_fetched_at, active,
		       created_at, updated_at
		FROM product_sources
		WHERE platform = $1 AND external_product_id = $2;
	`
	var ps ProductSource
	err := r.pool.QueryRow(ctx, query, platform, externalID).Scan(
		&ps.ID,
		&ps.ProductID,
		&ps.Platform,
		&ps.ExternalProductID,
		&ps.CanonicalURL,
		&ps.SellerName,
		&ps.RawTitle,
		&ps.Currency,
		&ps.LastPrice,
		&ps.LastShippingFee,
		&ps.LastEffectivePrice,
		&ps.LastInStock,
		&ps.LastFetchedAt,
		&ps.Active,
		&ps.CreatedAt,
		&ps.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // Return nil, nil when not found so caller can cleanly check
		}
		return nil, fmt.Errorf("query product source by external id: %w", err)
	}

	return &ps, nil
}

func (r *PostgresRepository) UpdateProductSourcePrice(ctx context.Context, tx pgx.Tx, update *ProductSource) error {
	query := `
		UPDATE product_sources
		SET last_price = $1,
		    last_shipping_fee = $2,
		    last_effective_price = $3,
		    last_in_stock = $4,
		    last_fetched_at = $5,
		    updated_at = NOW()
		WHERE id = $6;
	`
	var err error
	if tx != nil {
		_, err = tx.Exec(ctx, query,
			update.LastPrice,
			update.LastShippingFee,
			update.LastEffectivePrice,
			update.LastInStock,
			update.LastFetchedAt,
			update.ID,
		)
	} else {
		_, err = r.pool.Exec(ctx, query,
			update.LastPrice,
			update.LastShippingFee,
			update.LastEffectivePrice,
			update.LastInStock,
			update.LastFetchedAt,
			update.ID,
		)
	}

	if err != nil {
		return fmt.Errorf("update product source price: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ProductExists(ctx context.Context, productID uuid.UUID) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM products WHERE id = $1);`
	var exists bool
	err := r.pool.QueryRow(ctx, query, productID).Scan(&exists)
	return exists, err
}

// InsertProductSourceIfAbsent inserts ps unless a source with the same platform and external ID exists.
// Unlike UpsertProductSource it never touches (and so never waits on) an existing row, which keeps the
// source-then-group lock order of group changes intact. inserted reports whether ps was written.
func (r *PostgresRepository) InsertProductSourceIfAbsent(ctx context.Context, tx pgx.Tx, ps *ProductSource) (bool, error) {
	now := time.Now()
	if ps.CreatedAt.IsZero() {
		ps.CreatedAt = now
	}
	ps.UpdatedAt = now
	query := `
		INSERT INTO product_sources (
			id, product_id, platform, external_product_id, canonical_url,
			seller_name, raw_title, currency, active, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (platform, external_product_id) DO NOTHING;
	`
	exec := r.pool.Exec
	if tx != nil {
		exec = tx.Exec
	}
	tag, err := exec(ctx, query, ps.ID, ps.ProductID, ps.Platform, ps.ExternalProductID, ps.CanonicalURL,
		ps.SellerName, ps.RawTitle, ps.Currency, ps.Active, ps.CreatedAt, ps.UpdatedAt)
	if err != nil {
		return false, fmt.Errorf("insert product source: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// ErrSourceMoved means the source no longer belongs to the group the caller checked.
var ErrSourceMoved = errors.New("product source moved to another group")

// AssignProductSource moves a source from one product group to another. It only moves it if it is still
// in fromProductID (ErrSourceMoved otherwise), so a decision based on that group cannot be applied late.
func (r *PostgresRepository) AssignProductSource(ctx context.Context, tx pgx.Tx, sourceID, fromProductID, toProductID uuid.UUID) error {
	query := `
		UPDATE product_sources
		SET product_id = $1,
		    updated_at = NOW()
		WHERE id = $2 AND product_id = $3;
	`
	exec := r.pool.Exec
	if tx != nil {
		exec = tx.Exec
	}
	res, err := exec(ctx, query, toProductID, sourceID, fromProductID)
	if err != nil {
		return fmt.Errorf("assign product source: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrSourceMoved
	}
	return nil
}
