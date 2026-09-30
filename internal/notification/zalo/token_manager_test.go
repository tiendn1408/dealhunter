package zalo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func getTestRedis(t *testing.T) *redis.Client {
	rdb := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15, // Isolated test DB
	})
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping test: Redis not reachable at localhost:6379: %v", err)
	}
	_ = rdb.FlushDB(ctx).Err()
	return rdb
}

func TestTokenManager_SandboxFallback(t *testing.T) {
	rdb := getTestRedis(t)
	defer rdb.Close()

	tm := NewTokenManager("", "", "", rdb, nil)
	ctx := context.Background()

	token, err := tm.GetAccessToken(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if token != "mock_zalo_access_token_active" {
		t.Errorf("expected sandbox mock token, got %s", token)
	}

	// Verify cached in Redis
	cached, err := rdb.Get(ctx, KeyZaloAccessToken).Result()
	if err != nil || cached != token {
		t.Errorf("expected token cached in redis, got %v, err=%v", cached, err)
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

func TestTokenManager_AutoRefreshTicker(t *testing.T) {
	rdb := getTestRedis(t)
	defer rdb.Close()

	tm := NewTokenManager("", "", "", rdb, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tm.StartAutoRefresh(ctx, 20*time.Millisecond)

	time.Sleep(60 * time.Millisecond)

	cached, err := rdb.Get(ctx, KeyZaloAccessToken).Result()
	if err != nil || cached != "mock_zalo_access_token_active" {
		t.Errorf("expected auto refresh to populate token in redis, got %s, err=%v", cached, err)
	}
}

func TestMockZaloClient_SendAndGenerateMsgID(t *testing.T) {
	mock := NewMockZaloClient()
	ctx := context.Background()

	msgID, err := mock.SendMessage(ctx, "0987654321", "tpl_123", map[string]string{
		"price_before": "6000000",
		"price_after":  "5000000",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if msgID == "" {
		t.Errorf("expected non-empty msgID")
	}

	if mock.CountSent() != 1 {
		t.Errorf("expected 1 sent message, got %d", mock.CountSent())
	}

	if mock.SentMessages[0].MsgID != msgID {
		t.Errorf("expected tracked msgID %s, got %s", msgID, mock.SentMessages[0].MsgID)
	}

	// Test failure mode
	mock.ShouldFail = true
	mock.FailError = fmt.Errorf("zalo network timeout")
	_, err = mock.SendMessage(ctx, "0987654321", "tpl_123", nil)
	if err == nil {
		t.Errorf("expected error when ShouldFail = true")
	}
	_ = uuid.Nil
}
