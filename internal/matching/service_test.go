package matching

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/tracking"
)

type mockMatchingRepo struct {
	suggestions  map[uuid.UUID]*MatchSuggestion
	lookupErr    error  // returned by GetSuggestionByProductAndURL
	lookupErrFor string // only for this candidate URL
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
	if m.lookupErr != nil {
		return nil, m.lookupErr
	}
	if m.lookupErrFor != "" && url == m.lookupErrFor {
		return nil, errors.New("db down")
	}
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
	failOn     string // platform whose search fails
}

func (ms *mockSearcher) Search(_ context.Context, platform, _ string) ([]*MatchCandidate, error) {
	if platform == ms.failOn {
		return nil, ErrSearchUnavailable
	}
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
	byUser     []bool
	groupErr   error // returned by CanEditGroup (e.g. tracking.ErrGroupShared)
}

func (ml *mockLinker) LinkSource(_ context.Context, _, _ uuid.UUID, url string, byUser bool) error {
	ml.linkedURLs = append(ml.linkedURLs, url)
	ml.byUser = append(ml.byUser, byUser)
	return nil
}

func (ml *mockLinker) CanEditGroup(context.Context, uuid.UUID, uuid.UUID) error { return ml.groupErr }

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

	// A suggestion cannot be accepted through another product's path (SEC-08)
	if err := svc.AcceptSuggestion(ctx, userID, uuid.New(), sugg.ID); !errors.Is(err, ErrSuggestionNotFound) {
		t.Fatalf("expected ErrSuggestionNotFound for foreign product, got %v", err)
	}
	if sugg.Status != StatusPending {
		t.Fatalf("suggestion changed through foreign product path: %s", sugg.Status)
	}

	// Test Accept
	if err := svc.AcceptSuggestion(ctx, userID, productID, sugg.ID); err != nil {
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
	if err := svc.DismissSuggestion(ctx, userID, uuid.New(), dismissID); !errors.Is(err, ErrSuggestionNotFound) {
		t.Fatalf("expected ErrSuggestionNotFound for foreign product, got %v", err)
	}
	if err := svc.DismissSuggestion(ctx, userID, productID, dismissID); err != nil {
		t.Fatalf("unexpected error on dismiss: %v", err)
	}
	d, _ := repo.GetSuggestionByID(ctx, dismissID)
	if d.Status != StatusDismissed {
		t.Errorf("expected status 'dismissed', got '%s'", d.Status)
	}
}

func TestMatchingService_DiscoverAndMatch_RequiresPrices(t *testing.T) {
	ctx := context.Background()
	candidate := &MatchCandidate{
		Platform:   "lazada",
		URL:        "https://lazada.vn/products/tai-nghe-sony-wh-1000xm5-i1.html",
		Title:      "Tai nghe Sony WH-1000XM5",
		SellerName: "Sony Official Store",
		IsMall:     true,
	}

	// Reference product without a fetched price: nothing is searched or linked (DATA-11).
	linker := &mockLinker{}
	svc := NewMatchingService(newMockMatchingRepo(), &mockSearcher{candidates: []*MatchCandidate{candidate}}, linker, &mockComparisonProvider{})
	if _, err := svc.DiscoverAndMatch(ctx, uuid.New(), uuid.New(), "shopee", "Tai nghe Sony WH-1000XM5", 0); !errors.Is(err, ErrNoReferencePrice) {
		t.Fatalf("expected ErrNoReferencePrice, got %v", err)
	}

	// Candidate without a price scores above the auto-link threshold but must not be auto-linked.
	if score := ScoreMatch(NormalizeTitle("Tai nghe Sony WH-1000XM5"), 6290000, candidate.Title, 0, candidate.SellerName, true); score < ThresholdAutoLink {
		t.Fatalf("test setup: expected score >= %.2f, got %.2f", ThresholdAutoLink, score)
	}
	result, err := svc.DiscoverAndMatch(ctx, uuid.New(), uuid.New(), "shopee", "Tai nghe Sony WH-1000XM5", 6290000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.AutoLinkedSources) != 0 || len(linker.linkedURLs) != 0 {
		t.Fatalf("candidate without price was auto-linked: %v", result.AutoLinkedSources)
	}
}

// A user-started match on a group someone else also tracks only suggests: a look-alike listing must not
// be auto-linked into other people's comparison.
func TestMatchingService_SharedGroupOnlySuggests(t *testing.T) {
	linker := &mockLinker{groupErr: tracking.ErrGroupShared}
	searcher := &mockSearcher{candidates: []*MatchCandidate{{
		Platform: "lazada", URL: "https://lazada.vn/products/tai-nghe-sony-wh-1000xm5-i9.html",
		Title: "Tai nghe Sony WH-1000XM5", SellerName: "Sony Official Store", Price: 6000000, IsMall: true,
	}}}
	svc := NewMatchingService(newMockMatchingRepo(), searcher, linker, &mockComparisonProvider{})

	result, err := svc.DiscoverAndMatch(context.Background(), uuid.New(), uuid.New(), "shopee", "Tai nghe Sony WH-1000XM5", 6290000)
	if err != nil {
		t.Fatal(err)
	}
	if len(linker.linkedURLs) != 0 || len(result.AutoLinkedSources) != 0 {
		t.Fatalf("shared group must not be auto-linked, linked %v", linker.linkedURLs)
	}
	if len(result.NewSuggestions) != 1 {
		t.Fatalf("the high-confidence candidate must become a suggestion, got %d", len(result.NewSuggestions))
	}
}

// A blocked search is a failure, not "no match"; with candidates from another platform it is partial.
func TestMatchingService_SearchFailureIsReported(t *testing.T) {
	ctx := context.Background()
	svc := NewMatchingService(newMockMatchingRepo(), &mockSearcher{failOn: "lazada"}, &mockLinker{}, &mockComparisonProvider{})
	if _, err := svc.DiscoverAndMatch(ctx, uuid.New(), uuid.New(), "shopee", "Tai nghe Sony WH-1000XM5", 6290000); !errors.Is(err, ErrSearchUnavailable) {
		t.Fatalf("expected ErrSearchUnavailable when nothing could be searched, got %v", err)
	}

	withTikTok := &mockSearcher{failOn: "lazada", candidates: []*MatchCandidate{{Platform: "tiktok", URL: "https://shop.tiktok.com/view/product/1", Title: "Tai nghe Sony WH-1000XM5", Price: 6200000}}}
	svc = NewMatchingService(newMockMatchingRepo(), withTikTok, &mockLinker{}, &mockComparisonProvider{})
	if res, err := svc.DiscoverAndMatch(ctx, uuid.New(), uuid.New(), "shopee", "Tai nghe Sony WH-1000XM5", 6290000); err != nil || res.TotalDiscovered != 1 {
		t.Fatalf("candidates from another platform must still be returned, got %+v %v", res, err)
	}
}

// A database failure while checking a candidate's earlier suggestion must not be read as "no earlier
// suggestion": the candidate is skipped (never re-suggested over a decision), and a run where nothing
// could be checked reports the failure.
func TestMatchingService_LookupFailureIsNotSwallowed(t *testing.T) {
	repo := newMockMatchingRepo()
	repo.lookupErr = errors.New("db down")
	linker := &mockLinker{}
	searcher := &mockSearcher{candidates: []*MatchCandidate{{
		Platform: "lazada", URL: "https://lazada.vn/products/x-i1.html", Title: "Tai nghe Sony WH-1000XM5", SellerName: "Sony Official", Price: 6200000, IsMall: true,
	}}}
	svc := NewMatchingService(repo, searcher, linker, &mockComparisonProvider{})

	_, err := svc.DiscoverAndMatch(context.Background(), uuid.New(), uuid.New(), "shopee", "Tai nghe Sony WH-1000XM5", 6290000)
	if err == nil {
		t.Fatal("expected the lookup failure to be reported")
	}
	if len(repo.suggestions) != 0 || len(linker.linkedURLs) != 0 {
		t.Fatalf("nothing may be saved or linked for an unchecked candidate, got %d suggestions, %d links", len(repo.suggestions), len(linker.linkedURLs))
	}
}

// Refreshing pending suggestions while one candidate could not be checked is a partial success
// (incomplete), not an error; and the result's lists are never null in JSON.
func TestMatchingService_PartialRunIsIncompleteNotError(t *testing.T) {
	productID := uuid.New()
	repo := newMockMatchingRepo()
	pendingURL := "https://lazada.vn/products/known-i1.html"
	repo.suggestions[uuid.New()] = &MatchSuggestion{ID: uuid.New(), ProductID: productID, CandidateURL: pendingURL, Status: StatusPending}
	repo.lookupErrFor = "https://lazada.vn/products/broken-i2.html"
	searcher := &mockSearcher{candidates: []*MatchCandidate{
		{Platform: "lazada", URL: pendingURL, Title: "Tai nghe Sony WH-1000XM5", Price: 6200000},
		{Platform: "lazada", URL: repo.lookupErrFor, Title: "Tai nghe Sony WH-1000XM5", Price: 6100000},
	}}
	svc := NewMatchingService(repo, searcher, nil, &mockComparisonProvider{})

	res, err := svc.DiscoverAndMatch(context.Background(), uuid.New(), productID, "shopee", "Tai nghe Sony WH-1000XM5", 6290000)
	if err != nil || res == nil || !res.Incomplete {
		t.Fatalf("expected a partial (incomplete) result, got %+v, %v", res, err)
	}

	empty, err := NewMatchingService(newMockMatchingRepo(), &mockSearcher{}, nil, nil).DiscoverAndMatch(context.Background(), uuid.New(), uuid.New(), "shopee", "!!!", 6290000)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(empty)
	if strings.Contains(string(raw), "null") {
		t.Fatalf("lists must be [] not null: %s", raw)
	}
}
