package lazada

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

func TestLazadaAdapter_Name(t *testing.T) {
	adapter := NewLazadaAdapter()
	if adapter.Name() != "lazada" {
		t.Errorf("expected 'lazada', got '%s'", adapter.Name())
	}
}

// When the marketplace blocks us (anti-bot page) the adapter must fail, never invent a title,
// seller or price, and never re-use a previously stored price as a new reading.
func TestLazadaAdapter_BlockedPageFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`<html><head><title></title></head><body>Checking your browser...</body></html>`))
	}))
	defer server.Close()

	adapter := NewLazadaAdapter()
	ctx := context.Background()
	testURL := server.URL + "/products/dell-lazada.vn-i987654.html"

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

func TestLazadaAdapter_ResolveProduct_LiveMockServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`
<!DOCTYPE html>
<html>
<head>
    <meta property="og:title" content="Man Hinh Dell UltraSharp U2723QE 4K - Mua ngay | Lazada.vn" />
    <meta property="og:price:amount" content="12590000" />
    <meta property="og:site_name" content="Dell LazMall Flagship" />
</head>
<body></body>
</html>
`))
	}))
	defer server.Close()

	adapter := NewLazadaAdapter()
	ctx := context.Background()

	testURL := server.URL + "/products/dell-lazada.vn-i987654.html"
	data, err := adapter.ResolveProduct(ctx, testURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data.RawTitle != "Man Hinh Dell UltraSharp U2723QE 4K" {
		t.Errorf("expected title 'Man Hinh Dell UltraSharp U2723QE 4K', got '%s'", data.RawTitle)
	}
	if data.Price.SalePrice != 12590000 {
		t.Errorf("expected price 12590000, got %d", data.Price.SalePrice)
	}
	// og:site_name names the site, not the seller: the seller stays unknown
	if data.SellerName != "" {
		t.Errorf("expected unknown seller, got '%s'", data.SellerName)
	}
}

// A 200 page that only has a <title> (anti-bot "Security Check", "product removed" pages) is not a product
func TestLazadaAdapter_TitleOnlyPageIsNotAProduct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html><head><title>Security Check</title><meta property="og:title" content="Security Check" /></head><body></body></html>`))
	}))
	defer server.Close()

	data, err := NewLazadaAdapter().ResolveProduct(context.Background(), server.URL+"/products/dell-lazada.vn-i987654.html")
	if !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("expected ErrProductUnavailable, got data=%+v err=%v", data, err)
	}
}
