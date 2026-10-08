package retry

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
)

// FromHTTPStatus classifies a non-2xx marketplace response. Blocks, rate limits, timeouts and server
// errors are temporary; a missing product or any other client error is not.
func FromHTTPStatus(status int) *MarketplaceError {
	msg := fmt.Sprintf("marketplace answered HTTP %d", status)
	switch {
	case status == http.StatusForbidden:
		return &MarketplaceError{Kind: ErrRetryable, Code: "blocked", Message: msg}
	case status == http.StatusTooManyRequests:
		return &MarketplaceError{Kind: ErrRetryable, Code: "rate_limited", Message: msg}
	case status == http.StatusRequestTimeout:
		return &MarketplaceError{Kind: ErrRetryable, Code: "timeout", Message: msg}
	case status >= 500:
		return &MarketplaceError{Kind: ErrRetryable, Code: "server_error", Message: msg}
	case status == http.StatusNotFound || status == http.StatusGone:
		return &MarketplaceError{Kind: ErrNonRetryable, Code: "not_found", Message: msg}
	default:
		return &MarketplaceError{Kind: ErrNonRetryable, Code: fmt.Sprintf("http_%d", status), Message: msg}
	}
}

// Network classifies a request that got no response (timeout, connection error). Always temporary.
func Network(err error) *MarketplaceError {
	code := "network"
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		code = "timeout"
	}
	return &MarketplaceError{Kind: ErrRetryable, Code: code, Message: "marketplace request failed", Err: err}
}

// Unreadable classifies a page that loaded but held no product data: usually an anti-bot/captcha
// page answered with 200, sometimes a changed layout. Treated as temporary.
func Unreadable() *MarketplaceError {
	return &MarketplaceError{Kind: ErrRetryable, Code: "unreadable_page", Message: "page has no product data"}
}

// IsRetryable reports whether err carries a MarketplaceError worth retrying later.
func IsRetryable(err error) bool {
	var me *MarketplaceError
	return errors.As(err, &me) && me.Kind == ErrRetryable
}

// Code returns the classification code of err, or "unknown" when it is not a MarketplaceError.
func Code(err error) string {
	var me *MarketplaceError
	if errors.As(err, &me) {
		return me.Code
	}
	return "unknown"
}
