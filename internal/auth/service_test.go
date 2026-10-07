package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

type memoryUserRepo struct {
	users    map[uuid.UUID]*User
	byEmail  map[string]*User
	refresh  map[string]*memoryRefreshToken
	migrated []uuid.UUID
}

type memoryRefreshToken struct {
	RefreshToken
	revoked bool
	rotated bool
}

func newMemoryUserRepo() *memoryUserRepo {
	return &memoryUserRepo{
		users:   make(map[uuid.UUID]*User),
		byEmail: make(map[string]*User),
		refresh: make(map[string]*memoryRefreshToken),
	}
}

func (m *memoryUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u, ok := m.users[id]
	if !ok {
		return nil, ErrUserNotFound
	}
	return u, nil
}

func (m *memoryUserRepo) GetByEmail(ctx context.Context, email string) (*User, error) {
	u, ok := m.byEmail[email]
	if !ok {
		return nil, ErrUserNotFound
	}
	return u, nil
}

func (m *memoryUserRepo) UpsertUser(ctx context.Context, user *User) error {
	m.users[user.ID] = user
	if user.Email != nil {
		m.byEmail[*user.Email] = user
	}
	return nil
}

func (m *memoryUserRepo) UpsertGoogleUser(ctx context.Context, id GoogleIdentity) (*User, error) {
	for _, u := range m.users {
		if u.GoogleSub != nil && *u.GoogleSub == id.Sub {
			u.Email = &id.Email
			return u, nil
		}
	}
	if u, ok := m.byEmail[id.Email]; ok {
		if u.AuthProvider != "google" || u.GoogleSub != nil {
			return nil, ErrAccountConflict
		}
		sub := id.Sub
		u.GoogleSub = &sub
		return u, nil
	}
	email, name, sub := id.Email, id.Name, id.Sub
	u := &User{ID: uuid.New(), Email: &email, Name: &name, AuthProvider: "google", GoogleSub: &sub}
	return u, m.UpsertUser(ctx, u)
}

func (m *memoryUserRepo) MigrateGuestData(ctx context.Context, guestID uuid.UUID, targetUserID uuid.UUID) (*MigrationResult, error) {
	guest, ok := m.users[guestID]
	if ok && guest.AuthProvider == "migrated" {
		return nil, ErrAlreadyMigrated
	}
	if ok && guest.AuthProvider != "guest" {
		return nil, ErrInvalidGuestAccount
	}
	if ok {
		guest.AuthProvider = "migrated"
	}
	m.migrated = append(m.migrated, guestID)
	return &MigrationResult{
		MigratedProducts:      3,
		MigratedAlerts:        1,
		MigratedNotifications: 2,
	}, nil
}

func (m *memoryUserRepo) CreateRefreshToken(ctx context.Context, rt *RefreshToken) error {
	m.refresh[rt.TokenHash] = &memoryRefreshToken{RefreshToken: *rt}
	return nil
}

func (m *memoryUserRepo) RotateRefreshToken(ctx context.Context, oldHash string, next *RefreshToken) (uuid.UUID, error) {
	old, ok := m.refresh[oldHash]
	if !ok {
		return uuid.Nil, ErrInvalidRefreshToken
	}
	if old.revoked && old.rotated {
		for _, rt := range m.refresh {
			if rt.UserID == old.UserID {
				rt.revoked = true
			}
		}
		return uuid.Nil, ErrRefreshTokenReused
	}
	if u := m.users[old.UserID]; old.revoked || time.Now().After(old.ExpiresAt) || (u != nil && u.AuthProvider == "migrated") {
		return uuid.Nil, ErrInvalidRefreshToken
	}
	old.revoked, old.rotated = true, true
	next.UserID, next.FamilyID = old.UserID, old.FamilyID
	m.refresh[next.TokenHash] = &memoryRefreshToken{RefreshToken: *next}
	return old.UserID, nil
}

func (m *memoryUserRepo) RevokeRefreshFamily(ctx context.Context, tokenHash string) error {
	if rt, ok := m.refresh[tokenHash]; ok {
		for _, other := range m.refresh {
			if other.FamilyID == rt.FamilyID {
				other.revoked = true
			}
		}
	}
	return nil
}

const testClientID = "test-client-id.apps.googleusercontent.com"

// fakeGoogle stands in for Google's tokeninfo endpoint: the ID token "valid:<email>[|<sub>]" is a
// verified token for <email> (sub defaults to "sub-<email>"); anything else is rejected the way Google rejects bad tokens (HTTP 400).
func fakeGoogle(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("id_token")
		if !strings.HasPrefix(token, "valid:") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		email, sub, _ := strings.Cut(strings.TrimPrefix(token, "valid:"), "|")
		if sub == "" {
			sub = "sub-" + strings.ToLower(email)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"aud": testClientID, "iss": "https://accounts.google.com", "sub": sub,
			"email": email, "email_verified": "true", "name": "Test " + email,
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newTestService(t *testing.T, repo *memoryUserRepo) (*AuthService, *JWTManager) {
	t.Helper()
	jwtMgr := NewJWTManager("secret-key-test-very-long-32-bytes!!", 15*time.Minute)
	svc := NewAuthService(repo, jwtMgr, testClientID)
	svc.SetGoogleTokenInfoURL(fakeGoogle(t).URL)
	return svc, jwtMgr
}

func TestAuthService_GoogleLogin(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, jwtMgr := newTestService(t, repo)

	sess, err := svc.GoogleLogin(context.Background(), "valid:Tien.Dang@dealhunter.vn", uuid.Nil)
	if err != nil {
		t.Fatalf("GoogleLogin failed: %v", err)
	}
	if sess.AccessToken == "" || sess.RefreshToken == "" {
		t.Fatal("expected access and refresh tokens")
	}
	if sess.User.Email == nil || *sess.User.Email != "tien.dang@dealhunter.vn" {
		t.Errorf("expected lower-cased email, got %v", sess.User.Email)
	}
	if sess.User.AuthProvider != "google" {
		t.Errorf("expected auth_provider 'google', got '%s'", sess.User.AuthProvider)
	}
	claims, err := jwtMgr.ValidateToken(sess.AccessToken)
	if err != nil || claims.UserID != sess.User.ID || claims.Role != RoleUser {
		t.Fatalf("unexpected claims %+v err=%v", claims, err)
	}

	// Logging in again returns the same account
	again, err := svc.GoogleLogin(context.Background(), "valid:tien.dang@dealhunter.vn", uuid.Nil)
	if err != nil || again.User.ID != sess.User.ID {
		t.Fatalf("expected same account on second login, got %v err=%v", again, err)
	}
}

// SEC-01: there is no mock-token bypass; unverifiable tokens are rejected
func TestAuthService_GoogleLogin_RejectsMockTokens(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(t, repo)

	for _, token := range []string{"mock-google-victim@gmail.com", "demo-victim@gmail.com", "garbage"} {
		if _, err := svc.GoogleLogin(context.Background(), token, uuid.Nil); !errors.Is(err, ErrInvalidGoogleToken) {
			t.Fatalf("token %q: expected ErrInvalidGoogleToken, got %v", token, err)
		}
	}
	if len(repo.users) != 0 {
		t.Fatalf("expected no users created, got %d", len(repo.users))
	}
}

// SEC-03: audience, issuer and email_verified are all enforced
func TestAuthService_GoogleLogin_VerifiesClaims(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{"valid", `{"aud":"` + testClientID + `","iss":"https://accounts.google.com","sub":"1","email":"a@gmail.com","email_verified":"true","name":"A"}`, false},
		{"missing sub", `{"aud":"` + testClientID + `","iss":"https://accounts.google.com","email":"a@gmail.com","email_verified":"true"}`, true},
		{"other app audience", `{"aud":"evil-app.apps.googleusercontent.com","iss":"https://accounts.google.com","email":"a@gmail.com","email_verified":"true"}`, true},
		{"wrong issuer", `{"aud":"` + testClientID + `","iss":"https://evil.example","email":"a@gmail.com","email_verified":"true"}`, true},
		{"unverified email", `{"aud":"` + testClientID + `","iss":"accounts.google.com","email":"a@gmail.com","email_verified":"false"}`, true},
		{"missing email", `{"aud":"` + testClientID + `","iss":"accounts.google.com","email_verified":"true"}`, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newMemoryUserRepo()
			svc, _ := newTestService(t, repo)
			google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer google.Close()
			svc.SetGoogleTokenInfoURL(google.URL)

			_, err := svc.GoogleLogin(context.Background(), "real-looking-id-token", uuid.Nil)
			if tc.wantErr && !errors.Is(err, ErrInvalidGoogleToken) {
				t.Fatalf("expected ErrInvalidGoogleToken, got %v", err)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected success, got %v", err)
			}
		})
	}
}

func TestAuthService_GoogleLogin_RequiresClientID(t *testing.T) {
	repo := newMemoryUserRepo()
	jwtMgr := NewJWTManager("secret-key-test-very-long-32-bytes!!", 15*time.Minute)
	svc := NewAuthService(repo, jwtMgr, "")

	if _, err := svc.GoogleLogin(context.Background(), "some-token", uuid.Nil); !errors.Is(err, ErrGoogleNotConfigured) {
		t.Fatalf("expected ErrGoogleNotConfigured, got %v", err)
	}
}

// SEC-06 / GAP-02c: guest data is migrated only from the caller's own guest session
func TestAuthService_GuestSessionMigratesOnLogin(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, jwtMgr := newTestService(t, repo)
	ctx := context.Background()

	guest, err := svc.StartGuestSession(ctx)
	if err != nil {
		t.Fatalf("StartGuestSession failed: %v", err)
	}
	claims, err := jwtMgr.ValidateToken(guest.AccessToken)
	if err != nil || claims.Role != RoleGuest {
		t.Fatalf("expected guest access token, got claims=%+v err=%v", claims, err)
	}

	sess, err := svc.GoogleLogin(ctx, "valid:member@gmail.com", guest.User.ID)
	if err != nil {
		t.Fatalf("GoogleLogin failed: %v", err)
	}
	if sess.Migration == nil || sess.Migration.MigratedProducts != 3 {
		t.Fatalf("expected migration result, got %+v", sess.Migration)
	}
	if len(repo.migrated) != 1 || repo.migrated[0] != guest.User.ID {
		t.Fatalf("expected guest %s migrated, got %v", guest.User.ID, repo.migrated)
	}

	// Logging in again with the same (now migrated) guest identity must not fail or re-migrate
	again, err := svc.GoogleLogin(ctx, "valid:member@gmail.com", guest.User.ID)
	if err != nil || again.Migration != nil {
		t.Fatalf("expected login without migration, got sess=%+v err=%v", again, err)
	}
}

func TestAuthService_RefreshRotationAndReuseDetection(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(t, repo)
	ctx := context.Background()

	sess, err := svc.StartGuestSession(ctx)
	if err != nil {
		t.Fatalf("StartGuestSession failed: %v", err)
	}

	rotated, err := svc.Refresh(ctx, sess.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}
	if rotated.RefreshToken == sess.RefreshToken || rotated.User.ID != sess.User.ID {
		t.Fatalf("expected rotated token for same user")
	}

	// Rotation is strict: replaying the old token revokes the whole family
	if _, err := svc.Refresh(ctx, sess.RefreshToken); !errors.Is(err, ErrRefreshTokenReused) {
		t.Fatalf("expected ErrRefreshTokenReused, got %v", err)
	}
	if _, err := svc.Refresh(ctx, rotated.RefreshToken); err == nil {
		t.Fatal("expected rotated token to be revoked after reuse detection")
	}
}

func TestAuthService_Logout(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(t, repo)
	ctx := context.Background()

	sess, _ := svc.StartGuestSession(ctx)
	if err := svc.Logout(ctx, sess.RefreshToken); err != nil {
		t.Fatalf("Logout failed: %v", err)
	}
	if _, err := svc.Refresh(ctx, sess.RefreshToken); err == nil {
		t.Fatal("expected refresh to fail after logout")
	}
}

func TestAuthService_MigrateGuestData(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(t, repo)

	ctx := context.Background()
	user := &User{ID: uuid.New(), AuthProvider: "google"}
	_ = repo.UpsertUser(ctx, user)

	guestID := uuid.New()
	res, err := svc.MigrateGuestData(ctx, guestID, user.ID)
	if err != nil {
		t.Fatalf("MigrateGuestData failed: %v", err)
	}

	if res.MigratedProducts != 3 {
		t.Errorf("expected 3 migrated products, got %d", res.MigratedProducts)
	}
}

// A reassigned email (different Google sub) must not inherit the existing account
func TestAuthService_GoogleLogin_DifferentSubSameEmailRejected(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(t, repo)
	ctx := context.Background()

	first, err := svc.GoogleLogin(ctx, "valid:owner@company.vn|sub-original", uuid.Nil)
	if err != nil {
		t.Fatalf("first login failed: %v", err)
	}
	if _, err := svc.GoogleLogin(ctx, "valid:owner@company.vn|sub-new-person", uuid.Nil); !errors.Is(err, ErrAccountConflict) {
		t.Fatalf("expected ErrAccountConflict, got %v", err)
	}
	again, err := svc.GoogleLogin(ctx, "valid:owner@company.vn|sub-original", uuid.Nil)
	if err != nil || again.User.ID != first.User.ID {
		t.Fatalf("expected original owner to keep the account, got %v err=%v", again, err)
	}
}

// Logout revokes the whole login family, including a token a concurrent refresh just issued
func TestAuthService_LogoutRevokesFamily(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(t, repo)
	ctx := context.Background()

	sess, _ := svc.GoogleLogin(ctx, "valid:family@gmail.com", uuid.Nil)
	other, _ := svc.GoogleLogin(ctx, "valid:family@gmail.com", uuid.Nil) // second device, own family
	rotated, err := svc.Refresh(ctx, sess.RefreshToken)
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}

	if err := svc.Logout(ctx, sess.RefreshToken); err != nil {
		t.Fatalf("logout failed: %v", err)
	}
	if _, err := svc.Refresh(ctx, rotated.RefreshToken); err == nil {
		t.Fatal("expected rotated token of the same login to be revoked")
	}
	if _, err := svc.Refresh(ctx, other.RefreshToken); err != nil {
		t.Fatalf("expected the other device to stay signed in, got %v", err)
	}
}
