package zalo

import (
	"context"
	"fmt"
)

// DisabledClient is used when Zalo OA is not configured: every send fails with ErrZaloNotConfigured,
// so notifications are recorded as failed instead of pretending they were delivered.
type DisabledClient struct{}

func NewDisabledClient() *DisabledClient {
	return &DisabledClient{}
}

func (DisabledClient) SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) (string, error) {
	return "", fmt.Errorf("%w: %w", ErrZaloNotConfigured, ErrNotSent)
}
