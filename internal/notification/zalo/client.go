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
	SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) error
}

type HTTPZaloClient struct {
	accessToken string
	httpClient  *http.Client
	redisClient *redis.Client
}

func NewHTTPZaloClient(accessToken string, redisClient *redis.Client) *HTTPZaloClient {
	return &HTTPZaloClient{
		accessToken: accessToken,
		httpClient:  &http.Client{Timeout: 10 * time.Second},
		redisClient: redisClient,
	}
}

type TemplateRequest struct {
	Phone        string            `json:"phone,omitempty"`
	ZaloID       string            `json:"user_id,omitempty"`
	TemplateID   string            `json:"template_id"`
	TemplateData map[string]string `json:"template_data"`
}

func (c *HTTPZaloClient) SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) error {
	token := c.accessToken
	// Check Redis cache for refreshed access token if available
	if c.redisClient != nil {
		if cachedToken, err := c.redisClient.Get(ctx, "zalo:oa:access_token").Result(); err == nil && cachedToken != "" {
			token = cachedToken
		}
	}

	if token == "" {
		return fmt.Errorf("zalo access token is empty")
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
		return fmt.Errorf("marshal zalo request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://business.openapi.zalo.me/message/template", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create zalo request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("access_token", token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute zalo request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("zalo API error HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var zaloResp struct {
		Error   int    `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(bodyBytes, &zaloResp); err == nil {
		if zaloResp.Error != 0 {
			return fmt.Errorf("zalo business error %d: %s", zaloResp.Error, zaloResp.Message)
		}
	}

	return nil
}
