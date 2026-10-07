package router

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/voucher"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
)

// GetTrackedProductVouchers handles GET /api/v1/tracked-products/{id}/vouchers
func (h *Handler) GetTrackedProductVouchers(w http.ResponseWriter, r *http.Request) {
	if h.voucherRepo == nil {
		http.Error(w, "voucher service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var productID uuid.UUID
	var platform string
	var canonicalURL string
	var affiliateURL string
	var listedPrice int64
	var shippingFee int64

	// 1. Resolve to productSourceID if the passed ID is a tracked_product ID
	if h.trackingService != nil {
		if tracked, err := h.trackingService.GetTracking(r.Context(), sourceID); err == nil && tracked != nil {
			sourceID = tracked.ProductSourceID
		}
		source, err := h.trackingService.GetProductSource(r.Context(), sourceID)
		if err != nil || source == nil {
			http.Error(w, "product source not found", http.StatusNotFound)
			return
		}
		productID = source.ProductID
		platform = source.Platform
		canonicalURL = source.CanonicalURL
		if source.LastPrice != nil {
			listedPrice = *source.LastPrice
		}
		if source.LastShippingFee != nil {
			shippingFee = *source.LastShippingFee
		}
	}

	subID := affiliate.FormatSubID(userID, productID)
	if h.affiliateTransformer != nil && canonicalURL != "" {
		affiliateURL = h.affiliateTransformer.Transform(canonicalURL, platform, subID)
	} else {
		affiliateURL = canonicalURL
	}

	// 2. Query vouchers for this product source
	vouchers, err := h.voucherRepo.GetVouchersBySourceID(r.Context(), sourceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Only real vouchers are shown; no voucher data is ever generated. An empty list is a valid answer.

	// 3. Enrich vouchers with affiliate collect URL for Early Cookie Drop
	for _, v := range vouchers {
		if v.CollectURL != "" {
			if h.affiliateTransformer != nil {
				v.AffiliateCollectURL = h.affiliateTransformer.Transform(v.CollectURL, platform, subID)
			} else {
				v.AffiliateCollectURL = v.CollectURL
			}
		}
	}

	// 4. Calculate effective price with 2-step combo savings
	calc := voucher.CalculateEffectivePrice(listedPrice, shippingFee, vouchers)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"product_source_id": sourceID,
		"product_id":        productID,
		"platform":          platform,
		"canonical_url":     canonicalURL,
		"affiliate_url":     affiliateURL,
		"calculation":       calc,
		"vouchers":          calc.AvailableVouchers,
	})
}

func (h *Handler) CreateTrackedProductVoucher(w http.ResponseWriter, r *http.Request) {
	if h.voucherRepo == nil {
		http.Error(w, "voucher service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if _, err := h.resolveUserID(r); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if h.trackingService != nil {
		if tracked, err := h.trackingService.GetTracking(r.Context(), sourceID); err == nil && tracked != nil {
			sourceID = tracked.ProductSourceID
		} else {
			if source, err := h.trackingService.GetProductSource(r.Context(), sourceID); err != nil || source == nil {
				http.Error(w, "product source not found", http.StatusNotFound)
				return
			}
		}
	}

	var req struct {
		VoucherType     voucher.VoucherType `json:"voucher_type"`
		VoucherCode     string              `json:"voucher_code,omitempty"`
		Title           string              `json:"title"`
		DiscountAmount  int64               `json:"discount_amount"`
		DiscountPercent int                 `json:"discount_percent"`
		MinOrderValue   int64               `json:"min_order_value"`
		CollectURL      string              `json:"collect_url,omitempty"`
		ExpiresInDays   *int                `json:"expires_in_days,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		http.Error(w, "voucher title is required", http.StatusBadRequest)
		return
	}

	now := time.Now()
	var expiresAt *time.Time
	if req.ExpiresInDays != nil && *req.ExpiresInDays > 0 {
		exp := now.AddDate(0, 0, *req.ExpiresInDays)
		expiresAt = &exp
	}

	v := &voucher.ProductVoucher{
		ID:              uuid.New(),
		ProductSourceID: sourceID,
		VoucherType:     req.VoucherType,
		VoucherCode:     req.VoucherCode,
		Title:           req.Title,
		DiscountAmount:  req.DiscountAmount,
		DiscountPercent: req.DiscountPercent,
		MinOrderValue:   req.MinOrderValue,
		CollectURL:      req.CollectURL,
		ExpiresAt:       expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := h.voucherRepo.UpsertVoucher(r.Context(), v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(v)
}
