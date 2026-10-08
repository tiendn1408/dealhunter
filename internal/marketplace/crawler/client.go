package crawler

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/pkg/retry"
)

var defaultUserAgents = []string{
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
}

type FetchResponse struct {
	StatusCode int
	FinalURL   string
	Body       []byte
	Headers    http.Header
}

type ClientOptions struct {
	Timeout   time.Duration
	ProxyURL  string
	UserAgent string
}

type Client struct {
	httpClient *http.Client
	userAgents []string
	rateLimiter *DomainRateLimiter
}

func NewClient(opts ClientOptions) (*Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("create cookie jar: %w", err)
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
		DisableKeepAlives:   false,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}

	if opts.ProxyURL != "" {
		proxyURL, err := url.Parse(opts.ProxyURL)
		if err == nil {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}

	client := &http.Client{
		Transport: transport,
		Jar:       jar,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("stopped after 10 redirects")
			}
			// Copy standard headers to redirect requests
			if len(via) > 0 {
				for k, v := range via[0].Header {
					if _, exists := req.Header[k]; !exists {
						req.Header[k] = v
					}
				}
			}
			return nil
		},
	}

	uas := defaultUserAgents
	if opts.UserAgent != "" {
		uas = []string{opts.UserAgent}
	}

	return &Client{
		httpClient:  client,
		userAgents:  uas,
		rateLimiter: DefaultRateLimiter(),
	}, nil
}

func (c *Client) SetRateLimiter(rl *DomainRateLimiter) {
	c.rateLimiter = rl
}

func (c *Client) Fetch(ctx context.Context, targetURL string, customHeaders map[string]string) (*FetchResponse, error) {
	parsed, err := url.Parse(targetURL)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}

	if c.rateLimiter != nil {
		if err := c.rateLimiter.Wait(ctx, parsed.Host); err != nil {
			return nil, fmt.Errorf("rate limiter wait: %w", err)
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	ua := c.userAgents[rand.Intn(len(c.userAgents))]
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	req.Header.Set("Sec-Ch-Ua", `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`)
	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	req.Header.Set("Sec-Ch-Ua-Platform", `"macOS"`)
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

	for k, v := range customHeaders {
		req.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, retry.Network(err)
	}
	defer resp.Body.Close()

	if c.rateLimiter != nil && (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable) {
		c.rateLimiter.RecordBackoff(parsed.Host)
	}
	// A blocked, missing or failing page is never parsed: error pages can still carry og:price tags
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, retry.FromHTTPStatus(resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	finalURL := targetURL
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}

	return &FetchResponse{
		StatusCode: resp.StatusCode,
		FinalURL:   finalURL,
		Body:       body,
		Headers:    resp.Header,
	}, nil
}

// ResolveFinalURL follows redirects without downloading full payload.
func (c *Client) ResolveFinalURL(ctx context.Context, rawURL string) (string, error) {
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return rawURL, nil
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL, nil
	}

	if c.rateLimiter != nil {
		if err := c.rateLimiter.Wait(ctx, parsed.Host); err != nil {
			return rawURL, err
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodHead, rawURL, nil)
	if err != nil {
		return rawURL, nil
	}
	req.Header.Set("User-Agent", c.userAgents[0])

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Fallback: try GET with range header
		reqGet, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return rawURL, nil
		}
		reqGet.Header.Set("User-Agent", c.userAgents[0])
		reqGet.Header.Set("Range", "bytes=0-0")
		respGet, errGet := c.httpClient.Do(reqGet)
		if errGet != nil {
			return rawURL, nil
		}
		defer respGet.Body.Close()
		if respGet.Request != nil && respGet.Request.URL != nil {
			return respGet.Request.URL.String(), nil
		}
		return rawURL, nil
	}
	defer resp.Body.Close()

	if resp.Request != nil && resp.Request.URL != nil {
		return resp.Request.URL.String(), nil
	}
	return rawURL, nil
}
