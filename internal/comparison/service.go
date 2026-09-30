package comparison

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ComparisonService handles cross-platform price comparison logic and cache orchestration.
type ComparisonService struct {
	repo  ComparisonRepository
	cache ComparisonCache
}

func NewComparisonService(repo ComparisonRepository, cache ComparisonCache) *ComparisonService {
	return &ComparisonService{
		repo:  repo,
		cache: cache,
	}
}

// BuildComparison queries latest data from database, computes best deal, persists snapshot, and updates cache.
func (s *ComparisonService) BuildComparison(ctx context.Context, productID uuid.UUID) (*ComparisonResult, error) {
	title, sources, err := s.repo.GetSourcesByProductID(ctx, productID)
	if err != nil {
		return nil, fmt.Errorf("get sources for product: %w", err)
	}

	if sources == nil {
		sources = []SourcePrice{}
	}

	bestDeal := IdentifyBestDeal(sources)

	result := &ComparisonResult{
		ProductID:           productID,
		ProductTitle:        title,
		ComparisonAvailable: len(sources) >= 2,
		Sources:             sources,
		BestDeal:            bestDeal,
		ComputedAt:          time.Now(),
	}

	// Persist snapshot to comparison_snapshots table (best-effort)
	_ = s.repo.UpsertComparisonSnapshot(ctx, productID, sources)

	// Update Redis cache (best-effort)
	if s.cache != nil {
		_ = s.cache.Set(ctx, productID, result)
	}

	return result, nil
}

// GetComparison retrieves comparison data using a cache-first strategy.
func (s *ComparisonService) GetComparison(ctx context.Context, productID uuid.UUID) (*ComparisonResult, error) {
	if s.cache != nil {
		cached, err := s.cache.Get(ctx, productID)
		if err == nil && cached != nil {
			return cached, nil
		}
	}

	return s.BuildComparison(ctx, productID)
}

// Invalidate removes cached comparison result for a product.
func (s *ComparisonService) Invalidate(ctx context.Context, productID uuid.UUID) error {
	if s.cache != nil {
		return s.cache.Invalidate(ctx, productID)
	}
	return nil
}

// ProductExists checks if a product exists in database.
func (s *ComparisonService) ProductExists(ctx context.Context, productID uuid.UUID) (bool, error) {
	return s.repo.ProductExists(ctx, productID)
}

// GetUserMultiSourceProducts returns products tracked by user that have >= 2 active sources.
func (s *ComparisonService) GetUserMultiSourceProducts(ctx context.Context, userID uuid.UUID) ([]ProductGroupSummary, error) {
	return s.repo.GetUserMultiSourceProducts(ctx, userID)
}

// RefreshAllActiveProducts iterates through all products with >= 2 sources and rebuilds comparison snapshots.
func (s *ComparisonService) RefreshAllActiveProducts(ctx context.Context) error {
	ids, err := s.repo.GetAllMultiSourceProductIDs(ctx)
	if err != nil {
		return fmt.Errorf("get multi-source product IDs: %w", err)
	}

	for _, pid := range ids {
		// Skip if recently refreshed in the last 5 minutes (prevents racing with worker invalidation)
		age, err := s.repo.GetSnapshotAge(ctx, pid)
		if err == nil && age != nil && time.Since(*age) < 5*time.Minute {
			continue
		}

		if _, err := s.BuildComparison(ctx, pid); err != nil {
			// Log / continue next product without aborting the entire loop
			continue
		}
	}

	return nil
}
