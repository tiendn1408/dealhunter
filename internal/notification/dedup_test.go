package notification

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

type mockNotifRepo struct {
	logs []*NotificationLog
}

func (m *mockNotifRepo) InsertLog(ctx context.Context, log *NotificationLog) error {
	m.logs = append(m.logs, log)
	return nil
}

func (m *mockNotifRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status Status, errorMessage *string) error {
	for _, l := range m.logs {
		if l.ID == id {
			l.Status = status
			l.ErrorMessage = errorMessage
			return nil
		}
	}
	return nil
}

func (m *mockNotifRepo) UpdateStatusAndMsgID(ctx context.Context, id uuid.UUID, status Status, msgID string, errorMessage *string) error {
	for _, l := range m.logs {
		if l.ID == id {
			l.Status = status
			l.MsgID = &msgID
			l.ErrorMessage = errorMessage
			return nil
		}
	}
	return nil
}

func (m *mockNotifRepo) GetLogByMsgID(ctx context.Context, msgID string) (*NotificationLog, error) {
	for _, l := range m.logs {
		if l.MsgID != nil && *l.MsgID == msgID {
			return l, nil
		}
	}
	return nil, nil
}

func (m *mockNotifRepo) UpdateDeliveryStatus(ctx context.Context, msgID string, status Status, timestamp *time.Time) error {
	for _, l := range m.logs {
		if l.MsgID != nil && *l.MsgID == msgID {
			l.Status = status
			if status == StatusDelivered && timestamp != nil {
				l.DeliveredAt = timestamp
			}
			if status == StatusRead && timestamp != nil {
				l.ReadAt = timestamp
			}
			return nil
		}
	}
	return nil
}

func (m *mockNotifRepo) CheckDedup(ctx context.Context, userID, alertRuleID uuid.UUID, within time.Duration) (bool, error) {
	threshold := time.Now().Add(-within)
	for _, l := range m.logs {
		if l.UserID == userID && l.AlertRuleID == alertRuleID && (l.Status == StatusQueued || l.Status == StatusSent) {
			if l.CreatedAt.After(threshold) {
				return true, nil
			}
		}
	}
	return false, nil
}

func (m *mockNotifRepo) ListUserNotifications(ctx context.Context, userID uuid.UUID, limit int) ([]*EnrichedNotification, error) {
	var res []*EnrichedNotification
	for _, l := range m.logs {
		if l.UserID == userID {
			res = append(res, &EnrichedNotification{NotificationLog: *l})
		}
	}
	return res, nil
}

func (m *mockNotifRepo) ListRuleLogs(ctx context.Context, alertRuleID uuid.UUID) ([]*NotificationLog, error) {
	var res []*NotificationLog
	for _, l := range m.logs {
		if l.AlertRuleID == alertRuleID {
			res = append(res, l)
		}
	}
	return res, nil
}

func (m *mockNotifRepo) MarkAsRead(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	for _, l := range m.logs {
		if l.ID == id && l.UserID == userID {
			now := time.Now()
			l.ReadAt = &now
			return nil
		}
	}
	return nil
}

func (m *mockNotifRepo) GetLog(ctx context.Context, id uuid.UUID) (*NotificationLog, error) {
	for _, l := range m.logs {
		if l.ID == id {
			return l, nil
		}
	}
	return nil, nil
}

func (m *mockNotifRepo) GetUserRecipient(ctx context.Context, userID uuid.UUID, channel string) (string, error) {
	return "0987654321", nil
}

func (m *mockNotifRepo) GetUserProfile(ctx context.Context, userID uuid.UUID) (*UserProfile, error) {
	return &UserProfile{UserID: userID}, nil
}

func (m *mockNotifRepo) LinkVerifiedPhone(ctx context.Context, userID uuid.UUID, phone string) error {
	return nil
}

func (m *mockNotifRepo) DisconnectUserZalo(ctx context.Context, userID uuid.UUID) error {
	return nil
}

func TestDedupService_ShouldSuppress(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	ruleID := uuid.New()

	repo := &mockNotifRepo{
		logs: []*NotificationLog{
			{
				ID:          uuid.New(),
				UserID:      userID,
				AlertRuleID: ruleID,
				Status:      StatusSent,
				CreatedAt:   time.Now().Add(-1 * time.Hour), // 1 hour ago
			},
		},
	}

	dedup := NewDedupService(repo, 6*time.Hour)

	// Should be suppressed within 6-hour window
	suppressed, err := dedup.ShouldSuppress(ctx, userID, ruleID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !suppressed {
		t.Errorf("expected suppressed = true for log sent 1 hour ago with 6h window")
	}

	// Another rule that was never notified
	otherRuleID := uuid.New()
	suppressedOther, err := dedup.ShouldSuppress(ctx, userID, otherRuleID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if suppressedOther {
		t.Errorf("expected suppressed = false for new rule")
	}
}
