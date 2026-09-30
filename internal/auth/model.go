package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type User struct {
	ID           uuid.UUID  `json:"id"`
	Email        *string    `json:"email,omitempty"`
	Name         *string    `json:"name,omitempty"`
	AvatarURL    *string    `json:"avatar_url,omitempty"`
	AuthProvider string     `json:"auth_provider"`
	ZaloID       *string    `json:"zalo_id,omitempty"`
	Phone        *string    `json:"phone,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type UserClaims struct {
	UserID uuid.UUID `json:"user_id"`
	Email  string    `json:"email,omitempty"`
	jwt.RegisteredClaims
}

type LoginResponse struct {
	Token string `json:"token"`
	User  *User  `json:"user"`
}

type DemoLoginRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

type MigrateRequest struct {
	GuestUserID uuid.UUID `json:"guest_user_id"`
}

type MigrationResult struct {
	MigratedProducts      int64 `json:"migrated_products"`
	MigratedAlerts        int64 `json:"migrated_alerts"`
	MigratedNotifications int64 `json:"migrated_notifications"`
}
