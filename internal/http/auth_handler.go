package router

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/auth"
)

const (
	refreshCookieName = "dh_refresh"
	refreshCookiePath = "/api/v1/auth"
)

// StartGuestSession creates an anonymous account and returns its session.
// POST /api/v1/auth/guest
func (h *Handler) StartGuestSession(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	sess, err := h.authService.StartGuestSession(r.Context())
	if err != nil {
		http.Error(w, "could not start guest session", http.StatusInternalServerError)
		return
	}
	h.writeSession(w, sess)
}

// GoogleLogin verifies a Google ID token. If the request carries a guest access token,
// that guest's data is migrated into the account.
// POST /api/v1/auth/google
func (h *Handler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	var req auth.GoogleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.IDToken == "" {
		http.Error(w, "invalid request: id_token is required", http.StatusBadRequest)
		return
	}

	sess, err := h.authService.GoogleLogin(r.Context(), req.IDToken, h.guestIDFromRequest(r))
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidGoogleToken):
			http.Error(w, "invalid google token", http.StatusUnauthorized)
		case errors.Is(err, auth.ErrGoogleNotConfigured):
			http.Error(w, "google login is not configured", http.StatusServiceUnavailable)
		default:
			http.Error(w, "google login failed", http.StatusInternalServerError)
		}
		return
	}
	h.writeSession(w, sess)
}

// RefreshSession rotates the refresh-token cookie and returns a new access token.
// POST /api/v1/auth/refresh
func (h *Handler) RefreshSession(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	cookie, err := r.Cookie(refreshCookieName)
	if err != nil || cookie.Value == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sess, err := h.authService.Refresh(r.Context(), cookie.Value)
	if err != nil {
		h.clearRefreshCookie(w)
		if errors.Is(err, auth.ErrInvalidRefreshToken) || errors.Is(err, auth.ErrRefreshTokenReused) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		http.Error(w, "refresh failed", http.StatusInternalServerError)
		return
	}
	h.writeSession(w, sess)
}

// Logout revokes the refresh token and clears the cookie.
// POST /api/v1/auth/logout
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	if cookie, err := r.Cookie(refreshCookieName); err == nil {
		if err := h.authService.Logout(r.Context(), cookie.Value); err != nil {
			http.Error(w, "logout failed", http.StatusInternalServerError)
			return
		}
	}
	h.clearRefreshCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	user, err := h.authService.GetProfile(r.Context(), userID)
	if err != nil {
		if errors.Is(err, auth.ErrUserNotFound) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		http.Error(w, "could not load user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(user)
}

// guestIDFromRequest returns the user ID of a valid guest access token on the request, if any.
// Possessing the guest's own token is the proof of ownership required for data migration.
func (h *Handler) guestIDFromRequest(r *http.Request) uuid.UUID {
	claims, err := h.bearerClaims(r)
	if err != nil || claims.Role != auth.RoleGuest {
		return uuid.Nil
	}
	return claims.UserID
}

func (h *Handler) writeSession(w http.ResponseWriter, sess *auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    sess.RefreshToken,
		Path:     refreshCookiePath,
		Expires:  sess.RefreshExpiresAt,
		MaxAge:   int(time.Until(sess.RefreshExpiresAt).Seconds()),
		HttpOnly: true,
		Secure:   h.authCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(sess)
}

func (h *Handler) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     refreshCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.authCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}
