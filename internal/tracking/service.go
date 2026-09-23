package tracking

import (
	"context"
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

	// 3. Upsert Product
	prod := &product.Product{
		ID:        uuid.New(),
		Title:     data.RawTitle,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := s.productRepo.UpsertProduct(ctx, prod); err != nil {
		return nil, fmt.Errorf("upsert product: %w", err)
	}

	// 4. Upsert ProductSource
	source := &product.ProductSource{
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

	// 5. Create Tracking
	tracked := &domain.TrackedProduct{
		ID:                     uuid.New(),
		UserID:                 userID,
		ProductSourceID:        source.ID,
		Active:                 true,
		PollingIntervalSeconds: 1800,
		NextFetchAt:            time.Now(),
		CreatedAt:              time.Now(),
		UpdatedAt:              time.Now(),
	}
	if err := s.trackingRepo.CreateTracking(ctx, tracked); err != nil {
		return nil, fmt.Errorf("create tracking: %w", err)
	}

	// 6. Create FetchJob
	job := &domain.FetchJob{
		ID:              uuid.New(),
		ProductSourceID: source.ID,
		Status:          domain.JobStatusQueued,
		Attempt:         0,
		AvailableAt:     time.Now(),
		CreatedAt:       time.Now(),
	}
	if err := s.jobRepo.CreateJob(ctx, job); err != nil {
		return nil, fmt.Errorf("create job: %w", err)
	}

	// 7. Enqueue to Redis
	if err := s.q.Enqueue(ctx, job.ID.String()); err != nil {
		// Log error but don't fail tracking creation.
		// The scheduler will pick it up later if queue fails.
		fmt.Printf("failed to enqueue job: %v\n", err)
	}

	return tracked, nil
}
