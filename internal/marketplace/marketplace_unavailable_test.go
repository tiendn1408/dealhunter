package marketplace

import (
	"errors"
	"testing"

	"github.com/tiendang/deal-hunter/pkg/retry"
)

func TestUnavailable_KeepsClassifiedCause(t *testing.T) {
	err := Unavailable("shopee price", "https://shopee.vn/x-i.1.2", retry.FromHTTPStatus(404))
	if !errors.Is(err, ErrProductUnavailable) || retry.Code(err) != "not_found" || retry.IsRetryable(err) {
		t.Fatalf("expected unavailable + permanent not_found, got %v", err)
	}
	// A page that loaded but had no product data (anti-bot page answered with 200) is temporary
	err = Unavailable("lazada", "https://www.lazada.vn/products/x-i1.html", nil)
	if !errors.Is(err, ErrProductUnavailable) || retry.Code(err) != "unreadable_page" || !retry.IsRetryable(err) {
		t.Fatalf("expected unavailable + retryable unreadable_page, got %v", err)
	}
}
