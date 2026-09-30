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
)

type ZaloClient interface {
	SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) (string, error)
}

type HTTPZaloClient struct {
	accessToken  string
	httpClient   *http.Client
	redisClient  *redis.Client
	tokenManager *TokenManager
}

func NewHTTPZaloClient(accessToken string, redisClient *redis.Client) *HTTPZaloClient {
	return &HTTPZaloClient{
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
		return "", fmt.Errorf("zalo access token is empty")
	}

	reqBody := TemplateRequest{
		TemplateID:   templateID,
		TemplateData: params,
	}
	// Decide if recipient is phone number or zalo_id
	if len(recipient) >= 9 && recipient[0] == '0' {
		reqBody.Phone = recipient
	} else {
		reqBody.ZaloID = recipient
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal zalo request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://business.openapi.zalo.me/message/template", bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("create zalo request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("access_token", token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("execute zalo request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
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
			return "", fmt.Errorf("zalo business error %d: %s", zaloResp.Error, zaloResp.Message)
		}
		if zaloResp.Data.MsgID != "" {
			return zaloResp.Data.MsgID, nil
		}
	}

	return "", nil
}
