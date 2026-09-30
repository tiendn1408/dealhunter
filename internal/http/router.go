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

	// Health check endpoint
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","app":"DealHunter"}`))
	})

	// Prometheus metrics endpoint
	r.Handle("/metrics", promhttp.Handler())

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","app":"DealHunter"}`))
		})

		r.Post("/tracked-products", handler.TrackProduct)
		r.Get("/tracked-products", handler.ListTrackings)
		r.Get("/tracked-products/{id}", handler.GetTracking)
		r.Get("/tracked-products/{id}/prices", handler.GetTrackingPrices)
		r.Post("/tracked-products/{id}/pause", handler.PauseTracking)
		r.Post("/tracked-products/{id}/resume", handler.ResumeTracking)

		// Phase 2: Alert Rules & Notifications
		r.Post("/tracked-products/{id}/alerts", handler.CreateAlert)
		r.Get("/tracked-products/{id}/alerts", handler.ListAlerts)
		r.Get("/alert-rules", handler.ListUserAlerts)
		r.Delete("/alerts/{alert_id}", handler.DeactivateAlert)
		r.Get("/alerts/{alert_id}/logs", handler.GetAlertLogs)
		r.Get("/notifications", handler.ListNotifications)
		r.Post("/notifications/{id}/read", handler.MarkNotificationAsRead)

		// Phase 2: User Profile & Zalo Connection
		r.Get("/users/me", handler.GetUserProfile)
		r.Post("/users/me/zalo", handler.ConnectZalo)
		r.Delete("/users/me/zalo", handler.DisconnectZalo)
		r.Get("/auth/zalo/status", handler.GetUserProfile)
		r.Post("/auth/zalo/disconnect", handler.DisconnectZalo)
		r.Post("/user/zalo/connect", handler.ConnectZalo)
		r.Get("/user/zalo/status", handler.GetUserProfile)
		r.Delete("/user/zalo", handler.DisconnectZalo)

		// Phase 3: Cross-platform Price Comparison
		r.Get("/products/{product_id}/comparison", handler.GetProductComparison)
		r.Post("/products/{product_id}/link-source", handler.LinkProductSource)
		r.Get("/product-groups", handler.ListProductGroups)
		r.Get("/tracked-products/{id}/comparison", handler.GetTrackedProductComparison)
	})

	return r
}
