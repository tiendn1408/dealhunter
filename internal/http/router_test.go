package router

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
