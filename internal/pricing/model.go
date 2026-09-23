package pricing

import (
	"time"

	"github.com/google/uuid"
)

type Price struct {
	ListedPrice    int64
	SalePrice      int64
	ShopDiscount   int64
	PlatformCoupon int64
	ShippingFee    int64
}

func (p Price) EffectivePrice() int64 {
	base := p.SalePrice
	if base == 0 {
		base = p.ListedPrice
	}
	return base - p.ShopDiscount - p.PlatformCoupon + p.ShippingFee
}

type PriceSnapshot struct {
	ID              int64
	ProductSourceID uuid.UUID
	Price           int64
	ShippingFee     int64
	EffectivePrice  int64
	Currency        string
	InStock         *bool
	CapturedAt      time.Time
	CreatedAt       time.Time
}
