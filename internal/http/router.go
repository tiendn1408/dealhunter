package router

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func NewRouter(logger *slog.Logger, handler *Handler) *chi.Mux {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(RequestLogger(logger))

	// Prometheus metrics endpoint
	r.Handle("/metrics", promhttp.Handler())

	// Basic CORS middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-CSRF-Token, X-User-ID")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/tracked-products", handler.TrackProduct)
		r.Get("/tracked-products", handler.ListTrackings)
		r.Get("/tracked-products/{id}", handler.GetTracking)
		r.Get("/tracked-products/{id}/prices", handler.GetTrackingPrices)
		r.Post("/tracked-products/{id}/pause", handler.PauseTracking)
		r.Post("/tracked-products/{id}/resume", handler.ResumeTracking)
	})

	return r
}
