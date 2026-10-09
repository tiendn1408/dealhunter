package router

import (
	"context"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCORS_OnlyConfiguredOriginsGetCredentials(t *testing.T) {
	h := newTestHandler()
	h.SetCORSAllowedOrigins([]string{"https://dealhunter.vn"})
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), h)

	cases := []struct {
		origin  string
		allowed bool
	}{
		{"https://dealhunter.vn", true},
		{"https://evil.example", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/refresh", nil)
		req.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		got := w.Header().Get("Access-Control-Allow-Origin")
		if tc.allowed && (got != tc.origin || w.Header().Get("Access-Control-Allow-Credentials") != "true") {
			t.Errorf("origin %s: expected credentialed CORS, got allow-origin=%q", tc.origin, got)
		}
		if !tc.allowed && got != "" {
			t.Errorf("origin %s: expected no CORS headers, got allow-origin=%q", tc.origin, got)
		}
	}
}

// Login CSRF: cross-site form posts to /auth/* are rejected before reaching the handler
func TestAuthCSRFGuard(t *testing.T) {
	h := newTestHandler()
	h.SetCORSAllowedOrigins([]string{"https://dealhunter.vn"})
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), h)

	cases := []struct {
		name, origin, contentType string
		want                      int
	}{
		{"cross-site form post", "https://evil.example", "text/plain", http.StatusForbidden},
		{"foreign origin with json", "https://evil.example", "application/json", http.StatusForbidden},
		{"allowed origin form post", "https://dealhunter.vn", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType},
		{"no content type", "", "", http.StatusUnsupportedMediaType},
	}
	for _, tc := range cases {
		for _, path := range []string{"/api/v1/auth/google", "/api/v1/auth/guest", "/api/v1/auth/refresh", "/api/v1/auth/logout", "/api/v1/auth/zalo/disconnect"} {
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"id_token":"x"}`))
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.contentType != "" {
				req.Header.Set("Content-Type", tc.contentType)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Errorf("%s %s: expected %d, got %d", tc.name, path, tc.want, w.Code)
			}
		}
	}
}

// DoD group 1: every route that acts for a user requires an access token before any handler runs.
// New routes are covered automatically; only the explicitly public ones may answer without a token.
func TestEveryUserRouteRequiresAccessToken(t *testing.T) {
	h := newTestHandler()
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), h)

	public := map[string]bool{
		"GET /health": true, "GET /metrics": true, "GET /api/v1/health": true,
		"POST /api/v1/auth/guest": true, "POST /api/v1/auth/google": true,
		"POST /api/v1/auth/refresh": true, "POST /api/v1/auth/logout": true,
		"POST /api/v1/webhooks/zalo": true, "POST /api/v1/notifications/webhook/zalo": true,
	}
	checked := 0
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		// /metrics answers every method; it is restricted at deployment level (OPS-03)
		if public[method+" "+route] || route == "/metrics" || method == http.MethodOptions {
			return nil
		}
		path := strings.NewReplacer("{id}", uuid.NewString(), "{product_id}", uuid.NewString(), "{alert_id}", uuid.NewString()).Replace(route)
		req := httptest.NewRequest(method, path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a token: expected 401, got %d", method, route, w.Code)
		}
		checked++
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked < 30 {
		t.Fatalf("expected to check every user route, only checked %d", checked)
	}
}

// SEC-11: request bodies are capped at 64KB on every /api/v1 route, the Zalo webhook included.
func TestOversizedBodiesRejected(t *testing.T) {
	h := newWebhookTestHandler(&mockWebhookNotifRepo{})
	h.jwtManager = testJWTManager
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), h)
	big := `{"url":"` + strings.Repeat("a", 70<<10) + `"}`

	for _, path := range []string{"/api/v1/tracked-products", "/api/v1/webhooks/zalo", "/api/v1/auth/google"} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(big))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("%s with a 70KB body: expected 413, got %d", path, w.Code)
		}
	}

	// A body that does not declare its length is cut off at the limit instead of being read whole
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/zalo", io.MultiReader(strings.NewReader(big)))
	req.ContentLength = -1
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("chunked 70KB webhook body: expected 400, got %d", w.Code)
	}
}

// denyLimiter refuses everything, as a user over the scrape limit.
type denyLimiter struct{}

func (denyLimiter) Allow(context.Context, string) (bool, time.Duration, error) {
	return false, 90 * time.Second, nil
}

// Every request that makes the server call a marketplace is rate limited per user (429 + Retry-After)
// before any marketplace traffic.
func TestScrapeEndpointsRateLimited(t *testing.T) {
	store := newFakeStore()
	userID := uuid.New()
	src := store.addTrackedSource(userID, uuid.New())

	h := newTestHandler()
	h.trackingService = store.trackingService()
	h.SetComparisonService(comparison.NewComparisonService(&mockCompRepoForHandler{}, nil))
	h.SetScrapeRateLimiter(denyLimiter{})
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), h)

	for _, path := range []string{
		"/api/v1/tracked-products",
		"/api/v1/products/" + src.ProductID.String() + "/link-source",
	} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"url":"https://shopee.vn/x-i.1.2"}`))
		req.Header.Set("Content-Type", "application/json")
		authAs(req, userID)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "90" {
			t.Errorf("%s: expected 429 with Retry-After 90, got %d %q", path, w.Code, w.Header().Get("Retry-After"))
		}
	}
}

// keyLimiter refuses one key only, to check which key a limiter is asked about.
type keyLimiter struct{ deny string }

func (l keyLimiter) Allow(_ context.Context, key string) (bool, time.Duration, error) {
	return key != l.deny, time.Minute, nil
}

// The per-IP scrape limit applies whatever the user: many guest accounts from one address share it.
func TestScrapeLimitedPerClientIP(t *testing.T) {
	h := newTestHandler()
	h.trackingService = newFakeStore().trackingService()
	h.SetScrapeIPRateLimiter(keyLimiter{deny: "203.0.113.7"})
	r := NewRouter(slog.New(slog.NewTextHandler(io.Discard, nil)), h)

	for _, ip := range []string{"203.0.113.7", "198.51.100.9"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tracked-products", strings.NewReader(`{"url":"https://shopee.vn/x-i.1.2"}`))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = ip + ":1234"
		authAs(req, uuid.New())
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req) // past the limiter the request fails (the fake store has no registry); only 429 matters
		limited := w.Code == http.StatusTooManyRequests
		if limited != (ip == "203.0.113.7") {
			t.Errorf("%s: limited=%v (status %d)", ip, limited, w.Code)
		}
	}
}
