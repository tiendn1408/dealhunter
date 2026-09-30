package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/tiendang/deal-hunter/internal/notification/zalo"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/pkg/metrics"
)

type NotifierService struct {
	repo       Repository
	queue      queue.Queue
	zaloClient zalo.ZaloClient
	templateID string
	logger     *slog.Logger
}

func NewNotifierService(
	repo Repository,
	q queue.Queue,
	zaloClient zalo.ZaloClient,
	templateID string,
	logger *slog.Logger,
) *NotifierService {
	return &NotifierService{
		repo:       repo,
		queue:      q,
		zaloClient: zaloClient,
		templateID: templateID,
		logger:     logger,
	}
}

func (s *NotifierService) ProcessMessage(ctx context.Context, msg queue.Message) error {
	var payload QueuePayload
	if err := json.Unmarshal([]byte(msg.JobID), &payload); err != nil {
		s.logger.Error("Failed to unmarshal notification payload", "err", err, "raw", msg.JobID)
		_ = s.queue.Ack(ctx, msg.MsgID)
		return nil
	}

	params := map[string]string{
		"price_before": fmt.Sprintf("%d", payload.PriceBefore),
		"price_after":  fmt.Sprintf("%d", payload.PriceAfter),
	}

	err := s.zaloClient.SendMessage(ctx, payload.Recipient, s.templateID, params)
	if err != nil {
		metrics.NotifierFailedTotal.Inc()
		errMsg := err.Error()
		_ = s.repo.UpdateStatus(ctx, payload.NotificationLogID, StatusFailed, &errMsg)
		s.logger.Error("Failed to send Zalo notification", "recipient", payload.Recipient, "err", err)
	} else {
		metrics.NotifierSentTotal.Inc()
		_ = s.repo.UpdateStatus(ctx, payload.NotificationLogID, StatusSent, nil)
		s.logger.Info("Notification sent successfully", "recipient", payload.Recipient, "log_id", payload.NotificationLogID)
	}

	_ = s.queue.Ack(ctx, msg.MsgID)
	return nil
}

func (s *NotifierService) Run(ctx context.Context, consumerName string) error {
	ch, err := s.queue.Consume(ctx, consumerName)
	if err != nil {
		return fmt.Errorf("start consume: %w", err)
	}

	s.logger.Info("Notifier consumer started", "consumer", consumerName)
	for msg := range ch {
		_ = s.ProcessMessage(ctx, msg)
	}
	s.logger.Info("Notifier consumer stopped")
	return nil
}
