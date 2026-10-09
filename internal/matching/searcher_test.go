package matching

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiendang/deal-hunter/internal/marketplace/crawler"
)

// A blocked or unreadable Shopee search is a failure; only a real, readable empty answer is "no candidates".
func TestSearchShopee_BlockedIsAnError(t *testing.T) {
	cases := []struct {
		name, body string
		wantErr    bool
		wantN      int
	}{
		{"results", `{"error":0,"items":[{"item_basic":{"itemid":2,"shopid":1,"name":"Tai nghe","price":629000000000}}]}`, false, 1},
		{"genuinely empty", `{"error":0,"items":[]}`, false, 0},
		{"anti-bot error code", `{"error":90309999}`, true, 0},
		{"items missing", `{"error":0}`, true, 0},
		{"items null", `{"error":0,"items":null}`, true, 0},
		{"empty answer with items null but a count", `{"error":0,"items":null,"total_count":0,"nomore":true}`, false, 0},
		{"empty answer with only nomore", `{"error":0,"items":null,"nomore":true}`, false, 0},
		{"not JSON", `<html>verify</html>`, true, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c, _ := crawler.NewClient(crawler.ClientOptions{Timeout: 5 * time.Second})
			c.SetRateLimiter(crawler.NewDomainRateLimiter(0))
			s := &MultiPlatformSearcher{shopeeBase: srv.URL, crawler: c}

			got, err := s.Search(context.Background(), "shopee", "tai nghe")
			if tc.wantErr != (err != nil) || (err != nil && !errors.Is(err, ErrSearchUnavailable)) {
				t.Fatalf("err = %v, want ErrSearchUnavailable=%v", err, tc.wantErr)
			}
			if len(got) != tc.wantN {
				t.Fatalf("got %d candidates, want %d", len(got), tc.wantN)
			}
		})
	}
}
