package router

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/product"
	"github.com/tiendang/deal-hunter/internal/tracking"
)

// fakeStore is an in-memory product + tracking repository for handler tests.
type fakeStore struct {
	sources   map[uuid.UUID]*product.ProductSource
	trackings []*domain.TrackedProduct
}

func newFakeStore() *fakeStore {
	return &fakeStore{sources: map[uuid.UUID]*product.ProductSource{}}
}

// addTrackedSource creates a source in productID's group tracked by userID and returns it.
func (f *fakeStore) addTrackedSource(userID, productID uuid.UUID) *product.ProductSource {
	src := &product.ProductSource{ID: uuid.New(), ProductID: productID, Platform: "shopee", CanonicalURL: "https://shopee.vn/x-i.1." + uuid.NewString()[:6]}
	f.sources[src.ID] = src
	f.trackings = append(f.trackings, &domain.TrackedProduct{ID: uuid.New(), UserID: userID, ProductSourceID: src.ID, Active: true})
	return src
}

func (f *fakeStore) trackingService() *tracking.TrackingService {
	return tracking.NewTrackingService(nil, f, f, nil, nil)
}

// Same "no row" error the PostgreSQL repositories wrap
var errFakeNotFound = fmt.Errorf("not found: %w", pgx.ErrNoRows)

// product.ProductRepository
func (f *fakeStore) UpsertProduct(context.Context, *product.Product) error { return nil }
func (f *fakeStore) InsertProductSourceIfAbsent(_ context.Context, _ pgx.Tx, ps *product.ProductSource) (bool, error) {
	for _, existing := range f.sources {
		if ps.ExternalProductID != nil && existing.ExternalProductID != nil && existing.Platform == ps.Platform && *existing.ExternalProductID == *ps.ExternalProductID {
			return false, nil
		}
	}
	f.sources[ps.ID] = ps
	return true, nil
}
func (f *fakeStore) UpsertProductSource(_ context.Context, _ pgx.Tx, ps *product.ProductSource) error {
	f.sources[ps.ID] = ps
	return nil
}
func (f *fakeStore) GetProductSource(_ context.Context, id uuid.UUID) (*product.ProductSource, error) {
	if s, ok := f.sources[id]; ok {
		return s, nil
	}
	return nil, errFakeNotFound
}
func (f *fakeStore) GetProductSourceByExternalID(context.Context, string, string) (*product.ProductSource, error) {
	return nil, nil
}
func (f *fakeStore) UpdateProductSourcePrice(context.Context, pgx.Tx, *product.ProductSource) error {
	return nil
}
func (f *fakeStore) ProductExists(_ context.Context, productID uuid.UUID) (bool, error) {
	for _, s := range f.sources {
		if s.ProductID == productID {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeStore) AssignProductSource(_ context.Context, _ pgx.Tx, sourceID, fromProductID, toProductID uuid.UUID) error {
	if f.sources[sourceID].ProductID != fromProductID {
		return product.ErrSourceMoved
	}
	f.sources[sourceID].ProductID = toProductID
	return nil
}

// domain.TrackingRepository
func (f *fakeStore) CreateTracking(_ context.Context, _ pgx.Tx, t *domain.TrackedProduct) error {
	f.trackings = append(f.trackings, t)
	return nil
}
func (f *fakeStore) GetTracking(_ context.Context, id uuid.UUID) (*domain.TrackedProduct, error) {
	for _, t := range f.trackings {
		if t.ID == id {
			return t, nil
		}
	}
	return nil, errFakeNotFound
}
func (f *fakeStore) GetTrackingForUser(_ context.Context, id, userID uuid.UUID) (*domain.TrackedProduct, error) {
	for _, t := range f.trackings {
		if (t.ID == id || t.ProductSourceID == id) && t.UserID == userID {
			return t, nil
		}
	}
	return nil, errFakeNotFound
}
func (f *fakeStore) GetTrackingBySource(_ context.Context, userID, sourceID uuid.UUID) (*domain.TrackedProduct, error) {
	for _, t := range f.trackings {
		if t.ProductSourceID == sourceID && t.UserID == userID {
			return t, nil
		}
	}
	return nil, nil
}
func (f *fakeStore) ListTrackingsByUser(_ context.Context, userID uuid.UUID) ([]*domain.TrackedProduct, error) {
	var out []*domain.TrackedProduct
	for _, t := range f.trackings {
		if t.UserID == userID {
			out = append(out, t)
		}
	}
	return out, nil
}
func (f *fakeStore) UpdateNextFetchAt(context.Context, pgx.Tx, uuid.UUID, time.Time) error {
	return nil
}
func (f *fakeStore) UpdateNextFetchAtForUser(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, time.Time) error {
	return nil
}
func (f *fakeStore) ClaimDueTrackings(context.Context, int) ([]*domain.TrackedProduct, error) {
	return nil, nil
}
func (f *fakeStore) SetTrackingActive(context.Context, uuid.UUID, bool) error { return nil }
func (f *fakeStore) SetTrackingActiveForUser(context.Context, uuid.UUID, uuid.UUID, bool) error {
	return nil
}

// WithGroupLock runs fn directly: the in-memory store has no concurrency to guard against.
func (f *fakeStore) WithGroupLock(_ context.Context, _, _ []uuid.UUID, fn func(tx pgx.Tx) error) error {
	return fn(nil)
}
func (f *fakeStore) UserTracksProduct(_ context.Context, _ pgx.Tx, userID, productID uuid.UUID) (bool, error) {
	for _, t := range f.trackings {
		if s := f.sources[t.ProductSourceID]; t.UserID == userID && s != nil && s.ProductID == productID {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeStore) OtherUsersTrackProduct(_ context.Context, _ pgx.Tx, productID, userID uuid.UUID) (bool, error) {
	for _, t := range f.trackings {
		if s := f.sources[t.ProductSourceID]; t.UserID != userID && s != nil && s.ProductID == productID {
			return true, nil
		}
	}
	return false, nil
}
