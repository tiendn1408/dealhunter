package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
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
}

func NewWorker(
	concurrency int,
	q queue.Queue,
	jobRepo domain.JobRepository,
	productRepo product.ProductRepository,
	pricingRepo pricing.PricingRepository,
	registry *marketplace.Registry,
	logger *slog.Logger,
) *Worker {
	return &Worker{
		concurrency: concurrency,
		q:           q,
		jobRepo:     jobRepo,
		productRepo: productRepo,
		pricingRepo: pricingRepo,
		registry:    registry,
		logger:      logger,
	}
}

// SetDB injects the connection pool.
// Must be called before Run().
func (w *Worker) SetDB(db *pgxpool.Pool) {
	w.db = db
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
	fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	snapshot, err := adapter.FetchPrice(fetchCtx, source)
	if err != nil {
		w.logger.Error("Fetch failed", "job_id", job.ID, "err", err)
		if job.Attempt >= 5 {
			_ = w.jobRepo.MarkDead(ctx, job.ID)
		} else {
			_ = w.jobRepo.MarkFailed(ctx, job.ID, "fetch_failed", err.Error())
		}
		_ = w.q.Ack(ctx, msg.MsgID)
		return
	}

	// 5. Atomic success transaction:
	//    INSERT snapshot + UPDATE product_source + UPDATE fetch_job + UPDATE tracked_products
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

	w.logger.Info("Job succeeded",
		"job_id", job.ID,
		"platform", source.Platform,
		"effective_price", snapshot.EffectivePrice,
	)
	_ = w.q.Ack(ctx, msg.MsgID)
}
