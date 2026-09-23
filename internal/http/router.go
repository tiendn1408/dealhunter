package router

import (
	"log/slog"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter(logger *slog.Logger, handler *Handler) *chi.Mux {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(RequestLogger(logger))

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/tracked-products", handler.TrackProduct)
		// r.Get("/tracked-products", handler.ListTrackings)
		// r.Get("/tracked-products/{id}", handler.GetTracking)
		r.Get("/tracked-products/{id}/prices", handler.GetTrackingPrices)
	})

	return r
}
