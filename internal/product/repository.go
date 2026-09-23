package product

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ProductRepository interface {
	UpsertProduct(ctx context.Context, p *Product) error
	UpsertProductSource(ctx context.Context, ps *ProductSource) error
	GetProductSource(ctx context.Context, id uuid.UUID) (*ProductSource, error)
	UpdateProductSourcePrice(ctx context.Context, tx pgx.Tx, update *ProductSource) error
}
