package voucher

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type VoucherType string

const (
	VoucherTypeShop     VoucherType = "shop_voucher"
	VoucherTypePlatform VoucherType = "platform_voucher"
	VoucherTypeFreeship VoucherType = "freeship_voucher"
)

type ProductVoucher struct {
	ID                  uuid.UUID   `json:"id"`
	ProductSourceID     uuid.UUID   `json:"product_source_id"`
	VoucherType         VoucherType `json:"voucher_type"`
	VoucherCode         string      `json:"voucher_code,omitempty"`
	Title               string      `json:"title"`
	DiscountAmount      int64       `json:"discount_amount"`
	DiscountPercent     int         `json:"discount_percent"`
	MinOrderValue       int64       `json:"min_order_value"`
	CollectURL          string      `json:"collect_url,omitempty"`
	AffiliateCollectURL string      `json:"affiliate_collect_url,omitempty"`
	ExpiresAt           *time.Time  `json:"expires_at,omitempty"`
	CreatedAt           time.Time   `json:"created_at"`
	UpdatedAt           time.Time   `json:"updated_at"`
}

type VoucherCalculation struct {
	ListedPrice         int64             `json:"listed_price"`
	ShopDiscount        int64             `json:"shop_discount"`
	PlatformCoupon      int64             `json:"platform_coupon"`
	ShippingFee         int64             `json:"shipping_fee"`
	EffectivePrice      int64             `json:"effective_price"`
	TotalSavings        int64             `json:"total_savings"`
	BestShopVoucher     *ProductVoucher   `json:"best_shop_voucher,omitempty"`
	BestPlatformVoucher *ProductVoucher   `json:"best_platform_voucher,omitempty"`
	BestFreeshipVoucher *ProductVoucher   `json:"best_freeship_voucher,omitempty"`
	AvailableVouchers   []*ProductVoucher `json:"available_vouchers"`
}

// CalculateEffectivePrice evaluates available vouchers against listed price and shipping fee.
// Formula:
// EffectivePrice = max(0, ListedPrice - BestShopDiscount - BestPlatformCoupon) + FinalShippingFee
// TotalSavings = (ListedPrice + InitialShippingFee) - EffectivePrice
func CalculateEffectivePrice(listedPrice, shippingFee int64, vouchers []*ProductVoucher) VoucherCalculation {
	now := time.Now()
	initialShippingFee := shippingFee
	var bestShopVoucher *ProductVoucher
	var maxShopDiscount int64

	var bestPlatformVoucher *ProductVoucher
	var maxPlatformDiscount int64

	var bestFreeshipVoucher *ProductVoucher
	var maxFreeshipDiscount int64

	var validVouchers []*ProductVoucher

	for _, v := range vouchers {
		if v == nil {
			continue
		}
		if v.ExpiresAt != nil && v.ExpiresAt.Before(now) {
			continue
		}
		if v.MinOrderValue > 0 && listedPrice < v.MinOrderValue {
			continue
		}

		validVouchers = append(validVouchers, v)

		// Calculate discount amount:
		// - If DiscountPercent > 0: percentDiscount = listedPrice * percent / 100.
		// - If DiscountAmount > 0: acts as maximum cap (or flat discount if percent == 0).
		discount := v.DiscountAmount
		if v.DiscountPercent > 0 && listedPrice > 0 {
			percentDiscount := (listedPrice * int64(v.DiscountPercent)) / 100
			if discount == 0 || percentDiscount < discount {
				discount = percentDiscount
			}
		}

		switch v.VoucherType {
		case VoucherTypeShop:
			if discount > maxShopDiscount {
				maxShopDiscount = discount
				bestShopVoucher = v
			}
		case VoucherTypePlatform:
			if discount > maxPlatformDiscount {
				maxPlatformDiscount = discount
				bestPlatformVoucher = v
			}
		case VoucherTypeFreeship:
			if discount > maxFreeshipDiscount {
				maxFreeshipDiscount = discount
				bestFreeshipVoucher = v
			}
		}
	}

	finalShippingFee := initialShippingFee
	if maxFreeshipDiscount > 0 && finalShippingFee > 0 {
		if maxFreeshipDiscount >= finalShippingFee {
			finalShippingFee = 0
		} else {
			finalShippingFee -= maxFreeshipDiscount
		}
	}

	netPrice := listedPrice - maxShopDiscount - maxPlatformDiscount
	if netPrice < 0 {
		netPrice = 0
	}
	effectivePrice := netPrice + finalShippingFee
	totalSavings := (listedPrice + initialShippingFee) - effectivePrice
	if totalSavings < 0 {
		totalSavings = 0
	}

	return VoucherCalculation{
		ListedPrice:         listedPrice,
		ShopDiscount:        maxShopDiscount,
		PlatformCoupon:      maxPlatformDiscount,
		ShippingFee:         finalShippingFee,
		EffectivePrice:      effectivePrice,
		TotalSavings:        totalSavings,
		BestShopVoucher:     bestShopVoucher,
		BestPlatformVoucher: bestPlatformVoucher,
		BestFreeshipVoucher: bestFreeshipVoucher,
		AvailableVouchers:   validVouchers,
	}
}

func (t VoucherType) IsValid() bool {
	switch t {
	case VoucherTypeShop, VoucherTypePlatform, VoucherTypeFreeship:
		return true
	}
	return false
}

// MaxVoucherLifetime bounds how far in the future a voucher may expire.
const MaxVoucherLifetime = 365 * 24 * time.Hour

// Validate checks a voucher before it is stored. Vouchers change every user's effective price and are
// sent in Zalo messages, so values must be plausible and an expiry is mandatory (SEC-09).
// CollectURL is checked by the caller against the source's marketplace.
func (v *ProductVoucher) Validate(now time.Time) error {
	switch {
	case !v.VoucherType.IsValid():
		return errors.New("voucher_type must be shop_voucher, platform_voucher or freeship_voucher")
	case strings.TrimSpace(v.Title) == "" || utf8.RuneCountInString(v.Title) > 200:
		return errors.New("title is required (max 200 characters)")
	case len(v.VoucherCode) > 64:
		return errors.New("voucher_code is too long (max 64 characters)")
	case v.DiscountAmount < 0 || v.MinOrderValue < 0:
		return errors.New("discount_amount and min_order_value must not be negative")
	case v.DiscountPercent < 0 || v.DiscountPercent > 100:
		return errors.New("discount_percent must be between 0 and 100")
	case v.DiscountAmount == 0 && v.DiscountPercent == 0:
		return errors.New("discount_amount or discount_percent is required")
	case len(v.CollectURL) > 2048:
		return errors.New("collect_url is too long")
	case v.ExpiresAt == nil || !v.ExpiresAt.After(now) || v.ExpiresAt.After(now.Add(MaxVoucherLifetime)):
		return errors.New("expires_at is required and must be within one year")
	}
	return nil
}
