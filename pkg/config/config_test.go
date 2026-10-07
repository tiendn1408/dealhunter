package config

import (
	"os"
	"testing"
	"time"
)

func TestConfigLoad(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.HTTPPort != 8080 {
		t.Errorf("Expected HTTPPort 8080, got %d", cfg.HTTPPort)
	}

	if cfg.DatabaseURL == "" {
		t.Errorf("Expected DatabaseURL to be non-empty")
	}

	if cfg.RedisURL == "" {
		t.Errorf("Expected RedisURL to be non-empty")
	}

	if cfg.WorkerConcurrency <= 0 {
		t.Errorf("Expected WorkerConcurrency > 0, got %d", cfg.WorkerConcurrency)
	}
}

func TestLoadEnvFile(t *testing.T) {
	tempFile, err := os.CreateTemp("", "test_env_*.env")
	if err != nil {
		t.Fatalf("CreateTemp failed: %v", err)
	}
	defer os.Remove(tempFile.Name())

	content := "TEST_CONFIG_CUSTOM_VAR=\"hello_dealhunter\"\n# comment line\nTEST_CONFIG_INT_VAR=9999\n"
	if _, err := tempFile.WriteString(content); err != nil {
		t.Fatalf("WriteString failed: %v", err)
	}
	tempFile.Close()

	loadEnvFile(tempFile.Name())

	if val := os.Getenv("TEST_CONFIG_CUSTOM_VAR"); val != "hello_dealhunter" {
		t.Errorf("Expected hello_dealhunter, got %s", val)
	}
	if val := os.Getenv("TEST_CONFIG_INT_VAR"); val != "9999" {
		t.Errorf("Expected 9999, got %s", val)
	}
}

func validProductionConfig() *Config {
	return &Config{
		AppEnv:             "production",
		JWTSecret:          "prod-secret-that-is-long-enough-1234567890",
		GoogleClientID:     "client.apps.googleusercontent.com",
		AccessTokenTTL:     15 * time.Minute,
		RefreshTokenTTL:    720 * time.Hour,
		AuthCookieSecure:   true,
		CORSAllowedOrigins: "https://dealhunter.vn, https://www.dealhunter.vn",
	}
}

func TestValidateAPI_Production(t *testing.T) {
	if err := validProductionConfig().ValidateAPI(); err != nil {
		t.Fatalf("expected valid production config, got %v", err)
	}

	cases := map[string]func(c *Config){
		"empty jwt secret":   func(c *Config) { c.JWTSecret = "" },
		"default jwt secret": func(c *Config) { c.JWTSecret = DevJWTSecret },
		"short jwt secret":   func(c *Config) { c.JWTSecret = "short" },
		"no google client":   func(c *Config) { c.GoogleClientID = "" },
		"insecure cookie":    func(c *Config) { c.AuthCookieSecure = false },
		"wildcard cors":      func(c *Config) { c.CORSAllowedOrigins = "*" },
		"empty cors":         func(c *Config) { c.CORSAllowedOrigins = "" },
		"zalo without creds": func(c *Config) { c.ZaloEnabled = true },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			c := validProductionConfig()
			mutate(c)
			if err := c.ValidateAPI(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestValidateAPI_DevelopmentRejectsEmptySecret(t *testing.T) {
	c := &Config{AppEnv: "development", JWTSecret: "", AccessTokenTTL: time.Minute, RefreshTokenTTL: time.Hour}
	if err := c.ValidateAPI(); err == nil {
		t.Fatal("expected empty JWT secret to be rejected in development")
	}
	c.JWTSecret = DevJWTSecret
	if err := c.ValidateAPI(); err != nil {
		t.Fatalf("expected dev default secret to be allowed in development, got %v", err)
	}
}

// Strict rules apply to every APP_ENV other than development/test
func TestValidateAPI_NonDevelopmentEnvsAreStrict(t *testing.T) {
	for _, env := range []string{"staging", "Production", "prod", ""} {
		c := &Config{AppEnv: env, JWTSecret: DevJWTSecret, AccessTokenTTL: time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: "*"}
		if err := c.ValidateAPI(); err == nil {
			t.Errorf("APP_ENV=%q: expected insecure config to be rejected", env)
		}
	}
	for _, env := range []string{"development", "test", "Development"} {
		c := &Config{AppEnv: env, JWTSecret: DevJWTSecret, AccessTokenTTL: time.Minute, RefreshTokenTTL: time.Hour}
		if err := c.ValidateAPI(); err != nil {
			t.Errorf("APP_ENV=%q: expected relaxed rules, got %v", env, err)
		}
	}
}

func TestZaloWebhookSecretFallsBackWhenEmpty(t *testing.T) {
	t.Setenv("ZALO_WEBHOOK_SECRET", "")
	t.Setenv("ZALO_OA_SECRET_KEY", "oa-secret")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ZaloWebhookSecret != "oa-secret" {
		t.Fatalf("expected fallback to ZALO_OA_SECRET_KEY, got %q", cfg.ZaloWebhookSecret)
	}
}
