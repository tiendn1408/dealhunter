//go:build integration
// +build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	router "github.com/tiendang/deal-hunter/internal/http"
)

// The shared limiter is a sliding window: never more than `limit` requests in any `window`, and a
// refused caller learns how long to wait.
func TestRedisRateLimiter_SlidingWindow(t *testing.T) {
	ctx := context.Background()
	rdb := getTestRedisClient(t)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()

	window := 600 * time.Millisecond
	l := router.NewRedisRateLimiter(rdb, "dh:test:rl:"+uuid.NewString(), 3, window)
	for i := 0; i < 3; i++ {
		if ok, _, err := l.Allow(ctx, "user"); err != nil || !ok {
			t.Fatalf("request %d: expected allowed, got %v %v", i+1, ok, err)
		}
	}
	ok, retryAfter, err := l.Allow(ctx, "user")
	if err != nil || ok {
		t.Fatalf("4th request in the window: expected refused, got %v %v", ok, err)
	}
	if retryAfter <= 0 || retryAfter > window {
		t.Fatalf("retryAfter %v must be within (0, %v]", retryAfter, window)
	}
	// Other keys are independent
	if ok, _, _ := l.Allow(ctx, "someone-else"); !ok {
		t.Fatal("another key must not be limited")
	}
	time.Sleep(retryAfter + 50*time.Millisecond)
	if ok, _, _ := l.Allow(ctx, "user"); !ok {
		t.Fatal("a slot must free up once the oldest request leaves the window")
	}
}

// A refunded request frees its slot again.
func TestRedisRateLimiter_Refund(t *testing.T) {
	ctx := context.Background()
	rdb := getTestRedisClient(t)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()
	l := router.NewRedisRateLimiter(rdb, "dh:test:rl:"+uuid.NewString(), 2, time.Minute)
	for i := 0; i < 2; i++ {
		if ok, _, _ := l.Allow(ctx, "u"); !ok {
			t.Fatal("expected allowed")
		}
	}
	if ok, _, _ := l.Allow(ctx, "u"); ok {
		t.Fatal("expected the limit to be reached")
	}
	if err := l.Refund(ctx, "u"); err != nil {
		t.Fatal(err)
	}
	if ok, _, _ := l.Allow(ctx, "u"); !ok {
		t.Fatal("a refunded slot must be usable again")
	}
}
