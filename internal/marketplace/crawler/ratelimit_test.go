package crawler

import (
	"context"
	"testing"
	"time"
)

func TestDomainRateLimiter_Wait(t *testing.T) {
	limiter := NewDomainRateLimiter(20 * time.Millisecond)

	ctx := context.Background()

	start := time.Now()
	if err := limiter.Wait(ctx, "shopee.vn"); err != nil {
		t.Fatalf("first wait failed: %v", err)
	}

	if err := limiter.Wait(ctx, "shopee.vn"); err != nil {
		t.Fatalf("second wait failed: %v", err)
	}

	elapsed := time.Since(start)
	if elapsed < 15*time.Millisecond {
		t.Errorf("expected at least 15ms gap, got %v", elapsed)
	}
}

func TestDomainRateLimiter_Backoff(t *testing.T) {
	limiter := NewDomainRateLimiter(10 * time.Millisecond)
	limiter.RecordBackoff("lazada.vn")

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// Since backoff is at least 2s, 50ms context should timeout
	err := limiter.Wait(ctx, "lazada.vn")
	if err != context.DeadlineExceeded {
		t.Errorf("expected context.DeadlineExceeded, got %v", err)
	}
}
