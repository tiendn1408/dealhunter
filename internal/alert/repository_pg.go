package alert

import (
	"context"
	"errors"
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

func (r *PostgresRepository) CreateRule(ctx context.Context, rule *AlertRule) error {
	if rule.ID == uuid.Nil {
		rule.ID = uuid.New()
	}
	now := time.Now()
	if rule.CreatedAt.IsZero() {
		rule.CreatedAt = now
	}
	if rule.UpdatedAt.IsZero() {
		rule.UpdatedAt = now
	}

	query := `
		INSERT INTO alert_rules (
			id, user_id, product_source_id, rule_type, threshold_value,
			active, expires_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at;
	`

	return r.pool.QueryRow(ctx, query,
		rule.ID,
		rule.UserID,
		rule.ProductSourceID,
		rule.RuleType,
		rule.ThresholdValue,
		rule.Active,
		rule.ExpiresAt,
		rule.CreatedAt,
		rule.UpdatedAt,
	).Scan(&rule.ID, &rule.CreatedAt, &rule.UpdatedAt)
}

func (r *PostgresRepository) GetRule(ctx context.Context, id uuid.UUID) (*AlertRule, error) {
	query := `
		SELECT id, user_id, product_source_id, rule_type, threshold_value,
		       active, expires_at, created_at, updated_at
		FROM alert_rules
		WHERE id = $1;
	`

	var rule AlertRule
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&rule.ID,
		&rule.UserID,
		&rule.ProductSourceID,
		&rule.RuleType,
		&rule.ThresholdValue,
		&rule.Active,
		&rule.ExpiresAt,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get alert rule: %w", err)
	}

	return &rule, nil
}

func (r *PostgresRepository) ListActiveRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*AlertRule, error) {
	query := `
		SELECT id, user_id, product_source_id, rule_type, threshold_value,
		       active, expires_at, created_at, updated_at
		FROM alert_rules
		WHERE product_source_id = $1
		  AND active = TRUE
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY created_at ASC;
	`

	rows, err := r.pool.Query(ctx, query, productSourceID)
	if err != nil {
		return nil, fmt.Errorf("list active rules by source: %w", err)
	}
	defer rows.Close()

	var rules []*AlertRule
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(
			&rule.ID,
			&rule.UserID,
			&rule.ProductSourceID,
			&rule.RuleType,
			&rule.ThresholdValue,
			&rule.Active,
			&rule.ExpiresAt,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan alert rule: %w", err)
		}
		rules = append(rules, &rule)
	}

	return rules, rows.Err()
}

func (r *PostgresRepository) ListRulesByUser(ctx context.Context, userID uuid.UUID) ([]*AlertRule, error) {
	query := `
		SELECT id, user_id, product_source_id, rule_type, threshold_value,
		       active, expires_at, created_at, updated_at
		FROM alert_rules
		WHERE user_id = $1
		ORDER BY created_at DESC;
	`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("list rules by user: %w", err)
	}
	defer rows.Close()

	var rules []*AlertRule
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(
			&rule.ID,
			&rule.UserID,
			&rule.ProductSourceID,
			&rule.RuleType,
			&rule.ThresholdValue,
			&rule.Active,
			&rule.ExpiresAt,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan alert rule: %w", err)
		}
		rules = append(rules, &rule)
	}

	return rules, rows.Err()
}

func (r *PostgresRepository) ListRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*AlertRule, error) {
	query := `
		SELECT id, user_id, product_source_id, rule_type, threshold_value,
		       active, expires_at, created_at, updated_at
		FROM alert_rules
		WHERE product_source_id = $1
		ORDER BY created_at DESC;
	`

	rows, err := r.pool.Query(ctx, query, productSourceID)
	if err != nil {
		return nil, fmt.Errorf("list rules by source: %w", err)
	}
	defer rows.Close()

	var rules []*AlertRule
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(
			&rule.ID,
			&rule.UserID,
			&rule.ProductSourceID,
			&rule.RuleType,
			&rule.ThresholdValue,
			&rule.Active,
			&rule.ExpiresAt,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan alert rule: %w", err)
		}
		rules = append(rules, &rule)
	}

	return rules, rows.Err()
}

func (r *PostgresRepository) ListRulesBySourceAndUser(ctx context.Context, productSourceID, userID uuid.UUID) ([]*AlertRule, error) {
	query := `
		SELECT id, user_id, product_source_id, rule_type, threshold_value,
		       active, expires_at, created_at, updated_at
		FROM alert_rules
		WHERE product_source_id = $1 AND user_id = $2
		ORDER BY created_at DESC;
	`

	rows, err := r.pool.Query(ctx, query, productSourceID, userID)
	if err != nil {
		return nil, fmt.Errorf("list rules by source and user: %w", err)
	}
	defer rows.Close()

	var rules []*AlertRule
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(
			&rule.ID,
			&rule.UserID,
			&rule.ProductSourceID,
			&rule.RuleType,
			&rule.ThresholdValue,
			&rule.Active,
			&rule.ExpiresAt,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan alert rule: %w", err)
		}
		rules = append(rules, &rule)
	}

	return rules, rows.Err()
}

func (r *PostgresRepository) DeactivateRule(ctx context.Context, id uuid.UUID) error {
	query := `
		UPDATE alert_rules
		SET active = FALSE, updated_at = NOW()
		WHERE id = $1;
	`
	_, err := r.pool.Exec(ctx, query, id)
	return err
}

// ErrRuleNotFound: no alert rule with that ID belongs to the user.
var ErrRuleNotFound = errors.New("alert rule not found")

func (r *PostgresRepository) DeactivateRuleForUser(ctx context.Context, id, userID uuid.UUID) error {
	query := `
		UPDATE alert_rules
		SET active = FALSE, updated_at = NOW()
		WHERE id = $1 AND user_id = $2;
	`
	res, err := r.pool.Exec(ctx, query, id, userID)
	if err != nil {
		return fmt.Errorf("deactivate rule for user: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrRuleNotFound
	}
	return nil
}
