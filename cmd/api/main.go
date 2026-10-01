package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/comparison"
	router "github.com/tiendang/deal-hunter/internal/http"
	"github.com/tiendang/deal-hunter/internal/jobs"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/marketplace/lazada"
	"github.com/tiendang/deal-hunter/internal/marketplace/mock"
	"github.com/tiendang/deal-hunter/internal/marketplace/shopee"
	"github.com/tiendang/deal-hunter/internal/marketplace/tiktok"
	"github.com/tiendang/deal-hunter/internal/matching"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/internal/voucher"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
	"github.com/tiendang/deal-hunter/pkg/config"
	"github.com/tiendang/deal-hunter/pkg/database"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Load config failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	logger.Info("Starting API server", "port", cfg.HTTPPort, "env", cfg.AppEnv)

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
	trackingRepo := tracking.NewPostgresRepository(dbPool)
	pricingRepo := pricing.NewPostgresRepository(dbPool)
	jobRepo := jobs.NewPostgresRepository(dbPool)
	alertRepo := alert.NewPostgresRepository(dbPool)
	notifRepo := notification.NewPostgresRepository(dbPool)
	comparisonRepo := comparison.NewPostgresRepository(dbPool)
	authRepo := auth.NewPostgresUserRepository(dbPool)
	voucherRepo := voucher.NewPostgresRepository(dbPool)

	// 5. Queue
	q := queue.NewRedisStreamQueue(rdb, "dh:stream:price-fetch", "price-workers")
	if err := q.Init(ctx); err != nil {
		logger.Warn("Redis consumer group init note", "err", err)
	}

	// 6. Domain Services
	trackingSvc := tracking.NewTrackingService(registry, productRepo, trackingRepo, jobRepo, q)
	pricingSvc := pricing.NewPricingService(pricingRepo)
	comparisonCache := comparison.NewRedisCache(rdb)
	comparisonSvc := comparison.NewComparisonService(comparisonRepo, comparisonCache)
	jwtMgr := auth.NewJWTManager(cfg.JWTSecret, 7*24*time.Hour)
	authSvc := auth.NewAuthService(authRepo, jwtMgr, cfg.GoogleClientID)

	// GAP-03: Matching Service
	matchingRepo := matching.NewPostgresMatchingRepository(dbPool)
	searcher := matching.NewMultiPlatformSearcher(nil)
	linker := &trackingLinker{trackingSvc: trackingSvc}
	matchingSvc := matching.NewMatchingService(matchingRepo, searcher, linker, comparisonSvc)

	// Phase 3.5.1: Affiliate Link Engine
	affiliateCfg := affiliate.Config{
		Enabled:             cfg.AffiliateEnabled,
		ShopeeID:            cfg.ShopeeAffiliateID,
		ShopeeTemplate:      cfg.ShopeeAffiliateURLTemplate,
		LazadaID:            cfg.LazadaAffiliateID,
		LazadaTemplate:      cfg.LazadaAffiliateURLTemplate,
		TikTokID:            cfg.TikTokAffiliateID,
		TikTokTemplate:      cfg.TikTokAffiliateURLTemplate,
		AccessTradeTemplate: cfg.AccessTradeDeeplinkURL,
	}
	affiliateTr := affiliate.NewTransformer(affiliateCfg)
	comparisonSvc.SetAffiliateTransformer(affiliateTr)
	notifRepo.SetAffiliateTransformer(affiliateTr)

	// 7. HTTP Handlers & Router
	handler := router.NewHandler(trackingSvc, pricingSvc)
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)
	handler.SetComparisonService(comparisonSvc)
	handler.SetAuthService(authSvc, jwtMgr)
	handler.SetMatchingService(matchingSvc)
	handler.SetAffiliateTransformer(affiliateTr)
	handler.SetVoucherRepository(voucherRepo)
	if cfg.ZaloWebhookSecret != "" {
		handler.SetZaloWebhookSecret(cfg.ZaloWebhookSecret)
	}
	r := router.NewRouter(logger, handler)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server failed to listen", "err", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig

	logger.Info("Shutting down API server gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server shutdown failed", "err", err)
	}
	logger.Info("API server stopped")
}

type trackingLinker struct {
	trackingSvc *tracking.TrackingService
}

func (l *trackingLinker) LinkSource(ctx context.Context, userID, productID uuid.UUID, url string) error {
	_, err := l.trackingSvc.LinkSourceToProduct(ctx, userID, productID, url)
	return err
}
