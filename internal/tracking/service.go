package tracking

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
			SellerName:        optionalString(data.SellerName),
			RawTitle:          &data.RawTitle,
			Currency:          "VND",
			Active:            true,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if err := s.productRepo.UpsertProductSource(ctx, nil, source); err != nil {
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
	// ErrGroupShared: a user may only change a comparison group nobody else tracks; a shared group is
	// only extended by the system's auto-match.
	ErrGroupShared = errors.New("product group is tracked by other users")
	// ErrSourceInOtherGroup: the URL's source belongs to a product group other users track,
	// so moving it would silently change their comparison (SEC-07).
	ErrSourceInOtherGroup = errors.New("source belongs to another product group")
)

// CanAccessProduct reports whether the user may read or change a product group:
// they must track at least one of its sources.
func (s *TrackingService) CanAccessProduct(ctx context.Context, userID, productID uuid.UUID) (bool, error) {
	return s.trackingRepo.UserTracksProduct(ctx, nil, userID, productID)
}

// ResolveSourceForUser resolves id (the user's tracked_product ID or a product_source ID) to a product
// source the user may access, i.e. a source in a product group they track. Returns ErrProductNotFound otherwise.
func (s *TrackingService) ResolveSourceForUser(ctx context.Context, userID, id uuid.UUID) (*product.ProductSource, error) {
	sourceID := id
	tracked, err := s.trackingRepo.GetTrackingForUser(ctx, id, userID)
	switch {
	case err == nil && tracked != nil:
		sourceID = tracked.ProductSourceID
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return nil, err // a database failure is not "not found" (SEC-12)
	}
	source, err := s.productRepo.GetProductSource(ctx, sourceID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && source == nil) {
		return nil, ErrProductNotFound
	}
	if err != nil {
		return nil, err
	}
	ok, err := s.trackingRepo.UserTracksProduct(ctx, nil, userID, source.ProductID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrProductNotFound
	}
	return source, nil
}

// ResolveProductForUser resolves id (a product ID, the user's tracked_product ID or a product_source ID)
// to a product group the user may access. Returns ErrProductNotFound otherwise.
func (s *TrackingService) ResolveProductForUser(ctx context.Context, userID, id uuid.UUID) (uuid.UUID, error) {
	ok, err := s.trackingRepo.UserTracksProduct(ctx, nil, userID, id)
	if err != nil {
		return uuid.Nil, err
	}
	if ok {
		return id, nil
	}
	source, err := s.ResolveSourceForUser(ctx, userID, id)
	if err != nil {
		return uuid.Nil, err
	}
	return source.ProductID, nil
}

// DetectPlatform returns the marketplace a URL belongs to.
func (s *TrackingService) DetectPlatform(url string) (string, error) {
	adapter, err := s.registry.Detect(url)
	if err != nil {
		return "", err
	}
	return adapter.Name(), nil
}

// CanEditGroup reports whether userID may change the comparison group by hand (accept or dismiss
// match suggestions): only when nobody else tracks it (ErrGroupShared otherwise).
func (s *TrackingService) CanEditGroup(ctx context.Context, userID, productID uuid.UUID) error {
	shared, err := s.trackingRepo.OtherUsersTrackProduct(ctx, nil, productID, userID)
	if err != nil {
		return fmt.Errorf("check group trackers: %w", err)
	}
	if shared {
		return ErrGroupShared
	}
	return nil
}

// LinkSourceToProduct adds the product at url to targetProductID's comparison group. The caller must track
// the target group. A user-initiated change (byUser) also requires that nobody else tracks the target group:
// otherwise anyone tracking the same public URL could put arbitrary products in other people's comparison.
// The system's auto-match (byUser=false) may extend a shared group. In both cases a source already in
// another group is only moved when no other user tracks that group. Checks and the change happen in one
// transaction holding locks on both groups, so a concurrent tracking cannot slip in between.
func (s *TrackingService) LinkSourceToProduct(ctx context.Context, userID, targetProductID uuid.UUID, url string, byUser bool) (*product.ProductSource, error) {
	ok, err := s.trackingRepo.UserTracksProduct(ctx, nil, userID, targetProductID)
	if err != nil {
		return nil, fmt.Errorf("check target product: %w", err)
	}
	if !ok {
		return nil, ErrProductNotFound
	}
	// Fail fast before reading the marketplace; re-checked under the group locks below
	if byUser {
		if shared, err := s.trackingRepo.OtherUsersTrackProduct(ctx, nil, targetProductID, userID); err != nil {
			return nil, fmt.Errorf("check target group: %w", err)
		} else if shared {
			return nil, ErrGroupShared
		}
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
	if source != nil && source.ProductID == targetProductID {
		return nil, ErrSourceAlreadyLinked
	}

	groups := []uuid.UUID{targetProductID}
	if source != nil {
		groups = append(groups, source.ProductID)
	}
	err = s.trackingRepo.WithGroupLock(ctx, groups, func(tx pgx.Tx) error {
		// Re-checked under the locks: the group may have changed since the checks above
		if ok, err := s.trackingRepo.UserTracksProduct(ctx, tx, userID, targetProductID); err != nil {
			return fmt.Errorf("check target product: %w", err)
		} else if !ok {
			return ErrProductNotFound
		}
		if byUser {
			if shared, err := s.trackingRepo.OtherUsersTrackProduct(ctx, tx, targetProductID, userID); err != nil {
				return fmt.Errorf("check target group: %w", err)
			} else if shared {
				return ErrGroupShared
			}
		}

		if source != nil {
			if shared, err := s.trackingRepo.OtherUsersTrackProduct(ctx, tx, source.ProductID, userID); err != nil {
				return fmt.Errorf("check source group: %w", err)
			} else if shared {
				return ErrSourceInOtherGroup
			}
			if err := s.productRepo.AssignProductSource(ctx, tx, source.ID, source.ProductID, targetProductID); err != nil {
				if errors.Is(err, product.ErrSourceMoved) {
					return ErrSourceInOtherGroup
				}
				return fmt.Errorf("reassign source: %w", err)
			}
			source.ProductID = targetProductID
			return nil
		}

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
			SellerName:        optionalString(data.SellerName),
			RawTitle:          &data.RawTitle,
			Currency:          "VND",
			Active:            true,
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if err := s.productRepo.UpsertProductSource(ctx, tx, source); err != nil {
			return fmt.Errorf("insert source: %w", err)
		}
		// Someone created this source concurrently in another group: never move it implicitly
		if source.ProductID != targetProductID {
			return ErrSourceInOtherGroup
		}
		return nil
	})
	if err != nil {
		return nil, err
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

// optionalString maps a value the marketplace did not state ("") to NULL.
func optionalString(v string) *string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return &v
}
