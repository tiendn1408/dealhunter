package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestJWTManager_GenerateAndValidate(t *testing.T) {
	manager := NewJWTManager("test-secret-key-at-least-32-chars-long!", 1*time.Hour)

	userUUID := uuid.New()
	email := "test@dealhunter.vn"
	name := "Test User"
	user := &User{
		ID:           userUUID,
		Email:        &email,
		Name:         &name,
		AuthProvider: "google",
	}

	token, err := manager.GenerateAccessToken(user)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	if token == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := manager.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}

	if claims.UserID != userUUID {
		t.Errorf("expected UserID %s, got %s", userUUID, claims.UserID)
	}
	if claims.Email != email {
		t.Errorf("expected email %s, got %s", email, claims.Email)
	}
}

func TestJWTManager_ExpiredToken(t *testing.T) {
	manager := NewJWTManager("test-secret-key-at-least-32-chars-long!", -1*time.Second)

	userUUID := uuid.New()
	email := "expired@dealhunter.vn"
	user := &User{
		ID:           userUUID,
		Email:        &email,
		AuthProvider: "google",
	}

	token, err := manager.GenerateAccessToken(user)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, err = manager.ValidateToken(token)
	if err != ErrExpiredToken {
		t.Errorf("expected ErrExpiredToken, got %v", err)
	}
}

func TestJWTManager_InvalidSecret(t *testing.T) {
	m1 := NewJWTManager("secret-key-1-dealhunter-very-long!", 1*time.Hour)
	m2 := NewJWTManager("secret-key-2-dealhunter-different!", 1*time.Hour)

	user := &User{ID: uuid.New()}
	token, _ := m1.GenerateAccessToken(user)

	_, err := m2.ValidateToken(token)
	if err != ErrInvalidToken {
		t.Errorf("expected ErrInvalidToken, got %v", err)
	}
}

func TestJWTManager_RoleClaim(t *testing.T) {
	manager := NewJWTManager("test-secret-key-at-least-32-chars-long!", 1*time.Hour)

	guestToken, _ := manager.GenerateAccessToken(&User{ID: uuid.New(), AuthProvider: "guest"})
	claims, err := manager.ValidateToken(guestToken)
	if err != nil || claims.Role != RoleGuest {
		t.Fatalf("expected guest role, got claims=%+v err=%v", claims, err)
	}

	userToken, _ := manager.GenerateAccessToken(&User{ID: uuid.New(), AuthProvider: "google"})
	claims, err = manager.ValidateToken(userToken)
	if err != nil || claims.Role != RoleUser {
		t.Fatalf("expected user role, got claims=%+v err=%v", claims, err)
	}
}

func TestJWTManager_RejectsTokenWithoutRoleOrIssuer(t *testing.T) {
	secret := "test-secret-key-at-least-32-chars-long!"
	manager := NewJWTManager(secret, 1*time.Hour)

	forge := func(claims *UserClaims) string {
		tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	exp := jwt.NewNumericDate(time.Now().Add(time.Hour))

	noRole := forge(&UserClaims{UserID: uuid.New(), RegisteredClaims: jwt.RegisteredClaims{Issuer: "dealhunter", ExpiresAt: exp}})
	if _, err := manager.ValidateToken(noRole); err != ErrInvalidToken {
		t.Errorf("token without role: expected ErrInvalidToken, got %v", err)
	}

	wrongIssuer := forge(&UserClaims{UserID: uuid.New(), Role: RoleUser, RegisteredClaims: jwt.RegisteredClaims{Issuer: "evil", ExpiresAt: exp}})
	if _, err := manager.ValidateToken(wrongIssuer); err != ErrInvalidToken {
		t.Errorf("token with wrong issuer: expected ErrInvalidToken, got %v", err)
	}

	noExpiry := forge(&UserClaims{UserID: uuid.New(), Role: RoleUser, RegisteredClaims: jwt.RegisteredClaims{Issuer: "dealhunter"}})
	if _, err := manager.ValidateToken(noExpiry); err != ErrInvalidToken {
		t.Errorf("token without exp: expected ErrInvalidToken, got %v", err)
	}
}

// A migrated guest must never get a session, and nothing but a Google account is a member
func TestGenerateAccessToken_OnlyLiveAccounts(t *testing.T) {
	m := NewJWTManager("jwt-test-secret-key-at-least-32-bytes-long", time.Minute)
	for _, provider := range []string{"migrated", "", "demo"} {
		if _, err := m.GenerateAccessToken(&User{ID: uuid.New(), AuthProvider: provider}); err == nil {
			t.Errorf("provider %q: expected no token", provider)
		}
	}
	if RoleFor(&User{AuthProvider: "migrated"}) != RoleGuest {
		t.Error("migrated account must not map to the member role")
	}
}

// Only HS256 is accepted, even with the right secret
func TestValidateToken_RejectsOtherHMAC(t *testing.T) {
	secret := "jwt-test-secret-key-at-least-32-bytes-long"
	m := NewJWTManager(secret, time.Minute)
	claims := &UserClaims{UserID: uuid.New(), Role: RoleUser, RegisteredClaims: jwt.RegisteredClaims{
		Issuer: "dealhunter", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS512, claims).SignedString([]byte(secret))
	if _, err := m.ValidateToken(tok); err == nil {
		t.Fatal("expected HS512 token to be rejected")
	}
}
