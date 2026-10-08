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
	refreshTokenTTL    time.Duration
	httpClient         *http.Client
}

// NewAuthService creates the auth service. Google is the only login method; there are no
// demo or mock logins.
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

func (s *AuthService) SetRefreshTokenTTL(ttl time.Duration) {
	if ttl > 0 {
		s.refreshTokenTTL = ttl
	}
}

// SetGoogleTokenInfoURL overrides Google's tokeninfo endpoint (tests only).
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

// GoogleLogin verifies a Google ID token and signs the user in, migrating the caller's
// guest data when guestID is set (taken from the caller's own guest access token).
func (s *AuthService) GoogleLogin(ctx context.Context, idToken string, guestID uuid.UUID) (*Session, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return nil, ErrInvalidGoogleToken
	}

	info, err := s.verifyGoogleIDToken(ctx, idToken)
	if err != nil {
		return nil, err
	}

	user, err := s.repo.UpsertGoogleUser(ctx, GoogleIdentity{
		Sub:     info.Sub,
		Email:   strings.ToLower(info.Email),
		Name:    info.Name,
		Picture: info.Picture,
	})
	if err != nil {
		if errors.Is(err, ErrAccountConflict) {
			return nil, err
		}
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
		info.EmailVerified != "true" || info.Email == "" || info.Sub == "" {
		return nil, ErrInvalidGoogleToken
	}
	return &info, nil
}

// Refresh rotates a refresh token and issues a new access token.
func (s *AuthService) Refresh(ctx context.Context, rawRefreshToken string) (*Session, error) {
	if rawRefreshToken == "" {
		return nil, ErrInvalidRefreshToken
	}

	raw, next, err := newRefreshToken(uuid.Nil, uuid.Nil, s.refreshTokenTTL)
	if err != nil {
		return nil, err
	}

	userID, err := s.repo.RotateRefreshToken(ctx, HashRefreshToken(rawRefreshToken), next)
	if err != nil {
		return nil, err
	}

	user, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		// The old token is already revoked; the client must still receive the new one, or its retry
		// would look like token reuse and end every session.
		return nil, &RotatedError{Err: fmt.Errorf("load session user: %w", err), RefreshToken: raw, ExpiresAt: next.ExpiresAt}
	}
	if user.AuthProvider == "migrated" {
		return nil, ErrInvalidRefreshToken
	}

	sess, err := s.buildSession(user, raw, next.ExpiresAt, nil)
	if err != nil {
		return nil, &RotatedError{Err: err, RefreshToken: raw, ExpiresAt: next.ExpiresAt}
	}
	return sess, nil
}

// RotatedError reports a refresh that failed after the refresh token was rotated.
// It carries the new refresh token so the caller can still hand it to the client.
type RotatedError struct {
	Err          error
	RefreshToken string
	ExpiresAt    time.Time
}

func (e *RotatedError) Error() string { return e.Err.Error() }
func (e *RotatedError) Unwrap() error { return e.Err }

// Logout ends the login the refresh token belongs to (every token in its family).
func (s *AuthService) Logout(ctx context.Context, rawRefreshToken string) error {
	if rawRefreshToken == "" {
		return nil
	}
	return s.repo.RevokeRefreshFamily(ctx, HashRefreshToken(rawRefreshToken))
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
	raw, rt, err := newRefreshToken(user.ID, uuid.Nil, s.refreshTokenTTL)
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
