package router

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimiter decides whether one more request for key is allowed.
type RateLimiter interface {
	Allow(ctx context.Context, key string) (bool, error)
}

// RedisRateLimiter is a fixed-window counter shared by every API instance.
type RedisRateLimiter struct {
	rdb    *redis.Client
	prefix string
	limit  int64
	window time.Duration
}

func NewRedisRateLimiter(rdb *redis.Client, prefix string, limit int64, window time.Duration) *RedisRateLimiter {
	return &RedisRateLimiter{rdb: rdb, prefix: prefix, limit: limit, window: window}
}

func (l *RedisRateLimiter) Allow(ctx context.Context, key string) (bool, error) {
	bucket := time.Now().UnixNano() / int64(l.window)
	k := fmt.Sprintf("%s:%s:%d", l.prefix, key, bucket)
	pipe := l.rdb.TxPipeline()
	incr := pipe.Incr(ctx, k)
	pipe.Expire(ctx, k, l.window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, err
	}
	return incr.Val() <= l.limit, nil
}

// clientIP is the address set by the RealIP middleware, without the port.
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
