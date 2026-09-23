package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/queue"
)

type Scheduler struct {
	trackingRepo domain.TrackingRepository
	jobRepo      domain.JobRepository
	q            queue.Queue
	interval     time.Duration
	logger       *slog.Logger
}

func NewScheduler(
	trackingRepo domain.TrackingRepository,
	jobRepo domain.JobRepository,
	q queue.Queue,
	interval time.Duration,
	logger *slog.Logger,
) *Scheduler {
	return &Scheduler{
		trackingRepo: trackingRepo,
		jobRepo:      jobRepo,
		q:            q,
		interval:     interval,
		logger:       logger,
	}
}

func (s *Scheduler) Run(ctx context.Context) error {
	s.logger.Info("Scheduler starting", "interval", s.interval)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.logger.Info("Scheduler stopping")
			return nil
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	trackings, err := s.trackingRepo.ClaimDueTrackings(ctx, 100)
	if err != nil {
		s.logger.Error("Failed to claim trackings", "err", err)
		return
	}

	if len(trackings) == 0 {
		return
	}

	s.logger.Info("Processing due trackings", "count", len(trackings))

	for _, t := range trackings {
		job := &domain.FetchJob{
			ID:              uuid.New(),
			ProductSourceID: t.ProductSourceID,
			Status:          domain.JobStatusQueued,
			Attempt:         0,
			AvailableAt:     time.Now(),
			CreatedAt:       time.Now(),
		}

		if err := s.jobRepo.CreateJob(ctx, job); err != nil {
			s.logger.Error("Failed to create job", "tracking_id", t.ID, "err", err)
			continue
		}

		if err := s.q.Enqueue(ctx, job.ID.String()); err != nil {
			s.logger.Error("Failed to enqueue job", "job_id", job.ID, "err", err)
			continue
		}
	}
}
