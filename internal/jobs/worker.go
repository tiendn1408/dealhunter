package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/pkg/metrics"
)

// Worker processes price-fetch jobs consumed from the Redis Stream.
// It runs a pool of goroutines, each consuming from the same consumer group.
type Worker struct {
	concurrency int
	q           queue.Queue
	jobRepo     domain.JobRepository
	productRepo product.ProductRepository
	pricingRepo pricing.PricingRepository
	registry    *marketplace.Registry
	db          *pgxpool.Pool // pool supports concurrent transactions across goroutines
	logger      *slog.Logger

	// Phase 2 components
	ruleEngine   alert.RuleEngine
	notifRepo    notification.Repository
	dedupService *notification.DedupService
	notifQueue   queue.Queue

	// Phase 3 components
	comparisonCache comparison.ComparisonCache
}

func NewWorker(
	concurrency int,
	q queue.Queue,
	jobRepo domain.JobRepository,
	productRepo product.ProductRepository,
	pricingRepo pricing.PricingRepository,
	registry *marketplace.Registry,
	db *pgxpool.Pool,
	logger *slog.Logger,
) *Worker {
	return &Worker{
		concurrency: concurrency,
		q:           q,
		jobRepo:     jobRepo,
		productRepo: productRepo,
		pricingRepo: pricingRepo,
		registry:    registry,
		db:          db,
		logger:      logger,
	}
}

// SetDB injects the connection pool (optional override).
func (w *Worker) SetDB(db *pgxpool.Pool) {
	w.db = db
}

// SetAlertComponents injects alert evaluation and notification components.
func (w *Worker) SetAlertComponents(
	engine alert.RuleEngine,
	notifRepo notification.Repository,
	dedup *notification.DedupService,
	notifQueue queue.Queue,
) {
	w.ruleEngine = engine
	w.notifRepo = notifRepo
	w.dedupService = dedup
	w.notifQueue = notifQueue
}

// SetComparisonCache injects the comparison cache for cache invalidation upon price updates.
func (w *Worker) SetComparisonCache(cache comparison.ComparisonCache) {
	w.comparisonCache = cache
}

func (w *Worker) Run(ctx context.Context) error {
	w.logger.Info("Starting worker pool", "concurrency", w.concurrency)
	var wg sync.WaitGroup

	for i := 0; i < w.concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			w.runWorker(ctx, fmt.Sprintf("worker-%d", workerID))
		}(i)
	}

	wg.Wait()
	w.logger.Info("Worker pool stopped")
	return nil
}

func (w *Worker) runWorker(ctx context.Context, consumerName string) {
	ch, err := w.q.Consume(ctx, consumerName)
	if err != nil {
		w.logger.Error("Failed to start consumer", "err", err)
		return
	}

	for msg := range ch {
		w.processJob(ctx, msg)
	}
}

func (w *Worker) processJob(ctx context.Context, msg queue.Message) {
	jobUUID, err := uuid.Parse(msg.JobID)
	if err != nil {
		w.logger.Error("Invalid job id", "job_id", msg.JobID)
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}

	job, err := w.jobRepo.GetJob(ctx, jobUUID)
	if err != nil {
		w.logger.Error("Job not found", "job_id", msg.JobID)
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}

	// Idempotency: skip already-finished jobs (handles Redis re-delivery after crash)
	if job.Status == domain.JobStatusSucceeded || job.Status == domain.JobStatusDead {
		w.logger.Info("Job already finished, acking", "job_id", msg.JobID, "status", job.Status)
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}

	// 1. Mark Running
	if err := w.jobRepo.MarkRunning(ctx, job.ID); err != nil {
		w.logger.Error("Failed to mark running", "job_id", job.ID, "err", err)
		return
	}

	// 2. Fetch ProductSource
	source, err := w.productRepo.GetProductSource(ctx, job.ProductSourceID)
	if err != nil {
		_ = w.jobRepo.MarkFailed(ctx, job.ID, "source_not_found", err.Error())
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}

	// 3. Find adapter
	adapter, err := w.registry.Detect(source.CanonicalURL)
	if err != nil {
		_ = w.jobRepo.MarkFailed(ctx, job.ID, "adapter_not_found", err.Error())
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}

	// 4. Fetch price with timeout
	fetchStart := time.Now()
	fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	snapshot, err := adapter.FetchPrice(fetchCtx, source)
	duration := time.Since(fetchStart).Seconds()
	metrics.PriceFetchDuration.WithLabelValues(source.Platform).Observe(duration)

	if err != nil {
		metrics.PriceFetchTotal.WithLabelValues(source.Platform, "failure").Inc()
		w.logger.Error("Fetch failed", "job_id", job.ID, "err", err)
		if job.Attempt >= 5 {
			_ = w.jobRepo.MarkDead(ctx, job.ID)
		} else {
			metrics.JobRetryTotal.Inc()
			_ = w.jobRepo.MarkFailed(ctx, job.ID, "fetch_failed", err.Error())
		}
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}
	metrics.PriceFetchTotal.WithLabelValues(source.Platform, "success").Inc()

	// 5. Atomic success transaction:
	//    INSERT snapshot + UPDATE product_source + UPDATE fetch_job
	tx, err := w.db.Begin(ctx)
	if err != nil {
		w.logger.Error("Begin tx failed", "err", err)
		return
	}
	defer tx.Rollback(ctx) // noop if already committed

	if err := w.pricingRepo.InsertSnapshot(ctx, tx, snapshot); err != nil {
		w.logger.Error("Insert snapshot failed", "err", err)
		return
	}

	oldPrice := int64(0)
	if source.LastPrice != nil {
		oldPrice = *source.LastPrice
	}

	now := time.Now()
	source.LastPrice = &snapshot.Price
	source.LastShippingFee = &snapshot.ShippingFee
	source.LastEffectivePrice = &snapshot.EffectivePrice
	source.LastInStock = snapshot.InStock
	source.LastFetchedAt = &now

	if err := w.productRepo.UpdateProductSourcePrice(ctx, tx, source); err != nil {
		w.logger.Error("Update source price failed", "err", err)
		return
	}

	if err := w.jobRepo.MarkSucceeded(ctx, tx, job.ID); err != nil {
		w.logger.Error("Mark succeeded failed", "err", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		w.logger.Error("Commit failed", "err", err)
		return
	}

	metrics.PriceSnapshotsTotal.Inc()

	// Phase 2: Check price change and evaluate alert rules
	if oldPrice > 0 && oldPrice != snapshot.Price && w.ruleEngine != nil {
		w.evaluateAlerts(ctx, source, oldPrice, snapshot.Price, snapshot.CapturedAt)
	}

	w.logger.Info("Job succeeded",
		"job_id", job.ID,
		"platform", source.Platform,
		"effective_price", snapshot.EffectivePrice,
	)
	_ = w.q.Ack(ctx, msg.MsgID)

	// Phase 3: Invalidate comparison cache if product has multiple sources
	if w.comparisonCache != nil && source.ProductID != uuid.Nil {
		if err := w.comparisonCache.Invalidate(ctx, source.ProductID); err != nil {
			w.logger.Warn("Comparison cache invalidate failed", "product_id", source.ProductID, "err", err)
		}
	}
}

func (w *Worker) evaluateAlerts(ctx context.Context, source *product.ProductSource, oldPrice, newPrice int64, capturedAt time.Time) {
	if w.logger == nil {
		w.logger = slog.Default()
	}

	event := alert.PriceChangeEvent{
		ProductSourceID: source.ID,
		OldPrice:        oldPrice,
		NewPrice:        newPrice,
		CapturedAt:      capturedAt,
	}

	matchedRules, err := w.ruleEngine.Evaluate(ctx, event)
	if err != nil {
		w.logger.Error("Failed to evaluate alert rules", "source_id", source.ID, "err", err)
		return
	}

	for _, rule := range matchedRules {
		// Dedup check
		if w.dedupService != nil {
			suppressed, err := w.dedupService.ShouldSuppress(ctx, rule.UserID, rule.ID)
			if err != nil {
				w.logger.Error("Dedup check error", "rule_id", rule.ID, "err", err)
			} else if suppressed {
				w.logger.Info("Alert suppressed by dedup window", "rule_id", rule.ID, "user_id", rule.UserID)
				continue
			}
		}

		recipient := ""
		if w.notifRepo != nil {
			rec, err := w.notifRepo.GetUserRecipient(ctx, rule.UserID, "zalo")
			if err == nil {
				recipient = rec
			}
		}

		logEntry := &notification.NotificationLog{
			UserID:      rule.UserID,
			AlertRuleID: rule.ID,
			Channel:     "zalo",
			Recipient:   recipient,
			Status:      notification.StatusQueued,
			PriceBefore: oldPrice,
			PriceAfter:  newPrice,
		}

		if w.notifRepo != nil {
			if err := w.notifRepo.InsertLog(ctx, logEntry); err != nil {
				w.logger.Error("Failed to insert notification log", "rule_id", rule.ID, "err", err)
				continue
			}
		}

		if w.notifQueue != nil {
			payloadBytes, err := json.Marshal(notification.QueuePayload{
				NotificationLogID: logEntry.ID,
				UserID:            rule.UserID,
				AlertRuleID:       rule.ID,
				Recipient:         recipient,
				Channel:           "zalo",
				ProductSourceID:   source.ID,
				PriceBefore:       oldPrice,
				PriceAfter:        newPrice,
			})
			if err != nil {
				w.logger.Error("Failed to marshal notification queue payload", "err", err)
				continue
			}

			if err := w.notifQueue.Enqueue(ctx, string(payloadBytes)); err != nil {
				w.logger.Error("Failed to enqueue notification", "err", err)
			} else {
				w.logger.Info("Notification queued for alert", "rule_id", rule.ID, "user_id", rule.UserID)
			}
		}
	}
}
