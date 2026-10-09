//go:build integration
// +build integration

package integration

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/matching"
	"github.com/tiendang/deal-hunter/pkg/database"
)

// Re-saving a candidate (a later auto-match run) must never undo a user's decision on it.
func TestSaveSuggestionKeepsUserDecision(t *testing.T) {
	ctx := context.Background()
	pool, err := database.NewPostgresPool(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer pool.Close()
	repo := matching.NewPostgresMatchingRepository(pool)

	productID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO products (id, title) VALUES ($1, 'P')`, productID); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `DELETE FROM products WHERE id = $1`, productID)

	for _, decided := range []string{matching.StatusDismissed, matching.StatusAccepted, matching.StatusAutoLinked} {
		url := "https://www.lazada.vn/products/x-i" + uuid.NewString()[:8] + ".html"
		first := &matching.MatchSuggestion{ID: uuid.New(), ProductID: productID, CandidatePlatform: "lazada", CandidateURL: url, CandidateTitle: "X", MatchScore: 0.8, Status: decided}
		if err := repo.SaveSuggestion(ctx, first); err != nil {
			t.Fatal(err)
		}
		again := &matching.MatchSuggestion{ID: uuid.New(), ProductID: productID, CandidatePlatform: "lazada", CandidateURL: url, CandidateTitle: "X new", MatchScore: 0.82, Status: matching.StatusPending}
		if err := repo.SaveSuggestion(ctx, again); err != nil {
			t.Fatal(err)
		}
		got, err := repo.GetSuggestionByProductAndURL(ctx, productID, url)
		if err != nil || got == nil || got.Status != decided {
			t.Fatalf("a %s suggestion became %v after a re-save (%v)", decided, got, err)
		}
	}
}
