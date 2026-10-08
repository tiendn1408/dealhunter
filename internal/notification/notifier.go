package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/notification/zalo"
	"github.com/tiendang/deal-hunter/internal/queue"
	"github.com/tiendang/deal-hunter/internal/voucher"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
	"github.com/tiendang/deal-hunter/pkg/metrics"
)

type NotifierService struct {
	repo        Repository
	queue       queue.Queue
	zaloClient  zalo.ZaloClient
	templateID  string
	logger      *slog.Logger
	affiliate   affiliate.LinkTransformer
	voucherRepo voucher.Repository
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

func (s *NotifierService) SetAffiliateTransformer(transformer affiliate.LinkTransformer) {
	s.affiliate = transformer
}

func (s *NotifierService) SetVoucherRepository(repo voucher.Repository) {
	s.voucherRepo = repo
}

func (s *NotifierService) ProcessMessage(ctx context.Context, msg queue.Message) error {
	var payload QueuePayload
	if err := json.Unmarshal([]byte(msg.JobID), &payload); err != nil {
		s.logger.Error("Failed to unmarshal notification payload", "err", err, "msg_id", msg.MsgID)
		_ = s.queue.Ack(ctx, msg.MsgID)
		return nil
	}

	params := map[string]string{
		"price_before": fmt.Sprintf("%d", payload.PriceBefore),
		"price_after":  fmt.Sprintf("%d", payload.PriceAfter),
	}

	dealURL := payload.ProductURL
	subID := affiliate.FormatSubID(payload.UserID, payload.ProductSourceID)
	if s.affiliate != nil && payload.ProductURL != "" {
		dealURL = s.affiliate.Transform(payload.ProductURL, payload.Platform, subID)
	}
	if dealURL != "" {
		params["deal_url"] = dealURL
		params["affiliate_url"] = dealURL
		params["product_url"] = dealURL
	}

	// 2-Step Voucher Combo Intelligence (Phase 3.5.2)
	if s.voucherRepo != nil && payload.ProductSourceID != uuid.Nil {
		vouchers, err := s.voucherRepo.GetVouchersBySourceID(ctx, payload.ProductSourceID)
		if err == nil && len(vouchers) > 0 {
			calc := voucher.CalculateEffectivePrice(payload.PriceAfter, 0, vouchers)
			if calc.TotalSavings > 0 {
				params["effective_price"] = fmt.Sprintf("%d", calc.EffectivePrice)
				params["total_savings"] = fmt.Sprintf("%d", calc.TotalSavings)
			}
			bestVoucher := calc.BestShopVoucher
			if bestVoucher == nil {
				bestVoucher = calc.BestPlatformVoucher
			}
			if bestVoucher != nil {
				params["voucher_title"] = bestVoucher.Title
				if bestVoucher.VoucherCode != "" {
					params["voucher_code"] = bestVoucher.VoucherCode
				}
				if bestVoucher.CollectURL != "" {
					collectURL := bestVoucher.CollectURL
					if s.affiliate != nil {
						collectURL = s.affiliate.Transform(collectURL, payload.Platform, subID)
					}
					params["voucher_collect_url"] = collectURL
				}
			}
		}
	}

	msgID, err := s.zaloClient.SendMessage(ctx, payload.Recipient, s.templateID, params)
	if err != nil {
		metrics.NotifierFailedTotal.Inc()
		errMsg := err.Error()
		_ = s.repo.UpdateStatus(ctx, payload.NotificationLogID, StatusFailed, &errMsg)
		s.logger.Error("Failed to send Zalo notification", "recipient", MaskRecipient(payload.Recipient), "err", err)
	} else {
		metrics.NotifierSentTotal.Inc()
		if msgID != "" {
			if err := s.repo.UpdateStatusAndMsgID(ctx, payload.NotificationLogID, StatusSent, msgID, nil); err != nil {
				s.logger.Error("Failed to update status and msg_id in db", "err", err, "id", payload.NotificationLogID)
			}
		} else {
			if err := s.repo.UpdateStatus(ctx, payload.NotificationLogID, StatusSent, nil); err != nil {
				s.logger.Error("Failed to update status in db", "err", err, "id", payload.NotificationLogID)
			}
		}
		s.logger.Info("Notification sent successfully", "recipient", MaskRecipient(payload.Recipient), "log_id", payload.NotificationLogID, "msg_id", msgID)
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
