package auth

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

type memoryUserRepo struct {
	users map[uuid.UUID]*User
	byEmail map[string]*User
}

func newMemoryUserRepo() *memoryUserRepo {
	return &memoryUserRepo{
		users: make(map[uuid.UUID]*User),
		byEmail: make(map[string]*User),
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
	return &MigrationResult{
		MigratedProducts: 3,
		MigratedAlerts: 1,
		MigratedNotifications: 2,
	}, nil
}

func TestAuthService_DemoLogin(t *testing.T) {
	repo := newMemoryUserRepo()
	jwtMgr := NewJWTManager("secret-key-test-very-long-32-bytes!!", 1*time.Hour)
	svc := NewAuthService(repo, jwtMgr, "")

	ctx := context.Background()
	resp, err := svc.DemoLogin(ctx, DemoLoginRequest{
		Email: "tester@dealhunter.vn",
		Name: "Tester",
	})
	if err != nil {
		t.Fatalf("DemoLogin failed: %v", err)
	}

	if resp.Token == "" {
		t.Fatal("expected non-empty token")
	}
	if resp.User.Email == nil || *resp.User.Email != "tester@dealhunter.vn" {
		t.Errorf("unexpected email")
	}
	if resp.User.AuthProvider != "demo" {
		t.Errorf("expected auth_provider 'demo', got '%s'", resp.User.AuthProvider)
	}

	// Verify token
	claims, err := jwtMgr.ValidateToken(resp.Token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims.UserID != resp.User.ID {
		t.Errorf("claims user ID mismatch")
	}
}

func TestAuthService_GoogleLogin_Mock(t *testing.T) {
	repo := newMemoryUserRepo()
	jwtMgr := NewJWTManager("secret-key-test-very-long-32-bytes!!", 1*time.Hour)
	svc := NewAuthService(repo, jwtMgr, "")

	ctx := context.Background()
	resp, err := svc.GoogleLogin(ctx, "mock-google-tien.dang@dealhunter.vn")
	if err != nil {
		t.Fatalf("GoogleLogin mock failed: %v", err)
	}

	if resp.User.Email == nil || *resp.User.Email != "tien.dang@dealhunter.vn" {
		t.Errorf("unexpected email")
	}
	if resp.User.AuthProvider != "google" {
		t.Errorf("expected auth_provider 'google', got '%s'", resp.User.AuthProvider)
	}
}

func TestAuthService_MigrateGuestData(t *testing.T) {
	repo := newMemoryUserRepo()
	jwtMgr := NewJWTManager("secret-key-test-very-long-32-bytes!!", 1*time.Hour)
	svc := NewAuthService(repo, jwtMgr, "")

	ctx := context.Background()
	user := &User{ID: uuid.New()}
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
