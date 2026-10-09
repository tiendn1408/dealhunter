//go:build integration
// +build integration

package integration

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/pkg/database"
)

// Reading a profile never creates a user: users only come from guest sessions and Google sign-in.
func TestGetUserProfileNeverCreatesUsers(t *testing.T) {
	ctx := context.Background()
	pool, err := database.NewPostgresPool(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer pool.Close()
	repo := notification.NewPostgresRepository(pool)

	ghost := uuid.New()
	if _, err := repo.GetUserProfile(ctx, ghost); !errors.Is(err, notification.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound for an unknown user, got %v", err)
	}
	var n int
	pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id = $1`, ghost).Scan(&n)
	if n != 0 {
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, ghost)
		t.Fatal("reading a profile created a user row")
	}
}
