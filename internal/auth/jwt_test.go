package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestJWTManager_GenerateAndValidate(t *testing.T) {
	manager := NewJWTManager("test-secret-key-at-least-32-chars-long!", 1*time.Hour)

	userUUID := uuid.New()
	email := "test@dealhunter.vn"
	name := "Test User"
	user := &User{
		ID:    userUUID,
		Email: &email,
		Name:  &name,
	}

	token, err := manager.GenerateToken(user)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
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
		ID:    userUUID,
		Email: &email,
	}

	token, err := manager.GenerateToken(user)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
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
	token, _ := m1.GenerateToken(user)

	_, err := m2.ValidateToken(token)
	if err != ErrInvalidToken {
		t.Errorf("expected ErrInvalidToken, got %v", err)
	}
}
