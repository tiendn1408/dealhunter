package config

import (
	"os"
	"testing"
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
