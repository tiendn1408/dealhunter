package matching

import (
	"context"

	"github.com/google/uuid"
)

// MatchingRepository provides persistence operations for product match suggestions.
type MatchingRepository interface {
	SaveSuggestion(ctx context.Context, s *MatchSuggestion) error
	GetSuggestionsByProductID(ctx context.Context, productID uuid.UUID) ([]*MatchSuggestion, error)
	GetSuggestionByID(ctx context.Context, id uuid.UUID) (*MatchSuggestion, error)
	UpdateSuggestionStatus(ctx context.Context, id uuid.UUID, status string) error
}
