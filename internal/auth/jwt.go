package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken = errors.New("invalid or malformed token")
	ErrExpiredToken = errors.New("token has expired")
)

type JWTManager struct {
	secretKey     []byte
	tokenDuration time.Duration
}

func NewJWTManager(secretKey string, tokenDuration time.Duration) *JWTManager {
	if tokenDuration == 0 {
		tokenDuration = 15 * time.Minute // short-lived access token; sessions are extended via refresh tokens
	}
	return &JWTManager{
		secretKey:     []byte(secretKey),
		tokenDuration: tokenDuration,
	}
}

func (m *JWTManager) TokenDuration() time.Duration {
	return m.tokenDuration
}

// RoleFor maps a user's auth provider to the role carried in its access token.
func RoleFor(user *User) string {
	if user.AuthProvider == "" || user.AuthProvider == "guest" {
		return RoleGuest
	}
	return RoleUser
}

func (m *JWTManager) GenerateAccessToken(user *User) (string, error) {
	email := ""
	if user.Email != nil {
		email = *user.Email
	}

	claims := &UserClaims{
		UserID: user.ID,
		Email:  email,
		Role:   RoleFor(user),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "dealhunter",
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.tokenDuration)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secretKey)
	if err != nil {
		return "", fmt.Errorf("sign jwt: %w", err)
	}

	return signed, nil
}

func (m *JWTManager) ValidateToken(tokenStr string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &UserClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secretKey, nil
	}, jwt.WithIssuer("dealhunter"), jwt.WithExpirationRequired())

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*UserClaims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	if claims.UserID == uuid.Nil || (claims.Role != RoleGuest && claims.Role != RoleUser) {
		return nil, ErrInvalidToken
	}

	return claims, nil
}
