package marketplace

import (
	"context"
	"testing"

	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
)

type dummyAdapter struct {
	name string
}

func (d *dummyAdapter) Name() string { return d.name }

func (d *dummyAdapter) ResolveProduct(_ context.Context, _ string) (*ProductData, error) {
	return nil, nil
}

func (d *dummyAdapter) FetchPrice(_ context.Context, _ *product.ProductSource) (*pricing.PriceSnapshot, error) {
	return nil, nil
}

func TestRegistryDetect(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&dummyAdapter{name: "shopee"})
	reg.Register(&dummyAdapter{name: "lazada"})
	reg.Register(&dummyAdapter{name: "tiktok"})
	reg.Register(&dummyAdapter{name: "mock"})

	tests := []struct {
		url          string
		expectedName string
		shouldErr    bool
	}{
		{
			url:          "https://shopee.vn/product/123/456",
			expectedName: "shopee",
			shouldErr:    false,
		},
		{
			url:          "https://www.lazada.vn/products/item-i123.html",
			expectedName: "lazada",
			shouldErr:    false,
		},
		{
			url:          "https://mock.dealhunter.vn/item/999",
			expectedName: "mock",
			shouldErr:    false,
		},
		{
			url:       "https://amazon.com/dp/B000",
			shouldErr: true,
		},
		{
			url:       "://invalid-url",
			shouldErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			m, err := reg.Detect(tt.url)
			if tt.shouldErr {
				if err == nil {
					t.Fatalf("expected error for %s, got nil", tt.url)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %s: %v", tt.url, err)
			}
			if m.Name() != tt.expectedName {
				t.Errorf("expected adapter %s, got %s", tt.expectedName, m.Name())
			}
		})
	}
}
