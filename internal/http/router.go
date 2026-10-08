package router

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func NewRouter(logger *slog.Logger, handler *Handler) *chi.Mux {
	r := chi.NewRouter()
	handler.logger = logger

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(RequestLogger(logger))

	r.Use(corsMiddleware(handler.corsAllowedOrigins))

	// Health check endpoint
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","app":"DealHunter"}`))
	})

	// Prometheus metrics endpoint
	r.Handle("/metrics", promhttp.Handler())

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(LimitBody(maxJSONBodyBytes))

		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok","app":"DealHunter"}`))
		})

		// Phase 1 Foundation / GAP-02: Authentication & Guest Data Migration
		r.Route("/auth", func(r chi.Router) {
			r.Use(authCSRFGuard(handler.corsAllowedOrigins))
			r.Post("/guest", handler.StartGuestSession)
			r.Post("/google", handler.GoogleLogin)
			r.Post("/refresh", handler.RefreshSession)
			r.Post("/logout", handler.Logout)
			r.With(handler.requireAccessToken).Get("/me", handler.GetCurrentUser)
			// Inside the group so the CSRF guard covers it like every other POST /auth/*
			r.With(handler.requireAccessToken).Get("/zalo/status", handler.GetUserProfile)
			r.With(handler.requireAccessToken).Post("/zalo/disconnect", handler.DisconnectZalo)
		})

		// GAP-04: Zalo OA & ZNS Webhooks (authenticated by the Zalo signature, not a user token)
		r.Post("/webhooks/zalo", handler.HandleZaloWebhook)
		r.Post("/notifications/webhook/zalo", handler.HandleZaloWebhook)

		// Everything below acts for a signed-in user (guest or member): a valid access token is required
		// before any handler runs. Handlers still resolve the user and check ownership themselves.
		r.Group(func(r chi.Router) {
			r.Use(handler.requireAccessToken)

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
			r.Post("/users/me/zalo/otp", handler.RequestZaloOTP)
			r.Post("/users/me/zalo", handler.ConnectZalo)
			r.Delete("/users/me/zalo", handler.DisconnectZalo)
			r.Post("/user/zalo/connect", handler.ConnectZalo)
			r.Get("/user/zalo/status", handler.GetUserProfile)
			r.Delete("/user/zalo", handler.DisconnectZalo)

			// Phase 3: Cross-platform Price Comparison
			r.Get("/products/{product_id}/comparison", handler.GetProductComparison)
			r.Post("/products/{product_id}/link-source", handler.LinkProductSource)
			r.Get("/product-groups", handler.ListProductGroups)
			r.Get("/tracked-products/{id}/comparison", handler.GetTrackedProductComparison)

			// GAP-03: Cross-platform Auto-Matching & Suggestions
			r.Get("/products/{product_id}/match-suggestions", handler.GetMatchSuggestions)
			r.Post("/products/{product_id}/match-suggestions/{id}/accept", handler.AcceptMatchSuggestion)
			r.Post("/products/{product_id}/match-suggestions/{id}/dismiss", handler.DismissMatchSuggestion)
			r.Post("/products/{product_id}/auto-match", handler.TriggerAutoMatch)
			r.Get("/tracked-products/{id}/match-suggestions", handler.GetTrackedProductMatchSuggestions)
			r.Post("/tracked-products/{id}/auto-match", handler.TriggerTrackedProductAutoMatch)

			// Phase 3.5.2: Voucher Intelligence & 2-Step Combo
			r.Get("/tracked-products/{id}/vouchers", handler.GetTrackedProductVouchers)
			r.Post("/tracked-products/{id}/vouchers", handler.CreateTrackedProductVoucher)
		})
	})

	return r
}

// authCSRFGuard blocks cross-site login/logout CSRF on POST /auth/*: the request must be JSON
// (an HTML form cannot send application/json without a CORS preflight) and, when the browser
// sends an Origin, it must be an allowed origin.
func authCSRFGuard(allowedOrigins []string) func(http.Handler) http.Handler {
	allowAny, allowed := parseOrigins(allowedOrigins)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				if origin := r.Header.Get("Origin"); origin != "" && !allowAny && !allowed[origin] {
					http.Error(w, "origin not allowed", http.StatusForbidden)
					return
				}
				if mt := strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0]); !strings.EqualFold(mt, "application/json") {
					http.Error(w, "content-type must be application/json", http.StatusUnsupportedMediaType)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func parseOrigins(origins []string) (bool, map[string]bool) {
	allowAny := false
	allowed := make(map[string]bool, len(origins))
	for _, o := range origins {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "*" {
			allowAny = true
		} else if o != "" {
			allowed[o] = true
		}
	}
	return allowAny, allowed
}

// corsMiddleware allows credentialed requests (refresh-token cookie) from the configured origins only.
// "*" in the list echoes any origin and must only be used in development.
func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	allowAny, allowed := parseOrigins(allowedOrigins)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && (allowAny || allowed[origin]) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type")
				// Lets a cross-origin web app read how long to wait after a 429
				w.Header().Set("Access-Control-Expose-Headers", "Retry-After")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			w.Header().Add("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireAccessToken rejects a request without a valid access token (signature, issuer, expiry, role)
// with 401 before it reaches a handler, so no user route can be served anonymously by mistake.
func (h *Handler) requireAccessToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := h.bearerClaims(r); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
