package retry

import (
	"time"
)

var DefaultBackoff = []time.Duration{
	1 * time.Minute,
	5 * time.Minute,
	15 * time.Minute,
	1 * time.Hour,
}

func NextAvailableAt(attempt int) time.Time {
	if attempt < 0 {
		attempt = 0
	}
	if attempt >= len(DefaultBackoff) {
		attempt = len(DefaultBackoff) - 1
	}
	return time.Now().Add(DefaultBackoff[attempt])
}

type ErrorKind int

const (
	ErrRetryable ErrorKind = iota
	ErrNonRetryable
)

// MarketplaceError classifies why a marketplace request failed, so the worker can decide whether
// retrying later can help (DATA-01).
type MarketplaceError struct {
	Kind    ErrorKind
	Code    string // blocked, rate_limited, timeout, server_error, network, not_found, http_<status>, unreadable_page
	Message string
	Err     error // underlying transport error, if any
}

func (e *MarketplaceError) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

func (e *MarketplaceError) Unwrap() error { return e.Err }
