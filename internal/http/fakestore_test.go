package router

import (
	"context"
	"errors"
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

var errFakeNotFound = errors.New("not found")

// product.ProductRepository
func (f *fakeStore) UpsertProduct(context.Context, *product.Product) error { return nil }
func (f *fakeStore) UpsertProductSource(_ context.Context, ps *product.ProductSource) error {
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
func (f *fakeStore) AssignProductSource(_ context.Context, sourceID, productID uuid.UUID) error {
	f.sources[sourceID].ProductID = productID
	return nil
}

// domain.TrackingRepository
func (f *fakeStore) CreateTracking(_ context.Context, t *domain.TrackedProduct) error {
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
func (f *fakeStore) UserTracksProduct(_ context.Context, userID, productID uuid.UUID) (bool, error) {
	for _, t := range f.trackings {
		if s := f.sources[t.ProductSourceID]; t.UserID == userID && s != nil && s.ProductID == productID {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeStore) OtherUsersTrackProduct(_ context.Context, productID, userID uuid.UUID) (bool, error) {
	for _, t := range f.trackings {
		if s := f.sources[t.ProductSourceID]; t.UserID != userID && s != nil && s.ProductID == productID {
			return true, nil
		}
	}
	return false, nil
}
