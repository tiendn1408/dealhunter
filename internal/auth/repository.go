package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUserNotFound        = errors.New("user not found")
	ErrCannotMigrateSelf   = errors.New("cannot migrate data to the same user account")
	ErrInvalidGuestAccount = errors.New("cannot migrate data from an existing registered account")
	ErrAlreadyMigrated     = errors.New("guest data has already been migrated")
	ErrAccountConflict     = errors.New("email is linked to a different account")
)

// GoogleIdentity is the verified subset of a Google ID token.
type GoogleIdentity struct {
	Sub     string
	Email   string
	Name    string
	Picture string
}

type UserRepository interface {
	GetByID(ctx context.Context, id uuid.UUID) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	UpsertUser(ctx context.Context, user *User) error
	UpsertGoogleUser(ctx context.Context, id GoogleIdentity) (*User, error)
	MigrateGuestData(ctx context.Context, guestID uuid.UUID, targetUserID uuid.UUID) (*MigrationResult, error)

	CreateRefreshToken(ctx context.Context, rt *RefreshToken) error
	RotateRefreshToken(ctx context.Context, oldHash string, next *RefreshToken) (uuid.UUID, error)
	RevokeRefreshFamily(ctx context.Context, tokenHash string) error
}

type PostgresUserRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresUserRepository(pool *pgxpool.Pool) *PostgresUserRepository {
	return &PostgresUserRepository{pool: pool}
}

const userColumns = `id, email, name, avatar_url, auth_provider, zalo_id, phone, created_at, updated_at`

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

// UpsertGoogleUser finds or creates the account for a verified Google identity, atomically.
// Accounts are matched by Google `sub`; an existing email row is linked only if it is a Google account
// without a different `sub` (a reassigned email never inherits another person's account).
func (r *PostgresUserRepository) UpsertGoogleUser(ctx context.Context, id GoogleIdentity) (*User, error) {
	if id.Sub == "" || id.Email == "" {
		return nil, errors.New("google identity requires sub and email")
	}

	user, err := r.updateGoogleUserBySub(ctx, id)
	if err == nil || !errors.Is(err, ErrUserNotFound) {
		return user, err
	}

	row := r.pool.QueryRow(ctx, `
		INSERT INTO users (id, email, name, avatar_url, auth_provider, google_sub, created_at, updated_at)
		VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), 'google', $5, NOW(), NOW())
		ON CONFLICT (email) DO UPDATE SET
			google_sub = EXCLUDED.google_sub,
			name = COALESCE(EXCLUDED.name, users.name),
			avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
			updated_at = NOW()
		WHERE users.auth_provider = 'google' AND users.google_sub IS NULL
		RETURNING `+userColumns, uuid.New(), id.Email, id.Name, id.Picture, id.Sub)
	user, err = scanUser(row)
	if isUniqueViolation(err) {
		// A concurrent first login of the same person inserted the row with this `sub`
		return r.updateGoogleUserBySub(ctx, id)
	}
	if errors.Is(err, ErrUserNotFound) {
		// Either a concurrent first login of the same person bound the email row to this `sub` just now,
		// or the email belongs to a non-Google account or to a different Google `sub`.
		if user, err := r.updateGoogleUserBySub(ctx, id); err == nil || !errors.Is(err, ErrUserNotFound) {
			return user, err
		}
		return nil, ErrAccountConflict
	}
	return user, err
}

// updateGoogleUserBySub refreshes the profile of the account bound to a Google `sub` (ErrUserNotFound if none).
// Changing the email to one another account already uses is an account conflict.
func (r *PostgresUserRepository) updateGoogleUserBySub(ctx context.Context, id GoogleIdentity) (*User, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE users SET
			email = $2,
			name = COALESCE(NULLIF($3, ''), name),
			avatar_url = COALESCE(NULLIF($4, ''), avatar_url),
			updated_at = NOW()
		WHERE google_sub = $1
		RETURNING `+userColumns, id.Sub, id.Email, id.Name, id.Picture)
	user, err := scanUser(row)
	if isUniqueViolation(err) {
		return nil, ErrAccountConflict
	}
	return user, err
}

func (r *PostgresUserRepository) MigrateGuestData(ctx context.Context, guestID uuid.UUID, targetUserID uuid.UUID) (*MigrationResult, error) {
	if guestID == targetUserID {
		return nil, ErrCannotMigrateSelf
	}
	if guestID == uuid.Nil || targetUserID == uuid.Nil {
		return nil, errors.New("invalid guest_id or target_user_id")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Validate guest account status and prevent hijacking registered accounts
	var guestProvider string
	err = tx.QueryRow(ctx, "SELECT auth_provider FROM users WHERE id = $1 FOR UPDATE", guestID).Scan(&guestProvider)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Guest user never tracked any product or alert (no record in users table)
			return &MigrationResult{}, nil
		}
		return nil, fmt.Errorf("lookup guest user: %w", err)
	}

	if guestProvider == "migrated" {
		return nil, ErrAlreadyMigrated
	}
	if guestProvider != "" && guestProvider != "guest" {
		return nil, ErrInvalidGuestAccount
	}

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

	// 1b. Drop guest alert rules that duplicate an identical rule the target user already has
	deleteDupAlertsQuery := `
		DELETE FROM alert_rules g
		USING alert_rules m
		WHERE g.user_id = $1 AND m.user_id = $2
		  AND g.product_source_id = m.product_source_id
		  AND g.rule_type = m.rule_type
		  AND g.threshold_value = m.threshold_value
	`
	if _, err := tx.Exec(ctx, deleteDupAlertsQuery, guestID, targetUserID); err != nil {
		return nil, fmt.Errorf("clean duplicate guest alert rules: %w", err)
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

	// 4b. Move the guest's Zalo/phone link to the target if it has none (both columns are unique,
	// so clear the guest row first)
	var guestZalo, guestPhone *string
	if err := tx.QueryRow(ctx,
		`UPDATE users g SET zalo_id = NULL, phone = NULL FROM users old WHERE g.id = $1 AND old.id = g.id RETURNING old.zalo_id, old.phone`,
		guestID).Scan(&guestZalo, &guestPhone); err != nil {
		return nil, fmt.Errorf("detach guest zalo link: %w", err)
	}
	if guestZalo != nil || guestPhone != nil {
		// Moved as a pair, and only to an account without any Zalo link: mixing the target's Zalo ID
		// with the guest's phone would address messages to a different person.
		if _, err := tx.Exec(ctx,
			`UPDATE users SET zalo_id = $2, phone = $3, updated_at = NOW() WHERE id = $1 AND zalo_id IS NULL AND phone IS NULL`,
			targetUserID, guestZalo, guestPhone); err != nil {
			return nil, fmt.Errorf("move guest zalo link: %w", err)
		}
	}

	// 5. Invalidate every guest session so the guest identity cannot be reused
	if _, err := tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, guestID); err != nil {
		return nil, fmt.Errorf("revoke guest sessions: %w", err)
	}

	// 6. Mark guest account as migrated
	markMigratedQuery := `
		UPDATE users
		SET auth_provider = 'migrated', updated_at = NOW()
		WHERE id = $1
	`
	if _, err := tx.Exec(ctx, markMigratedQuery, guestID); err != nil {
		return nil, fmt.Errorf("mark guest migrated: %w", err)
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

// isUniqueViolation reports a PostgreSQL unique-constraint violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
