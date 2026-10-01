//go:build integration
// +build integration

package integration

import (
	"os"

	"github.com/redis/go-redis/v9"
)

func getTestRedisURL() string {
	u := os.Getenv("REDIS_URL")
	if u != "" {
		return u
	}
	return "redis://localhost:6380"
}

func getTestRedisClient() *redis.Client {
	redisURL := getTestRedisURL()
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return redis.NewClient(&redis.Options{Addr: "localhost:6380"})
	}
	return redis.NewClient(opt)
}
