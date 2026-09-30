package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/config"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Load config failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	logger.Info("Starting scheduler", "poll_interval", cfg.DefaultPollInterval)

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

	// 3. Repositories
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)

	// 4. Queue
	q := queue.NewRedisStreamQueue(rdb, "dh:stream:price-fetch", "price-workers")
	if err := q.Init(ctx); err != nil {
		logger.Warn("Redis consumer group init note", "err", err)
	}

	// 5. Scheduler (ticks every 10 seconds to check due trackings)
	scheduler := jobs.NewScheduler(
		trackingRepo,
		jobRepo,
		q,
		10*time.Second,
		logger,
	)

	// 6. Phase 3: Refresh comparison snapshots every 10 minutes
	comparisonRepo := comparison.NewPostgresRepository(dbPool)
	comparisonCache := comparison.NewRedisCache(rdb)
	comparisonSvc := comparison.NewComparisonService(comparisonRepo, comparisonCache)

	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := comparisonSvc.RefreshAllActiveProducts(ctx); err != nil {
					logger.Error("Comparison refresh error", "err", err)
				}
			}
		}
	}()

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		logger.Info("Shutting down scheduler...")
		cancel()
	}()

	if err := scheduler.Run(ctx); err != nil {
		logger.Error("Scheduler exit with error", "err", err)
	}
	logger.Info("Scheduler stopped")
}
