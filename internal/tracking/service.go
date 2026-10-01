package tracking

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
)

type TrackingService struct {
	registry     *marketplace.Registry
	productRepo  product.ProductRepository
	trackingRepo domain.TrackingRepository
	jobRepo      domain.JobRepository
	q            queue.Queue
}

func NewTrackingService(
	registry *marketplace.Registry,
	productRepo product.ProductRepository,
	trackingRepo domain.TrackingRepository,
	jobRepo domain.JobRepository,
	q queue.Queue,
) *TrackingService {
	return &TrackingService{
		registry:     registry,
		productRepo:  productRepo,
		trackingRepo: trackingRepo,
		jobRepo:      jobRepo,
		q:            q,
	}
}

func (s *TrackingService) TrackURL(ctx context.Context, userID uuid.UUID, url string) (*domain.TrackedProduct, error) {
	// 1. Detect platform
	adapter, err := s.registry.Detect(url)
	if err != nil {
		return nil, fmt.Errorf("detect platform: %w", err)
	}

	// 2. Resolve Product
	data, err := adapter.ResolveProduct(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("resolve product: %w", err)
	}

	// 3. Check if ProductSource already exists to avoid creating duplicate/orphan Products
	var source *product.ProductSource
	if data.ExternalProductID != "" {
		source, err = s.productRepo.GetProductSourceByExternalID(ctx, adapter.Name(), data.ExternalProductID)
		if err != nil {
			return nil, fmt.Errorf("check existing source: %w", err)
		}
	}

	if source == nil {
		// New product: insert Product and ProductSource
		prod := &product.Product{
			ID:        uuid.New(),
			Title:     data.RawTitle,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if err := s.productRepo.UpsertProduct(ctx, prod); err != nil {
			return nil, fmt.Errorf("upsert product: %w", err)
		}

		source = &product.ProductSource{
			ID:                uuid.New(),
			ProductID:         prod.ID,
			Platform:          adapter.Name(),
			ExternalProductID: &data.ExternalProductID,
			CanonicalURL:      data.CanonicalURL,
			SellerName:        &data.SellerName,
			Currency:          "VND",
			Active:            true,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if err := s.productRepo.UpsertProductSource(ctx, source); err != nil {
			return nil, fmt.Errorf("upsert source: %w", err)
		}
	}

	// 4. Create Tracking (schedule next fetch for 30m later since we queue an immediate fetch now)
	pollInterval := 1800
	tracked := &domain.TrackedProduct{
		ID:                     uuid.New(),
		UserID:                 userID,
		ProductSourceID:        source.ID,
		Active:                 true,
		PollingIntervalSeconds: pollInterval,
		NextFetchAt:            time.Now().Add(time.Duration(pollInterval) * time.Second),
		CreatedAt:              time.Now(),
		UpdatedAt:              time.Now(),
		IsPrimary:              true,
	}
	if err := s.trackingRepo.CreateTracking(ctx, tracked); err != nil {
		return nil, fmt.Errorf("create tracking: %w", err)
	}

	// 5. Create immediate initial FetchJob
	job := &domain.FetchJob{
		ID:              uuid.New(),
		ProductSourceID: source.ID,
		Status:          domain.JobStatusQueued,
		Attempt:         0,
		AvailableAt:     time.Now(),
		CreatedAt:       time.Now(),
	}
	if s.jobRepo != nil {
		if err := s.jobRepo.CreateJob(ctx, job); err != nil {
			return nil, fmt.Errorf("create job: %w", err)
		}

		// 6. Enqueue to Redis
		if s.q != nil {
			if err := s.q.Enqueue(ctx, job.ID.String()); err != nil {
				// Log error but don't fail tracking creation.
				// The scheduler will pick it up later if queue fails.
				fmt.Printf("failed to enqueue job: %v\n", err)
			}
		}
	}

	return tracked, nil
}

func (s *TrackingService) GetTracking(ctx context.Context, id uuid.UUID) (*domain.TrackedProduct, error) {
	return s.trackingRepo.GetTracking(ctx, id)
}

func (s *TrackingService) GetTrackingForUser(ctx context.Context, id, userID uuid.UUID) (*domain.TrackedProduct, error) {
	return s.trackingRepo.GetTrackingForUser(ctx, id, userID)
}

func (s *TrackingService) ListTrackings(ctx context.Context, userID uuid.UUID) ([]*domain.TrackedProduct, error) {
	return s.trackingRepo.ListTrackingsByUser(ctx, userID)
}

func (s *TrackingService) PauseTracking(ctx context.Context, id, userID uuid.UUID) error {
	return s.trackingRepo.SetTrackingActiveForUser(ctx, id, userID, false)
}

func (s *TrackingService) ResumeTracking(ctx context.Context, id, userID uuid.UUID) error {
	// Set active to true and schedule fetch immediately
	if err := s.trackingRepo.SetTrackingActiveForUser(ctx, id, userID, true); err != nil {
		return err
	}
	return s.trackingRepo.UpdateNextFetchAtForUser(ctx, nil, id, userID, time.Now())
}

func (s *TrackingService) GetProductSource(ctx context.Context, id uuid.UUID) (*product.ProductSource, error) {
	return s.productRepo.GetProductSource(ctx, id)
}

var (
	ErrProductNotFound     = errors.New("product not found")
	ErrSourceAlreadyLinked = errors.New("source already linked to this product")
)

func (s *TrackingService) LinkSourceToProduct(ctx context.Context, userID, targetProductID uuid.UUID, url string) (*product.ProductSource, error) {
	exists, err := s.productRepo.ProductExists(ctx, targetProductID)
	if err != nil {
		return nil, fmt.Errorf("check target product: %w", err)
	}
	if !exists {
		return nil, ErrProductNotFound
	}

	adapter, err := s.registry.Detect(url)
	if err != nil {
		return nil, fmt.Errorf("detect platform: %w", err)
	}
	data, err := adapter.ResolveProduct(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("resolve product: %w", err)
	}

	var source *product.ProductSource
	if data.ExternalProductID != "" {
		source, err = s.productRepo.GetProductSourceByExternalID(ctx, adapter.Name(), data.ExternalProductID)
		if err != nil {
			return nil, fmt.Errorf("check existing source: %w", err)
		}
	}

	if source != nil {
		if source.ProductID == targetProductID {
			return nil, ErrSourceAlreadyLinked
		}
		if err := s.productRepo.AssignProductSource(ctx, source.ID, targetProductID); err != nil {
			return nil, fmt.Errorf("reassign source: %w", err)
		}
		source.ProductID = targetProductID
	} else {
		var extID *string
		if data.ExternalProductID != "" {
			extID = &data.ExternalProductID
		}
		source = &product.ProductSource{
			ID:                uuid.New(),
			ProductID:         targetProductID,
			Platform:          adapter.Name(),
			ExternalProductID: extID,
			CanonicalURL:      data.CanonicalURL,
			SellerName:        &data.SellerName,
			RawTitle:          &data.RawTitle,
			Currency:          "VND",
			Active:            true,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if err := s.productRepo.UpsertProductSource(ctx, source); err != nil {
			return nil, fmt.Errorf("insert source: %w", err)
		}
	}

	// Create TrackedProduct with IsPrimary = false if user isn't tracking yet
	tracked, err := s.trackingRepo.GetTrackingBySource(ctx, userID, source.ID)
	if err == nil && tracked == nil {
		pollInterval := 1800
		newTracked := &domain.TrackedProduct{
			ID:                     uuid.New(),
			UserID:                 userID,
			ProductSourceID:        source.ID,
			Active:                 true,
			PollingIntervalSeconds: pollInterval,
			NextFetchAt:            time.Now().Add(time.Duration(pollInterval) * time.Second),
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
			IsPrimary:              false,
		}
		_ = s.trackingRepo.CreateTracking(ctx, newTracked)
	}

	// Create and enqueue initial fetch job
	job := &domain.FetchJob{
		ID:              uuid.New(),
		ProductSourceID: source.ID,
		Status:          domain.JobStatusQueued,
		Attempt:         0,
		AvailableAt:     time.Now(),
		CreatedAt:       time.Now(),
	}
	if err := s.jobRepo.CreateJob(ctx, job); err == nil {
		_ = s.q.Enqueue(ctx, job.ID.String())
	}

	return source, nil
}
