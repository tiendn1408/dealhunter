package router

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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

	productID, err := h.resolveCanonicalProductID(r.Context(), rawID)
	if err != nil {
		http.Error(w, "product not found", http.StatusNotFound)
		return
	}

	suggestions, err := h.matchingService.GetPendingSuggestions(r.Context(), productID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	var productID uuid.UUID
	if tracked, err := h.trackingService.GetTrackingForUser(r.Context(), rawID, userID); err == nil && tracked != nil {
		if source, err := h.trackingService.GetProductSource(r.Context(), tracked.ProductSourceID); err == nil && source != nil {
			productID = source.ProductID
		}
	} else if source, err := h.trackingService.GetProductSource(r.Context(), rawID); err == nil && source != nil {
		productID = source.ProductID
	}

	if productID == uuid.Nil {
		http.Error(w, "tracking not found", http.StatusNotFound)
		return
	}

	suggestions, err := h.matchingService.GetPendingSuggestions(r.Context(), productID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := h.matchingService.AcceptSuggestion(r.Context(), userID, suggestionID); err != nil {
		if strings.Contains(err.Error(), "suggestion not found") {
			http.Error(w, "suggestion not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	_, err = h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.matchingService.DismissSuggestion(r.Context(), suggestionID); err != nil {
		if strings.Contains(err.Error(), "suggestion not found") {
			http.Error(w, "suggestion not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "dismissed",
		"id":     suggestionID,
	})
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

	productID, err := h.resolveCanonicalProductID(r.Context(), rawID)
	if err != nil {
		http.Error(w, "product not found", http.StatusNotFound)
		return
	}

	// Retrieve product comparison/sources to get reference title and price
	cmp, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil || cmp == nil || len(cmp.Sources) == 0 {
		http.Error(w, "product sources not found", http.StatusNotFound)
		return
	}

	primarySource := cmp.Sources[0]
	refPlatform := primarySource.Platform
	refTitle := cmp.ProductTitle
	refPrice := primarySource.EffectivePrice

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	result, err := h.matchingService.DiscoverAndMatch(r.Context(), userID, productID, refPlatform, refTitle, refPrice)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	var productID uuid.UUID
	if tracked, err := h.trackingService.GetTrackingForUser(r.Context(), rawID, userID); err == nil && tracked != nil {
		if source, err := h.trackingService.GetProductSource(r.Context(), tracked.ProductSourceID); err == nil && source != nil {
			productID = source.ProductID
		}
	} else if source, err := h.trackingService.GetProductSource(r.Context(), rawID); err == nil && source != nil {
		productID = source.ProductID
	}

	if productID == uuid.Nil {
		http.Error(w, "tracking not found", http.StatusNotFound)
		return
	}

	cmp, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil || cmp == nil || len(cmp.Sources) == 0 {
		http.Error(w, "product sources not found", http.StatusNotFound)
		return
	}

	primarySource := cmp.Sources[0]
	result, err := h.matchingService.DiscoverAndMatch(r.Context(), userID, productID, primarySource.Platform, cmp.ProductTitle, primarySource.EffectivePrice)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
