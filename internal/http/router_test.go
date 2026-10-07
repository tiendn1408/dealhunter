package router

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
		for _, path := range []string{"/api/v1/auth/google", "/api/v1/auth/guest", "/api/v1/auth/refresh", "/api/v1/auth/logout"} {
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
