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
	ZaloAppID           string
	ZaloOASecretKey     string
	ZaloRefreshToken    string
	ZaloWebhookSecret   string
	ZaloEnabled         bool
	CORSAllowedOrigins  string
	JWTSecret           string
	GoogleClientID      string

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
	zaloAppID := getEnv("ZALO_APP_ID", "")
	zaloSecret := getEnv("ZALO_OA_SECRET_KEY", "")
	zaloRefreshToken := getEnv("ZALO_REFRESH_TOKEN", "")
	zaloWebhookSecret := getEnv("ZALO_WEBHOOK_SECRET", zaloSecret)
	zaloEnabled := getEnv("ZALO_ENABLED", "false") == "true" || zaloToken != "" || zaloRefreshToken != ""

	return &Config{
		AppEnv:              getEnv("APP_ENV", "development"),
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
		ZaloAppID:           zaloAppID,
		ZaloOASecretKey:     zaloSecret,
		ZaloRefreshToken:    zaloRefreshToken,
		ZaloWebhookSecret:   zaloWebhookSecret,
		ZaloEnabled:         zaloEnabled,
		CORSAllowedOrigins:  getEnv("CORS_ALLOWED_ORIGINS", "*"),
		JWTSecret:           getEnv("JWT_SECRET", "dealhunter-super-secret-jwt-key-32bytes-secure!"),
		GoogleClientID:      getEnv("GOOGLE_CLIENT_ID", ""),

		// Affiliate Marketing
		AffiliateEnabled:           getEnv("AFFILIATE_ENABLED", "true") == "true",
		ShopeeAffiliateID:          getEnv("SHOPEE_AFFILIATE_ID", ""),
		ShopeeAffiliateURLTemplate: getEnv("SHOPEE_AFFILIATE_URL_TEMPLATE", "https://s.shopee.vn/universal-link?url={URL}&sub_id={SUB_ID}"),
		LazadaAffiliateID:          getEnv("LAZADA_AFFILIATE_ID", ""),
		LazadaAffiliateURLTemplate: getEnv("LAZADA_AFFILIATE_URL_TEMPLATE", "https://s.lazada.vn/s.xxxx?url={URL}&aff_sub={SUB_ID}"),
		TikTokAffiliateID:          getEnv("TIKTOK_AFFILIATE_ID", ""),
		TikTokAffiliateURLTemplate: getEnv("TIKTOK_AFFILIATE_URL_TEMPLATE", "https://vt.tiktok.com/xxxx?url={URL}&sub_id={SUB_ID}"),
		AccessTradeDeeplinkURL:     getEnv("ACCESSTRADE_DEEPLINK_URL", ""),
	}, nil
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
