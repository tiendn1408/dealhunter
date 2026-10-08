package tiktok

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/pkg/retry"
)

func TestTikTokAdapter_Name(t *testing.T) {
	adapter := NewTikTokAdapter()
	if adapter.Name() != "tiktok" {
		t.Errorf("expected 'tiktok', got '%s'", adapter.Name())
	}
}

// When the marketplace blocks us (anti-bot page) the adapter must fail, never invent a title,
// seller or price, and never re-use a previously stored price as a new reading.
func TestTikTokAdapter_BlockedPageFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`<html><head><title></title></head><body>Checking your browser...</body></html>`))
	}))
	defer server.Close()

	adapter := NewTikTokAdapter()
	ctx := context.Background()
	testURL := server.URL + "/view/product/555666777-tiktok.com"

	if data, err := adapter.ResolveProduct(ctx, testURL); !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("ResolveProduct: expected ErrProductUnavailable, got data=%+v err=%v", data, err)
	}

	lastPrice := int64(1990000)
	source := &product.ProductSource{ID: uuid.New(), CanonicalURL: testURL, LastPrice: &lastPrice}
	if snap, err := adapter.FetchPrice(ctx, source); !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("FetchPrice: expected ErrProductUnavailable (no stale price), got snap=%+v err=%v", snap, err)
	}

	// The block is classified as temporary, so the worker retries instead of giving up (DATA-01)
	_, err := adapter.FetchPrice(ctx, source)
	if retry.Code(err) != "blocked" || !retry.IsRetryable(err) {
		t.Fatalf("expected a retryable 'blocked' cause, got code=%q err=%v", retry.Code(err), err)
	}
}

func TestTikTokAdapter_ResolveProduct_LiveMockServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`
<!DOCTYPE html>
<html>
<head>
    <meta property="og:title" content="Loa Bluetooth JBL Flip 6 Chinh Hang | TikTok Shop" />
    <meta property="og:price:amount" content="2490000" />
    <meta property="og:site_name" content="JBL Official Store" />
</head>
<body></body>
</html>
`))
	}))
	defer server.Close()

	adapter := NewTikTokAdapter()
	ctx := context.Background()

	testURL := server.URL + "/view/product/555666777-tiktok.com"
	data, err := adapter.ResolveProduct(ctx, testURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data.RawTitle != "Loa Bluetooth JBL Flip 6 Chinh Hang" {
		t.Errorf("expected title 'Loa Bluetooth JBL Flip 6 Chinh Hang', got '%s'", data.RawTitle)
	}
	if data.Price.SalePrice != 2490000 {
		t.Errorf("expected price 2490000, got %d", data.Price.SalePrice)
	}
	// og:site_name names the site, not the seller: the seller stays unknown
	if data.SellerName != "" {
		t.Errorf("expected unknown seller, got '%s'", data.SellerName)
	}
}

// A 200 page that only has a <title> (anti-bot "Security Check", "product removed" pages) is not a product
func TestTikTokAdapter_TitleOnlyPageIsNotAProduct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html><head><title>Security Check</title><meta property="og:title" content="Security Check" /></head><body></body></html>`))
	}))
	defer server.Close()

	data, err := NewTikTokAdapter().ResolveProduct(context.Background(), server.URL+"/view/product/555666777-tiktok.com")
	if !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("expected ErrProductUnavailable, got data=%+v err=%v", data, err)
	}
}
