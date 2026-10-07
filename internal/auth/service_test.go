package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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
	revoked   bool
	revokedAt time.Time
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
	inGrace := old.revoked && time.Since(old.revokedAt) < RefreshReuseGrace
	if old.revoked && !inGrace {
		for _, rt := range m.refresh {
			if rt.UserID == old.UserID {
				rt.revoked = true
			}
		}
		return uuid.Nil, ErrRefreshTokenReused
	}
	if time.Now().After(old.ExpiresAt) {
		return uuid.Nil, ErrInvalidRefreshToken
	}
	if !old.revoked {
		old.revoked, old.revokedAt = true, time.Now()
	}
	next.UserID = old.UserID
	m.refresh[next.TokenHash] = &memoryRefreshToken{RefreshToken: *next}
	return old.UserID, nil
}

func (m *memoryUserRepo) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	if rt, ok := m.refresh[tokenHash]; ok {
		rt.revoked = true
	}
	return nil
}

func newTestService(repo *memoryUserRepo, devLogin bool) (*AuthService, *JWTManager) {
	jwtMgr := NewJWTManager("secret-key-test-very-long-32-bytes!!", 15*time.Minute)
	svc := NewAuthService(repo, jwtMgr, "test-client-id.apps.googleusercontent.com")
	svc.SetDevLoginEnabled(devLogin)
	return svc, jwtMgr
}

func TestAuthService_DemoLogin(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, jwtMgr := newTestService(repo, true)

	ctx := context.Background()
	sess, err := svc.DemoLogin(ctx, DemoLoginRequest{
		Email: "tester@dealhunter.vn",
		Name:  "Tester",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("DemoLogin failed: %v", err)
	}

	if sess.AccessToken == "" || sess.RefreshToken == "" {
		t.Fatal("expected access and refresh tokens")
	}
	if sess.User.Email == nil || *sess.User.Email != "tester@dealhunter.vn" {
		t.Errorf("unexpected email")
	}
	if sess.User.AuthProvider != "demo" {
		t.Errorf("expected auth_provider 'demo', got '%s'", sess.User.AuthProvider)
	}

	claims, err := jwtMgr.ValidateToken(sess.AccessToken)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims.UserID != sess.User.ID || claims.Role != RoleUser {
		t.Errorf("unexpected claims: %+v", claims)
	}
}

// SEC-02: demo login is unavailable outside dev environments
func TestAuthService_DemoLogin_DisabledByDefault(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(repo, false)

	_, err := svc.DemoLogin(context.Background(), DemoLoginRequest{Email: "x@dealhunter.vn"}, uuid.Nil)
	if !errors.Is(err, ErrDevLoginDisabled) {
		t.Fatalf("expected ErrDevLoginDisabled, got %v", err)
	}
}

// SEC-02: demo login never hands out an account registered through Google
func TestAuthService_DemoLogin_CannotTakeOverRegisteredAccount(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(repo, true)

	email := "victim@gmail.com"
	_ = repo.UpsertUser(context.Background(), &User{ID: uuid.New(), Email: &email, AuthProvider: "google"})

	_, err := svc.DemoLogin(context.Background(), DemoLoginRequest{Email: email}, uuid.Nil)
	if !errors.Is(err, ErrEmailRegistered) {
		t.Fatalf("expected ErrEmailRegistered, got %v", err)
	}
}

func TestAuthService_GoogleLogin_Mock(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(repo, true)

	sess, err := svc.GoogleLogin(context.Background(), "mock-google-tien.dang@dealhunter.vn", uuid.Nil)
	if err != nil {
		t.Fatalf("GoogleLogin mock failed: %v", err)
	}

	if sess.User.Email == nil || *sess.User.Email != "tien.dang@dealhunter.vn" {
		t.Errorf("unexpected email")
	}
	if sess.User.AuthProvider != "google" {
		t.Errorf("expected auth_provider 'google', got '%s'", sess.User.AuthProvider)
	}
}

// SEC-01: mock tokens are not accepted when dev login is disabled
func TestAuthService_GoogleLogin_MockRejectedInProduction(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(repo, false)

	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer google.Close()
	svc.SetGoogleTokenInfoURL(google.URL)

	if _, err := svc.GoogleLogin(context.Background(), "mock-google-victim@gmail.com", uuid.Nil); !errors.Is(err, ErrInvalidGoogleToken) {
		t.Fatalf("expected ErrInvalidGoogleToken, got %v", err)
	}
}

// SEC-03: audience, issuer and email_verified are all enforced
func TestAuthService_GoogleLogin_VerifiesClaims(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{"valid", `{"aud":"test-client-id.apps.googleusercontent.com","iss":"https://accounts.google.com","email":"a@gmail.com","email_verified":"true","name":"A"}`, false},
		{"other app audience", `{"aud":"evil-app.apps.googleusercontent.com","iss":"https://accounts.google.com","email":"a@gmail.com","email_verified":"true"}`, true},
		{"wrong issuer", `{"aud":"test-client-id.apps.googleusercontent.com","iss":"https://evil.example","email":"a@gmail.com","email_verified":"true"}`, true},
		{"unverified email", `{"aud":"test-client-id.apps.googleusercontent.com","iss":"accounts.google.com","email":"a@gmail.com","email_verified":"false"}`, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := newMemoryUserRepo()
			svc, _ := newTestService(repo, false)
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
	svc, jwtMgr := newTestService(repo, true)
	ctx := context.Background()

	guest, err := svc.StartGuestSession(ctx)
	if err != nil {
		t.Fatalf("StartGuestSession failed: %v", err)
	}
	claims, err := jwtMgr.ValidateToken(guest.AccessToken)
	if err != nil || claims.Role != RoleGuest {
		t.Fatalf("expected guest access token, got claims=%+v err=%v", claims, err)
	}

	sess, err := svc.GoogleLogin(ctx, "mock-google-member@gmail.com", guest.User.ID)
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
	again, err := svc.GoogleLogin(ctx, "mock-google-member@gmail.com", guest.User.ID)
	if err != nil || again.Migration != nil {
		t.Fatalf("expected login without migration, got sess=%+v err=%v", again, err)
	}
}

func TestAuthService_RefreshRotationAndReuseDetection(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(repo, true)
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

	// A concurrent refresh (second tab) within the grace window still succeeds
	if _, err := svc.Refresh(ctx, sess.RefreshToken); err != nil {
		t.Fatalf("expected concurrent refresh within grace window to succeed, got %v", err)
	}

	// Replaying the old token after the grace window revokes the whole family
	for _, rt := range repo.refresh {
		if rt.TokenHash == HashRefreshToken(sess.RefreshToken) {
			rt.revokedAt = time.Now().Add(-2 * RefreshReuseGrace)
		}
	}
	if _, err := svc.Refresh(ctx, sess.RefreshToken); !errors.Is(err, ErrRefreshTokenReused) {
		t.Fatalf("expected ErrRefreshTokenReused, got %v", err)
	}
	if _, err := svc.Refresh(ctx, rotated.RefreshToken); err == nil {
		t.Fatal("expected rotated token to be revoked after reuse detection")
	}
}

func TestAuthService_Logout(t *testing.T) {
	repo := newMemoryUserRepo()
	svc, _ := newTestService(repo, true)
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
	svc, _ := newTestService(repo, false)

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
