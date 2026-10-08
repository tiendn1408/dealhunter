package router

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/voucher"
)

// stubUserRepo implements auth.UserRepository with fixed results for handler tests.
type stubUserRepo struct {
	email      string
	googleErr  error
	rotateUser uuid.UUID
	rotateErr  error
	getByIDErr error
}

func (s *stubUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*auth.User, error) {
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	u := &auth.User{ID: id, AuthProvider: "google"}
	if s.email != "" {
		u.Email = &s.email
	}
	return u, nil
}
func (s *stubUserRepo) GetByEmail(ctx context.Context, email string) (*auth.User, error) {
	return nil, auth.ErrUserNotFound
}
func (s *stubUserRepo) UpsertUser(ctx context.Context, user *auth.User) error { return nil }
func (s *stubUserRepo) UpsertGoogleUser(ctx context.Context, id auth.GoogleIdentity) (*auth.User, error) {
	return nil, s.googleErr
}
func (s *stubUserRepo) MigrateGuestData(ctx context.Context, guestID, targetUserID uuid.UUID) (*auth.MigrationResult, error) {
	return &auth.MigrationResult{}, nil
}
func (s *stubUserRepo) CreateRefreshToken(ctx context.Context, rt *auth.RefreshToken) error {
	return nil
}
func (s *stubUserRepo) RotateRefreshToken(ctx context.Context, oldHash string, next *auth.RefreshToken) (uuid.UUID, error) {
	return s.rotateUser, s.rotateErr
}
func (s *stubUserRepo) RevokeRefreshFamily(ctx context.Context, tokenHash string) error { return nil }

func newAuthTestHandler(t *testing.T, repo auth.UserRepository) *Handler {
	t.Helper()
	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"aud":"client-id","iss":"https://accounts.google.com","email":"a@example.com","email_verified":"true","sub":"sub-2"}`)
	}))
	t.Cleanup(google.Close)

	svc := auth.NewAuthService(repo, testJWTManager, "client-id")
	svc.SetGoogleTokenInfoURL(google.URL)
	h := newTestHandler()
	h.SetAuthService(svc, testJWTManager)
	h.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	return h
}

func refreshCookie(w *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == refreshCookieName {
			return c
		}
	}
	return nil
}

// An email already bound to another Google identity is a conflict, not a server error.
func TestGoogleLogin_AccountConflictIs409(t *testing.T) {
	h := newAuthTestHandler(t, &stubUserRepo{googleErr: auth.ErrAccountConflict})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"id_token":"tok"}`))
	w := httptest.NewRecorder()
	h.GoogleLogin(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRefreshSession_CookieHandling(t *testing.T) {
	userID := uuid.New()
	cases := []struct {
		name       string
		repo       *stubUserRepo
		wantStatus int
		// "" = cookie untouched, "cleared", "rotated"
		wantCookie string
	}{
		{"invalid token clears cookie", &stubUserRepo{rotateErr: auth.ErrInvalidRefreshToken}, http.StatusUnauthorized, "cleared"},
		{"reused token clears cookie", &stubUserRepo{rotateErr: auth.ErrRefreshTokenReused}, http.StatusUnauthorized, "cleared"},
		{"db error before rotation keeps cookie", &stubUserRepo{rotateErr: errors.New("db down")}, http.StatusInternalServerError, ""},
		{"error after rotation hands over new cookie", &stubUserRepo{rotateUser: userID, getByIDErr: errors.New("db down")}, http.StatusInternalServerError, "rotated"},
		{"success sets new cookie", &stubUserRepo{rotateUser: userID}, http.StatusOK, "rotated"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newAuthTestHandler(t, tc.repo)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
			req.AddCookie(&http.Cookie{Name: refreshCookieName, Value: "old-token"})
			w := httptest.NewRecorder()
			h.RefreshSession(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("expected %d, got %d", tc.wantStatus, w.Code)
			}
			c := refreshCookie(w)
			switch tc.wantCookie {
			case "":
				if c != nil {
					t.Fatalf("expected cookie untouched, got %+v", c)
				}
			case "cleared":
				if c == nil || c.MaxAge >= 0 {
					t.Fatalf("expected cookie cleared, got %+v", c)
				}
			case "rotated":
				if c == nil || c.Value == "" || c.Value == "old-token" || c.MaxAge <= 0 {
					t.Fatalf("expected new refresh cookie, got %+v", c)
				}
			}
		})
	}
}

// A write rejected because the guest was merged into a member account ends the guest session (401),
// any other failure stays a generic 500.
func TestServerError_MigratedUserWriteIs401(t *testing.T) {
	h := newTestHandler()
	h.logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	cases := []struct {
		err  error
		want int
	}{
		{fmt.Errorf("create tracking: %w", &pgconn.PgError{Code: "DH001"}), http.StatusUnauthorized},
		{errors.New("db down"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		h.serverError(w, httptest.NewRequest(http.MethodPost, "/api/v1/tracked-products", nil), tc.err)
		if w.Code != tc.want {
			t.Errorf("%v: expected %d, got %d", tc.err, tc.want, w.Code)
		}
	}
}

// SEC-09: vouchers are global data, so only ADMIN_EMAILS may create them; an empty list means nobody.
func TestCreateVoucher_AdminOnly(t *testing.T) {
	post := func(h *Handler, asMember bool) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tracked-products/x/vouchers", strings.NewReader(`{}`))
		if asMember {
			authAsMember(req, uuid.New())
		} else {
			authAs(req, uuid.New())
		}
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", uuid.NewString())
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		w := httptest.NewRecorder()
		h.CreateTrackedProductVoucher(w, req)
		return w.Code
	}
	handler := func(email string, admins []string) *Handler {
		h := newAuthTestHandler(t, &stubUserRepo{email: email})
		h.SetVoucherRepository(noVoucherRepo{})
		h.trackingService = newFakeStore().trackingService()
		h.SetAdminEmails(admins)
		return h
	}

	if code := post(handler("boss@example.com", nil), true); code != http.StatusForbidden {
		t.Errorf("empty ADMIN_EMAILS must refuse everyone, got %d", code)
	}
	if code := post(handler("someone@example.com", []string{"boss@example.com"}), true); code != http.StatusForbidden {
		t.Errorf("member not in ADMIN_EMAILS: expected 403, got %d", code)
	}
	if code := post(handler("boss@example.com", []string{"boss@example.com"}), false); code != http.StatusForbidden {
		t.Errorf("guest token, even with an admin email: expected 403, got %d", code)
	}
}

// SEC-12: a failure is logged server-side and answered with a generic body: no SQL, driver or
// upstream detail reaches the client.
func TestServerError_GenericBody(t *testing.T) {
	h := newTestHandler()
	var logs strings.Builder
	h.logger = slog.New(slog.NewTextHandler(&logs, nil))
	w := httptest.NewRecorder()
	secret := `ERROR: relation "users" does not exist (SQLSTATE 42P01)`
	h.serverError(w, httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil), errors.New(secret))
	if w.Code != http.StatusInternalServerError || strings.TrimSpace(w.Body.String()) != "internal server error" {
		t.Fatalf("expected a generic 500, got %d %q", w.Code, w.Body.String())
	}
	if !strings.Contains(logs.String(), "SQLSTATE 42P01") {
		t.Fatal("the detail must be logged server-side")
	}
}

// noVoucherRepo fails the test run if a refused request ever reached storage.
type noVoucherRepo struct{}

func (noVoucherRepo) UpsertVoucher(context.Context, *voucher.ProductVoucher) error {
	panic("voucher stored by a non-admin")
}
func (noVoucherRepo) GetVouchersBySourceID(context.Context, uuid.UUID) ([]*voucher.ProductVoucher, error) {
	return nil, nil
}
func (noVoucherRepo) DeleteExpiredVouchers(context.Context) error { return nil }
