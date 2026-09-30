package notification

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
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
			id, user_id, alert_rule_id, channel, recipient, status,
			price_before, price_after, sent_at, read_at, error_message, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, created_at;
	`

	return r.pool.QueryRow(ctx, query,
		log.ID,
		log.UserID,
		log.AlertRuleID,
		log.Channel,
		log.Recipient,
		log.Status,
		log.PriceBefore,
		log.PriceAfter,
		log.SentAt,
		log.ReadAt,
		log.ErrorMessage,
		log.CreatedAt,
	).Scan(&log.ID, &log.CreatedAt)
}

func (r *PostgresRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status Status, errorMessage *string) error {
	query := `
		UPDATE notification_logs
		SET status = $1,
		    error_message = $2,
		    sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
		WHERE id = $3;
	`
	_, err := r.pool.Exec(ctx, query, status, errorMessage, id)
	if err != nil {
		return fmt.Errorf("update notification status: %w", err)
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
		SELECT n.id, n.user_id, n.alert_rule_id, n.channel, n.recipient, n.status,
		       n.price_before, n.price_after, n.sent_at, n.read_at, n.error_message, n.created_at,
		       COALESCE(ps.raw_title, p.title, '') AS product_title,
		       COALESCE(ps.platform, '') AS platform,
		       COALESCE(ps.canonical_url, '') AS product_url
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
		if err := rows.Scan(
			&n.ID,
			&n.UserID,
			&n.AlertRuleID,
			&n.Channel,
			&n.Recipient,
			&n.Status,
			&n.PriceBefore,
			&n.PriceAfter,
			&n.SentAt,
			&n.ReadAt,
			&n.ErrorMessage,
			&n.CreatedAt,
			&n.ProductTitle,
			&n.Platform,
			&n.ProductURL,
		); err != nil {
			return nil, fmt.Errorf("scan user notification: %w", err)
		}
		notifs = append(notifs, &n)
	}

	return notifs, rows.Err()
}

func (r *PostgresRepository) ListRuleLogs(ctx context.Context, alertRuleID uuid.UUID) ([]*NotificationLog, error) {
	query := `
		SELECT id, user_id, alert_rule_id, channel, recipient, status,
		       price_before, price_after, sent_at, read_at, error_message, created_at
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
			&n.PriceBefore,
			&n.PriceAfter,
			&n.SentAt,
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
		SELECT id, user_id, alert_rule_id, channel, recipient, status,
		       price_before, price_after, sent_at, read_at, error_message, created_at
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
		&n.PriceBefore,
		&n.PriceAfter,
		&n.SentAt,
		&n.ReadAt,
		&n.ErrorMessage,
		&n.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
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
