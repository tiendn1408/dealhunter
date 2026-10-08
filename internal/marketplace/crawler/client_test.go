package crawler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiendang/deal-hunter/pkg/retry"
)

// Non-2xx pages are never handed to the extractor (an error page can still carry og:price tags),
// and the failure is classified for the worker (DATA-01).
func TestFetch_ClassifiesHTTPFailures(t *testing.T) {
	cases := []struct {
		status    int
		code      string
		retryable bool
	}{
		{http.StatusForbidden, "blocked", true},
		{http.StatusTooManyRequests, "rate_limited", true},
		{http.StatusBadGateway, "server_error", true},
		{http.StatusNotFound, "not_found", false},
		{http.StatusGone, "not_found", false},
		{http.StatusBadRequest, "http_400", false},
	}
	for _, tc := range cases {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			w.Write([]byte(`<meta property="og:price:amount" content="6290000" />`))
		}))
		c, _ := NewClient(ClientOptions{Timeout: 5 * time.Second})
		resp, err := c.Fetch(context.Background(), server.URL+"/p", nil)
		server.Close()

		if resp != nil || err == nil {
			t.Fatalf("HTTP %d: expected an error and no body, got resp=%v err=%v", tc.status, resp != nil, err)
		}
		if got := retry.Code(err); got != tc.code {
			t.Errorf("HTTP %d: expected code %q, got %q", tc.status, tc.code, got)
		}
		if got := retry.IsRetryable(err); got != tc.retryable {
			t.Errorf("HTTP %d: expected retryable=%v, got %v", tc.status, tc.retryable, got)
		}
	}
}

func TestFetch_TimeoutIsRetryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
	}))
	defer server.Close()

	c, _ := NewClient(ClientOptions{Timeout: 50 * time.Millisecond})
	_, err := c.Fetch(context.Background(), server.URL+"/p", nil)
	if retry.Code(err) != "timeout" || !retry.IsRetryable(err) {
		t.Fatalf("expected a retryable timeout, got code=%q err=%v", retry.Code(err), err)
	}
}
