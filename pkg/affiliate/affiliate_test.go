package affiliate

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestTransformer_Shopee(t *testing.T) {
	cfg := Config{
		Enabled:        true,
		ShopeeID:       "dealhunter-shopee-vn",
		ShopeeTemplate: "https://s.shopee.vn/universal-link?url={URL}&sub_id={SUB_ID}&aff_id={AFFILIATE_ID}",
	}
	tr := NewTransformer(cfg)

	rawURL := "https://shopee.vn/product/123456/7891011"
	subID := "u_12345678_p_87654321"

	affURL := tr.Transform(rawURL, "shopee", subID)

	if !strings.Contains(affURL, "https://s.shopee.vn/universal-link") {
		t.Fatalf("expected template prefix, got: %s", affURL)
	}
	if !strings.Contains(affURL, "sub_id=u_12345678_p_87654321") {
		t.Fatalf("expected sub_id in url, got: %s", affURL)
	}
	if !strings.Contains(affURL, "aff_id=dealhunter-shopee-vn") {
		t.Fatalf("expected aff_id in url, got: %s", affURL)
	}
	if !strings.Contains(affURL, "shopee.vn%2Fproduct") {
		t.Fatalf("expected url encoded target url, got: %s", affURL)
	}
}

func TestTransformer_Lazada(t *testing.T) {
	cfg := Config{
		Enabled:        true,
		LazadaID:       "lazada-aff-id",
		LazadaTemplate: "https://s.lazada.vn/s.test?url={URL}&aff_sub={SUB_ID}",
	}
	tr := NewTransformer(cfg)

	rawURL := "https://www.lazada.vn/products/keyboard-i123456.html"
	affURL := tr.Transform(rawURL, "lazada", "u_test")

	if !strings.HasPrefix(affURL, "https://s.lazada.vn/s.test") {
		t.Fatalf("expected lazada prefix, got: %s", affURL)
	}
	if !strings.Contains(affURL, "aff_sub=u_test") {
		t.Fatalf("expected aff_sub, got: %s", affURL)
	}
}

func TestTransformer_TikTok(t *testing.T) {
	cfg := Config{
		Enabled:        true,
		TikTokID:       "dh-tiktok",
		TikTokTemplate: "https://vt.tiktok.com/aff?url={URL}&sub_id={SUB_ID}",
	}
	tr := NewTransformer(cfg)

	rawURL := "https://shop.tiktok.com/view/product/12345"
	affURL := tr.Transform(rawURL, "tiktok", "sub123")

	if !strings.HasPrefix(affURL, "https://vt.tiktok.com/aff") {
		t.Fatalf("expected tiktok prefix, got: %s", affURL)
	}
}

func TestTransformer_AccessTradeFallback(t *testing.T) {
	cfg := Config{
		Enabled:             true,
		AccessTradeTemplate: "https://go.isclix.com/deep_link?url={URL}&utm_content={SUB_ID}",
	}
	tr := NewTransformer(cfg)

	rawURL := "https://tiki.vn/product/123"
	affURL := tr.Transform(rawURL, "tiki", "u_test")

	if !strings.HasPrefix(affURL, "https://go.isclix.com/deep_link") {
		t.Fatalf("expected accesstrade fallback, got: %s", affURL)
	}
}

func TestTransformer_AutoDetectPlatform(t *testing.T) {
	cfg := Config{
		Enabled:        true,
		ShopeeID:       "dh-shopee",
		ShopeeTemplate: "https://s.shopee.vn/aff?url={URL}&sub_id={SUB_ID}",
	}
	tr := NewTransformer(cfg)

	rawURL := "https://shopee.vn/product/999/888"
	// Empty platform passed, should auto-detect "shopee" from URL
	affURL := tr.Transform(rawURL, "", "sub_auto")

	if !strings.HasPrefix(affURL, "https://s.shopee.vn/aff") {
		t.Fatalf("expected auto-detected shopee template, got: %s", affURL)
	}
}

func TestTransformer_Disabled(t *testing.T) {
	cfg := Config{
		Enabled:        false,
		ShopeeTemplate: "https://s.shopee.vn/aff?url={URL}&sub_id={SUB_ID}",
	}
	tr := NewTransformer(cfg)

	rawURL := "https://shopee.vn/product/123"
	affURL := tr.Transform(rawURL, "shopee", "sub")

	if affURL != rawURL {
		t.Fatalf("expected original url when disabled, got: %s", affURL)
	}
}

func TestFormatSubID(t *testing.T) {
	uID := uuid.MustParse("11111111-2222-3333-4444-555555555555")
	pID := uuid.MustParse("99999999-8888-7777-6666-555555555555")

	res := FormatSubID(uID, pID)
	if res != "u_11111111_p_99999999" {
		t.Fatalf("expected 'u_11111111_p_99999999', got: %s", res)
	}

	resGuest := FormatSubID(uuid.Nil, pID)
	if resGuest != "guest_p_99999999" {
		t.Fatalf("expected 'guest_p_99999999', got: %s", resGuest)
	}
}

// Without a real affiliate ID the canonical link is kept (no placeholder affiliate links)
func TestTransformer_NoAffiliateIDKeepsCanonicalLink(t *testing.T) {
	tr := NewTransformer(Config{
		Enabled:        true,
		LazadaTemplate: "https://s.lazada.vn/s.xxxx?url={URL}&aff_sub={SUB_ID}",
	})
	rawURL := "https://www.lazada.vn/products/item-i123.html"
	if got := tr.Transform(rawURL, "lazada", "u_1_p_2"); got != rawURL {
		t.Fatalf("expected canonical link without affiliate ID, got %s", got)
	}
}

// An AccessTrade template without {URL} would send every click to the same page; it is ignored
func TestTransformer_AccessTradeTemplateWithoutURLIgnored(t *testing.T) {
	tr := NewTransformer(Config{Enabled: true, AccessTradeTemplate: "https://go.isclix.com/deep_link/123?url="})
	rawURL := "https://tiki.vn/product/123"
	if got := tr.Transform(rawURL, "tiki", "u_1"); got != rawURL {
		t.Fatalf("expected canonical link, got %s", got)
	}
}
