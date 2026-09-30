package matching

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusPending    = "pending"
	StatusAccepted   = "accepted"
	StatusDismissed  = "dismissed"
	StatusAutoLinked = "auto_linked"

	// Confidence thresholds
	ThresholdAutoLink   = 0.85 // Auto-link directly without user confirmation
	ThresholdSuggestion = 0.60 // Show as suggestion in comparison UI
)

// MatchCandidate represents a raw product candidate discovered on another marketplace.
type MatchCandidate struct {
	Platform    string `json:"platform"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	SellerName  string `json:"seller_name"`
	Price       int64  `json:"price"`
	IsMall      bool   `json:"is_mall"`
	MatchScore  float64 `json:"match_score"`
}

// MatchSuggestion represents a stored suggestion in the database for user review.
type MatchSuggestion struct {
	ID                uuid.UUID `json:"id"`
	ProductID         uuid.UUID `json:"product_id"`
	CandidatePlatform string    `json:"candidate_platform"`
	CandidateURL      string    `json:"candidate_url"`
	CandidateTitle    string    `json:"candidate_title"`
	CandidateSeller   string    `json:"candidate_seller"`
	CandidatePrice    int64     `json:"candidate_price"`
	MatchScore        float64   `json:"match_score"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// AutoMatchResult summarizes the outcome of an auto-matching process for a product.
type AutoMatchResult struct {
	ProductID          uuid.UUID          `json:"product_id"`
	ReferenceTitle     string             `json:"reference_title"`
	AutoLinkedSources  []string           `json:"auto_linked_sources"`
	NewSuggestions     []*MatchSuggestion `json:"new_suggestions"`
	TotalDiscovered    int                `json:"total_discovered"`
}
