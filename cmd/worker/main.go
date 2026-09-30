package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/lazada"
	"github.com/tiendang/deal-hunter/internal/marketplace/mock"
	"github.com/tiendang/deal-hunter/internal/marketplace/shopee"
	"github.com/tiendang/deal-hunter/internal/marketplace/tiktok"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
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
	logger.Info("Starting worker pool", "concurrency", cfg.WorkerConcurrency)

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

	// 3. Marketplace Registry
	registry := marketplace.NewRegistry()
	registry.Register(mock.NewMockAdapter())
	registry.Register(lazada.NewLazadaAdapter())
	registry.Register(shopee.NewShopeeAdapter())
	registry.Register(tiktok.NewTikTokAdapter())

	// 4. Repositories
	productRepo := product.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)

	// 5. Queue
	q := queue.NewRedisStreamQueue(rdb, "dh:stream:price-fetch", "price-workers")
	if err := q.Init(ctx); err != nil {
		logger.Warn("Redis consumer group init note", "err", err)
	}

	// 6. Worker Pool
	worker := jobs.NewWorker(
		cfg.WorkerConcurrency,
		q,
		jobRepo,
		productRepo,
		pricingRepo,
		registry,
		dbPool,
		logger,
	)

	// 7. Phase 2 Alert & Notification Components
	alertRepo := alert.NewPostgresRepository(dbPool)
	ruleEngine := alert.NewRuleEngine(alertRepo, pricingRepo)
	notifRepo := notification.NewPostgresRepository(dbPool)
	dedupService := notification.NewDedupService(notifRepo, notification.NotifDedupWindow)
	notifQueue := queue.NewRedisStreamQueue(rdb, "dh:stream:notifications", "dh:notifier")
	if err := notifQueue.Init(ctx); err != nil {
		logger.Warn("Redis notification consumer group init note", "err", err)
	}

	worker.SetAlertComponents(ruleEngine, notifRepo, dedupService, notifQueue)

	// 8. Phase 3 Comparison Cache Invalidation
	comparisonCache := comparison.NewRedisCache(rdb)
	worker.SetComparisonCache(comparisonCache)

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		logger.Info("Shutting down worker pool...")
		cancel()
	}()

	if err := worker.Run(ctx); err != nil {
		logger.Error("Worker exit with error", "err", err)
	}
	logger.Info("Worker stopped")
}
