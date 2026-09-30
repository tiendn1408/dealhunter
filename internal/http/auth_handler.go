package router

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/auth"
)

func (h *Handler) DemoLogin(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	var req auth.DemoLoginRequest
	// Body is optional for demo-login
	_ = json.NewDecoder(r.Body).Decode(&req)

	resp, err := h.authService.DemoLogin(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

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

	resp, err := h.authService.GoogleLogin(r.Context(), req.IDToken)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handler) MigrateGuestData(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	targetUserID := h.getUserID(r)
	if targetUserID == uuid.Nil {
		http.Error(w, "unauthorized: valid session required", http.StatusUnauthorized)
		return
	}

	var req auth.MigrateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.GuestUserID == uuid.Nil {
		http.Error(w, "invalid request: valid guest_user_id is required", http.StatusBadRequest)
		return
	}

	result, err := h.authService.MigrateGuestData(r.Context(), req.GuestUserID, targetUserID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(result)
}

func (h *Handler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	if h.authService == nil {
		http.Error(w, "auth service not initialized", http.StatusInternalServerError)
		return
	}

	userID := h.getUserID(r)
	user, err := h.authService.GetProfile(r.Context(), userID)
	if err != nil {
		// Return guest fallback profile if user record doesn't exist in DB yet
		guestUser := &auth.User{
			ID:           userID,
			AuthProvider: "guest",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(guestUser)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(user)
}
