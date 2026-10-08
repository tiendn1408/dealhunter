package router

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/matching"
	"github.com/tiendang/deal-hunter/internal/tracking"
)

// GetMatchSuggestions handles GET /api/v1/products/{product_id}/match-suggestions
func (h *Handler) GetMatchSuggestions(w http.ResponseWriter, r *http.Request) {
	if h.matchingService == nil {
		http.Error(w, "matching service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "product_id")
	if idStr == "" {
		idStr = chi.URLParam(r, "id")
	}
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid product id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "product not found")
		return
	}

	suggestions, err := h.matchingService.GetPendingSuggestions(r.Context(), productID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"product_id":  productID,
		"suggestions": suggestions,
	})
}

// GetTrackedProductMatchSuggestions handles GET /api/v1/tracked-products/{id}/match-suggestions
func (h *Handler) GetTrackedProductMatchSuggestions(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "tracking not found")
		return
	}

	suggestions, err := h.matchingService.GetPendingSuggestions(r.Context(), productID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"product_id":  productID,
		"suggestions": suggestions,
	})
}

// AcceptMatchSuggestion handles POST /api/v1/products/{product_id}/match-suggestions/{id}/accept
func (h *Handler) AcceptMatchSuggestion(w http.ResponseWriter, r *http.Request) {
	if h.matchingService == nil {
		http.Error(w, "matching service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	suggestionID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid suggestion id", http.StatusBadRequest)
		return
	}

	userID, productID, ok := h.suggestionScope(w, r)
	if !ok {
		return
	}
	if !h.allowScrape(w, r, userID) {
		return
	}
	if err := h.matchingService.AcceptSuggestion(r.Context(), userID, productID, suggestionID); err != nil {
		switch {
		case errors.Is(err, matching.ErrSuggestionNotFound):
			http.Error(w, "suggestion not found", http.StatusNotFound)
		case errors.Is(err, tracking.ErrGroupShared):
			http.Error(w, msgGroupShared, http.StatusConflict)
		case errors.Is(err, tracking.ErrSourceInOtherGroup):
			http.Error(w, "Sản phẩm gợi ý đang thuộc một nhóm so sánh khác", http.StatusConflict)
		case errors.Is(err, marketplace.ErrProductUnavailable):
			http.Error(w, "Không đọc được thông tin sản phẩm từ sàn. Vui lòng thử lại sau.", http.StatusBadGateway)
		default:
			h.serverError(w, r, err)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "accepted",
		"id":     suggestionID,
	})
}

// DismissMatchSuggestion handles POST /api/v1/products/{product_id}/match-suggestions/{id}/dismiss
func (h *Handler) DismissMatchSuggestion(w http.ResponseWriter, r *http.Request) {
	if h.matchingService == nil {
		http.Error(w, "matching service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	suggestionID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid suggestion id", http.StatusBadRequest)
		return
	}

	userID, productID, ok := h.suggestionScope(w, r)
	if !ok {
		return
	}

	if err := h.matchingService.DismissSuggestion(r.Context(), userID, productID, suggestionID); err != nil {
		if errors.Is(err, matching.ErrSuggestionNotFound) {
			http.Error(w, "suggestion not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, tracking.ErrGroupShared) {
			http.Error(w, msgGroupShared, http.StatusConflict)
			return
		}
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "dismissed",
		"id":     suggestionID,
	})
}

// suggestionScope authenticates the caller and resolves {product_id} to a product group they track (SEC-08).
func (h *Handler) suggestionScope(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	rawID, err := uuid.Parse(chi.URLParam(r, "product_id"))
	if err != nil {
		http.Error(w, "invalid product id", http.StatusBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return uuid.Nil, uuid.Nil, false
	}
	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "suggestion not found")
		return uuid.Nil, uuid.Nil, false
	}
	return userID, productID, true
}

// TriggerAutoMatch handles POST /api/v1/products/{product_id}/auto-match
func (h *Handler) TriggerAutoMatch(w http.ResponseWriter, r *http.Request) {
	if h.matchingService == nil {
		http.Error(w, "matching service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "product_id")
	if idStr == "" {
		idStr = chi.URLParam(r, "id")
	}
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid product id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "product not found")
		return
	}

	// Retrieve product comparison/sources to get reference title and price
	if !h.allowScrape(w, r, userID) {
		return
	}
	cmp, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil || cmp == nil || len(cmp.Sources) == 0 {
		http.Error(w, "product sources not found", http.StatusNotFound)
		return
	}

	primarySource := cmp.Sources[0]
	refPlatform := primarySource.Platform
	refTitle := cmp.ProductTitle
	// Sources are ordered by price with unknown prices last; no price means matching cannot run yet
	var refPrice int64
	if primarySource.EffectivePrice != nil {
		refPrice = *primarySource.EffectivePrice
	}

	result, err := h.matchingService.DiscoverAndMatch(r.Context(), userID, productID, refPlatform, refTitle, refPrice)
	if errors.Is(err, matching.ErrNoReferencePrice) {
		http.Error(w, "product has no price yet; try again after the first price fetch", http.StatusConflict)
		return
	}
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// TriggerTrackedProductAutoMatch handles POST /api/v1/tracked-products/{id}/auto-match
func (h *Handler) TriggerTrackedProductAutoMatch(w http.ResponseWriter, r *http.Request) {
	if h.matchingService == nil {
		http.Error(w, "matching service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "tracking not found")
		return
	}

	if !h.allowScrape(w, r, userID) {
		return
	}
	cmp, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil || cmp == nil || len(cmp.Sources) == 0 {
		http.Error(w, "product sources not found", http.StatusNotFound)
		return
	}

	primarySource := cmp.Sources[0]
	var refPrice int64
	if primarySource.EffectivePrice != nil {
		refPrice = *primarySource.EffectivePrice
	}
	result, err := h.matchingService.DiscoverAndMatch(r.Context(), userID, productID, primarySource.Platform, cmp.ProductTitle, refPrice)
	if errors.Is(err, matching.ErrNoReferencePrice) {
		http.Error(w, "product has no price yet; try again after the first price fetch", http.StatusConflict)
		return
	}
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
