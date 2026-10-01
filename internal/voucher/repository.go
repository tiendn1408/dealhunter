package voucher

import (
	"context"

	"github.com/google/uuid"
)

// Repository defines storage operations for product vouchers.
type Repository interface {
	UpsertVoucher(ctx context.Context, v *ProductVoucher) error
	GetVouchersBySourceID(ctx context.Context, sourceID uuid.UUID) ([]*ProductVoucher, error)
	DeleteExpiredVouchers(ctx context.Context) error
}
