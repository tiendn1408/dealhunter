package comparison

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	comparisonCacheTTL       = 5 * time.Minute
	comparisonCacheKeyPrefix = "dh:cmp:"
)

// RedisComparisonCache implements ComparisonCache using Redis.
type RedisComparisonCache struct {
	client *redis.Client
}

func NewRedisCache(client *redis.Client) *RedisComparisonCache {
	return &RedisComparisonCache{client: client}
}

func (c *RedisComparisonCache) key(productID uuid.UUID) string {
	return comparisonCacheKeyPrefix + productID.String()
}

func (c *RedisComparisonCache) Get(ctx context.Context, productID uuid.UUID) (*ComparisonResult, error) {
	if c.client == nil {
		return nil, nil
	}

	data, err := c.client.Get(ctx, c.key(productID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil // Cache miss
	}
	if err != nil {
		return nil, err
	}

	var result ComparisonResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (c *RedisComparisonCache) Set(ctx context.Context, productID uuid.UUID, result *ComparisonResult) error {
	if c.client == nil || result == nil {
		return nil
	}

	data, err := json.Marshal(result)
	if err != nil {
		return err
	}

	return c.client.Set(ctx, c.key(productID), data, comparisonCacheTTL).Err()
}

func (c *RedisComparisonCache) Invalidate(ctx context.Context, productID uuid.UUID) error {
	if c.client == nil {
		return nil
	}

	return c.client.Del(ctx, c.key(productID)).Err()
}
