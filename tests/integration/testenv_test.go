//go:build integration
// +build integration

package integration

import (
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"
)

// Integration tests write users, products and stream entries. They must never run against the
// development database, which holds only real data, so they use their own database and Redis DB.

const (
	defaultTestDatabaseURL = "postgres://dealuser:dealpass@localhost:5433/dealdb_test?sslmode=disable"
	defaultTestRedisURL    = "redis://localhost:6380/15"
)

// getTestDatabaseURL returns TEST_DATABASE_URL (or the local default) and refuses any database
// whose name does not end in "_test".
func getTestDatabaseURL(t *testing.T) string {
	t.Helper()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = defaultTestDatabaseURL
	}
	u, err := url.Parse(dbURL)
	if err != nil {
		t.Fatalf("invalid TEST_DATABASE_URL: %v", err)
	}
	// pgx also takes the database name from a dbname query parameter, which would override the path
	if db := u.Query().Get("dbname"); db != "" && !strings.HasSuffix(db, "_test") {
		t.Fatalf("TEST_DATABASE_URL dbname parameter must end in _test (got %q)", db)
	}
	if !strings.HasSuffix(strings.TrimPrefix(u.Path, "/"), "_test") {
		t.Fatalf("TEST_DATABASE_URL must point to a database whose name ends in _test (got %q); run `make test-db`", u.Redacted())
	}
	return dbURL
}

// getTestRedisClient connects to TEST_REDIS_URL (or the local default) and refuses Redis DB 0,
// which the application uses.
func getTestRedisClient(t *testing.T) *redis.Client {
	t.Helper()
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		redisURL = defaultTestRedisURL
	}
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("invalid TEST_REDIS_URL: %v", err)
	}
	if opt.DB == 0 {
		t.Fatalf("TEST_REDIS_URL must select a Redis DB other than 0 (e.g. %s)", defaultTestRedisURL)
	}
	return redis.NewClient(opt)
}

func ptrInt64(v int64) *int64 { return &v }
