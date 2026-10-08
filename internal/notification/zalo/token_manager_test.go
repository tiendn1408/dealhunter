package zalo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// getTestRedis returns Redis DB 15 of the local test instance (shared with dev on port 6380).
// Only the token manager's own keys are cleared, before and after each test; the database is never flushed.
func getTestRedis(t *testing.T) *redis.Client {
	redisAddr := "localhost:6380"
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
		DB:   15,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping test: Redis not reachable at %s: %v", redisAddr, err)
	}
	clear := func() { _ = rdb.Del(context.Background(), KeyZaloAccessToken, KeyZaloRefreshToken).Err() }
	clear()
	t.Cleanup(clear)
	return rdb
}

// Without OAuth credentials the manager must fail, never fabricate or cache a token
func TestTokenManager_NotConfigured(t *testing.T) {
	rdb := getTestRedis(t)
	defer rdb.Close()

	tm := NewTokenManager("", "", "", rdb, nil)
	ctx := context.Background()

	token, err := tm.GetAccessToken(ctx)
	if !errors.Is(err, ErrZaloNotConfigured) || token != "" {
		t.Fatalf("expected ErrZaloNotConfigured and no token, got token=%q err=%v", token, err)
	}
	if tm.CanRefresh() {
		t.Fatal("expected CanRefresh=false without credentials")
	}
	if n, _ := rdb.Exists(ctx, KeyZaloAccessToken).Result(); n != 0 {
		t.Fatal("expected no access token written to Redis")
	}
}

func TestTokenManager_LiveOAuthRefresh(t *testing.T) {
	rdb := getTestRedis(t)
	defer rdb.Close()

	// Mock Zalo OAuth Server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("secret_key") != "test_secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		_ = r.ParseForm()
		if r.FormValue("app_id") != "123456" || r.FormValue("refresh_token") != "initial_refresh_token" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token":  "new_live_access_token_xyz",
			"refresh_token": "rotated_refresh_token_abc",
			"expires_in":    "90000",
			"error":         0,
			"message":       "success",
		})
	}))
	defer server.Close()

	tm := NewTokenManager("123456", "test_secret", "initial_refresh_token", rdb, nil)
	// Point http client to mock server
	tm.httpClient = server.Client()
	tm.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		newReq := req.Clone(req.Context())
		newReq.URL.Scheme = "http"
		newReq.URL.Host = server.Listener.Addr().String()
		return http.DefaultTransport.RoundTrip(newReq)
	})

	ctx := context.Background()
	token, err := tm.RefreshToken(ctx)
	if err != nil {
		t.Fatalf("refresh token failed: %v", err)
	}

	if token != "new_live_access_token_xyz" {
		t.Errorf("expected 'new_live_access_token_xyz', got '%s'", token)
	}

	// Verify cached in Redis
	cachedToken, _ := rdb.Get(ctx, KeyZaloAccessToken).Result()
	if cachedToken != "new_live_access_token_xyz" {
		t.Errorf("expected cached access token in redis, got '%s'", cachedToken)
	}

	cachedRefresh, _ := rdb.Get(ctx, KeyZaloRefreshToken).Result()
	if cachedRefresh != "rotated_refresh_token_abc" {
		t.Errorf("expected rotated refresh token in redis, got '%s'", cachedRefresh)
	}

	// Call GetAccessToken should return cached value immediately
	retrieved, err := tm.GetAccessToken(ctx)
	if err != nil || retrieved != "new_live_access_token_xyz" {
		t.Errorf("expected retrieved cached token, got %s, err=%v", retrieved, err)
	}
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestTokenManager_AutoRefreshTickerWithoutCredentialsWritesNothing(t *testing.T) {
	rdb := getTestRedis(t)
	defer rdb.Close()

	tm := NewTokenManager("", "", "", rdb, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tm.StartAutoRefresh(ctx, 20*time.Millisecond)
	time.Sleep(60 * time.Millisecond)

	if n, _ := rdb.Exists(ctx, KeyZaloAccessToken).Result(); n != 0 {
		t.Error("expected auto refresh without credentials to write no token")
	}
}
