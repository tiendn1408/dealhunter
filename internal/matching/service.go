package matching

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// SourceLinker defines an interface to link a discovered product source to a canonical product.
type SourceLinker interface {
	LinkSource(ctx context.Context, userID, productID uuid.UUID, url string) error
}

// CacheInvalidator defines an interface to bust comparison caches.
type CacheInvalidator interface {
	Invalidate(ctx context.Context, productID uuid.UUID) error
}

// MatchingService coordinates query normalization, cross-platform searching, scoring, auto-linking, and suggestions.
type MatchingService struct {
	repo        MatchingRepository
	searcher    CandidateSearcher
	linker      SourceLinker
	invalidator CacheInvalidator
}

func NewMatchingService(repo MatchingRepository, searcher CandidateSearcher, linker SourceLinker, inv CacheInvalidator) *MatchingService {
	return &MatchingService{
		repo:        repo,
		searcher:    searcher,
		linker:      linker,
		invalidator: inv,
	}
}

// DiscoverAndMatch performs cross-marketplace matching for a reference product.
func (s *MatchingService) DiscoverAndMatch(ctx context.Context, userID, productID uuid.UUID, refPlatform, refTitle string, refPrice int64) (*AutoMatchResult, error) {
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
		ProductID:          productID,
		ReferenceTitle:     refTitle,
		AutoLinkedSources:  []string{},
		NewSuggestions:     []*MatchSuggestion{},
		TotalDiscovered:    0,
	}

	for _, targetPlatform := range targetPlatforms {
		candidates, err := s.searcher.Search(ctx, targetPlatform, norm.SearchQuery)
		if err != nil {
			continue
		}

		result.TotalDiscovered += len(candidates)

		for _, cand := range candidates {
			score := ScoreMatch(norm, refPrice, cand.Title, cand.Price, cand.SellerName, cand.IsMall)

			if score >= ThresholdAutoLink && s.linker != nil {
				// High confidence: Auto-link directly
				err := s.linker.LinkSource(ctx, userID, productID, cand.URL)
				if err == nil {
					result.AutoLinkedSources = append(result.AutoLinkedSources, cand.URL)
					if s.invalidator != nil {
						_ = s.invalidator.Invalidate(ctx, productID)
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
			}

			if score >= ThresholdSuggestion {
				// Medium confidence: Save suggestion for user confirmation
				sugg := &MatchSuggestion{
					ID:                uuid.New(),
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
					result.NewSuggestions = append(result.NewSuggestions, sugg)
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

// AcceptSuggestion accepts a suggestion, links the candidate source, and updates status.
func (s *MatchingService) AcceptSuggestion(ctx context.Context, userID, suggestionID uuid.UUID) error {
	sugg, err := s.repo.GetSuggestionByID(ctx, suggestionID)
	if err != nil {
		return fmt.Errorf("get suggestion: %w", err)
	}
	if sugg == nil {
		return fmt.Errorf("suggestion not found: %s", suggestionID)
	}

	if s.linker != nil {
		if err := s.linker.LinkSource(ctx, userID, sugg.ProductID, sugg.CandidateURL); err != nil {
			return fmt.Errorf("link source on accept: %w", err)
		}
	}

	if err := s.repo.UpdateSuggestionStatus(ctx, suggestionID, StatusAccepted); err != nil {
		return fmt.Errorf("update status to accepted: %w", err)
	}

	if s.invalidator != nil {
		_ = s.invalidator.Invalidate(ctx, sugg.ProductID)
	}

	return nil
}

// DismissSuggestion rejects a match suggestion so it will not bother the user.
func (s *MatchingService) DismissSuggestion(ctx context.Context, suggestionID uuid.UUID) error {
	return s.repo.UpdateSuggestionStatus(ctx, suggestionID, StatusDismissed)
}
