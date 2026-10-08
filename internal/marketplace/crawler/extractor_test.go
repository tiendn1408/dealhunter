package crawler

import (
	"testing"
)

func TestExtractFromHTML_JsonLd(t *testing.T) {
	htmlContent := `
<!DOCTYPE html>
<html>
<head>
    <title>Tai nghe Sony WH-1000XM5 Chinh Hang | Shopee Viet Nam</title>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Tai nghe Sony WH-1000XM5 Chinh Hang",
        "image": "https://down-vn.img.susercontent.com/file/vn-11134207.jpg",
        "description": "Tai nghe chong on chu dong dinh cao Sony WH-1000XM5",
        "brand": {
            "@type": "Brand",
            "name": "Sony"
        },
        "offers": {
            "@type": "Offer",
            "price": "6290000",
            "priceCurrency": "VND",
            "availability": "https://schema.org/InStock",
            "seller": {
                "@type": "Organization",
                "name": "Sony Official Store"
            }
        }
    }
    </script>
</head>
<body><h1>Product</h1></body>
</html>
`

	prod, err := ExtractFromHTML([]byte(htmlContent), "https://shopee.vn/product/123/456")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if prod.Title != "Tai nghe Sony WH-1000XM5 Chinh Hang" {
		t.Errorf("expected title 'Tai nghe Sony WH-1000XM5 Chinh Hang', got '%s'", prod.Title)
	}
	if prod.Price != 6290000 {
		t.Errorf("expected price 6290000, got %d", prod.Price)
	}
	if prod.Brand != "Sony" {
		t.Errorf("expected brand Sony, got '%s'", prod.Brand)
	}
	if prod.SellerName != "Sony Official Store" {
		t.Errorf("expected seller 'Sony Official Store', got '%s'", prod.SellerName)
	}
	if prod.InStock == nil || !*prod.InStock {
		t.Errorf("expected InStock to be true")
	}
}

func TestExtractFromHTML_OpenGraph(t *testing.T) {
	htmlContent := `
<!DOCTYPE html>
<html>
<head>
    <meta property="og:title" content="O Cung SSD Samsung 990 Pro 2TB NVMe M.2 | Lazada.vn" />
    <meta property="og:image" content="https://lzd-img.alicdn.com/samsung990.jpg" />
    <meta property="og:price:amount" content="2850000" />
    <meta property="og:price:currency" content="VND" />
    <meta property="og:site_name" content="Samsung Flagship Store" />
</head>
<body></body>
</html>
`

	prod, err := ExtractFromHTML([]byte(htmlContent), "https://www.lazada.vn/products/ssd-samsung-i1234.html")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if prod.Title != "O Cung SSD Samsung 990 Pro 2TB NVMe M.2" {
		t.Errorf("expected title 'O Cung SSD Samsung 990 Pro 2TB NVMe M.2', got '%s'", prod.Title)
	}
	if prod.Price != 2850000 {
		t.Errorf("expected price 2850000, got %d", prod.Price)
	}
	// og:site_name is the site, not the seller; values the page does not state stay unknown
	if prod.SellerName != "" {
		t.Errorf("expected unknown seller, got '%s'", prod.SellerName)
	}
	if prod.InStock != nil {
		t.Errorf("expected unknown stock status, got %v", *prod.InStock)
	}
	if prod.ShippingFee != nil {
		t.Errorf("expected unknown shipping fee, got %d", *prod.ShippingFee)
	}
}

func TestParseVNDPrice(t *testing.T) {
	tests := []struct {
		input    string
		expected int64
	}{
		{"6290000", 6290000},
		{"6.290.000", 6290000},
		{"6,290,000", 6290000},
		{"6.290.000 ₫", 6290000},
		{"6290000 VND", 6290000},
		{"6290000.00", 6290000},
		{" 15.000 đ ", 15000},
		{"6,290,000.00", 6290000},
		{"6.290.000,00", 6290000},
		{"6290000,5", 6290000},
		{"1.500", 1500},
		{"6290000.000", 6290000},
		{"6290000,0", 6290000},
		{"1.500.000", 1500000},
	}

	for _, tc := range tests {
		val, err := ParseVNDPrice(tc.input)
		if err != nil {
			t.Errorf("ParseVNDPrice(%s) error: %v", tc.input, err)
		}
		if val != tc.expected {
			t.Errorf("ParseVNDPrice(%s) = %d, expected %d", tc.input, val, tc.expected)
		}
	}
}

// A page without product content (e.g. an anti-bot challenge) yields no title: nothing is invented from the URL
func TestExtractFromHTML_NoContentNoTitle(t *testing.T) {
	prod, err := ExtractFromHTML([]byte(`<html><head></head><body>Checking your browser...</body></html>`),
		"https://shopee.vn/Tai-nghe-Sony-WH-1000XM5-Chinh-Hang-i.88201679.22731853609")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if prod.Title != "" || prod.Price != 0 || prod.InStock != nil {
		t.Fatalf("expected empty extraction, got %+v", prod)
	}
}

func TestCleanTitle(t *testing.T) {
	raw := "Tai nghe Sony WH-1000XM5   | Shopee Việt Nam"
	cleaned := CleanTitle(raw)
	if cleaned != "Tai nghe Sony WH-1000XM5" {
		t.Errorf("CleanTitle failed, got: '%s'", cleaned)
	}

	lazadaRaw := "Apple iPhone 16 Pro Max 256GB - Mua ngay | Lazada.vn"
	lazadaCleaned := CleanTitle(lazadaRaw)
	if lazadaCleaned != "Apple iPhone 16 Pro Max 256GB" {
		t.Errorf("CleanTitle failed, got: '%s'", lazadaCleaned)
	}
}
