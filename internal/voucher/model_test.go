package voucher

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCalculateEffectivePrice(t *testing.T) {
	sourceID := uuid.New()
	future := time.Now().Add(24 * time.Hour)
	past := time.Now().Add(-24 * time.Hour)

	vouchers := []*ProductVoucher{
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeShop,
			Title:           "Giam 300k cho don tu 5tr",
			DiscountAmount:  300000,
			MinOrderValue:   5000000,
			ExpiresAt:       &future,
		},
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypePlatform,
			Title:           "Shopee Live giam 10% toi da 600k",
			DiscountAmount:  600000,
			DiscountPercent: 10,
			MinOrderValue:   0,
			ExpiresAt:       &future,
		},
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeFreeship,
			Title:           "Freeship Extra giam 30k",
			DiscountAmount:  30000,
			ExpiresAt:       &future,
		},
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeShop,
			Title:           "Ma het han",
			DiscountAmount:  500000,
			ExpiresAt:       &past,
		},
	}

	listedPrice := int64(6290000)
	shippingFee := int64(30000)

	calc := CalculateEffectivePrice(listedPrice, shippingFee, vouchers)

	// Shop discount: 300,000 (listedPrice 6.29m >= min 5m)
	if calc.ShopDiscount != 300000 {
		t.Errorf("expected ShopDiscount 300000, got %d", calc.ShopDiscount)
	}

	// Platform discount: min(600k, 10% of 6.29m = 629k) -> 600k capped
	if calc.PlatformCoupon != 600000 {
		t.Errorf("expected PlatformCoupon 600000, got %d", calc.PlatformCoupon)
	}

	// Freeship reduces 30k fee to 0
	if calc.ShippingFee != 0 {
		t.Errorf("expected ShippingFee 0 after freeship voucher, got %d", calc.ShippingFee)
	}

	// Net effective price: 6,290,000 - 300,000 - 600,000 + 0 = 5,390,000
	expectedEffective := int64(5390000)
	if calc.EffectivePrice != expectedEffective {
		t.Errorf("expected EffectivePrice %d, got %d", expectedEffective, calc.EffectivePrice)
	}

	expectedSavings := (listedPrice + shippingFee) - expectedEffective
	if calc.TotalSavings != expectedSavings {
		t.Errorf("expected TotalSavings %d, got %d", expectedSavings, calc.TotalSavings)
	}

	if calc.BestShopVoucher == nil || calc.BestShopVoucher.DiscountAmount != 300000 {
		t.Errorf("expected BestShopVoucher with 300k discount")
	}

	// Expired voucher should not be in AvailableVouchers
	if len(calc.AvailableVouchers) != 3 {
		t.Errorf("expected 3 valid vouchers (excluding expired), got %d", len(calc.AvailableVouchers))
	}
}

func TestCalculateEffectivePrice_MinOrderNotMet(t *testing.T) {
	sourceID := uuid.New()
	vouchers := []*ProductVoucher{
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeShop,
			Title:           "Giam 100k cho don tu 1tr",
			DiscountAmount:  100000,
			MinOrderValue:   1000000,
		},
	}

	calc := CalculateEffectivePrice(500000, 20000, vouchers)
	if calc.ShopDiscount != 0 {
		t.Errorf("expected 0 ShopDiscount because min order not met, got %d", calc.ShopDiscount)
	}
	if calc.EffectivePrice != 520000 {
		t.Errorf("expected EffectivePrice 520000, got %d", calc.EffectivePrice)
	}
}

func TestCalculateEffectivePrice_MultipleFreeship(t *testing.T) {
	sourceID := uuid.New()
	vouchers := []*ProductVoucher{
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeFreeship,
			Title:           "Freeship 10k",
			DiscountAmount:  10000,
		},
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeFreeship,
			Title:           "Freeship 15k",
			DiscountAmount:  15000,
		},
	}

	calc := CalculateEffectivePrice(200000, 20000, vouchers)
	if calc.ShippingFee != 5000 {
		t.Errorf("expected ShippingFee 5000 (best freeship only), got %d", calc.ShippingFee)
	}
	if calc.BestFreeshipVoucher == nil || calc.BestFreeshipVoucher.DiscountAmount != 15000 {
		t.Errorf("expected BestFreeshipVoucher with 15k discount")
	}
}

func TestCalculateEffectivePrice_ZeroPrice_MinOrderExcluded(t *testing.T) {
	sourceID := uuid.New()
	vouchers := []*ProductVoucher{
		{
			ID:              uuid.New(),
			ProductSourceID: sourceID,
			VoucherType:     VoucherTypeShop,
			Title:           "Giam 100k cho don tu 1tr",
			DiscountAmount:  100000,
			MinOrderValue:   1000000,
		},
	}

	calc := CalculateEffectivePrice(0, 0, vouchers)
	if calc.ShopDiscount != 0 {
		t.Errorf("expected 0 ShopDiscount when price is 0, got %d", calc.ShopDiscount)
	}
	if len(calc.AvailableVouchers) != 0 {
		t.Errorf("expected 0 available vouchers when price is 0 and voucher has min order, got %d", len(calc.AvailableVouchers))
	}
}

// SEC-09: every voucher field an admin submits is validated (vouchers drive every user's price and
// Zalo messages).
func TestProductVoucher_Validate(t *testing.T) {
	now := time.Now()
	in := func(d time.Duration) *time.Time { v := now.Add(d); return &v }
	valid := func() ProductVoucher {
		return ProductVoucher{VoucherType: "shop_voucher", Title: "Giảm 50K", VoucherCode: "GIAM50", DiscountAmount: 50000, ExpiresAt: in(24 * time.Hour)}
	}
	if v := valid(); v.Validate(now) != nil {
		t.Fatalf("valid voucher rejected: %v", v.Validate(now))
	}
	cases := map[string]func(v *ProductVoucher){
		"unknown type":         func(v *ProductVoucher) { v.VoucherType = "magic" },
		"empty title":          func(v *ProductVoucher) { v.Title = "  " },
		"title over 200 chars": func(v *ProductVoucher) { v.Title = strings.Repeat("ạ", 201) },
		"code over 64 chars":   func(v *ProductVoucher) { v.VoucherCode = strings.Repeat("Á", 65) },
		"negative amount":      func(v *ProductVoucher) { v.DiscountAmount = -1 },
		"negative min order":   func(v *ProductVoucher) { v.MinOrderValue = -1 },
		"percent over 100":     func(v *ProductVoucher) { v.DiscountAmount = 0; v.DiscountPercent = 101 },
		"no discount at all":   func(v *ProductVoucher) { v.DiscountAmount = 0; v.DiscountPercent = 0 },
		"missing expiry":       func(v *ProductVoucher) { v.ExpiresAt = nil },
		"already expired":      func(v *ProductVoucher) { v.ExpiresAt = in(-time.Minute) },
		"expiry over one year": func(v *ProductVoucher) { v.ExpiresAt = in(MaxVoucherLifetime + time.Hour) },
		"collect_url too long": func(v *ProductVoucher) { v.CollectURL = "https://shopee.vn/" + strings.Repeat("a", 2048) },
	}
	for name, mutate := range cases {
		v := valid()
		mutate(&v)
		if v.Validate(now) == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
	// Limits count characters, not bytes: 200 Vietnamese characters are fine
	v := valid()
	v.Title = strings.Repeat("ạ", 200)
	v.VoucherCode = strings.Repeat("Á", 64)
	if err := v.Validate(now); err != nil {
		t.Errorf("200-character title / 64-character code must be accepted: %v", err)
	}
}
