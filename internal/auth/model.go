package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type User struct {
	ID           uuid.UUID `json:"id"`
	Email        *string   `json:"email,omitempty"`
	Name         *string   `json:"name,omitempty"`
	AvatarURL    *string   `json:"avatar_url,omitempty"`
	AuthProvider string    `json:"auth_provider"`
	GoogleSub    *string   `json:"-"`
	ZaloID       *string   `json:"zalo_id,omitempty"`
	Phone        *string   `json:"phone,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

const (
	RoleGuest = "guest"
	RoleUser  = "user"
)

type UserClaims struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email,omitempty"`
	Role   string    `json:"role"`
	jwt.RegisteredClaims
}

// Session is the result of any login, guest bootstrap or refresh.
// RefreshToken is delivered to the client only as an HttpOnly cookie.
type Session struct {
	AccessToken      string           `json:"access_token"`
	ExpiresIn        int64            `json:"expires_in"`
	User             *User            `json:"user"`
	Migration        *MigrationResult `json:"migration,omitempty"`
	RefreshToken     string           `json:"-"`
	RefreshExpiresAt time.Time        `json:"-"`
}

type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

type MigrationResult struct {
	MigratedProducts      int64 `json:"migrated_products"`
	MigratedAlerts        int64 `json:"migrated_alerts"`
	MigratedNotifications int64 `json:"migrated_notifications"`
}
