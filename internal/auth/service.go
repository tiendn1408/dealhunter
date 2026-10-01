package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type googleTokenInfo struct {
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Sub           string `json:"sub"`
	ErrorDesc     string `json:"error_description"`
}

type AuthService struct {
	repo           UserRepository
	jwtManager     *JWTManager
	googleClientID string
	httpClient     *http.Client
}

func NewAuthService(repo UserRepository, jwtManager *JWTManager, googleClientID string) *AuthService {
	return &AuthService{
		repo:           repo,
		jwtManager:     jwtManager,
		googleClientID: googleClientID,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *AuthService) DemoLogin(ctx context.Context, req DemoLoginRequest) (*LoginResponse, error) {
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
		if errors.Is(err, ErrUserNotFound) {
			user = &User{
				ID:           uuid.New(),
				Email:        &email,
				Name:         &name,
				AvatarURL:    &avatar,
				AuthProvider: "demo",
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
			if err := s.repo.UpsertUser(ctx, user); err != nil {
				return nil, fmt.Errorf("create demo user: %w", err)
			}
		} else {
			return nil, fmt.Errorf("lookup demo user: %w", err)
		}
	}

	token, err := s.jwtManager.GenerateToken(user)
	if err != nil {
		return nil, fmt.Errorf("generate jwt: %w", err)
	}

	return &LoginResponse{
		Token: token,
		User:  user,
	}, nil
}

func (s *AuthService) GoogleLogin(ctx context.Context, idToken string) (*LoginResponse, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return nil, errors.New("missing google id_token")
	}

	var email, name, picture string

	// Support test / dev tokens
	if strings.HasPrefix(idToken, "mock-google-") || strings.HasPrefix(idToken, "demo-") {
		email = strings.TrimPrefix(idToken, "mock-google-")
		if !strings.Contains(email, "@") {
			email = email + "@gmail.com"
		}
		name = "Google User " + strings.Split(email, "@")[0]
		picture = "https://api.dicebear.com/7.x/bottts/svg?seed=" + email
	} else {
		// Verify real Google ID Token via Google's tokeninfo endpoint
		url := "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create google tokeninfo req: %w", err)
		}

		resp, err := s.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("call google tokeninfo: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, errors.New("invalid or expired google token")
		}

		var info googleTokenInfo
		if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
			return nil, fmt.Errorf("decode google tokeninfo: %w", err)
		}

		if info.Email == "" {
			return nil, errors.New("google token contains no email")
		}

		email = strings.ToLower(info.Email)
		name = info.Name
		picture = info.Picture
	}

	user, err := s.repo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			user = &User{
				ID:           uuid.New(),
				Email:        &email,
				Name:         &name,
				AvatarURL:    &picture,
				AuthProvider: "google",
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
		} else {
			return nil, fmt.Errorf("lookup user by email: %w", err)
		}
	} else {
		user.Name = &name
		user.AvatarURL = &picture
		user.AuthProvider = "google"
	}

	if err := s.repo.UpsertUser(ctx, user); err != nil {
		return nil, fmt.Errorf("upsert google user: %w", err)
	}

	token, err := s.jwtManager.GenerateToken(user)
	if err != nil {
		return nil, fmt.Errorf("generate jwt: %w", err)
	}

	return &LoginResponse{
		Token: token,
		User:  user,
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
