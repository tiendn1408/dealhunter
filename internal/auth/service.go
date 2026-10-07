package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrDevLoginDisabled    = errors.New("demo and mock logins are disabled in this environment")
	ErrEmailRegistered     = errors.New("email belongs to a registered account")
	ErrGoogleNotConfigured = errors.New("google login is not configured")
	ErrInvalidGoogleToken  = errors.New("invalid google id_token")
)

const (
	defaultGoogleTokenInfoURL = "https://oauth2.googleapis.com/tokeninfo"
	defaultRefreshTokenTTL    = 30 * 24 * time.Hour
)

var googleIssuers = map[string]bool{
	"accounts.google.com":         true,
	"https://accounts.google.com": true,
}

type googleTokenInfo struct {
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Sub           string `json:"sub"`
}

type AuthService struct {
	repo               UserRepository
	jwtManager         *JWTManager
	googleClientID     string
	googleTokenInfoURL string
	devLoginEnabled    bool
	refreshTokenTTL    time.Duration
	httpClient         *http.Client
}

// NewAuthService creates the auth service. Demo and mock-Google logins stay disabled
// until SetDevLoginEnabled(true) is called (never in production).
func NewAuthService(repo UserRepository, jwtManager *JWTManager, googleClientID string) *AuthService {
	return &AuthService{
		repo:               repo,
		jwtManager:         jwtManager,
		googleClientID:     googleClientID,
		googleTokenInfoURL: defaultGoogleTokenInfoURL,
		refreshTokenTTL:    defaultRefreshTokenTTL,
		httpClient:         &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *AuthService) SetDevLoginEnabled(enabled bool) {
	s.devLoginEnabled = enabled
}

func (s *AuthService) SetRefreshTokenTTL(ttl time.Duration) {
	if ttl > 0 {
		s.refreshTokenTTL = ttl
	}
}

func (s *AuthService) SetGoogleTokenInfoURL(u string) {
	s.googleTokenInfoURL = u
}

// StartGuestSession creates an anonymous user and returns its session.
func (s *AuthService) StartGuestSession(ctx context.Context) (*Session, error) {
	user := &User{
		ID:           uuid.New(),
		AuthProvider: "guest",
	}
	if err := s.repo.UpsertUser(ctx, user); err != nil {
		return nil, fmt.Errorf("create guest user: %w", err)
	}
	return s.issueSession(ctx, user, nil)
}

// DemoLogin signs into (or creates) a demo account. Dev environments only, and it never
// returns an account that was registered through a real provider.
func (s *AuthService) DemoLogin(ctx context.Context, req DemoLoginRequest, guestID uuid.UUID) (*Session, error) {
	if !s.devLoginEnabled {
		return nil, ErrDevLoginDisabled
	}

	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		email = "demo@dealhunter.vn"
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Demo DealHunter"
	}

	avatar := "https://api.dicebear.com/7.x/bottts/svg?seed=" + email

	user, err := s.repo.GetByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, ErrUserNotFound) {
			return nil, fmt.Errorf("lookup demo user: %w", err)
		}
		user = &User{
			ID:           uuid.New(),
			Email:        &email,
			Name:         &name,
			AvatarURL:    &avatar,
			AuthProvider: "demo",
		}
		if err := s.repo.UpsertUser(ctx, user); err != nil {
			return nil, fmt.Errorf("create demo user: %w", err)
		}
	} else if user.AuthProvider != "demo" {
		return nil, ErrEmailRegistered
	}

	return s.loginAs(ctx, user, guestID)
}

// GoogleLogin verifies a Google ID token and signs the user in, migrating the caller's
// guest data when guestID is set (taken from the caller's own guest access token).
func (s *AuthService) GoogleLogin(ctx context.Context, idToken string, guestID uuid.UUID) (*Session, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return nil, ErrInvalidGoogleToken
	}

	var email, name, picture string

	if s.devLoginEnabled && strings.HasPrefix(idToken, "mock-google-") {
		email = strings.ToLower(strings.TrimPrefix(idToken, "mock-google-"))
		if !strings.Contains(email, "@") {
			email = email + "@gmail.com"
		}
		name = "Google User " + strings.Split(email, "@")[0]
		picture = "https://api.dicebear.com/7.x/bottts/svg?seed=" + email
	} else {
		info, err := s.verifyGoogleIDToken(ctx, idToken)
		if err != nil {
			return nil, err
		}
		email = strings.ToLower(info.Email)
		name = info.Name
		picture = info.Picture
	}

	user, err := s.repo.GetByEmail(ctx, email)
	if err != nil {
		if !errors.Is(err, ErrUserNotFound) {
			return nil, fmt.Errorf("lookup user by email: %w", err)
		}
		user = &User{
			ID:    uuid.New(),
			Email: &email,
		}
	}
	user.Name = &name
	user.AvatarURL = &picture
	user.AuthProvider = "google"

	if err := s.repo.UpsertUser(ctx, user); err != nil {
		return nil, fmt.Errorf("upsert google user: %w", err)
	}

	return s.loginAs(ctx, user, guestID)
}

func (s *AuthService) verifyGoogleIDToken(ctx context.Context, idToken string) (*googleTokenInfo, error) {
	if s.googleClientID == "" {
		return nil, ErrGoogleNotConfigured
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.googleTokenInfoURL+"?id_token="+url.QueryEscape(idToken), nil)
	if err != nil {
		return nil, fmt.Errorf("create google tokeninfo req: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call google tokeninfo: %w", err)
	}
	defer resp.Body.Close()

	// tokeninfo validates signature and expiry; non-200 means the token is not valid
	if resp.StatusCode != http.StatusOK {
		return nil, ErrInvalidGoogleToken
	}

	var info googleTokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decode google tokeninfo: %w", err)
	}

	if info.Aud != s.googleClientID || !googleIssuers[info.Iss] ||
		info.EmailVerified != "true" || info.Email == "" {
		return nil, ErrInvalidGoogleToken
	}
	return &info, nil
}

// Refresh rotates a refresh token and issues a new access token.
func (s *AuthService) Refresh(ctx context.Context, rawRefreshToken string) (*Session, error) {
	if rawRefreshToken == "" {
		return nil, ErrInvalidRefreshToken
	}

	raw, next, err := newRefreshToken(uuid.Nil, s.refreshTokenTTL)
	if err != nil {
		return nil, err
	}

	userID, err := s.repo.RotateRefreshToken(ctx, HashRefreshToken(rawRefreshToken), next)
	if err != nil {
		return nil, err
	}

	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("load session user: %w", err)
	}
	if user.AuthProvider == "migrated" {
		return nil, ErrInvalidRefreshToken
	}

	return s.buildSession(user, raw, next.ExpiresAt, nil)
}

func (s *AuthService) Logout(ctx context.Context, rawRefreshToken string) error {
	if rawRefreshToken == "" {
		return nil
	}
	return s.repo.RevokeRefreshToken(ctx, HashRefreshToken(rawRefreshToken))
}

func (s *AuthService) loginAs(ctx context.Context, user *User, guestID uuid.UUID) (*Session, error) {
	var migration *MigrationResult
	if guestID != uuid.Nil && guestID != user.ID {
		result, err := s.MigrateGuestData(ctx, guestID, user.ID)
		switch {
		case err == nil:
			migration = result
		case errors.Is(err, ErrAlreadyMigrated), errors.Is(err, ErrInvalidGuestAccount):
			// Stale or non-guest token: log in without migrating
		default:
			return nil, fmt.Errorf("migrate guest data: %w", err)
		}
	}
	return s.issueSession(ctx, user, migration)
}

func (s *AuthService) issueSession(ctx context.Context, user *User, migration *MigrationResult) (*Session, error) {
	raw, rt, err := newRefreshToken(user.ID, s.refreshTokenTTL)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateRefreshToken(ctx, rt); err != nil {
		return nil, err
	}
	return s.buildSession(user, raw, rt.ExpiresAt, migration)
}

func (s *AuthService) buildSession(user *User, rawRefresh string, refreshExpiresAt time.Time, migration *MigrationResult) (*Session, error) {
	access, err := s.jwtManager.GenerateAccessToken(user)
	if err != nil {
		return nil, fmt.Errorf("generate jwt: %w", err)
	}
	return &Session{
		AccessToken:      access,
		ExpiresIn:        int64(s.jwtManager.TokenDuration().Seconds()),
		User:             user,
		Migration:        migration,
		RefreshToken:     rawRefresh,
		RefreshExpiresAt: refreshExpiresAt,
	}, nil
}

func (s *AuthService) MigrateGuestData(ctx context.Context, guestID, targetUserID uuid.UUID) (*MigrationResult, error) {
	if guestID == uuid.Nil || targetUserID == uuid.Nil {
		return nil, errors.New("invalid guest_id or target_user_id")
	}
	if guestID == targetUserID {
		return nil, ErrCannotMigrateSelf
	}

	// Ensure target user exists
	if _, err := s.repo.GetByID(ctx, targetUserID); err != nil {
		return nil, fmt.Errorf("target user not found: %w", err)
	}

	return s.repo.MigrateGuestData(ctx, guestID, targetUserID)
}

func (s *AuthService) GetProfile(ctx context.Context, userID uuid.UUID) (*User, error) {
	return s.repo.GetByID(ctx, userID)
}
