package comparison

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

type mockRepo struct {
	title       string
	sources     []SourcePrice
	groups      []ProductGroupSummary
	snapshotAge *time.Time
	multiIDs    []uuid.UUID
	exists      bool

	getSourcesCalls int
	upsertCalls     int
}

func (m *mockRepo) GetSourcesByProductID(ctx context.Context, productID uuid.UUID) (string, []SourcePrice, error) {
	m.getSourcesCalls++
	if !m.exists {
		return "", nil, fmt.Errorf("product not found")
	}
	return m.title, m.sources, nil
}

func (m *mockRepo) UpsertComparisonSnapshot(ctx context.Context, productID uuid.UUID, sources []SourcePrice) error {
	m.upsertCalls++
	return nil
}

func (m *mockRepo) GetUserMultiSourceProducts(ctx context.Context, userID uuid.UUID) ([]ProductGroupSummary, error) {
	return m.groups, nil
}

func (m *mockRepo) GetSnapshotAge(ctx context.Context, productID uuid.UUID) (*time.Time, error) {
	return m.snapshotAge, nil
}

func (m *mockRepo) GetAllMultiSourceProductIDs(ctx context.Context) ([]uuid.UUID, error) {
	return m.multiIDs, nil
}

func (m *mockRepo) ProductExists(ctx context.Context, productID uuid.UUID) (bool, error) {
	return m.exists, nil
}

type mockCache struct {
	store           map[uuid.UUID]*ComparisonResult
	getCalls        int
	setCalls        int
	invalidateCalls int
}

func newMockCache() *mockCache {
	return &mockCache{store: make(map[uuid.UUID]*ComparisonResult)}
}

func (c *mockCache) Get(ctx context.Context, productID uuid.UUID) (*ComparisonResult, error) {
	c.getCalls++
	res, ok := c.store[productID]
	if !ok {
		return nil, nil
	}
	return res, nil
}

func (c *mockCache) Set(ctx context.Context, productID uuid.UUID, result *ComparisonResult) error {
	c.setCalls++
	c.store[productID] = result
	return nil
}

func (c *mockCache) Invalidate(ctx context.Context, productID uuid.UUID) error {
	c.invalidateCalls++
	delete(c.store, productID)
	return nil
}

func TestComparisonService_CacheHit(t *testing.T) {
	ctx := context.Background()
	productID := uuid.New()

	cachedResult := &ComparisonResult{
		ProductID:           productID,
		ProductTitle:        "Cached Sony XM6",
		ComparisonAvailable: true,
		ComputedAt:          time.Now().Add(-1 * time.Minute),
	}

	cache := newMockCache()
	cache.store[productID] = cachedResult

	repo := &mockRepo{exists: true}
	svc := NewComparisonService(repo, cache)

	result, err := svc.GetComparison(ctx, productID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.ProductTitle != "Cached Sony XM6" {
		t.Errorf("expected cached title, got %s", result.ProductTitle)
	}
	if repo.getSourcesCalls != 0 {
		t.Errorf("expected 0 repo calls on cache hit, got %d", repo.getSourcesCalls)
	}
	if cache.getCalls != 1 {
		t.Errorf("expected 1 cache get call, got %d", cache.getCalls)
	}
}

func TestComparisonService_CacheMiss_BuildsAndCaches(t *testing.T) {
	ctx := context.Background()
	productID := uuid.New()
	now := time.Now()

	repo := &mockRepo{
		exists: true,
		title:  "Sony WH-1000XM6",
		sources: []SourcePrice{
			{
				SourceID:       uuid.New(),
				Platform:       "shopee",
				EffectivePrice: 6290000,
				InStock:        true,
				CapturedAt:     &now,
			},
			{
				SourceID:       uuid.New(),
				Platform:       "tiktok",
				EffectivePrice: 6190000,
				InStock:        true,
				CapturedAt:     &now,
			},
		},
	}

	cache := newMockCache()
	svc := NewComparisonService(repo, cache)

	result, err := svc.GetComparison(ctx, productID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.ComparisonAvailable {
		t.Error("expected comparison_available = true for 2 sources")
	}
	if result.BestDeal == nil || result.BestDeal.Platform != "tiktok" {
		t.Errorf("expected tiktok as best deal, got %+v", result.BestDeal)
	}
	if repo.getSourcesCalls != 1 {
		t.Errorf("expected 1 repo call on cache miss, got %d", repo.getSourcesCalls)
	}
	if repo.upsertCalls != 1 {
		t.Errorf("expected 1 snapshot upsert, got %d", repo.upsertCalls)
	}
	if cache.setCalls != 1 {
		t.Errorf("expected 1 cache set call, got %d", cache.setCalls)
	}

	// Verify cached item is now retrievable
	if _, ok := cache.store[productID]; !ok {
		t.Error("expected result to be stored in cache")
	}
}

func TestComparisonService_SingleSource(t *testing.T) {
	ctx := context.Background()
	productID := uuid.New()

	repo := &mockRepo{
		exists: true,
		title:  "Single Source Product",
		sources: []SourcePrice{
			{
				SourceID:       uuid.New(),
				Platform:       "shopee",
				EffectivePrice: 1000000,
				InStock:        true,
			},
		},
	}

	cache := newMockCache()
	svc := NewComparisonService(repo, cache)

	result, err := svc.GetComparison(ctx, productID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.ComparisonAvailable {
		t.Error("expected comparison_available = false for 1 source")
	}
	if result.BestDeal == nil {
		t.Error("expected best deal populated even for single in-stock source")
	}
}

func TestComparisonService_Invalidate(t *testing.T) {
	ctx := context.Background()
	productID := uuid.New()

	cache := newMockCache()
	cache.store[productID] = &ComparisonResult{ProductID: productID}

	svc := NewComparisonService(&mockRepo{}, cache)
	if err := svc.Invalidate(ctx, productID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cache.invalidateCalls != 1 {
		t.Errorf("expected 1 invalidate call, got %d", cache.invalidateCalls)
	}
	if _, ok := cache.store[productID]; ok {
		t.Error("expected product to be removed from cache")
	}
}
