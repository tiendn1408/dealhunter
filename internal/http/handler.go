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

func getUserID(r *http.Request) uuid.UUID {
	val := r.Header.Get("X-User-ID")
	if parsed, err := uuid.Parse(val); err == nil {
		return parsed
	}
	// Fallback to a deterministic demo anonymous user ID
	return uuid.MustParse("00000000-0000-0000-0000-000000000001")
}

type TrackRequest struct {
	URL string `json:"url"`
}

func (h *Handler) TrackProduct(w http.ResponseWriter, r *http.Request) {
	var req TrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, "invalid request: url is required", http.StatusBadRequest)
		return
	}

	userID := getUserID(r)

	tracked, err := h.trackingService.TrackURL(r.Context(), userID, req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                tracked.ID,
		"product_source_id": tracked.ProductSourceID,
		"next_fetch_at":     tracked.NextFetchAt,
	})
}

func (h *Handler) ListTrackings(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	trackings, err := h.trackingService.ListTrackings(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": trackings,
	})
}

func (h *Handler) GetTracking(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	tracked, err := h.trackingService.GetTracking(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tracked)
}

func (h *Handler) GetTrackingPrices(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	// Resolve to productSourceID if the passed ID is a tracked_product ID
	if tracked, err := h.trackingService.GetTracking(r.Context(), sourceID); err == nil && tracked != nil {
		sourceID = tracked.ProductSourceID
	}

	to := time.Now()
	from := to.AddDate(0, 0, -30)

	if qFrom := r.URL.Query().Get("from"); qFrom != "" {
		if t, err := time.Parse("2006-01-02", qFrom); err == nil {
			from = t
		}
	}
	if qTo := r.URL.Query().Get("to"); qTo != "" {
		if t, err := time.Parse("2006-01-02", qTo); err == nil {
			to = t.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
		}
	}

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

func (h *Handler) PauseTracking(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := h.trackingService.PauseTracking(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "paused",
		"id":     id,
	})
}

func (h *Handler) ResumeTracking(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := h.trackingService.ResumeTracking(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "resumed",
		"id":     id,
	})
}
