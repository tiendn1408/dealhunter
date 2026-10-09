package router

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RateLimiter decides whether one more request for key is allowed and, if not, how long to wait.
type RateLimiter interface {
	Allow(ctx context.Context, key string) (allowed bool, retryAfter time.Duration, err error)
}

// RedisRateLimiter is a sliding-window log shared by every API instance: at most `limit` requests in any
// `window` (a fixed window would let 2× the limit through around its boundary).
type RedisRateLimiter struct {
	rdb    *redis.Client
	prefix string
	limit  int64
	window time.Duration
}

func NewRedisRateLimiter(rdb *redis.Client, prefix string, limit int64, window time.Duration) *RedisRateLimiter {
	return &RedisRateLimiter{rdb: rdb, prefix: prefix, limit: limit, window: window}
}

// Returns 0 when the request is admitted (and recorded), else the milliseconds until a slot frees up.
var slidingWindowScript = redis.NewScript(`
local key, now, window, limit = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
if redis.call('ZCARD', key) < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, window)
  return 0
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
return math.max(1, tonumber(oldest[2]) + window - now)
`)

func (l *RedisRateLimiter) Allow(ctx context.Context, key string) (bool, time.Duration, error) {
	now := time.Now().UnixMilli()
	wait, err := slidingWindowScript.Run(ctx, l.rdb, []string{l.prefix + ":" + key},
		now, l.window.Milliseconds(), l.limit, uuid.NewString()).Int64()
	if err != nil {
		return false, 0, fmt.Errorf("rate limiter: %w", err)
	}
	if wait > 0 {
		return false, time.Duration(wait) * time.Millisecond, nil
	}
	return true, 0, nil
}

// writeRetryAfter sets Retry-After in whole seconds (rounded up, at least 1).
func writeRetryAfter(w http.ResponseWriter, d time.Duration) {
	secs := int(math.Ceil(d.Seconds()))
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
}

// clientIP is the client address resolved by TrustedRealIP, without the port.
func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// rateLimitKey is the per-client key for IP-based rate limits: the IPv4 address, or the /64 of an IPv6
// address (a subscriber usually controls a whole /64 and could otherwise rotate addresses to reset
// every per-IP limit).
func rateLimitKey(r *http.Request) string {
	addr, ok := remoteAddr(r.RemoteAddr)
	if !ok {
		return clientIP(r)
	}
	if addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String()
	}
	return addr.String()
}
