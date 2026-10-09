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

// The "new source" branch of link-source: the source did not exist when the link started, so only the
// target group is locked; meanwhile another request created it in that group and someone started
// tracking it. Writing the source must not wait on that tracker (which waits on the group) — no deadlock.
func TestLinkNewSourceVsTrackingNoDeadlock(t *testing.T) {
	ctx := context.Background()
	pool, err := database.NewPostgresPool(ctx, getTestDatabaseURL(t))
	if err != nil {
		t.Skipf("Skipping integration test: PostgreSQL not reachable: %v", err)
	}
	defer pool.Close()
	trackingRepo := tracking.NewPostgresRepository(pool)
	productRepo := product.NewPostgresRepository(pool)

	target, user := uuid.New(), uuid.New()
	extID := "shopee-9-" + uuid.NewString()[:8]
	url := "https://shopee.vn/product/9/" + extID
	pool.Exec(ctx, `INSERT INTO products (id, title) VALUES ($1, 'T')`, target)
	pool.Exec(ctx, `INSERT INTO users (id, auth_provider) VALUES ($1, 'guest')`, user)
	defer func() {
		pool.Exec(ctx, `DELETE FROM tracked_products WHERE user_id = $1`, user)
		pool.Exec(ctx, `DELETE FROM product_sources WHERE external_product_id = $1`, extID)
		pool.Exec(ctx, `DELETE FROM products WHERE id = $1`, target)
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, user)
	}()

	trackDone := make(chan error, 1)
	linkErr := trackingRepo.WithGroupLock(ctx, nil, []uuid.UUID{target}, func(tx pgx.Tx) error {
		// Another request creates the same source in the target group and commits; someone tracks it
		existing := &product.ProductSource{ID: uuid.New(), ProductID: target, Platform: "shopee", ExternalProductID: &extID, CanonicalURL: url, Currency: "VND", Active: true}
		if err := productRepo.UpsertProductSource(ctx, nil, existing); err != nil {
			return err
		}
		go func() {
			trackDone <- trackingRepo.CreateTracking(ctx, nil, &domain.TrackedProduct{ID: uuid.New(), UserID: user, ProductSourceID: existing.ID, Active: true})
		}()
		time.Sleep(200 * time.Millisecond) // the tracker now holds the source row and waits for the group

		// The link writes "its" new source, as LinkSourceToProduct does on that branch
		mine := &product.ProductSource{ID: uuid.New(), ProductID: target, Platform: "shopee", ExternalProductID: &extID, CanonicalURL: url, Currency: "VND", Active: true}
		_, err := productRepo.InsertProductSourceIfAbsent(ctx, tx, mine)
		return err
	})
	trackErr := <-trackDone

	var pgErr *pgconn.PgError
	for name, err := range map[string]error{"link": linkErr, "tracking": trackErr} {
		if errors.As(err, &pgErr) && pgErr.Code == "40P01" {
			t.Fatalf("%s deadlocked: %v", name, err)
		}
		if err != nil {
			t.Fatalf("%s failed: %v", name, err)
		}
	}
}
