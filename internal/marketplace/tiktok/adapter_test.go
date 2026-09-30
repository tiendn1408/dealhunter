package tiktok

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTikTokAdapter_Name(t *testing.T) {
	adapter := NewTikTokAdapter()
	if adapter.Name() != "tiktok" {
		t.Errorf("expected 'tiktok', got '%s'", adapter.Name())
	}
}

func TestTikTokAdapter_ResolveProduct_SlugFallback(t *testing.T) {
	adapter := NewTikTokAdapter()
	ctx := context.Background()

	url := "https://shop.tiktok.com/view/product/1729482910294819284"
	data, err := adapter.ResolveProduct(ctx, url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if data.ExternalProductID != "tiktok-1729482910294819284" {
		t.Errorf("expected extID 'tiktok-1729482910294819284', got '%s'", data.ExternalProductID)
	}
	if data.RawTitle == "" {
		t.Errorf("expected non-empty title")
	}
	if data.Price.SalePrice < 0 {
		t.Errorf("expected non-negative price, got %d", data.Price.SalePrice)
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
	if data.SellerName != "JBL Official Store" {
		t.Errorf("expected seller 'JBL Official Store', got '%s'", data.SellerName)
	}
}
