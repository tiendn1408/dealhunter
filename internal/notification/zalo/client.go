package zalo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/pkg/phone"
)

type ZaloClient interface {
	SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) (string, error)
}

// templateEndpoint is Zalo's ZNS template-message API.
const templateEndpoint = "https://business.openapi.zalo.me/message/template"

type HTTPZaloClient struct {
	endpoint     string
	accessToken  string
	httpClient   *http.Client
	redisClient  *redis.Client
	tokenManager *TokenManager
}

func NewHTTPZaloClient(accessToken string, redisClient *redis.Client) *HTTPZaloClient {
	return &HTTPZaloClient{
		endpoint:    templateEndpoint,
		accessToken: accessToken,
		httpClient:  &http.Client{Timeout: 10 * time.Second},
		redisClient: redisClient,
	}
}

func (c *HTTPZaloClient) SetTokenManager(tm *TokenManager) {
	c.tokenManager = tm
}

type TemplateRequest struct {
	Phone        string            `json:"phone,omitempty"`
	ZaloID       string            `json:"user_id,omitempty"`
	TemplateID   string            `json:"template_id"`
	TemplateData map[string]string `json:"template_data"`
}

func (c *HTTPZaloClient) SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) (string, error) {
	var token string
	if c.tokenManager != nil {
		t, err := c.tokenManager.GetAccessToken(ctx)
		if err == nil && t != "" {
			token = t
		}
	}
	if token == "" && c.redisClient != nil {
		if cachedToken, err := c.redisClient.Get(ctx, KeyZaloAccessToken).Result(); err == nil && cachedToken != "" {
			token = cachedToken
		}
	}
	if token == "" {
		token = c.accessToken
	}

	if token == "" {
		return "", fmt.Errorf("zalo access token is empty: %w", ErrNotSent)
	}

	reqBody := TemplateRequest{
		TemplateID:   templateID,
		TemplateData: params,
	}
	// A phone number (stored normalized as 84xxxxxxxxx, the form ZNS expects) or else a Zalo user ID
	if phone, err := phone.Normalize(recipient); err == nil {
		reqBody.Phone = phone
	} else {
		reqBody.ZaloID = recipient
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal zalo request: %w: %w", ErrNotSent, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("create zalo request: %w: %w", ErrNotSent, err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("access_token", token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("execute zalo request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		// The request itself was refused; nothing was delivered
		return "", fmt.Errorf("zalo API error HTTP %d: %s: %w", resp.StatusCode, string(bodyBytes), ErrNotSent)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// A 5xx (or anything else) gives no guarantee the message was not sent
		return "", fmt.Errorf("zalo API error HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var zaloResp struct {
		Error   int    `json:"error"`
		Message string `json:"message"`
		Data    struct {
			MsgID string `json:"msg_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(bodyBytes, &zaloResp); err == nil {
		if zaloResp.Error != 0 {
			return "", fmt.Errorf("zalo business error %d: %s: %w", zaloResp.Error, zaloResp.Message, ErrNotSent)
		}
		if zaloResp.Data.MsgID != "" {
			return zaloResp.Data.MsgID, nil
		}
	}

	// Without a msg_id the send cannot be confirmed or tracked, so it is not reported as sent.
	return "", fmt.Errorf("zalo response has no msg_id (HTTP %d)", resp.StatusCode)
}
