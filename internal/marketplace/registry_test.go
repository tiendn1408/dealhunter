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
	// An adapter named "mock" registered like a real one gets no hosts: fake platforms never resolve
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
			url:       "https://mock.dealhunter.io.vn/item/999",
			shouldErr: true,
		},
		{
			url:          "https://vt.tiktok.com/ZSabc/",
			expectedName: "tiktok",
			shouldErr:    false,
		},
		{
			url:       "https://amazon.com/dp/B000",
			shouldErr: true,
		},
		{
			url:       "https://shopee.attacker.com/item/123",
			shouldErr: true,
		},
		{
			url:       "https://evil-shopee.org/item/123",
			shouldErr: true,
		},
		{
			url:       "ftp://shopee.vn/product/123/456",
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

func TestRegistryRegisterForHosts(t *testing.T) {
	reg := NewRegistry()
	reg.RegisterForHosts(&dummyAdapter{name: "fake"}, "fake.test")

	if m, err := reg.Detect("https://fake.test/item/1"); err != nil || m.Name() != "fake" {
		t.Fatalf("expected fake adapter, got %v err=%v", m, err)
	}
	if _, err := reg.Detect("https://shopee.vn/product/1/2"); err == nil {
		t.Fatal("expected unregistered real platform to be rejected")
	}
}

func TestRegistryDetectShareShortLinks(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&dummyAdapter{name: "shopee"})
	reg.Register(&dummyAdapter{name: "lazada"})
	reg.Register(&dummyAdapter{name: "tiktok"})

	cases := map[string]string{
		"https://vn.shp.ee/pzvUeCZa":      "shopee",
		"https://shope.ee/abc123":         "shopee",
		"https://s.shopee.vn/AbC":         "shopee",
		"https://s.lazada.vn/s.xyz":       "lazada",
		"https://vt.tiktok.com/ZSabc123/": "tiktok",
	}
	for u, want := range cases {
		m, err := reg.Detect(u)
		if err != nil {
			t.Fatalf("Detect(%q) error: %v", u, err)
		}
		if m.Name() != want {
			t.Errorf("Detect(%q) = %s, want %s", u, m.Name(), want)
		}
	}
	// Look-alike hosts are not marketplaces
	if _, err := reg.Detect("https://shp.ee.evil.com/x"); err == nil {
		t.Errorf("look-alike host must not be detected")
	}
}

func TestIsShortLinkAndWithoutQuery(t *testing.T) {
	if !IsShortLink("shopee", "https://vn.shp.ee/pzvUeCZa") {
		t.Errorf("vn.shp.ee should be a Shopee short link")
	}
	if IsShortLink("shopee", "https://shopee.vn/product/1054984507/29254262829") {
		t.Errorf("a product page is not a short link")
	}
	got := WithoutQuery("https://shopee.vn/product/1054984507/29254262829?d_id=2846b&uls_trackid=56slrg8g05lj&utm_content=x#top")
	if got != "https://shopee.vn/product/1054984507/29254262829" {
		t.Errorf("WithoutQuery = %q", got)
	}
}
