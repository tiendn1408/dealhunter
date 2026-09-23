package product

import (
	"time"

	"github.com/google/uuid"
)

type Product struct {
	ID        uuid.UUID
	Title     string
	Brand     *string
	Model     *string
	Variant   *string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ProductSource struct {
	ID                 uuid.UUID
	ProductID          uuid.UUID
	Platform           string
	ExternalProductID  *string
	CanonicalURL       string
	SellerName         *string
	RawTitle           *string
	Currency           string
	LastPrice          *int64
	LastShippingFee    *int64
	LastEffectivePrice *int64
	LastInStock        *bool
	LastFetchedAt      *time.Time
	Active             bool
	CreatedAt          time.Time
	UpdatedAt          time.Time
}
