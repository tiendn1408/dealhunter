package shopee

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/product"
)

// newTestAdapter sends every request, item API included, to the local test server: unit tests never
// reach shopee.vn.
func newTestAdapter(server *httptest.Server) *ShopeeAdapter {
	a := NewShopeeAdapter()
	a.apiBase = server.URL
	return a
}

func TestShopeeAdapter_Name(t *testing.T) {
	adapter := NewShopeeAdapter()
	if adapter.Name() != "shopee" {
		t.Errorf("expected 'shopee', got '%s'", adapter.Name())
	}
}

// When the marketplace blocks us (anti-bot page) the adapter must fail, never invent a title,
// seller or price, and never re-use a previously stored price as a new reading.
func TestShopeeAdapter_BlockedPageFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`<html><head><title></title></head><body>Checking your browser...</body></html>`))
	}))
	defer server.Close()

	adapter := newTestAdapter(server)
	ctx := context.Background()
	testURL := server.URL + "/product-shopee.vn-i.111.222"

	if data, err := adapter.ResolveProduct(ctx, testURL); !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("ResolveProduct: expected ErrProductUnavailable, got data=%+v err=%v", data, err)
	}

	lastPrice := int64(1990000)
	source := &product.ProductSource{ID: uuid.New(), CanonicalURL: testURL, LastPrice: &lastPrice}
	if snap, err := adapter.FetchPrice(ctx, source); !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("FetchPrice: expected ErrProductUnavailable (no stale price), got snap=%+v err=%v", snap, err)
	}
}

func TestShopeeAdapter_ResolveProduct_LiveMockServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`
<!DOCTYPE html>
<html>
<head>
    <meta property="og:title" content="Chuot Khong Day Logitech MX Master 3S | Shopee Viet Nam" />
    <meta property="og:price:amount" content="1890000" />
    <meta property="og:site_name" content="Logitech Official" />
</head>
<body></body>
</html>
`))
	}))
	defer server.Close()

	adapter := newTestAdapter(server)
	ctx := context.Background()

	// Append shopee.vn to host so adapter validates platform
	testURL := server.URL + "/product-shopee.vn-i.111.222"
	data, err := adapter.ResolveProduct(ctx, testURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data.RawTitle != "Chuot Khong Day Logitech MX Master 3S" {
		t.Errorf("expected extracted title, got '%s'", data.RawTitle)
	}
	if data.Price.SalePrice != 1890000 {
		t.Errorf("expected price 1890000, got %d", data.Price.SalePrice)
	}
	// og:site_name names the site, not the seller: the seller stays unknown
	if data.SellerName != "" {
		t.Errorf("expected unknown seller, got '%s'", data.SellerName)
	}
}

// A 200 page that only has a <title> (anti-bot "Security Check", "product removed" pages) is not a product
func TestShopeeAdapter_TitleOnlyPageIsNotAProduct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html><head><title>Security Check</title><meta property="og:title" content="Security Check" /></head><body></body></html>`))
	}))
	defer server.Close()

	data, err := newTestAdapter(server).ResolveProduct(context.Background(), server.URL+"/product-shopee.vn-i.111.222")
	if !errors.Is(err, marketplace.ErrProductUnavailable) {
		t.Fatalf("expected ErrProductUnavailable, got data=%+v err=%v", data, err)
	}
}

// The item API path is parsed offline: prices come in Shopee's x100000 unit.
func TestShopeeAdapter_ItemAPI(t *testing.T) {
	apiCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v4/item/get" {
			http.NotFound(w, r)
			return
		}
		apiCalls++
		if r.URL.Query().Get("shopid") != "111" || r.URL.Query().Get("itemid") != "222" {
			t.Errorf("unexpected item API query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"error":0,"data":{"name":"Tai nghe Sony WH-1000XM5","price":629000000000,"price_before_discount":799000000000,"stock":3}}`))
	}))
	defer server.Close()

	data, err := newTestAdapter(server).ResolveProduct(context.Background(), server.URL+"/product-shopee.vn-i.111.222")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if apiCalls != 1 {
		t.Fatalf("expected 1 item API call to the test server, got %d", apiCalls)
	}
	if data.RawTitle != "Tai nghe Sony WH-1000XM5" || data.Price.SalePrice != 6290000 || data.Price.ListedPrice != 7990000 {
		t.Errorf("unexpected product data: %+v", data)
	}
	if data.ExternalProductID != "shopee-111-222" {
		t.Errorf("unexpected external id %q", data.ExternalProductID)
	}
}
