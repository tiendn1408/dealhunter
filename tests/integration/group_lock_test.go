//go:build integration
// +build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/pkg/database"
)

// A tracking created while a link-source moves its source must lock the group the source ends up in
// (migration 000016), so a manual change of that group waits for it and sees the new tracker.
func TestNewTrackingLocksCurrentGroup(t *testing.T) {
	ctx := context.Background()
	pool, err := database.NewPostgresPool(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer pool.Close()

	g1, g2, src, userB := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	mustExec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO products (id, title) VALUES ($1, 'G1'), ($2, 'G2')`, g1, g2)
	mustExec(`INSERT INTO product_sources (id, product_id, platform, canonical_url) VALUES ($1, $2, 'shopee', $3)`, src, g2, "https://shopee.vn/product/1/"+src.String())
	mustExec(`INSERT INTO users (id, auth_provider) VALUES ($1, 'guest')`, userB)
	defer func() {
		pool.Exec(ctx, `DELETE FROM tracked_products WHERE product_source_id = $1`, src)
		pool.Exec(ctx, `DELETE FROM product_sources WHERE id = $1`, src)
		pool.Exec(ctx, `DELETE FROM products WHERE id IN ($1, $2)`, g1, g2)
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userB)
	}()

	// A: a group change in progress, moving the source from G2 to G1
	txA, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := txA.Exec(ctx, `SELECT id FROM products WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE`, []uuid.UUID{g1, g2}); err != nil {
		t.Fatal(err)
	}
	if _, err := txA.Exec(ctx, `UPDATE product_sources SET product_id = $1 WHERE id = $2`, g1, src); err != nil {
		t.Fatal(err)
	}

	// B: a new tracking of that source, kept open after its INSERT
	txB, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer txB.Rollback(ctx)
	inserted := make(chan error, 1)
	go func() {
		_, err := txB.Exec(ctx, `INSERT INTO tracked_products (id, user_id, product_source_id) VALUES ($1, $2, $3)`, uuid.New(), userB, src)
		inserted <- err
	}()
	time.Sleep(150 * time.Millisecond)
	if err := txA.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-inserted; err != nil {
		t.Fatalf("tracking insert: %v", err)
	}

	// C: a manual change of G1 must not get the group while B (now a G1 tracker) is uncommitted
	txC, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer txC.Rollback(ctx)
	if _, err := txC.Exec(ctx, `SELECT id FROM products WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, g1); err == nil {
		t.Fatal("group G1 could be locked while a new tracker of it was being created")
	}
}
