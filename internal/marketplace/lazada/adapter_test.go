package lazada

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLazadaAdapter_Name(t *testing.T) {
	adapter := NewLazadaAdapter()
	if adapter.Name() != "lazada" {
		t.Errorf("expected 'lazada', got '%s'", adapter.Name())
	}
}

func TestLazadaAdapter_ResolveProduct_SlugFallback(t *testing.T) {
	adapter := NewLazadaAdapter()
	ctx := context.Background()

	url := "https://www.lazada.vn/products/ban-phim-co-akko-mod007-i1856950796.html"
	data, err := adapter.ResolveProduct(ctx, url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data.ExternalProductID != "lazada-1856950796" {
		t.Errorf("expected extID 'lazada-1856950796', got '%s'", data.ExternalProductID)
	}
	if data.RawTitle == "" {
		t.Errorf("expected non-empty title")
	}
	if data.Price.SalePrice < 0 {
		t.Errorf("expected non-negative price, got %d", data.Price.SalePrice)
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
	if data.SellerName != "Dell LazMall Flagship" {
		t.Errorf("expected seller 'Dell LazMall Flagship', got '%s'", data.SellerName)
	}
}
