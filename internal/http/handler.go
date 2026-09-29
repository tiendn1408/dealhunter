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

type EnrichedTracking struct {
	ID                     uuid.UUID `json:"ID"`
	UserID                 uuid.UUID `json:"UserID"`
	ProductSourceID        uuid.UUID `json:"ProductSourceID"`
	Active                 bool      `json:"Active"`
	PollingIntervalSeconds int       `json:"PollingIntervalSeconds"`
	NextFetchAt            time.Time `json:"NextFetchAt"`
	CreatedAt              time.Time `json:"CreatedAt"`
	UpdatedAt              time.Time `json:"UpdatedAt"`
	Title                  string    `json:"Title,omitempty"`
	Platform               string    `json:"Platform,omitempty"`
	CanonicalURL           string    `json:"CanonicalURL,omitempty"`
	SellerName             string    `json:"SellerName,omitempty"`
	LastPrice              *int64    `json:"LastPrice,omitempty"`
	LastEffectivePrice     *int64    `json:"LastEffectivePrice,omitempty"`
	LastInStock            *bool     `json:"LastInStock,omitempty"`
}

func (h *Handler) enrichTracking(r *http.Request, t *domain.TrackedProduct) EnrichedTracking {
	enriched := EnrichedTracking{
		ID:                     t.ID,
		UserID:                 t.UserID,
		ProductSourceID:        t.ProductSourceID,
		Active:                 t.Active,
		PollingIntervalSeconds: t.PollingIntervalSeconds,
		NextFetchAt:            t.NextFetchAt,
		CreatedAt:              t.CreatedAt,
		UpdatedAt:              t.UpdatedAt,
	}

	if source, err := h.trackingService.GetProductSource(r.Context(), t.ProductSourceID); err == nil && source != nil {
		if source.RawTitle != nil {
			enriched.Title = *source.RawTitle
		}
		enriched.Platform = source.Platform
		enriched.CanonicalURL = source.CanonicalURL
		if source.SellerName != nil {
			enriched.SellerName = *source.SellerName
		}
		enriched.LastPrice = source.LastPrice
		enriched.LastEffectivePrice = source.LastEffectivePrice
		enriched.LastInStock = source.LastInStock
	}

	return enriched
}

func (h *Handler) ListTrackings(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	trackings, err := h.trackingService.ListTrackings(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	enrichedList := make([]EnrichedTracking, 0, len(trackings))
	for _, t := range trackings {
		enrichedList = append(enrichedList, h.enrichTracking(r, t))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": enrichedList,
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
	if err == nil && tracked != nil {
		enriched := h.enrichTracking(r, tracked)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(enriched)
		return
	}

	// Fallback: check if id is a product_source_id directly
	if source, err := h.trackingService.GetProductSource(r.Context(), id); err == nil && source != nil {
		enriched := EnrichedTracking{
			ProductSourceID:    source.ID,
			Active:             source.Active,
			Platform:           source.Platform,
			CanonicalURL:       source.CanonicalURL,
			LastPrice:          source.LastPrice,
			LastEffectivePrice: source.LastEffectivePrice,
			LastInStock:        source.LastInStock,
			CreatedAt:          source.CreatedAt,
			UpdatedAt:          source.UpdatedAt,
		}
		if source.RawTitle != nil {
			enriched.Title = *source.RawTitle
		}
		if source.SellerName != nil {
			enriched.SellerName = *source.SellerName
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(enriched)
		return
	}

	http.Error(w, "tracking not found", http.StatusNotFound)
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
