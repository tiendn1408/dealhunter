package matching

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/comparison"
)

type mockMatchingRepo struct {
	suggestions map[uuid.UUID]*MatchSuggestion
}

func newMockMatchingRepo() *mockMatchingRepo {
	return &mockMatchingRepo{
		suggestions: make(map[uuid.UUID]*MatchSuggestion),
	}
}

func (m *mockMatchingRepo) SaveSuggestion(_ context.Context, s *MatchSuggestion) error {
	m.suggestions[s.ID] = s
	return nil
}

func (m *mockMatchingRepo) GetSuggestionsByProductID(_ context.Context, pid uuid.UUID) ([]*MatchSuggestion, error) {
	res := make([]*MatchSuggestion, 0)
	for _, s := range m.suggestions {
		if s.ProductID == pid && s.Status == StatusPending {
			res = append(res, s)
		}
	}
	return res, nil
}

func (m *mockMatchingRepo) GetSuggestionByID(_ context.Context, id uuid.UUID) (*MatchSuggestion, error) {
	return m.suggestions[id], nil
}

func (m *mockMatchingRepo) GetSuggestionByProductAndURL(_ context.Context, pid uuid.UUID, url string) (*MatchSuggestion, error) {
	for _, s := range m.suggestions {
		if s.ProductID == pid && s.CandidateURL == url {
			return s, nil
		}
	}
	return nil, nil
}

func (m *mockMatchingRepo) UpdateSuggestionStatus(_ context.Context, id uuid.UUID, status string) error {
	if s, ok := m.suggestions[id]; ok {
		s.Status = status
	}
	return nil
}

type mockSearcher struct {
	candidates []*MatchCandidate
}

func (ms *mockSearcher) Search(_ context.Context, platform, _ string) ([]*MatchCandidate, error) {
	var matched []*MatchCandidate
	for _, c := range ms.candidates {
		if c.Platform == platform {
			matched = append(matched, c)
		}
	}
	return matched, nil
}

type mockLinker struct {
	linkedURLs []string
}

func (ml *mockLinker) LinkSource(_ context.Context, _, _ uuid.UUID, url string) error {
	ml.linkedURLs = append(ml.linkedURLs, url)
	return nil
}

type mockComparisonProvider struct {
	invalidated bool
}

func (mi *mockComparisonProvider) GetComparison(_ context.Context, _ uuid.UUID) (*comparison.ComparisonResult, error) {
	return nil, nil
}

func (mi *mockComparisonProvider) Invalidate(_ context.Context, _ uuid.UUID) error {
	mi.invalidated = true
	return nil
}

func TestMatchingService_DiscoverAndMatch(t *testing.T) {
	repo := newMockMatchingRepo()
	linker := &mockLinker{}
	comp := &mockComparisonProvider{}

	searcher := &mockSearcher{
		candidates: []*MatchCandidate{
			{
				Platform:   "lazada",
				URL:        "https://lazada.vn/products/tai-nghe-sony-wh-1000xm5-i1.html",
				Title:      "Tai nghe Sony WH-1000XM5 Chính Hãng",
				SellerName: "Sony Official Store",
				Price:      6290000,
				IsMall:     true,
			},
			{
				Platform:   "tiktok",
				URL:        "https://shop.tiktok.com/view/product/2",
				Title:      "Tai nghe Bluetooth Sony WH-1000XM5",
				SellerName: "Audio Store Gia Re",
				Price:      8200000, // ~30% higher -> suggestion score 0.81
				IsMall:     false,
			},
		},
	}

	svc := NewMatchingService(repo, searcher, linker, comp)
	ctx := context.Background()

	productID := uuid.New()
	userID := uuid.New()

	result, err := svc.DiscoverAndMatch(ctx, userID, productID, "shopee", "Tai nghe Sony WH-1000XM5", 6290000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.AutoLinkedSources) != 1 {
		t.Errorf("expected 1 auto-linked source, got %d", len(result.AutoLinkedSources))
	}
	if len(result.NewSuggestions) != 1 {
		t.Errorf("expected 1 suggestion, got %d", len(result.NewSuggestions))
	}

	// Verify suggestion status and accept flow
	sugg := result.NewSuggestions[0]
	if sugg.Status != StatusPending {
		t.Errorf("expected status 'pending', got '%s'", sugg.Status)
	}

	// Test Accept
	if err := svc.AcceptSuggestion(ctx, userID, sugg.ID); err != nil {
		t.Fatalf("unexpected error on accept: %v", err)
	}
	if sugg.Status != StatusAccepted {
		t.Errorf("expected status 'accepted', got '%s'", sugg.Status)
	}
	if len(linker.linkedURLs) != 2 {
		t.Errorf("expected 2 linked URLs total (1 auto + 1 accepted), got %d", len(linker.linkedURLs))
	}

	// Test Dismiss
	dismissID := uuid.New()
	repo.SaveSuggestion(ctx, &MatchSuggestion{
		ID:        dismissID,
		ProductID: productID,
		Status:    StatusPending,
	})
	if err := svc.DismissSuggestion(ctx, dismissID); err != nil {
		t.Fatalf("unexpected error on dismiss: %v", err)
	}
	d, _ := repo.GetSuggestionByID(ctx, dismissID)
	if d.Status != StatusDismissed {
		t.Errorf("expected status 'dismissed', got '%s'", d.Status)
	}
}
