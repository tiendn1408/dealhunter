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

type MarketplaceError struct {
	Kind    ErrorKind
	Code    string
	Message string
}

func (e *MarketplaceError) Error() string {
	return e.Message
}
