package router

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
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

	// 1. Resolve a tracked_product ID or an accessible product_source ID to the source
	if h.trackingService != nil {
		source, err := h.trackingService.ResolveSourceForUser(r.Context(), userID, sourceID)
		if err != nil {
			h.accessError(w, r, err, "product source not found")
			return
		}
		sourceID = source.ID
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
		h.serverError(w, r, err)
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

// CreateTrackedProductVoucher handles POST /api/v1/tracked-products/{id}/vouchers.
// Vouchers are global for a product source (every tracker's effective price and Zalo alerts use them),
// so only admins (ADMIN_EMAILS) may create them (SEC-09).
func (h *Handler) CreateTrackedProductVoucher(w http.ResponseWriter, r *http.Request) {
	if h.voucherRepo == nil || h.trackingService == nil {
		http.Error(w, "voucher service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if _, ok := h.requireAdmin(w, r); !ok {
		return
	}

	if tracked, err := h.trackingService.GetTracking(r.Context(), sourceID); err == nil && tracked != nil {
		sourceID = tracked.ProductSourceID
	}
	source, err := h.trackingService.GetProductSource(r.Context(), sourceID)
	if err != nil || source == nil {
		http.Error(w, "product source not found", http.StatusNotFound)
		return
	}

	var req struct {
		VoucherType     voucher.VoucherType `json:"voucher_type"`
		VoucherCode     string              `json:"voucher_code,omitempty"`
		Title           string              `json:"title"`
		DiscountAmount  int64               `json:"discount_amount"`
		DiscountPercent int                 `json:"discount_percent"`
		MinOrderValue   int64               `json:"min_order_value"`
		CollectURL      string              `json:"collect_url,omitempty"`
		ExpiresAt       *time.Time          `json:"expires_at"`
	}

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	now := time.Now()
	v := &voucher.ProductVoucher{
		ID:              uuid.New(),
		ProductSourceID: source.ID,
		VoucherType:     req.VoucherType,
		VoucherCode:     strings.TrimSpace(req.VoucherCode),
		Title:           strings.TrimSpace(req.Title),
		DiscountAmount:  req.DiscountAmount,
		DiscountPercent: req.DiscountPercent,
		MinOrderValue:   req.MinOrderValue,
		CollectURL:      strings.TrimSpace(req.CollectURL),
		ExpiresAt:       req.ExpiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := v.Validate(now); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if v.CollectURL != "" && !h.isMarketplaceURL(v.CollectURL, source.Platform) {
		http.Error(w, "collect_url must be an https link on the product's marketplace", http.StatusBadRequest)
		return
	}

	if err := h.voucherRepo.UpsertVoucher(r.Context(), v); err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(v)
}

// isMarketplaceURL accepts only https links on the given marketplace's own hosts, so a voucher cannot
// point users (via the web app or Zalo) at a phishing page.
func (h *Handler) isMarketplaceURL(raw, platform string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return false
	}
	p, err := h.trackingService.DetectPlatform(raw)
	return err == nil && p == platform
}
