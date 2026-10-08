package router

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/auth"
)

// stubUserRepo implements auth.UserRepository with fixed results for handler tests.
type stubUserRepo struct {
	googleErr  error
	rotateUser uuid.UUID
	rotateErr  error
	getByIDErr error
}

func (s *stubUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*auth.User, error) {
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	return &auth.User{ID: id, AuthProvider: "google"}, nil
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
