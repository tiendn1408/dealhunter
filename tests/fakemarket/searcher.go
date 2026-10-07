package fakemarket

import (
	"context"

	"github.com/tiendang/deal-hunter/internal/matching"
)

// Searcher is a test-only matching.CandidateSearcher returning preset candidates per platform.
type Searcher struct {
	Candidates map[string][]matching.MatchCandidate
}

func (s *Searcher) Search(ctx context.Context, targetPlatform, query string) ([]*matching.MatchCandidate, error) {
	var out []*matching.MatchCandidate
	for _, c := range s.Candidates[targetPlatform] {
		c := c
		out = append(out, &c)
	}
	return out, nil
}
