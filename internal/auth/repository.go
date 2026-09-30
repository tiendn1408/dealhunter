package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUserNotFound = errors.New("user not found")
)

type UserRepository interface {
	GetByID(ctx context.Context, id uuid.UUID) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	UpsertUser(ctx context.Context, user *User) error
	MigrateGuestData(ctx context.Context, guestID uuid.UUID, targetUserID uuid.UUID) (*MigrationResult, error)
}

type PostgresUserRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresUserRepository(pool *pgxpool.Pool) *PostgresUserRepository {
	return &PostgresUserRepository{pool: pool}
}

func (r *PostgresUserRepository) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	query := `
		SELECT id, email, name, avatar_url, auth_provider, zalo_id, phone, created_at, updated_at
		FROM users
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, id)
	return scanUser(row)
}

func (r *PostgresUserRepository) GetByEmail(ctx context.Context, email string) (*User, error) {
	query := `
		SELECT id, email, name, avatar_url, auth_provider, zalo_id, phone, created_at, updated_at
		FROM users
		WHERE email = $1
	`
	row := r.pool.QueryRow(ctx, query, email)
	return scanUser(row)
}

func (r *PostgresUserRepository) UpsertUser(ctx context.Context, user *User) error {
	now := time.Now()
	if user.CreatedAt.IsZero() {
		user.CreatedAt = now
	}
	user.UpdatedAt = now

	query := `
		INSERT INTO users (id, email, name, avatar_url, auth_provider, zalo_id, phone, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET
			email = COALESCE(EXCLUDED.email, users.email),
			name = COALESCE(EXCLUDED.name, users.name),
			avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
			auth_provider = EXCLUDED.auth_provider,
			updated_at = NOW()
	`
	_, err := r.pool.Exec(ctx, query,
		user.ID,
		user.Email,
		user.Name,
		user.AvatarURL,
		user.AuthProvider,
		user.ZaloID,
		user.Phone,
		user.CreatedAt,
		user.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert user: %w", err)
	}
	return nil
}

func (r *PostgresUserRepository) MigrateGuestData(ctx context.Context, guestID uuid.UUID, targetUserID uuid.UUID) (*MigrationResult, error) {
	if guestID == targetUserID || guestID == uuid.Nil || targetUserID == uuid.Nil {
		return &MigrationResult{}, nil
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1. Delete duplicate tracked_products where target user already tracks the same source
	deleteDupQuery := `
		DELETE FROM tracked_products
		WHERE user_id = $1
		  AND product_source_id IN (
			  SELECT product_source_id FROM tracked_products WHERE user_id = $2
		  )
	`
	if _, err := tx.Exec(ctx, deleteDupQuery, guestID, targetUserID); err != nil {
		return nil, fmt.Errorf("clean duplicate guest trackings: %w", err)
	}

	// 2. Reassign remaining tracked_products from guest to target user
	reassignTrackingQuery := `
		UPDATE tracked_products
		SET user_id = $2, updated_at = NOW()
		WHERE user_id = $1
	`
	tagTrack, err := tx.Exec(ctx, reassignTrackingQuery, guestID, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("reassign tracked products: %w", err)
	}

	// 3. Reassign alert_rules
	reassignAlertsQuery := `
		UPDATE alert_rules
		SET user_id = $2, updated_at = NOW()
		WHERE user_id = $1
	`
	tagAlerts, err := tx.Exec(ctx, reassignAlertsQuery, guestID, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("reassign alert rules: %w", err)
	}

	// 4. Reassign notification_logs
	reassignLogsQuery := `
		UPDATE notification_logs
		SET user_id = $2
		WHERE user_id = $1
	`
	tagLogs, err := tx.Exec(ctx, reassignLogsQuery, guestID, targetUserID)
	if err != nil {
		return nil, fmt.Errorf("reassign notification logs: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit migration tx: %w", err)
	}

	return &MigrationResult{
		MigratedProducts:      tagTrack.RowsAffected(),
		MigratedAlerts:        tagAlerts.RowsAffected(),
		MigratedNotifications: tagLogs.RowsAffected(),
	}, nil
}

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(
		&u.ID,
		&u.Email,
		&u.Name,
		&u.AvatarURL,
		&u.AuthProvider,
		&u.ZaloID,
		&u.Phone,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return &u, nil
}
