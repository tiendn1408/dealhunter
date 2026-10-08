package product

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ProductRepository interface {
	UpsertProduct(ctx context.Context, p *Product) error
	UpsertProductSource(ctx context.Context, tx pgx.Tx, ps *ProductSource) error
	GetProductSource(ctx context.Context, id uuid.UUID) (*ProductSource, error)
	GetProductSourceByExternalID(ctx context.Context, platform, externalID string) (*ProductSource, error)
	UpdateProductSourcePrice(ctx context.Context, tx pgx.Tx, update *ProductSource) error
	ProductExists(ctx context.Context, productID uuid.UUID) (bool, error)
	AssignProductSource(ctx context.Context, tx pgx.Tx, sourceID, fromProductID, toProductID uuid.UUID) error
}
