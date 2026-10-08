package matching

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/tracking"
)

// SourceLinker defines an interface to link a discovered product source to a canonical product.
type SourceLinker interface {
	LinkSource(ctx context.Context, userID, productID uuid.UUID, url string) error
}

// ComparisonProvider defines an interface to read comparison and invalidate caches.
type ComparisonProvider interface {
	GetComparison(ctx context.Context, productID uuid.UUID) (*comparison.ComparisonResult, error)
	Invalidate(ctx context.Context, productID uuid.UUID) error
}

// MatchingService coordinates query normalization, cross-platform searching, scoring, auto-linking, and suggestions.
type MatchingService struct {
	repo       MatchingRepository
	searcher   CandidateSearcher
	linker     SourceLinker
	comparison ComparisonProvider
}

func NewMatchingService(repo MatchingRepository, searcher CandidateSearcher, linker SourceLinker, comp ComparisonProvider) *MatchingService {
	return &MatchingService{
		repo:       repo,
		searcher:   searcher,
		linker:     linker,
		comparison: comp,
	}
}

// ErrNoReferencePrice is returned when the reference product has no fetched price yet.
var ErrNoReferencePrice = errors.New("reference product has no price yet")

// DiscoverAndMatch performs cross-marketplace matching for a reference product.
func (s *MatchingService) DiscoverAndMatch(ctx context.Context, userID, productID uuid.UUID, refPlatform, refTitle string, refPrice int64) (*AutoMatchResult, error) {
	// Without a real price the price check is neutral and wrong products can be auto-linked (DATA-11).
	if refPrice <= 0 {
		return nil, ErrNoReferencePrice
	}

	norm := NormalizeTitle(refTitle)
	if norm.CleanTitle == "" {
		return &AutoMatchResult{ProductID: productID}, nil
	}

	allPlatforms := []string{"shopee", "lazada", "tiktok"}
	targetPlatforms := make([]string, 0, 2)
	for _, p := range allPlatforms {
		if !strings.EqualFold(p, refPlatform) {
			targetPlatforms = append(targetPlatforms, p)
		}
	}

	result := &AutoMatchResult{
		ProductID:         productID,
		ReferenceTitle:    refTitle,
		AutoLinkedSources: []string{},
		NewSuggestions:    []*MatchSuggestion{},
		TotalDiscovered:   0,
	}

	// 1. Gather existing source URLs to avoid duplicate matching
	existingURLs := make(map[string]bool)
	if s.comparison != nil {
		if cmp, err := s.comparison.GetComparison(ctx, productID); err == nil && cmp != nil {
			for _, src := range cmp.Sources {
				existingURLs[src.CanonicalURL] = true
				existingURLs[strings.TrimRight(src.CanonicalURL, "/")] = true
			}
		}
	}

	for _, targetPlatform := range targetPlatforms {
		candidates, err := s.searcher.Search(ctx, targetPlatform, norm.SearchQuery)
		if err != nil {
			continue
		}

		result.TotalDiscovered += len(candidates)

		for _, cand := range candidates {
			cleanCandURL := strings.TrimRight(cand.URL, "/")
			if existingURLs[cand.URL] || existingURLs[cleanCandURL] {
				// Already an active linked source in this product group
				continue
			}

			// Check if suggestion already exists in DB
			existing, _ := s.repo.GetSuggestionByProductAndURL(ctx, productID, cand.URL)
			if existing != nil {
				if existing.Status == StatusDismissed {
					// User explicitly dismissed this candidate before; respect their choice
					continue
				}
				if existing.Status == StatusAccepted || existing.Status == StatusAutoLinked {
					// Already accepted or auto-linked
					continue
				}
			}

			score := ScoreMatch(norm, refPrice, cand.Title, cand.Price, cand.SellerName, cand.IsMall)

			// A candidate without a price was never price-checked, so it can only be suggested.
			if score >= ThresholdAutoLink && cand.Price > 0 && s.linker != nil {
				// High confidence: Auto-link directly
				err := s.linker.LinkSource(ctx, userID, productID, cand.URL)
				if err == nil {
					result.AutoLinkedSources = append(result.AutoLinkedSources, cand.URL)
					existingURLs[cand.URL] = true
					if s.comparison != nil {
						_ = s.comparison.Invalidate(ctx, productID)
					}
					// Persist as auto_linked in suggestions table for audit
					_ = s.repo.SaveSuggestion(ctx, &MatchSuggestion{
						ID:                uuid.New(),
						ProductID:         productID,
						CandidatePlatform: cand.Platform,
						CandidateURL:      cand.URL,
						CandidateTitle:    cand.Title,
						CandidateSeller:   cand.SellerName,
						CandidatePrice:    cand.Price,
						MatchScore:        score,
						Status:            StatusAutoLinked,
					})
					continue
				}

				if errors.Is(err, tracking.ErrSourceAlreadyLinked) {
					existingURLs[cand.URL] = true
					continue
				}
			}

			if score >= ThresholdSuggestion {
				// Medium confidence: Save suggestion for user confirmation
				suggID := uuid.New()
				if existing != nil && existing.Status == StatusPending {
					suggID = existing.ID
				}

				sugg := &MatchSuggestion{
					ID:                suggID,
					ProductID:         productID,
					CandidatePlatform: cand.Platform,
					CandidateURL:      cand.URL,
					CandidateTitle:    cand.Title,
					CandidateSeller:   cand.SellerName,
					CandidatePrice:    cand.Price,
					MatchScore:        score,
					Status:            StatusPending,
				}
				if err := s.repo.SaveSuggestion(ctx, sugg); err == nil {
					if existing == nil {
						result.NewSuggestions = append(result.NewSuggestions, sugg)
					}
				}
			}
		}
	}

	return result, nil
}

// GetPendingSuggestions returns all pending match suggestions for a product.
func (s *MatchingService) GetPendingSuggestions(ctx context.Context, productID uuid.UUID) ([]*MatchSuggestion, error) {
	return s.repo.GetSuggestionsByProductID(ctx, productID)
}

// ErrSuggestionNotFound is returned when the suggestion does not exist or belongs to another product.
var ErrSuggestionNotFound = errors.New("suggestion not found")

func (s *MatchingService) suggestionForProduct(ctx context.Context, productID, suggestionID uuid.UUID) (*MatchSuggestion, error) {
	sugg, err := s.repo.GetSuggestionByID(ctx, suggestionID)
	if err != nil {
		return nil, fmt.Errorf("get suggestion: %w", err)
	}
	if sugg == nil || sugg.ProductID != productID {
		return nil, ErrSuggestionNotFound
	}
	return sugg, nil
}

// AcceptSuggestion accepts a suggestion of productID, links the candidate source, and updates status.
// The caller must already be authorized for productID.
func (s *MatchingService) AcceptSuggestion(ctx context.Context, userID, productID, suggestionID uuid.UUID) error {
	sugg, err := s.suggestionForProduct(ctx, productID, suggestionID)
	if err != nil {
		return err
	}

	if s.linker != nil {
		if err := s.linker.LinkSource(ctx, userID, sugg.ProductID, sugg.CandidateURL); err != nil {
			if !errors.Is(err, tracking.ErrSourceAlreadyLinked) {
				return fmt.Errorf("link source on accept: %w", err)
			}
		}
	}

	if err := s.repo.UpdateSuggestionStatus(ctx, suggestionID, StatusAccepted); err != nil {
		return fmt.Errorf("update status to accepted: %w", err)
	}

	if s.comparison != nil {
		_ = s.comparison.Invalidate(ctx, sugg.ProductID)
	}

	return nil
}

// DismissSuggestion rejects a match suggestion of productID so it will not bother the user.
// The caller must already be authorized for productID.
func (s *MatchingService) DismissSuggestion(ctx context.Context, productID, suggestionID uuid.UUID) error {
	if _, err := s.suggestionForProduct(ctx, productID, suggestionID); err != nil {
		return err
	}
	return s.repo.UpdateSuggestionStatus(ctx, suggestionID, StatusDismissed)
}
