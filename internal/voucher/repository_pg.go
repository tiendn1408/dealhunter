package voucher

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) UpsertVoucher(ctx context.Context, v *ProductVoucher) error {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	now := time.Now()
	if v.CreatedAt.IsZero() {
		v.CreatedAt = now
	}
	v.UpdatedAt = now

	query := `
		INSERT INTO product_vouchers (
			id, product_source_id, voucher_type, voucher_code, title,
			discount_amount, discount_percent, min_order_value, collect_url,
			expires_at, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (product_source_id, voucher_type, (COALESCE(voucher_code, ''))) DO UPDATE SET
			title = EXCLUDED.title,
			discount_amount = EXCLUDED.discount_amount,
			discount_percent = EXCLUDED.discount_percent,
			min_order_value = EXCLUDED.min_order_value,
			collect_url = EXCLUDED.collect_url,
			expires_at = EXCLUDED.expires_at,
			updated_at = NOW()
		RETURNING id, created_at, updated_at;
	`

	err := r.pool.QueryRow(ctx, query,
		v.ID,
		v.ProductSourceID,
		v.VoucherType,
		v.VoucherCode,
		v.Title,
		v.DiscountAmount,
		v.DiscountPercent,
		v.MinOrderValue,
		v.CollectURL,
		v.ExpiresAt,
		v.CreatedAt,
		v.UpdatedAt,
	).Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return fmt.Errorf("upsert voucher: %w", err)
	}

	return nil
}

func (r *PostgresRepository) GetVouchersBySourceID(ctx context.Context, sourceID uuid.UUID) ([]*ProductVoucher, error) {
	query := `
		SELECT id, product_source_id, voucher_type, COALESCE(voucher_code, ''),
		       title, discount_amount, discount_percent, min_order_value,
		       COALESCE(collect_url, ''), expires_at, created_at, updated_at
		FROM product_vouchers
		WHERE product_source_id = $1
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY discount_amount DESC, discount_percent DESC, created_at DESC;
	`

	rows, err := r.pool.Query(ctx, query, sourceID)
	if err != nil {
		return nil, fmt.Errorf("query vouchers: %w", err)
	}
	defer rows.Close()

	var list []*ProductVoucher
	for rows.Next() {
		var v ProductVoucher
		var code, collectURL string
		if err := rows.Scan(
			&v.ID,
			&v.ProductSourceID,
			&v.VoucherType,
			&code,
			&v.Title,
			&v.DiscountAmount,
			&v.DiscountPercent,
			&v.MinOrderValue,
			&collectURL,
			&v.ExpiresAt,
			&v.CreatedAt,
			&v.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan voucher: %w", err)
		}
		v.VoucherCode = code
		v.CollectURL = collectURL
		list = append(list, &v)
	}

	if list == nil {
		list = make([]*ProductVoucher, 0)
	}

	return list, rows.Err()
}

func (r *PostgresRepository) DeleteExpiredVouchers(ctx context.Context) error {
	query := `DELETE FROM product_vouchers WHERE expires_at IS NOT NULL AND expires_at < NOW();`
	_, err := r.pool.Exec(ctx, query)
	return err
}
