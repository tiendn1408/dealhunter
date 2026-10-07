package zalo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	KeyZaloAccessToken   = "zalo:oa:access_token"
	KeyZaloRefreshToken  = "zalo:oa:refresh_token"
	DefaultRefreshWindow = 12 * time.Hour
)

type TokenManager struct {
	appID        string
	secretKey    string
	refreshToken string
	redisClient  *redis.Client
	httpClient   *http.Client
	logger       *slog.Logger
	mu           sync.Mutex
}

func NewTokenManager(
	appID, secretKey, initialRefreshToken string,
	rdb *redis.Client,
	logger *slog.Logger,
) *TokenManager {
	if logger == nil {
		logger = slog.Default()
	}
	return &TokenManager{
		appID:        appID,
		secretKey:    secretKey,
		refreshToken: initialRefreshToken,
		redisClient:  rdb,
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		logger:       logger,
	}
}

// GetAccessToken returns a valid access token from Redis cache or refreshes it.
func (m *TokenManager) GetAccessToken(ctx context.Context) (string, error) {
	if m.redisClient != nil {
		token, err := m.redisClient.Get(ctx, KeyZaloAccessToken).Result()
		if err == nil && token != "" {
			return token, nil
		}
	}

	return m.RefreshToken(ctx)
}

type zaloTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    string `json:"expires_in"`
	Error        int    `json:"error"`
	Message      string `json:"message"`
}

// ErrZaloNotConfigured means Zalo OA credentials are missing, so no real message can be sent.
var ErrZaloNotConfigured = errors.New("zalo OA is not configured")

// CanRefresh reports whether OAuth refresh credentials are configured.
func (m *TokenManager) CanRefresh() bool {
	return m.appID != "" && m.secretKey != "" && m.refreshToken != ""
}

// RefreshToken requests a new access token from Zalo OAuth API and updates Redis.
func (m *TokenManager) RefreshToken(ctx context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. Resolve current refresh token (check Redis first, fallback to initial config)
	currRefreshToken := m.refreshToken
	if m.redisClient != nil {
		if cachedRefresh, err := m.redisClient.Get(ctx, KeyZaloRefreshToken).Result(); err == nil && cachedRefresh != "" {
			currRefreshToken = cachedRefresh
		}
	}

	// 2. Without OAuth credentials there is nothing to refresh; never fabricate a token
	if m.appID == "" || m.secretKey == "" || currRefreshToken == "" {
		return "", ErrZaloNotConfigured
	}

	// 3. Make HTTP request to Zalo OAuth v4 endpoint
	form := url.Values{}
	form.Set("app_id", m.appID)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", currRefreshToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth.zaloapp.com/v4/oa/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("create zalo token request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("secret_key", m.secretKey)

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("execute zalo token request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("zalo oauth error HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var tokenResp zaloTokenResponse
	if err := json.Unmarshal(bodyBytes, &tokenResp); err != nil {
		return "", fmt.Errorf("parse zalo token response: %w", err)
	}

	if tokenResp.Error != 0 || tokenResp.AccessToken == "" {
		return "", fmt.Errorf("zalo oauth api error code %d: %s", tokenResp.Error, tokenResp.Message)
	}

	// Parse TTL (Zalo returns string e.g. "90000" seconds)
	expiresInSec := int64(90000)
	if parsed, pErr := strconv.ParseInt(tokenResp.ExpiresIn, 10, 64); pErr == nil && parsed > 0 {
		expiresInSec = parsed
	}
	// Buffer 10 minutes before actual expiry
	ttl := time.Duration(expiresInSec-600) * time.Second
	if ttl <= 0 {
		ttl = 1 * time.Hour
	}

	// 4. Save new access token and rotated refresh token to Redis
	if m.redisClient != nil {
		if err := m.redisClient.Set(ctx, KeyZaloAccessToken, tokenResp.AccessToken, ttl).Err(); err != nil {
			m.logger.Warn("Failed to cache Zalo access token to Redis", "err", err)
		}
		if tokenResp.RefreshToken != "" {
			if err := m.redisClient.Set(ctx, KeyZaloRefreshToken, tokenResp.RefreshToken, 0).Err(); err != nil {
				m.logger.Warn("Failed to cache Zalo refresh token to Redis", "err", err)
			}
			m.refreshToken = tokenResp.RefreshToken
		}
	}

	m.logger.Info("Zalo access token refreshed successfully", "ttl_seconds", expiresInSec)
	return tokenResp.AccessToken, nil
}

// StartAutoRefresh starts a background worker that proactively refreshes access token every interval.
func (m *TokenManager) StartAutoRefresh(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultRefreshWindow
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				m.logger.Info("Zalo token auto-refresh worker stopped")
				return
			case <-ticker.C:
				_, err := m.RefreshToken(ctx)
				if err != nil {
					m.logger.Error("Zalo token proactive auto-refresh error", "err", err)
				}
			}
		}
	}()
}
