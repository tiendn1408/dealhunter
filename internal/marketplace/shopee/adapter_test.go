package shopee

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShopeeAdapter_Name(t *testing.T) {
	adapter := NewShopeeAdapter()
	if adapter.Name() != "shopee" {
		t.Errorf("expected 'shopee', got '%s'", adapter.Name())
	}
}

func TestShopeeAdapter_ResolveProduct_SlugFallback(t *testing.T) {
	adapter := NewShopeeAdapter()
	ctx := context.Background()

	url := "https://shopee.vn/Tai-nghe-Sony-WH-1000XM5-Chinh-Hang-i.88201679.22731853609"
	data, err := adapter.ResolveProduct(ctx, url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data.ExternalProductID != "shopee-88201679-22731853609" {
		t.Errorf("expected extID 'shopee-88201679-22731853609', got '%s'", data.ExternalProductID)
	}
	if data.RawTitle == "" {
		t.Errorf("expected non-empty title")
	}
	if data.Price.SalePrice < 0 {
		t.Errorf("expected non-negative price, got %d", data.Price.SalePrice)
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

	adapter := NewShopeeAdapter()
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
	if data.SellerName != "Logitech Official" {
		t.Errorf("expected seller 'Logitech Official', got '%s'", data.SellerName)
	}
}
