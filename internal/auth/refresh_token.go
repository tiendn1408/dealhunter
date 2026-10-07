package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// RefreshReuseGrace tolerates a just-rotated token being presented again (e.g. two tabs
// refreshing concurrently) without treating it as theft.
const RefreshReuseGrace = 30 * time.Second

var (
	ErrInvalidRefreshToken = errors.New("invalid or expired refresh token")
	ErrRefreshTokenReused  = errors.New("refresh token reuse detected; all sessions revoked")
)

type RefreshToken struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	ExpiresAt time.Time
}

// newRefreshToken returns the raw token for the client and the record to persist.
func newRefreshToken(userID uuid.UUID, ttl time.Duration) (string, *RefreshToken, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, fmt.Errorf("generate refresh token: %w", err)
	}
	raw := base64.RawURLEncoding.EncodeToString(buf)
	return raw, &RefreshToken{
		ID:        uuid.New(),
		UserID:    userID,
		TokenHash: HashRefreshToken(raw),
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

func HashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (r *PostgresUserRepository) CreateRefreshToken(ctx context.Context, rt *RefreshToken) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		rt.ID, rt.UserID, rt.TokenHash, rt.ExpiresAt)
	if err != nil {
		return fmt.Errorf("insert refresh token: %w", err)
	}
	return nil
}

// RotateRefreshToken atomically revokes the token identified by oldHash and stores next for the same user.
// Presenting an already revoked token revokes every session of that user (token theft signal).
func (r *PostgresUserRepository) RotateRefreshToken(ctx context.Context, oldHash string, next *RefreshToken) (uuid.UUID, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		id         uuid.UUID
		userID     uuid.UUID
		expiresAt  time.Time
		revokedAt  *time.Time
		replacedBy *uuid.UUID
	)
	err = tx.QueryRow(ctx,
		`SELECT id, user_id, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
		oldHash).Scan(&id, &userID, &expiresAt, &revokedAt, &replacedBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrInvalidRefreshToken
		}
		return uuid.Nil, fmt.Errorf("lookup refresh token: %w", err)
	}

	inGrace := revokedAt != nil && time.Since(*revokedAt) < RefreshReuseGrace && replacedBy != nil
	if revokedAt != nil && !inGrace {
		if _, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
			return uuid.Nil, fmt.Errorf("revoke sessions after reuse: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return uuid.Nil, fmt.Errorf("commit reuse revocation: %w", err)
		}
		return uuid.Nil, ErrRefreshTokenReused
	}
	if time.Now().After(expiresAt) {
		return uuid.Nil, ErrInvalidRefreshToken
	}

	next.UserID = userID
	if _, err := tx.Exec(ctx,
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		next.ID, next.UserID, next.TokenHash, next.ExpiresAt); err != nil {
		return uuid.Nil, fmt.Errorf("insert rotated refresh token: %w", err)
	}
	if !inGrace {
		if _, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1`, id, next.ID); err != nil {
			return uuid.Nil, fmt.Errorf("revoke rotated refresh token: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, fmt.Errorf("commit refresh rotation: %w", err)
	}
	return userID, nil
}

func (r *PostgresUserRepository) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`, tokenHash)
	if err != nil {
		return fmt.Errorf("revoke refresh token: %w", err)
	}
	return nil
}
