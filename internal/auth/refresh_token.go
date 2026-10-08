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

var (
	ErrInvalidRefreshToken = errors.New("invalid or expired refresh token")
	ErrRefreshTokenReused  = errors.New("refresh token reuse detected; all sessions revoked")
)

// RefreshToken is one link of a rotation chain. Every token issued from the same login shares a FamilyID.
type RefreshToken struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	FamilyID  uuid.UUID
	TokenHash string
	ExpiresAt time.Time
}

// newRefreshToken returns the raw token for the client and the record to persist.
// A zero familyID starts a new family (a new login).
func newRefreshToken(userID, familyID uuid.UUID, ttl time.Duration) (string, *RefreshToken, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, fmt.Errorf("generate refresh token: %w", err)
	}
	raw := base64.RawURLEncoding.EncodeToString(buf)
	id := uuid.New()
	if familyID == uuid.Nil {
		familyID = id
	}
	return raw, &RefreshToken{
		ID:        id,
		UserID:    userID,
		FamilyID:  familyID,
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
		`INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		rt.ID, rt.UserID, rt.FamilyID, rt.TokenHash, rt.ExpiresAt)
	if err != nil {
		return fmt.Errorf("insert refresh token: %w", err)
	}
	return nil
}

// RotateRefreshToken atomically revokes the token identified by oldHash and stores next in the same family.
// Rotation is strict: presenting an already rotated token is treated as theft and revokes every session
// of that user. Tokens revoked by logout, expired tokens and tokens of migrated guests are rejected.
func (r *PostgresUserRepository) RotateRefreshToken(ctx context.Context, oldHash string, next *RefreshToken) (uuid.UUID, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Serialize with logout and other rotations of the same login (see lockRefreshFamily)
	if err := lockRefreshFamily(ctx, tx, oldHash); err != nil {
		return uuid.Nil, err
	}

	var (
		id           uuid.UUID
		userID       uuid.UUID
		familyID     uuid.UUID
		expired      bool
		revoked      bool
		rotated      bool
		authProvider string
	)
	err = tx.QueryRow(ctx, `
		SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at <= NOW(), rt.revoked_at IS NOT NULL,
		       rt.replaced_by IS NOT NULL, u.auth_provider
		FROM refresh_tokens rt
		JOIN users u ON u.id = rt.user_id
		WHERE rt.token_hash = $1
		FOR UPDATE OF rt`,
		oldHash).Scan(&id, &userID, &familyID, &expired, &revoked, &rotated, &authProvider)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrInvalidRefreshToken
		}
		return uuid.Nil, fmt.Errorf("lookup refresh token: %w", err)
	}

	// A token that was already rotated is being replayed: treat as theft. A token revoked by
	// logout or migration is simply invalid.
	if revoked && rotated {
		if _, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
			return uuid.Nil, fmt.Errorf("revoke sessions after reuse: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return uuid.Nil, fmt.Errorf("commit reuse revocation: %w", err)
		}
		return uuid.Nil, ErrRefreshTokenReused
	}
	if revoked || expired || authProvider == "migrated" {
		return uuid.Nil, ErrInvalidRefreshToken
	}

	next.UserID = userID
	next.FamilyID = familyID
	if _, err := tx.Exec(ctx,
		`INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		next.ID, next.UserID, next.FamilyID, next.TokenHash, next.ExpiresAt); err != nil {
		return uuid.Nil, fmt.Errorf("insert rotated refresh token: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1`, id, next.ID); err != nil {
		return uuid.Nil, fmt.Errorf("revoke rotated refresh token: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, fmt.Errorf("commit refresh rotation: %w", err)
	}
	return userID, nil
}

// RevokeRefreshFamily revokes every token of the login that tokenHash belongs to (logout),
// including tokens a concurrent refresh in another tab may have just issued: the family lock makes
// logout wait for an in-flight rotation, and the UPDATE then sees the token it committed.
func (r *PostgresUserRepository) RevokeRefreshFamily(ctx context.Context, tokenHash string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := lockRefreshFamily(ctx, tx, tokenHash); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = NOW()
		WHERE revoked_at IS NULL
		  AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`, tokenHash); err != nil {
		return fmt.Errorf("revoke refresh family: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit refresh family revocation: %w", err)
	}
	return nil
}

// lockRefreshFamily takes a transaction-scoped lock on the login (token family) tokenHash belongs to.
// Rotation and logout both take it before touching any token row, so they never interleave (a logout
// can no longer miss a token a concurrent rotation is about to commit) and cannot deadlock.
// An unknown hash takes no lock; the caller's own lookup then rejects it.
func lockRefreshFamily(ctx context.Context, tx pgx.Tx, tokenHash string) error {
	if _, err := tx.Exec(ctx, `
		SELECT pg_advisory_xact_lock(hashtextextended(family_id::text, 0))
		FROM refresh_tokens WHERE token_hash = $1`, tokenHash); err != nil {
		return fmt.Errorf("lock refresh family: %w", err)
	}
	return nil
}

// PurgeRefreshTokens deletes tokens that expired, or were revoked by logout/migration, more than `retain`
// ago. Rotated tokens are kept until they expire: replaying one must keep being detected as theft for as
// long as it could otherwise have been used.
func (r *PostgresUserRepository) PurgeRefreshTokens(ctx context.Context, retain time.Duration) (int64, error) {
	cutoff := time.Now().Add(-retain)
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM refresh_tokens WHERE expires_at < $1 OR (revoked_at < $1 AND replaced_by IS NULL)`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("purge refresh tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}
