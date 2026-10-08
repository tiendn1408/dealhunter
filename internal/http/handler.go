package router

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/auth"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/domain"
	"github.com/tiendang/deal-hunter/internal/marketplace"
	"github.com/tiendang/deal-hunter/internal/matching"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/internal/pricing"
	"github.com/tiendang/deal-hunter/internal/tracking"
	"github.com/tiendang/deal-hunter/internal/voucher"
	"github.com/tiendang/deal-hunter/pkg/affiliate"
)

type Handler struct {
	trackingService      *tracking.TrackingService
	pricingService       *pricing.PricingService
	alertRepo            alert.Repository
	notifRepo            notification.Repository
	comparisonSvc        *comparison.ComparisonService
	authService          *auth.AuthService
	jwtManager           *auth.JWTManager
	matchingService      *matching.MatchingService
	zaloAppID            string
	zaloWebhookSecret    string
	authCookieSecure     bool
	corsAllowedOrigins   []string
	affiliateTransformer affiliate.LinkTransformer
	voucherRepo          voucher.Repository
	adminEmails          map[string]bool
	guestLimiter         RateLimiter
	logger               *slog.Logger
}

func NewHandler(ts *tracking.TrackingService, ps *pricing.PricingService) *Handler {
	return &Handler{trackingService: ts, pricingService: ps}
}

func (h *Handler) SetAffiliateTransformer(transformer affiliate.LinkTransformer) {
	h.affiliateTransformer = transformer
}

func (h *Handler) SetVoucherRepository(vr voucher.Repository) {
	h.voucherRepo = vr
}

// SetAdminEmails lists the accounts allowed to manage global data such as vouchers.
func (h *Handler) SetAdminEmails(emails []string) {
	h.adminEmails = make(map[string]bool, len(emails))
	for _, e := range emails {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			h.adminEmails[e] = true
		}
	}
}

// SetGuestRateLimiter limits how often one client may create guest accounts.
func (h *Handler) SetGuestRateLimiter(l RateLimiter) {
	h.guestLimiter = l
}

func (h *Handler) SetAlertAndNotificationRepos(ar alert.Repository, nr notification.Repository) {
	h.alertRepo = ar
	h.notifRepo = nr
}

// SetZaloWebhookCredentials configures webhook signature verification
// (Zalo signs with the OA app ID and OA secret key).
func (h *Handler) SetZaloWebhookCredentials(appID, secret string) {
	h.zaloAppID = appID
	h.zaloWebhookSecret = secret
}

// SetAuthCookieSecure marks the refresh-token cookie Secure (HTTPS only).
func (h *Handler) SetAuthCookieSecure(secure bool) {
	h.authCookieSecure = secure
}

// SetCORSAllowedOrigins restricts browser origins. "*" allows any origin (development only).
func (h *Handler) SetCORSAllowedOrigins(origins []string) {
	h.corsAllowedOrigins = origins
}

func (h *Handler) SetComparisonService(svc *comparison.ComparisonService) {
	h.comparisonSvc = svc
}

func (h *Handler) SetAuthService(svc *auth.AuthService, jm *auth.JWTManager) {
	h.authService = svc
	h.jwtManager = jm
}

func (h *Handler) SetMatchingService(svc *matching.MatchingService) {
	h.matchingService = svc
}

var (
	ErrUnauthorized   = errors.New("unauthorized")
	ErrMemberRequired = errors.New("unauthorized: registered account required")
)

// bearerClaims validates the access token in the Authorization header.
// Identity is never taken from client-supplied headers such as X-User-ID.
func (h *Handler) bearerClaims(r *http.Request) (*auth.UserClaims, error) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") || h.jwtManager == nil {
		return nil, ErrUnauthorized
	}
	claims, err := h.jwtManager.ValidateToken(strings.TrimPrefix(authHeader, "Bearer "))
	if err != nil || claims == nil || claims.UserID == uuid.Nil {
		return nil, ErrUnauthorized
	}
	return claims, nil
}

// resolveUserID returns the caller's user ID from a guest or member access token.
// A guest token stops working as soon as that guest has been migrated into an account.
func (h *Handler) resolveUserID(r *http.Request) (uuid.UUID, error) {
	claims, err := h.bearerClaims(r)
	if err != nil {
		return uuid.Nil, err
	}
	if claims.Role == auth.RoleGuest && h.authService != nil {
		user, err := h.authService.GetProfile(r.Context(), claims.UserID)
		if err != nil || user.AuthProvider != "guest" {
			return uuid.Nil, ErrUnauthorized
		}
	}
	return claims.UserID, nil
}

// getAuthenticatedUserID only accepts access tokens of registered (non-guest) accounts.
func (h *Handler) getAuthenticatedUserID(r *http.Request) (uuid.UUID, error) {
	claims, err := h.bearerClaims(r)
	if err != nil {
		return uuid.Nil, err
	}
	if claims.Role != auth.RoleUser {
		return uuid.Nil, ErrMemberRequired
	}
	return claims.UserID, nil
}

// requireMember writes 401 (no/invalid token) or 403 (guest) and returns false unless the caller
// is a signed-in member.
func (h *Handler) requireMember(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, err := h.getAuthenticatedUserID(r)
	switch {
	case errors.Is(err, ErrMemberRequired):
		http.Error(w, "đăng nhập tài khoản để sử dụng tính năng này", http.StatusForbidden)
		return uuid.Nil, false
	case err != nil:
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return uuid.Nil, false
	}
	return userID, true
}

// requireAdmin writes 401/403 and returns false unless the caller is a member listed in ADMIN_EMAILS.
func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, ok := h.requireMember(w, r)
	if !ok {
		return uuid.Nil, false
	}
	if len(h.adminEmails) > 0 && h.authService != nil {
		user, err := h.authService.GetProfile(r.Context(), userID)
		if err == nil && user != nil && user.Email != nil && h.adminEmails[strings.ToLower(*user.Email)] {
			return userID, true
		}
	}
	http.Error(w, "forbidden", http.StatusForbidden)
	return uuid.Nil, false
}

type TrackRequest struct {
	URL string `json:"url"`
}

func (h *Handler) TrackProduct(w http.ResponseWriter, r *http.Request) {
	var req TrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, "invalid request: url is required", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	tracked, err := h.trackingService.TrackURL(r.Context(), userID, req.URL)
	if err != nil {
		if errors.Is(err, marketplace.ErrProductUnavailable) {
			http.Error(w, "Không đọc được thông tin sản phẩm từ sàn (trang bị chặn, đã gỡ hoặc thay đổi). Vui lòng thử lại sau.", http.StatusBadGateway)
			return
		}
		if isBadProductURL(err) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		h.serverError(w, r, err)
		return
	}

	if h.matchingService != nil && h.comparisonSvc != nil {
		go func(uid uuid.UUID, sourceID uuid.UUID) {
			bgCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			source, sErr := h.trackingService.GetProductSource(bgCtx, sourceID)
			if sErr == nil && source != nil {
				cmp, cErr := h.comparisonSvc.GetComparison(bgCtx, source.ProductID)
				title := ""
				if cErr == nil && cmp != nil {
					title = cmp.ProductTitle
				}
				if source.RawTitle != nil && *source.RawTitle != "" {
					title = *source.RawTitle
				}
				price := int64(0)
				if source.LastEffectivePrice != nil {
					price = *source.LastEffectivePrice
				} else if source.LastPrice != nil {
					price = *source.LastPrice
				}
				// Without a real price the price check is skipped and wrong products can be auto-linked
				// (DATA-11), so matching waits until a price has actually been fetched.
				if price <= 0 {
					return
				}
				_, _ = h.matchingService.DiscoverAndMatch(bgCtx, uid, source.ProductID, source.Platform, title, price)
			}
		}(userID, tracked.ProductSourceID)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                tracked.ID,
		"product_source_id": tracked.ProductSourceID,
		"next_fetch_at":     tracked.NextFetchAt,
	})
}

type EnrichedTracking struct {
	ID                     uuid.UUID `json:"ID"`
	UserID                 uuid.UUID `json:"UserID"`
	ProductSourceID        uuid.UUID `json:"ProductSourceID"`
	Active                 bool      `json:"Active"`
	PollingIntervalSeconds int       `json:"PollingIntervalSeconds"`
	NextFetchAt            time.Time `json:"NextFetchAt"`
	CreatedAt              time.Time `json:"CreatedAt"`
	UpdatedAt              time.Time `json:"UpdatedAt"`
	ProductID              uuid.UUID `json:"ProductID,omitempty"`
	IsPrimary              bool      `json:"IsPrimary"`
	Title                  string    `json:"Title,omitempty"`
	Platform               string    `json:"Platform,omitempty"`
	CanonicalURL           string    `json:"CanonicalURL,omitempty"`
	AffiliateURL           string    `json:"AffiliateURL,omitempty"`
	SellerName             string    `json:"SellerName,omitempty"`
	LastPrice              *int64    `json:"LastPrice,omitempty"`
	LastEffectivePrice     *int64    `json:"LastEffectivePrice,omitempty"`
	LastInStock            *bool     `json:"LastInStock,omitempty"`
}

func (h *Handler) enrichTracking(r *http.Request, t *domain.TrackedProduct) EnrichedTracking {
	enriched := EnrichedTracking{
		ID:                     t.ID,
		UserID:                 t.UserID,
		ProductSourceID:        t.ProductSourceID,
		Active:                 t.Active,
		PollingIntervalSeconds: t.PollingIntervalSeconds,
		NextFetchAt:            t.NextFetchAt,
		CreatedAt:              t.CreatedAt,
		UpdatedAt:              t.UpdatedAt,
		IsPrimary:              t.IsPrimary,
	}

	if source, err := h.trackingService.GetProductSource(r.Context(), t.ProductSourceID); err == nil && source != nil {
		enriched.ProductID = source.ProductID
		if source.RawTitle != nil {
			enriched.Title = *source.RawTitle
		}
		enriched.Platform = source.Platform
		enriched.CanonicalURL = source.CanonicalURL
		if source.SellerName != nil {
			enriched.SellerName = *source.SellerName
		}
		enriched.LastPrice = source.LastPrice
		enriched.LastEffectivePrice = source.LastEffectivePrice
		enriched.LastInStock = source.LastInStock

		if h.affiliateTransformer != nil && enriched.CanonicalURL != "" {
			subID := affiliate.FormatSubID(t.UserID, enriched.ProductID)
			enriched.AffiliateURL = h.affiliateTransformer.Transform(enriched.CanonicalURL, enriched.Platform, subID)
		}
	}

	return enriched
}

func (h *Handler) ListTrackings(w http.ResponseWriter, r *http.Request) {
	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	trackings, err := h.trackingService.ListTrackings(r.Context(), userID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	enrichedList := make([]EnrichedTracking, 0, len(trackings))
	for _, t := range trackings {
		enrichedList = append(enrichedList, h.enrichTracking(r, t))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": enrichedList,
	})
}

func (h *Handler) GetTracking(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	tracked, err := h.trackingService.GetTrackingForUser(r.Context(), id, userID)
	if err == nil && tracked != nil {
		enriched := h.enrichTracking(r, tracked)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(enriched)
		return
	}

	// Fallback: id is a product_source_id in a product group the user tracks (e.g. a compared source)
	source, err := h.trackingService.ResolveSourceForUser(r.Context(), userID, id)
	if err != nil {
		h.accessError(w, r, err, "tracking not found")
		return
	}
	enriched := EnrichedTracking{
		ProductSourceID:    source.ID,
		ProductID:          source.ProductID,
		Active:             source.Active,
		Platform:           source.Platform,
		CanonicalURL:       source.CanonicalURL,
		LastPrice:          source.LastPrice,
		LastEffectivePrice: source.LastEffectivePrice,
		LastInStock:        source.LastInStock,
		CreatedAt:          source.CreatedAt,
		UpdatedAt:          source.UpdatedAt,
	}
	if source.RawTitle != nil {
		enriched.Title = *source.RawTitle
	}
	if source.SellerName != nil {
		enriched.SellerName = *source.SellerName
	}
	if h.affiliateTransformer != nil && enriched.CanonicalURL != "" {
		subID := affiliate.FormatSubID(userID, source.ProductID)
		enriched.AffiliateURL = h.affiliateTransformer.Transform(enriched.CanonicalURL, enriched.Platform, subID)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(enriched)
}

func (h *Handler) GetTrackingPrices(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	source, err := h.trackingService.ResolveSourceForUser(r.Context(), userID, sourceID)
	if err != nil {
		h.accessError(w, r, err, "tracking not found")
		return
	}
	sourceID = source.ID

	to := time.Now()
	from := to.AddDate(0, 0, -30)

	if qFrom := r.URL.Query().Get("from"); qFrom != "" {
		if t, err := time.Parse("2006-01-02", qFrom); err == nil {
			from = t
		}
	}
	if qTo := r.URL.Query().Get("to"); qTo != "" {
		if t, err := time.Parse("2006-01-02", qTo); err == nil {
			to = t.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
		}
	}

	snapshots, err := h.pricingService.GetHistory(r.Context(), sourceID, from, to)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"product_source_id": sourceID,
		"snapshots":         snapshots,
	})
}

func (h *Handler) PauseTracking(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.trackingService.PauseTracking(r.Context(), id, userID); err != nil {
		http.Error(w, "tracking not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "paused",
		"id":     id,
	})
}

func (h *Handler) ResumeTracking(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.trackingService.ResumeTracking(r.Context(), id, userID); err != nil {
		http.Error(w, "tracking not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "resumed",
		"id":     id,
	})
}

type CreateAlertRequest struct {
	RuleType       alert.RuleType `json:"rule_type"`
	ThresholdValue int64          `json:"threshold_value"`
	ExpiresInDays  *int           `json:"expires_in_days,omitempty"`
}

func (h *Handler) CreateAlert(w http.ResponseWriter, r *http.Request) {
	if h.alertRepo == nil {
		http.Error(w, "alert service not available", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Resolve a tracked_product ID or an accessible product_source ID to the source
	if h.trackingService != nil {
		source, err := h.trackingService.ResolveSourceForUser(r.Context(), userID, sourceID)
		if err != nil {
			h.accessError(w, r, err, "product not found")
			return
		}
		sourceID = source.ID
	}

	var req CreateAlertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if !req.RuleType.IsValid() {
		http.Error(w, "invalid rule_type: must be drop_percent, target_price, or lowest_in_days", http.StatusBadRequest)
		return
	}

	if req.ThresholdValue <= 0 {
		http.Error(w, "threshold_value must be greater than 0", http.StatusBadRequest)
		return
	}
	if req.RuleType == alert.RuleTypeDropPercent && req.ThresholdValue > 99 {
		http.Error(w, "threshold_value for drop_percent must be between 1 and 99", http.StatusBadRequest)
		return
	}
	if req.RuleType == alert.RuleTypeLowestInDays && req.ThresholdValue > 365 {
		http.Error(w, "threshold_value for lowest_in_days must be between 1 and 365", http.StatusBadRequest)
		return
	}
	if req.ExpiresInDays != nil && (*req.ExpiresInDays < 0 || *req.ExpiresInDays > 365) {
		http.Error(w, "expires_in_days must be between 0 and 365", http.StatusBadRequest)
		return
	}

	now := time.Now()

	var expiresAt *time.Time
	if req.ExpiresInDays != nil && *req.ExpiresInDays > 0 {
		exp := now.AddDate(0, 0, *req.ExpiresInDays)
		expiresAt = &exp
	}

	rule := &alert.AlertRule{
		ID:              uuid.New(),
		UserID:          userID,
		ProductSourceID: sourceID,
		RuleType:        req.RuleType,
		ThresholdValue:  req.ThresholdValue,
		Active:          true,
		ExpiresAt:       expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := h.alertRepo.CreateRule(r.Context(), rule); err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(rule)
}

func (h *Handler) ListAlerts(w http.ResponseWriter, r *http.Request) {
	if h.alertRepo == nil {
		http.Error(w, "alert service not available", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	sourceID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if h.trackingService != nil {
		source, err := h.trackingService.ResolveSourceForUser(r.Context(), userID, sourceID)
		if err != nil {
			h.accessError(w, r, err, "product not found")
			return
		}
		sourceID = source.ID
	}

	rules, err := h.alertRepo.ListRulesBySourceAndUser(r.Context(), sourceID, userID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	if rules == nil {
		rules = make([]*alert.AlertRule, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"product_source_id": sourceID,
		"data":              rules,
	})
}

func (h *Handler) DeactivateAlert(w http.ResponseWriter, r *http.Request) {
	if h.alertRepo == nil {
		http.Error(w, "alert service not available", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "alert_id")
	alertID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid alert_id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.alertRepo.DeactivateRuleForUser(r.Context(), alertID, userID); err != nil {
		http.Error(w, "alert rule not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "deactivated",
		"id":     alertID,
	})
}

func (h *Handler) GetAlertLogs(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "notification service not available", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "alert_id")
	alertID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid alert_id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Verify alert rule ownership
	if h.alertRepo != nil {
		rule, err := h.alertRepo.GetRule(r.Context(), alertID)
		if err != nil || rule == nil || rule.UserID != userID {
			http.Error(w, "alert rule not found", http.StatusNotFound)
			return
		}
	}

	logs, err := h.notifRepo.ListRuleLogs(r.Context(), alertID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	if logs == nil {
		logs = make([]*notification.NotificationLog, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"alert_id": alertID,
		"data":     logs,
	})
}

func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "notification service not available", http.StatusServiceUnavailable)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	limit := 30
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = min(l, 100)
		}
	}

	notifs, err := h.notifRepo.ListUserNotifications(r.Context(), userID, limit)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	if notifs == nil {
		notifs = make([]*notification.EnrichedNotification, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": notifs,
	})
}

func (h *Handler) MarkNotificationAsRead(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "notification service not available", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	notifID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.notifRepo.MarkAsRead(r.Context(), notifID, userID); err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "read",
		"id":     notifID,
	})
}

func (h *Handler) ListUserAlerts(w http.ResponseWriter, r *http.Request) {
	if h.alertRepo == nil {
		http.Error(w, "alert service not available", http.StatusServiceUnavailable)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	rules, err := h.alertRepo.ListRulesByUser(r.Context(), userID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	if rules == nil {
		rules = make([]*alert.AlertRule, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": rules,
	})
}

func (h *Handler) GetUserProfile(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "service not available", http.StatusServiceUnavailable)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	profile, err := h.notifRepo.GetUserProfile(r.Context(), userID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

var (
	phonePattern  = regexp.MustCompile(`^\+?[0-9]{9,15}$`)
	zaloIDPattern = regexp.MustCompile(`^[0-9A-Za-z_-]{1,64}$`)
)

type ConnectZaloRequest struct {
	ZaloID string `json:"zalo_id,omitempty"`
	Phone  string `json:"phone,omitempty"`
}

func (h *Handler) ConnectZalo(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "service not available", http.StatusServiceUnavailable)
		return
	}

	var req ConnectZaloRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.ZaloID, req.Phone = strings.TrimSpace(req.ZaloID), strings.TrimSpace(req.Phone)
	if req.ZaloID == "" && req.Phone == "" {
		http.Error(w, "either zalo_id or phone is required", http.StatusBadRequest)
		return
	}
	if req.Phone != "" && !phonePattern.MatchString(req.Phone) {
		http.Error(w, "invalid phone number", http.StatusBadRequest)
		return
	}
	if req.ZaloID != "" && !zaloIDPattern.MatchString(req.ZaloID) {
		http.Error(w, "invalid zalo_id", http.StatusBadRequest)
		return
	}

	userID, ok := h.requireMember(w, r)
	if !ok {
		return
	}

	if err := h.notifRepo.UpdateUserZalo(r.Context(), userID, req.ZaloID, req.Phone); err != nil {
		if strings.Contains(err.Error(), "duplicate key") ||
			strings.Contains(err.Error(), "23505") ||
			strings.Contains(err.Error(), "unique constraint") {
			http.Error(w, "Zalo ID hoặc số điện thoại đã được liên kết với một tài khoản khác", http.StatusConflict)
			return
		}
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "connected",
		"zalo_id": req.ZaloID,
		"phone":   req.Phone,
	})
}

func (h *Handler) DisconnectZalo(w http.ResponseWriter, r *http.Request) {
	if h.notifRepo == nil {
		http.Error(w, "service not available", http.StatusServiceUnavailable)
		return
	}

	userID, ok := h.requireMember(w, r)
	if !ok {
		return
	}

	if err := h.notifRepo.DisconnectUserZalo(r.Context(), userID); err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "disconnected",
	})
}

// Phase 3: Cross-platform Price Comparison Handlers

func (h *Handler) GetProductComparison(w http.ResponseWriter, r *http.Request) {
	if h.comparisonSvc == nil {
		http.Error(w, "comparison service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "product_id")
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid product id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "product not found")
		return
	}

	comparisonResult, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(comparisonResult)
}

func (h *Handler) LinkProductSource(w http.ResponseWriter, r *http.Request) {
	if h.comparisonSvc == nil {
		http.Error(w, "comparison service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "product_id")
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid product id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req TrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		http.Error(w, "invalid request: url is required", http.StatusBadRequest)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "product not found")
		return
	}

	source, err := h.trackingService.LinkSourceToProduct(r.Context(), userID, productID, req.URL)
	if err != nil {
		switch {
		case errors.Is(err, tracking.ErrSourceAlreadyLinked):
			http.Error(w, "Sản phẩm từ đường dẫn này đã được liên kết với nhóm sản phẩm", http.StatusConflict)
		case errors.Is(err, tracking.ErrSourceInOtherGroup):
			http.Error(w, "Sản phẩm từ đường dẫn này đang thuộc một nhóm so sánh khác", http.StatusConflict)
		case errors.Is(err, tracking.ErrProductNotFound):
			http.Error(w, "Nhóm sản phẩm không tồn tại", http.StatusNotFound)
		case errors.Is(err, marketplace.ErrProductUnavailable):
			http.Error(w, "Không đọc được thông tin sản phẩm từ sàn (trang bị chặn, đã gỡ hoặc thay đổi). Vui lòng thử lại sau.", http.StatusBadGateway)
		case isBadProductURL(err):
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			h.serverError(w, r, err)
		}
		return
	}

	_ = h.comparisonSvc.Invalidate(r.Context(), productID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"source_id": source.ID,
		"platform":  source.Platform,
		"message":   "Liên kết thành công. Dữ liệu giá sẽ được cập nhật ngay lập tức.",
	})
}

func (h *Handler) ListProductGroups(w http.ResponseWriter, r *http.Request) {
	if h.comparisonSvc == nil {
		http.Error(w, "comparison service unavailable", http.StatusServiceUnavailable)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	groups, err := h.comparisonSvc.GetUserMultiSourceProducts(r.Context(), userID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	if groups == nil {
		groups = []comparison.ProductGroupSummary{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"groups": groups,
	})
}

func (h *Handler) GetTrackedProductComparison(w http.ResponseWriter, r *http.Request) {
	if h.comparisonSvc == nil {
		http.Error(w, "comparison service unavailable", http.StatusServiceUnavailable)
		return
	}

	idStr := chi.URLParam(r, "id")
	rawID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid tracking id", http.StatusBadRequest)
		return
	}

	userID, err := h.resolveUserID(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	productID, err := h.trackingService.ResolveProductForUser(r.Context(), userID, rawID)
	if err != nil {
		h.accessError(w, r, err, "tracking not found")
		return
	}

	comparisonResult, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil {
		h.serverError(w, r, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(comparisonResult)
}
