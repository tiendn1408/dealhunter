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
	ShippingFee     *int64 // nil when the marketplace did not state a shipping fee
	EffectivePrice  int64  // Price plus ShippingFee when known, else Price alone
	Currency        string
	InStock         *bool
	CapturedAt      time.Time
	CreatedAt       time.Time
}

// EffectivePriceOf adds the shipping fee to the price when the fee is known.
func EffectivePriceOf(price int64, shippingFee *int64) int64 {
	if shippingFee == nil {
		return price
	}
	return price + *shippingFee
}
