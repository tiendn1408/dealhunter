package notification

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
)

type PostgresRepository struct {
	pool      *pgxpool.Pool
	affiliate affiliate.LinkTransformer
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) SetAffiliateTransformer(transformer affiliate.LinkTransformer) {
	r.affiliate = transformer
}

func (r *PostgresRepository) InsertLog(ctx context.Context, log *NotificationLog) error {
	if log.ID == uuid.Nil {
		log.ID = uuid.New()
	}
	now := time.Now()
	if log.CreatedAt.IsZero() {
		log.CreatedAt = now
	}
	if log.Channel == "" {
		log.Channel = "zalo"
	}
	if log.Status == "" {
		log.Status = StatusQueued
	}

	query := `
		INSERT INTO notification_logs (
			id, user_id, alert_rule_id, channel, recipient, status, msg_id,
			price_before, price_after, sent_at, delivered_at, read_at, error_message, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id, created_at;
	`

	return r.pool.QueryRow(ctx, query,
		log.ID,
		log.UserID,
		log.AlertRuleID,
		log.Channel,
		log.Recipient,
		log.Status,
		log.MsgID,
		log.PriceBefore,
		log.PriceAfter,
		log.SentAt,
		log.DeliveredAt,
		log.ReadAt,
		log.ErrorMessage,
		log.CreatedAt,
	).Scan(&log.ID, &log.CreatedAt)
}

func (r *PostgresRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status Status, errorMessage *string) error {
	query := `
		UPDATE notification_logs
		SET status = $1::text,
		    error_message = $2,
		    sent_at = CASE WHEN $1::text = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END
		WHERE id = $3;
	`
	_, err := r.pool.Exec(ctx, query, status, errorMessage, id)
	if err != nil {
		return fmt.Errorf("update notification status: %w", err)
	}
	return nil
}

func (r *PostgresRepository) UpdateStatusAndMsgID(ctx context.Context, id uuid.UUID, status Status, msgID string, errorMessage *string) error {
	query := `
		UPDATE notification_logs
		SET status = $1::text,
		    msg_id = $2,
		    error_message = $3,
		    sent_at = CASE WHEN $1::text = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END
		WHERE id = $4;
	`
	_, err := r.pool.Exec(ctx, query, status, msgID, errorMessage, id)
	if err != nil {
		return fmt.Errorf("update status and msg_id: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetLogByMsgID(ctx context.Context, msgID string) (*NotificationLog, error) {
	query := `
		SELECT id, user_id, alert_rule_id, channel, recipient, status, msg_id,
		       price_before, price_after, sent_at, delivered_at, read_at, error_message, created_at
		FROM notification_logs
		WHERE msg_id = $1;
	`
	var n NotificationLog
	err := r.pool.QueryRow(ctx, query, msgID).Scan(
		&n.ID,
		&n.UserID,
		&n.AlertRuleID,
		&n.Channel,
		&n.Recipient,
		&n.Status,
		&n.MsgID,
		&n.PriceBefore,
		&n.PriceAfter,
		&n.SentAt,
		&n.DeliveredAt,
		&n.ReadAt,
		&n.ErrorMessage,
		&n.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get log by msg_id: %w", err)
	}
	return &n, nil
}

func (r *PostgresRepository) UpdateDeliveryStatus(ctx context.Context, msgID string, status Status, timestamp *time.Time) error {
	ts := time.Now()
	if timestamp != nil && !timestamp.IsZero() {
		ts = *timestamp
	}

	switch status {
	case StatusDelivered:
		query := `
			UPDATE notification_logs
			SET status = $1::varchar,
			    delivered_at = COALESCE(delivered_at, $2)
			WHERE msg_id = $3 AND status IN ('sent', 'queued');
		`
		if _, err := r.pool.Exec(ctx, query, status, ts, msgID); err != nil {
			return fmt.Errorf("update delivery status: %w", err)
		}
	case StatusRead:
		query := `
			UPDATE notification_logs
			SET status = $1::varchar,
			    delivered_at = COALESCE(delivered_at, $2),
			    read_at = COALESCE(read_at, $2)
			WHERE msg_id = $3;
		`
		if _, err := r.pool.Exec(ctx, query, status, ts, msgID); err != nil {
			return fmt.Errorf("update delivery status: %w", err)
		}
	default:
		query := `
			UPDATE notification_logs
			SET status = $1::varchar
			WHERE msg_id = $2 AND status IN ('sent', 'queued');
		`
		if _, err := r.pool.Exec(ctx, query, status, msgID); err != nil {
			return fmt.Errorf("update delivery status: %w", err)
		}
	}
	return nil
}

func (r *PostgresRepository) CheckDedup(ctx context.Context, userID, alertRuleID uuid.UUID, within time.Duration) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1 FROM notification_logs
			WHERE user_id = $1
			  AND alert_rule_id = $2
			  AND created_at > NOW() - ($3 || ' seconds')::interval
			  AND status IN ('queued', 'sent')
		);
	`
	var exists bool
	seconds := int64(within.Seconds())
	err := r.pool.QueryRow(ctx, query, userID, alertRuleID, fmt.Sprintf("%d", seconds)).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check dedup: %w", err)
	}
	return exists, nil
}

func (r *PostgresRepository) ListUserNotifications(ctx context.Context, userID uuid.UUID, limit int) ([]*EnrichedNotification, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	query := `
		SELECT n.id, n.user_id, n.alert_rule_id, n.channel, n.recipient, n.status, n.msg_id,
		       n.price_before, n.price_after, n.sent_at, n.delivered_at, n.read_at, n.error_message, n.created_at,
		       COALESCE(ps.raw_title, p.title, '') AS product_title,
		       COALESCE(ps.platform, '') AS platform,
		       COALESCE(ps.canonical_url, '') AS product_url,
		       ps.product_id
		FROM notification_logs n
		JOIN alert_rules ar ON n.alert_rule_id = ar.id
		JOIN product_sources ps ON ar.product_source_id = ps.id
		LEFT JOIN products p ON ps.product_id = p.id
		WHERE n.user_id = $1
		ORDER BY n.created_at DESC
		LIMIT $2;
	`

	rows, err := r.pool.Query(ctx, query, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list user notifications: %w", err)
	}
	defer rows.Close()

	var notifs []*EnrichedNotification
	for rows.Next() {
		var n EnrichedNotification
		var productID uuid.UUID
		if err := rows.Scan(
			&n.ID,
			&n.UserID,
			&n.AlertRuleID,
			&n.Channel,
			&n.Recipient,
			&n.Status,
			&n.MsgID,
			&n.PriceBefore,
			&n.PriceAfter,
			&n.SentAt,
			&n.DeliveredAt,
			&n.ReadAt,
			&n.ErrorMessage,
			&n.CreatedAt,
			&n.ProductTitle,
			&n.Platform,
			&n.ProductURL,
			&productID,
		); err != nil {
			return nil, fmt.Errorf("scan user notification: %w", err)
		}
		if r.affiliate != nil && n.ProductURL != "" {
			subID := affiliate.FormatSubID(userID, productID)
			n.AffiliateURL = r.affiliate.Transform(n.ProductURL, n.Platform, subID)
		}
		notifs = append(notifs, &n)
	}

	return notifs, rows.Err()
}

func (r *PostgresRepository) ListRuleLogs(ctx context.Context, alertRuleID uuid.UUID) ([]*NotificationLog, error) {
	query := `
		SELECT id, user_id, alert_rule_id, channel, recipient, status, msg_id,
		       price_before, price_after, sent_at, delivered_at, read_at, error_message, created_at
		FROM notification_logs
		WHERE alert_rule_id = $1
		ORDER BY created_at DESC;
	`

	rows, err := r.pool.Query(ctx, query, alertRuleID)
	if err != nil {
		return nil, fmt.Errorf("list rule logs: %w", err)
	}
	defer rows.Close()

	var logs []*NotificationLog
	for rows.Next() {
		var n NotificationLog
		if err := rows.Scan(
			&n.ID,
			&n.UserID,
			&n.AlertRuleID,
			&n.Channel,
			&n.Recipient,
			&n.Status,
			&n.MsgID,
			&n.PriceBefore,
			&n.PriceAfter,
			&n.SentAt,
			&n.DeliveredAt,
			&n.ReadAt,
			&n.ErrorMessage,
			&n.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan rule log: %w", err)
		}
		logs = append(logs, &n)
	}

	return logs, rows.Err()
}

func (r *PostgresRepository) MarkAsRead(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	query := `
		UPDATE notification_logs
		SET read_at = NOW()
		WHERE id = $1 AND user_id = $2;
	`
	_, err := r.pool.Exec(ctx, query, id, userID)
	return err
}

func (r *PostgresRepository) GetLog(ctx context.Context, id uuid.UUID) (*NotificationLog, error) {
	query := `
		SELECT id, user_id, alert_rule_id, channel, recipient, status, msg_id,
		       price_before, price_after, sent_at, delivered_at, read_at, error_message, created_at
		FROM notification_logs
		WHERE id = $1;
	`
	var n NotificationLog
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&n.ID,
		&n.UserID,
		&n.AlertRuleID,
		&n.Channel,
		&n.Recipient,
		&n.Status,
		&n.MsgID,
		&n.PriceBefore,
		&n.PriceAfter,
		&n.SentAt,
		&n.DeliveredAt,
		&n.ReadAt,
		&n.ErrorMessage,
		&n.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get notification log: %w", err)
	}
	return &n, nil
}

func (r *PostgresRepository) GetUserRecipient(ctx context.Context, userID uuid.UUID, channel string) (string, error) {
	query := `
		SELECT COALESCE(zalo_id, phone, '')
		FROM users
		WHERE id = $1;
	`
	var recipient string
	err := r.pool.QueryRow(ctx, query, userID).Scan(&recipient)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("get user recipient: %w", err)
	}
	return recipient, nil
}

func (r *PostgresRepository) GetUserProfile(ctx context.Context, userID uuid.UUID) (*UserProfile, error) {
	// Ensure user exists
	ensureQuery := `INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING;`
	_, _ = r.pool.Exec(ctx, ensureQuery, userID)

	query := `SELECT id, COALESCE(zalo_id, ''), COALESCE(phone, ''), created_at FROM users WHERE id = $1;`
	var p UserProfile
	var zaloID, phone string
	err := r.pool.QueryRow(ctx, query, userID).Scan(&p.UserID, &zaloID, &phone, &p.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user profile: %w", err)
	}
	p.ZaloID = zaloID
	p.Phone = phone
	p.ZaloConnected = zaloID != "" || phone != ""
	return &p, nil
}

func (r *PostgresRepository) UpdateUserZalo(ctx context.Context, userID uuid.UUID, zaloID, phone string) error {
	ensureQuery := `INSERT INTO users (id, created_at) VALUES ($1, NOW()) ON CONFLICT (id) DO NOTHING;`
	_, _ = r.pool.Exec(ctx, ensureQuery, userID)

	query := `UPDATE users SET zalo_id = NULLIF($1, ''), phone = NULLIF($2, '') WHERE id = $3;`
	_, err := r.pool.Exec(ctx, query, zaloID, phone, userID)
	return err
}

func (r *PostgresRepository) DisconnectUserZalo(ctx context.Context, userID uuid.UUID) error {
	query := `UPDATE users SET zalo_id = NULL, phone = NULL WHERE id = $1;`
	_, err := r.pool.Exec(ctx, query, userID)
	return err
}
