package pricing

import (
	"testing"
)

func TestEffectivePrice(t *testing.T) {
	tests := []struct {
		name     string
		price    Price
		expected int64
	}{
		{
			name: "only listed price without discount or shipping",
			price: Price{
				ListedPrice: 100000,
			},
			expected: 100000,
		},
		{
			name: "sale price takes precedence over listed price",
			price: Price{
				ListedPrice: 120000,
				SalePrice:   100000,
			},
			expected: 100000,
		},
		{
			name: "sale price with shop discount and shipping fee",
			price: Price{
				ListedPrice:  150000,
				SalePrice:    120000,
				ShopDiscount: 10000,
				ShippingFee:  15000,
			},
			expected: 125000, // 120000 - 10000 + 15000
		},
		{
			name: "full coupon, discounts and shipping",
			price: Price{
				ListedPrice:    2000000,
				SalePrice:      1800000,
				ShopDiscount:   50000,
				PlatformCoupon: 100000,
				ShippingFee:    30000,
			},
			expected: 1680000, // 1800000 - 50000 - 100000 + 30000
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.price.EffectivePrice()
			if got != tt.expected {
				t.Errorf("EffectivePrice() = %d, want %d", got, tt.expected)
			}
		})
	}
}
