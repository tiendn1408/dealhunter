//go:build integration
// +build integration

package integration

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/pkg/database"
)

// Concurrency and data-integrity cases of the auth repository against a real PostgreSQL.
func TestAuthRepositoryRaces(t *testing.T) {
	ctx := context.Background()
	pool, err := database.NewPostgresPool(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer pool.Close()
	repo := auth.NewPostgresUserRepository(pool)

	t.Run("concurrent first Google logins share one account", func(t *testing.T) {
		id := auth.GoogleIdentity{Sub: "sub-" + uuid.NewString(), Email: "race-" + uuid.NewString()[:8] + "@example.com", Name: "Race"}
		const n = 8
		ids := make([]uuid.UUID, n)
		errs := make([]error, n)
		var wg sync.WaitGroup
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				u, err := repo.UpsertGoogleUser(ctx, id)
				errs[i] = err
				if u != nil {
					ids[i] = u.ID
				}
			}(i)
		}
		wg.Wait()
		for i := 0; i < n; i++ {
			if errs[i] != nil {
				t.Fatalf("login %d failed: %v", i, errs[i])
			}
			if ids[i] != ids[0] {
				t.Fatalf("logins returned different accounts: %v vs %v", ids[i], ids[0])
			}
		}
	})

	t.Run("reassigned email is still a conflict", func(t *testing.T) {
		email := "owner-" + uuid.NewString()[:8] + "@example.com"
		if _, err := repo.UpsertGoogleUser(ctx, auth.GoogleIdentity{Sub: "sub-a-" + uuid.NewString(), Email: email}); err != nil {
			t.Fatalf("first owner: %v", err)
		}
		if _, err := repo.UpsertGoogleUser(ctx, auth.GoogleIdentity{Sub: "sub-b-" + uuid.NewString(), Email: email}); err != auth.ErrAccountConflict {
			t.Fatalf("expected ErrAccountConflict for a different sub, got %v", err)
		}
	})

	t.Run("logout revokes the token a concurrent refresh issues", func(t *testing.T) {
		member, err := repo.UpsertGoogleUser(ctx, auth.GoogleIdentity{Sub: "sub-" + uuid.NewString(), Email: "lr-" + uuid.NewString()[:8] + "@example.com"})
		if err != nil {
			t.Fatal(err)
		}
		for round := 0; round < 20; round++ {
			first := &auth.RefreshToken{ID: uuid.New(), UserID: member.ID, FamilyID: uuid.New(), TokenHash: uuid.NewString(), ExpiresAt: time.Now().Add(time.Hour)}
			first.FamilyID = first.ID
			if err := repo.CreateRefreshToken(ctx, first); err != nil {
				t.Fatal(err)
			}
			next := &auth.RefreshToken{ID: uuid.New(), TokenHash: uuid.NewString(), ExpiresAt: time.Now().Add(time.Hour)}

			var wg sync.WaitGroup
			wg.Add(2)
			go func() { defer wg.Done(); _, _ = repo.RotateRefreshToken(ctx, first.TokenHash, next) }()
			go func() { defer wg.Done(); _ = repo.RevokeRefreshFamily(ctx, first.TokenHash) }()
			wg.Wait()

			// Whichever ran first, no token of the family may still be usable after the logout
			if _, err := repo.RotateRefreshToken(ctx, next.TokenHash, &auth.RefreshToken{ID: uuid.New(), TokenHash: uuid.NewString(), ExpiresAt: time.Now().Add(time.Hour)}); err == nil {
				t.Fatalf("round %d: token issued by a refresh racing logout is still valid", round)
			}
		}
	})

	t.Run("replay of a rotated token is detected after the cleanup job", func(t *testing.T) {
		member, err := repo.UpsertGoogleUser(ctx, auth.GoogleIdentity{Sub: "sub-" + uuid.NewString(), Email: "rp-" + uuid.NewString()[:8] + "@example.com"})
		if err != nil {
			t.Fatal(err)
		}
		old := &auth.RefreshToken{ID: uuid.New(), UserID: member.ID, TokenHash: uuid.NewString(), ExpiresAt: time.Now().Add(20 * 24 * time.Hour)}
		old.FamilyID = old.ID
		if err := repo.CreateRefreshToken(ctx, old); err != nil {
			t.Fatal(err)
		}
		next := &auth.RefreshToken{ID: uuid.New(), TokenHash: uuid.NewString(), ExpiresAt: time.Now().Add(30 * 24 * time.Hour)}
		if _, err := repo.RotateRefreshToken(ctx, old.TokenHash, next); err != nil {
			t.Fatal(err)
		}
		// Rotated 10 days ago: older than the 7-day retention, but the token has not expired yet
		if _, err := pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '10 days' WHERE id = $1`, old.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.PurgeRefreshTokens(ctx, 7*24*time.Hour); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.RotateRefreshToken(ctx, old.TokenHash, &auth.RefreshToken{ID: uuid.New(), TokenHash: uuid.NewString(), ExpiresAt: time.Now().Add(time.Hour)}); err != auth.ErrRefreshTokenReused {
			t.Fatalf("expected ErrRefreshTokenReused after purge, got %v", err)
		}
	})

	t.Run("a merged guest cannot get new rows", func(t *testing.T) {
		guest := &auth.User{ID: uuid.New(), AuthProvider: "guest"}
		if err := repo.UpsertUser(ctx, guest); err != nil {
			t.Fatal(err)
		}
		member, err := repo.UpsertGoogleUser(ctx, auth.GoogleIdentity{Sub: "sub-" + uuid.NewString(), Email: "mg-" + uuid.NewString()[:8] + "@example.com"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.MigrateGuestData(ctx, guest.ID, member.ID); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		// The trigger runs before the foreign-key checks, so no product source is needed
		_, err = pool.Exec(ctx, `INSERT INTO tracked_products (id, user_id, product_source_id, next_fetch_at)
			VALUES (gen_random_uuid(), $1, gen_random_uuid(), NOW())`, guest.ID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "DH001" {
			t.Fatalf("expected DH001 for a write by a merged guest, got %v", err)
		}
	})

	t.Run("guest Zalo link moves as a pair, never mixed", func(t *testing.T) {
		suffix := uuid.NewString()[:8]
		guest := &auth.User{ID: uuid.New(), AuthProvider: "guest"}
		if err := repo.UpsertUser(ctx, guest); err != nil {
			t.Fatal(err)
		}
		member, err := repo.UpsertGoogleUser(ctx, auth.GoogleIdentity{Sub: "sub-" + uuid.NewString(), Email: "zm-" + suffix + "@example.com"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE users SET zalo_id = $2 WHERE id = $1`, member.ID, "zm"+suffix); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE users SET phone = $2 WHERE id = $1`, guest.ID, "09"+suffix[:8]); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.MigrateGuestData(ctx, guest.ID, member.ID); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		var zaloID, phone *string
		if err := pool.QueryRow(ctx, `SELECT zalo_id, phone FROM users WHERE id = $1`, member.ID).Scan(&zaloID, &phone); err != nil {
			t.Fatal(err)
		}
		if zaloID == nil || *zaloID != "zm"+suffix || phone != nil {
			t.Fatalf("member's own Zalo link must stay unmixed, got zalo_id=%v phone=%v", zaloID, phone)
		}
	})
}
