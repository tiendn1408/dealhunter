package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/queue"
)

type mockAlertRepo struct {
	rules []*alert.AlertRule
}

func (m *mockAlertRepo) CreateRule(ctx context.Context, rule *alert.AlertRule) error {
	m.rules = append(m.rules, rule)
	return nil
}
func (m *mockAlertRepo) GetRule(ctx context.Context, id uuid.UUID) (*alert.AlertRule, error) {
	for _, r := range m.rules {
		if r.ID == id {
			return r, nil
		}
	}
	return nil, nil
}
func (m *mockAlertRepo) ListActiveRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*alert.AlertRule, error) {
	var res []*alert.AlertRule
	for _, r := range m.rules {
		if r.ProductSourceID == productSourceID && r.Active {
			res = append(res, r)
		}
	}
	return res, nil
}
func (m *mockAlertRepo) ListRulesByUser(ctx context.Context, userID uuid.UUID) ([]*alert.AlertRule, error) {
	return nil, nil
}
func (m *mockAlertRepo) ListRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*alert.AlertRule, error) {
	return nil, nil
}
func (m *mockAlertRepo) DeactivateRule(ctx context.Context, id uuid.UUID) error {
	for _, r := range m.rules {
		if r.ID == id {
			r.Active = false
			return nil
		}
	}
	return nil
}

type mockNotifRepo struct {
	logs []*notification.NotificationLog
}

func (m *mockNotifRepo) InsertLog(ctx context.Context, log *notification.NotificationLog) error {
	m.logs = append(m.logs, log)
	return nil
}
func (m *mockNotifRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status notification.Status, errorMessage *string) error {
	for _, l := range m.logs {
		if l.ID == id {
			l.Status = status
			l.ErrorMessage = errorMessage
			return nil
		}
	}
	return nil
}
func (m *mockNotifRepo) UpdateStatusAndMsgID(ctx context.Context, id uuid.UUID, status notification.Status, msgID string, errorMessage *string) error {
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
func (m *mockNotifRepo) GetLogByMsgID(ctx context.Context, msgID string) (*notification.NotificationLog, error) {
	for _, l := range m.logs {
		if l.MsgID != nil && *l.MsgID == msgID {
			return l, nil
		}
	}
	return nil, nil
}
func (m *mockNotifRepo) UpdateDeliveryStatus(ctx context.Context, msgID string, status notification.Status, timestamp *time.Time) error {
	for _, l := range m.logs {
		if l.MsgID != nil && *l.MsgID == msgID {
			l.Status = status
			if status == notification.StatusDelivered && timestamp != nil {
				l.DeliveredAt = timestamp
			} else if status == notification.StatusRead && timestamp != nil {
				l.ReadAt = timestamp
			}
			return nil
		}
	}
	return nil
}
func (m *mockNotifRepo) CheckDedup(ctx context.Context, userID, alertRuleID uuid.UUID, within time.Duration) (bool, error) {
	return false, nil // don't suppress
}
func (m *mockNotifRepo) ListUserNotifications(ctx context.Context, userID uuid.UUID, limit int) ([]*notification.EnrichedNotification, error) {
	return nil, nil
}
func (m *mockNotifRepo) ListRuleLogs(ctx context.Context, alertRuleID uuid.UUID) ([]*notification.NotificationLog, error) {
	return nil, nil
}
func (m *mockNotifRepo) MarkAsRead(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	return nil
}
func (m *mockNotifRepo) GetLog(ctx context.Context, id uuid.UUID) (*notification.NotificationLog, error) {
	return nil, nil
}
func (m *mockNotifRepo) GetUserRecipient(ctx context.Context, userID uuid.UUID, channel string) (string, error) {
	return "0988776655", nil
}
func (m *mockNotifRepo) GetUserProfile(ctx context.Context, userID uuid.UUID) (*notification.UserProfile, error) {
	return &notification.UserProfile{UserID: userID}, nil
}
func (m *mockNotifRepo) UpdateUserZalo(ctx context.Context, userID uuid.UUID, zaloID, phone string) error {
	return nil
}
func (m *mockNotifRepo) DisconnectUserZalo(ctx context.Context, userID uuid.UUID) error {
	return nil
}

type mockQueue struct {
	enqueued []string
}

func (m *mockQueue) Enqueue(ctx context.Context, jobID string) error {
	m.enqueued = append(m.enqueued, jobID)
	return nil
}
func (m *mockQueue) Consume(ctx context.Context, consumerName string) (<-chan struct{ MsgID, JobID string }, error) {
	return nil, nil
}
func (m *mockQueue) Ack(ctx context.Context, msgID string) error {
	return nil
}
func (m *mockQueue) ReclaimPending(ctx context.Context) error {
	return nil
}

func TestWorker_EvaluateAlertsFlow(t *testing.T) {
	ctx := context.Background()
	sourceID := uuid.New()
	userID := uuid.New()
	ruleID := uuid.New()

	alertRepo := &mockAlertRepo{
		rules: []*alert.AlertRule{
			{
				ID:              ruleID,
				UserID:          userID,
				ProductSourceID: sourceID,
				RuleType:        alert.RuleTypeDropPercent,
				ThresholdValue:  10, // >= 10%
				Active:          true,
			},
		},
	}

	engine := alert.NewRuleEngine(alertRepo, nil)
	notifRepo := &mockNotifRepo{}
	dedup := notification.NewDedupService(notifRepo, 6*time.Hour)

	// Custom mock queue using duck-typing queue interface
	q := &simpleMockQueue{}

	worker := &Worker{}
	worker.SetAlertComponents(engine, notifRepo, dedup, q)

	source := &product.ProductSource{
		ID: sourceID,
	}

	// Trigger alert: 1,000,000 -> 850,000 (15% drop > 10% threshold)
	worker.evaluateAlerts(ctx, source, 1000000, 850000, time.Now())

	if len(notifRepo.logs) != 1 {
		t.Fatalf("expected 1 notification log inserted, got %d", len(notifRepo.logs))
	}
	if notifRepo.logs[0].Status != notification.StatusQueued {
		t.Errorf("expected status queued, got %s", notifRepo.logs[0].Status)
	}
	if notifRepo.logs[0].Recipient != "0988776655" {
		t.Errorf("expected recipient 0988776655, got %s", notifRepo.logs[0].Recipient)
	}

	if len(q.messages) != 1 {
		t.Fatalf("expected 1 notification enqueued in Redis stream, got %d", len(q.messages))
	}
}

type simpleMockQueue struct {
	messages []string
}

func (s *simpleMockQueue) Enqueue(ctx context.Context, jobID string) error {
	s.messages = append(s.messages, jobID)
	return nil
}
func (s *simpleMockQueue) Consume(ctx context.Context, consumerName string) (<-chan queue.Message, error) {
	return nil, nil
}
func (s *simpleMockQueue) Ack(ctx context.Context, msgID string) error {
	return nil
}
func (s *simpleMockQueue) ReclaimPending(ctx context.Context) error {
	return nil
}
