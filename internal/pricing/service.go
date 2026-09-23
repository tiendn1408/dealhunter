package pricing

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type PricingService struct {
	repo PricingRepository
}

func NewPricingService(repo PricingRepository) *PricingService {
	return &PricingService{repo: repo}
}

func (s *PricingService) GetHistory(ctx context.Context, productSourceID uuid.UUID, from, to time.Time) ([]*PriceSnapshot, error) {
	return s.repo.ListSnapshots(ctx, productSourceID, from, to)
}
