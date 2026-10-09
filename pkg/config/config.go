package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	TrustedProxies      string // comma-separated IPs/CIDRs of reverse proxies whose X-Forwarded-For is believed
	AppEnv              string
	HTTPPort            int
	LogLevel            string
	DatabaseURL         string
	PostgresUser        string
	PostgresPassword    string
	PostgresDB          string
	PostgresPort        int
	RedisURL            string
	RedisPort           int
	WorkerConcurrency   int
	DefaultPollInterval time.Duration
	FetchTimeout        time.Duration
	MaxRetry            int
	ZaloOAAccessToken   string
	ZaloTemplateID      string
	ZaloOTPTemplateID   string // ZNS template for the phone verification code (variable: otp)
	ZaloAppID           string
	ZaloOASecretKey     string
	ZaloRefreshToken    string
	ZaloWebhookSecret   string
	ZaloEnabled         bool
	CORSAllowedOrigins  string
	AdminEmails         string
	JWTSecret           string
	GoogleClientID      string
	AccessTokenTTL      time.Duration
	RefreshTokenTTL     time.Duration
	AuthCookieSecure    bool

	// Affiliate Marketing (Phase 3.5.1)
	AffiliateEnabled           bool
	ShopeeAffiliateID          string
	ShopeeAffiliateURLTemplate string
	LazadaAffiliateID          string
	LazadaAffiliateURLTemplate string
	TikTokAffiliateID          string
	TikTokAffiliateURLTemplate string
	AccessTradeDeeplinkURL     string
}

func Load() (*Config, error) {
	loadEnvFile(".env")

	port, err := parseInt(getEnv("HTTP_PORT", "8080"))
	if err != nil {
		return nil, fmt.Errorf("invalid HTTP_PORT: %w", err)
	}

	concurrency, err := parseInt(getEnv("WORKER_CONCURRENCY", "10"))
	if err != nil {
		return nil, fmt.Errorf("invalid WORKER_CONCURRENCY: %w", err)
	}

	pollInterval, err := parseInt(getEnv("DEFAULT_POLL_INTERVAL", "1800"))
	if err != nil {
		return nil, fmt.Errorf("invalid DEFAULT_POLL_INTERVAL: %w", err)
	}

	timeoutStr := getEnv("FETCH_TIMEOUT", "10s")
	timeout, err := time.ParseDuration(timeoutStr)
	if err != nil {
		return nil, fmt.Errorf("invalid FETCH_TIMEOUT: %w", err)
	}

	maxRetry, err := parseInt(getEnv("MAX_RETRY", "5"))
	if err != nil {
		return nil, fmt.Errorf("invalid MAX_RETRY: %w", err)
	}

	pgPort, _ := parseInt(getEnv("POSTGRES_PORT", "5433"))
	redisPort, _ := parseInt(getEnv("REDIS_PORT", "6380"))

	zaloToken := getEnv("ZALO_OA_ACCESS_TOKEN", "")
	zaloTemplate := getEnv("ZALO_TEMPLATE_ID", "")
	zaloOTPTemplate := getEnv("ZALO_OTP_TEMPLATE_ID", "")
	zaloAppID := getEnv("ZALO_APP_ID", "")
	zaloSecret := getEnv("ZALO_OA_SECRET_KEY", "")
	zaloRefreshToken := getEnv("ZALO_REFRESH_TOKEN", "")
	// Compose passes unset variables as "", so an empty override falls back to the OA secret key
	zaloWebhookSecret := getEnv("ZALO_WEBHOOK_SECRET", "")
	if zaloWebhookSecret == "" {
		zaloWebhookSecret = zaloSecret
	}
	zaloEnabled := getEnv("ZALO_ENABLED", "false") == "true" || zaloToken != "" || zaloRefreshToken != ""

	// Fail closed: a deployment that forgets APP_ENV gets production rules (local dev sets it in .env)
	trustedProxies := getEnv("TRUSTED_PROXIES", "")
	appEnv := getEnv("APP_ENV", "production")
	isDev := !isStrictEnv(appEnv)

	accessTTL, err := time.ParseDuration(getEnv("ACCESS_TOKEN_TTL", "15m"))
	if err != nil {
		return nil, fmt.Errorf("invalid ACCESS_TOKEN_TTL: %w", err)
	}
	refreshTTL, err := time.ParseDuration(getEnv("REFRESH_TOKEN_TTL", "720h"))
	if err != nil {
		return nil, fmt.Errorf("invalid REFRESH_TOKEN_TTL: %w", err)
	}

	return &Config{
		TrustedProxies:      trustedProxies,
		AppEnv:              appEnv,
		HTTPPort:            port,
		LogLevel:            getEnv("LOG_LEVEL", "info"),
		DatabaseURL:         getEnv("DATABASE_URL", "postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable"),
		PostgresUser:        getEnv("POSTGRES_USER", "dealuser"),
		PostgresPassword:    getEnv("POSTGRES_PASSWORD", "dealpass"),
		PostgresDB:          getEnv("POSTGRES_DB", "dealdb"),
		PostgresPort:        pgPort,
		RedisURL:            getEnv("REDIS_URL", "redis://localhost:6380"),
		RedisPort:           redisPort,
		WorkerConcurrency:   concurrency,
		DefaultPollInterval: time.Duration(pollInterval) * time.Second,
		FetchTimeout:        timeout,
		MaxRetry:            maxRetry,
		ZaloOAAccessToken:   zaloToken,
		ZaloTemplateID:      zaloTemplate,
		ZaloOTPTemplateID:   zaloOTPTemplate,
		ZaloAppID:           zaloAppID,
		ZaloOASecretKey:     zaloSecret,
		ZaloRefreshToken:    zaloRefreshToken,
		ZaloWebhookSecret:   zaloWebhookSecret,
		ZaloEnabled:         zaloEnabled,
		CORSAllowedOrigins:  getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000"),
		AdminEmails:         getEnv("ADMIN_EMAILS", ""),
		JWTSecret:           getEnv("JWT_SECRET", DevJWTSecret),
		GoogleClientID:      getEnv("GOOGLE_CLIENT_ID", ""),
		AccessTokenTTL:      accessTTL,
		RefreshTokenTTL:     refreshTTL,
		AuthCookieSecure:    getEnv("AUTH_COOKIE_SECURE", strconv.FormatBool(!isDev)) == "true",

		// Affiliate Marketing
		// Affiliate links are off unless real affiliate accounts are configured; no placeholder templates
		AffiliateEnabled:           getEnv("AFFILIATE_ENABLED", "false") == "true",
		ShopeeAffiliateID:          getEnv("SHOPEE_AFFILIATE_ID", ""),
		ShopeeAffiliateURLTemplate: getEnv("SHOPEE_AFFILIATE_URL_TEMPLATE", ""),
		LazadaAffiliateID:          getEnv("LAZADA_AFFILIATE_ID", ""),
		LazadaAffiliateURLTemplate: getEnv("LAZADA_AFFILIATE_URL_TEMPLATE", ""),
		TikTokAffiliateID:          getEnv("TIKTOK_AFFILIATE_ID", ""),
		TikTokAffiliateURLTemplate: getEnv("TIKTOK_AFFILIATE_URL_TEMPLATE", ""),
		AccessTradeDeeplinkURL:     getEnv("ACCESSTRADE_DEEPLINK_URL", ""),
	}, nil
}

// DevJWTSecret is the public development default. It is rejected in production.
const DevJWTSecret = "dealhunter-super-secret-jwt-key-32bytes-secure!"

// isStrictEnv reports whether production-grade rules apply. Only an explicit "development" or "test"
// is relaxed; any other value (production, staging, Production, typos) is treated as production.
func isStrictEnv(appEnv string) bool {
	switch strings.ToLower(strings.TrimSpace(appEnv)) {
	case "development", "test":
		return false
	}
	return true
}

func (c *Config) IsProduction() bool {
	return isStrictEnv(c.AppEnv)
}

// CORSOrigins returns the comma-separated CORS_ALLOWED_ORIGINS as a list.
func (c *Config) CORSOrigins() []string {
	var origins []string
	for _, o := range strings.Split(c.CORSAllowedOrigins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	return origins
}

// AdminEmailList returns ADMIN_EMAILS (comma-separated Google account emails allowed to manage vouchers).
func (c *Config) AdminEmailList() []string {
	var emails []string
	for _, e := range strings.Split(c.AdminEmails, ",") {
		if e = strings.TrimSpace(e); e != "" {
			emails = append(emails, e)
		}
	}
	return emails
}

// ValidateAPI fails fast on insecure API configuration. Production rules are strict;
// an empty JWT secret is rejected in every environment.
func (c *Config) ValidateAPI() error {
	var problems []string

	if len(c.JWTSecret) < 32 {
		problems = append(problems, "JWT_SECRET must be at least 32 characters")
	}
	if c.AccessTokenTTL <= 0 || c.RefreshTokenTTL <= c.AccessTokenTTL {
		problems = append(problems, "ACCESS_TOKEN_TTL must be > 0 and shorter than REFRESH_TOKEN_TTL")
	}

	if c.IsProduction() {
		if c.JWTSecret == DevJWTSecret {
			problems = append(problems, "JWT_SECRET must not use the development default")
		}
		if c.GoogleClientID == "" {
			problems = append(problems, "GOOGLE_CLIENT_ID is required")
		}
		if !c.AuthCookieSecure {
			problems = append(problems, "AUTH_COOKIE_SECURE must be true")
		}
		origins := c.CORSOrigins()
		if len(origins) == 0 {
			problems = append(problems, "CORS_ALLOWED_ORIGINS is required")
		}
		for _, o := range origins {
			if o == "*" {
				problems = append(problems, "CORS_ALLOWED_ORIGINS must not contain *")
			}
		}
		if c.ZaloEnabled && (c.ZaloAppID == "" || c.ZaloWebhookSecret == "") {
			problems = append(problems, "ZALO_APP_ID and ZALO_OA_SECRET_KEY (or ZALO_WEBHOOK_SECRET) are required when Zalo is enabled")
		}
	}

	if len(problems) > 0 {
		return fmt.Errorf("invalid configuration (APP_ENV=%s): %s", c.AppEnv, strings.Join(problems, "; "))
	}
	return nil
}

func loadEnvFile(filenames ...string) {
	for _, filename := range filenames {
		f, err := os.Open(filename)
		if err != nil {
			continue
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
					val = val[1 : len(val)-1]
				}
				if _, exists := os.LookupEnv(key); !exists {
					os.Setenv(key, val)
				}
			}
		}
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func parseInt(s string) (int, error) {
	return strconv.Atoi(s)
}
