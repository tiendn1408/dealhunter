package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppEnv              string
	HTTPPort            int
	DatabaseURL         string
	RedisURL            string
	WorkerConcurrency   int
	DefaultPollInterval time.Duration
	FetchTimeout        time.Duration
	MaxRetry            int
	ZaloOAAccessToken   string
	ZaloTemplateID      string
	ZaloAppID           string
	ZaloEnabled         bool
}

func Load() (*Config, error) {
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

	zaloToken := getEnv("ZALO_OA_ACCESS_TOKEN", "")
	zaloTemplate := getEnv("ZALO_TEMPLATE_ID", "")
	zaloAppID := getEnv("ZALO_APP_ID", "")
	zaloEnabled := getEnv("ZALO_ENABLED", "false") == "true" || zaloToken != ""

	return &Config{
		AppEnv:              getEnv("APP_ENV", "development"),
		HTTPPort:            port,
		DatabaseURL:         getEnv("DATABASE_URL", "postgres://dealuser:dealpass@localhost:5433/dealdb?sslmode=disable"),
		RedisURL:            getEnv("REDIS_URL", "redis://localhost:6379"),
		WorkerConcurrency:   concurrency,
		DefaultPollInterval: time.Duration(pollInterval) * time.Second,
		FetchTimeout:        timeout,
		MaxRetry:            maxRetry,
		ZaloOAAccessToken:   zaloToken,
		ZaloTemplateID:      zaloTemplate,
		ZaloAppID:           zaloAppID,
		ZaloEnabled:         zaloEnabled,
	}, nil
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
