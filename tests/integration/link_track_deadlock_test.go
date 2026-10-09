//go:build integration
// +build integration

package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/pkg/database"
)

// A link-source moving a source between groups while someone starts tracking that same source must
// serialize, never deadlock: every path locks the source row before the group rows.
func TestLinkSourceVsNewTrackingNoDeadlock(t *testing.T) {
	ctx := context.Background()
	pool, err := database.NewPostgresPool(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer pool.Close()
	trackingRepo := tracking.NewPostgresRepository(pool)
	productRepo := product.NewPostgresRepository(pool)

	for round := 0; round < 5; round++ {
		g1, g2, src, userB := uuid.New(), uuid.New(), uuid.New(), uuid.New()
		mustExec := func(sql string, args ...any) {
			t.Helper()
			if _, err := pool.Exec(ctx, sql, args...); err != nil {
				t.Fatal(err)
			}
		}
		mustExec(`INSERT INTO products (id, title) VALUES ($1, 'G1'), ($2, 'G2')`, g1, g2)
		mustExec(`INSERT INTO product_sources (id, product_id, platform, canonical_url) VALUES ($1, $2, 'shopee', $3)`, src, g2, "https://shopee.vn/product/2/"+src.String())
		mustExec(`INSERT INTO users (id, auth_provider) VALUES ($1, 'guest')`, userB)

		trackDone := make(chan error, 1)
		// A: the link-source transaction, pausing after its group locks while B starts tracking the source
		linkErr := trackingRepo.WithGroupLock(ctx, []uuid.UUID{src}, []uuid.UUID{g1, g2}, func(tx pgx.Tx) error {
			go func() {
				trackDone <- trackingRepo.CreateTracking(ctx, nil, &domain.TrackedProduct{ID: uuid.New(), UserID: userB, ProductSourceID: src, Active: true})
			}()
			time.Sleep(200 * time.Millisecond) // B is now waiting inside its trigger
			return productRepo.AssignProductSource(ctx, tx, src, g2, g1)
		})
		trackErr := <-trackDone

		var pgErr *pgconn.PgError
		for name, err := range map[string]error{"link-source": linkErr, "tracking": trackErr} {
			if errors.As(err, &pgErr) && pgErr.Code == "40P01" {
				t.Fatalf("round %d: %s deadlocked: %v", round, name, err)
			}
			if err != nil {
				t.Fatalf("round %d: %s failed: %v", round, name, err)
			}
		}
		var gid uuid.UUID
		if err := pool.QueryRow(ctx, `SELECT product_id FROM product_sources WHERE id = $1`, src).Scan(&gid); err != nil || gid != g1 {
			t.Fatalf("round %d: source should be in G1, got %v (%v)", round, gid, err)
		}

		pool.Exec(ctx, `DELETE FROM tracked_products WHERE product_source_id = $1`, src)
		pool.Exec(ctx, `DELETE FROM product_sources WHERE id = $1`, src)
		pool.Exec(ctx, `DELETE FROM products WHERE id IN ($1, $2)`, g1, g2)
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userB)
	}
}
