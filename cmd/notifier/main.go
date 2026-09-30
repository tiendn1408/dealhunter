package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/notification/zalo"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/pkg/config"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Load config failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	logger.Info("Starting notification worker...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. PostgreSQL Connection Pool
	dbPool, err := database.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("Failed to connect to PostgreSQL", "err", err)
		os.Exit(1)
	}
	defer dbPool.Close()

	// 2. Redis Client
	redisOpt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		redisOpt = &redis.Options{Addr: cfg.RedisURL}
	}
	rdb := redis.NewClient(redisOpt)
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Error("Failed to connect to Redis", "err", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// 3. Notification Repository
	notifRepo := notification.NewPostgresRepository(dbPool)

	// 4. Notification Queue
	q := queue.NewRedisStreamQueue(rdb, "dh:stream:notifications", "dh:notifier")
	if err := q.Init(ctx); err != nil {
		logger.Warn("Redis consumer group init note", "err", err)
	}

	// 5. Zalo Client (falls back to mock client if Zalo credentials not configured)
	var zaloClient zalo.ZaloClient
	if cfg.ZaloEnabled && cfg.ZaloOAAccessToken != "" {
		logger.Info("Using real Zalo HTTP client")
		zaloClient = zalo.NewHTTPZaloClient(cfg.ZaloOAAccessToken, rdb)
	} else {
		logger.Info("Using Mock Zalo client (sandbox/development mode)")
		zaloClient = zalo.NewMockZaloClient()
	}

	// 6. Notifier Service
	notifier := notification.NewNotifierService(
		notifRepo,
		q,
		zaloClient,
		cfg.ZaloTemplateID,
		logger,
	)

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		logger.Info("Shutting down notification worker...")
		cancel()
	}()

	if err := notifier.Run(ctx, "notifier-1"); err != nil {
		logger.Error("Notifier exited with error", "err", err)
	}
	logger.Info("Notifier stopped")
}
