package notification

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// NotifDedupWindow specifies the sliding window during which identical notifications are suppressed.
const NotifDedupWindow = 6 * time.Hour

type DedupService struct {
	repo   Repository
	window time.Duration
}

func NewDedupService(repo Repository, window time.Duration) *DedupService {
	if window <= 0 {
		window = NotifDedupWindow
	}
	return &DedupService{
		repo:   repo,
		window: window,
	}
}

// ShouldSuppress returns true if a notification has already been sent or queued for this user and alert rule in the window.
func (s *DedupService) ShouldSuppress(ctx context.Context, userID, alertRuleID uuid.UUID) (bool, error) {
	return s.repo.CheckDedup(ctx, userID, alertRuleID, s.window)
}
