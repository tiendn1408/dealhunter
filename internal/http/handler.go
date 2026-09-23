package router

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/tracking"
)

type Handler struct {
	trackingService *tracking.TrackingService
	pricingService  *pricing.PricingService
}

func NewHandler(ts *tracking.TrackingService, ps *pricing.PricingService) *Handler {
	return &Handler{trackingService: ts, pricingService: ps}
}

type TrackRequest struct {
	URL string `json:"url"`
}

func (h *Handler) TrackProduct(w http.ResponseWriter, r *http.Request) {
	var req TrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	userID := uuid.New()

	tracked, err := h.trackingService.TrackURL(r.Context(), userID, req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id": tracked.ID,
		"product_source_id": tracked.ProductSourceID,
		"next_fetch_at": tracked.NextFetchAt,
	})
}

func (h *Handler) GetTrackingPrices(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr) // Assuming id here refers to productSourceID for simplicity
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Default from to 30 days ago, to to now
	to := time.Now()
	from := to.AddDate(0, 0, -30)

	snapshots, err := h.pricingService.GetHistory(r.Context(), sourceID, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"product_source_id": sourceID,
		"snapshots":         snapshots,
	})
}
