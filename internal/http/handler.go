package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
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
		if strings.Contains(err.Error(), "unsupported or unregistered platform") ||
			strings.Contains(err.Error(), "invalid url") ||
			strings.Contains(err.Error(), "detect platform") ||
			strings.Contains(err.Error(), "cannot parse") {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	// Fallback: check if id is a product_source_id directly
	if source, err := h.trackingService.GetProductSource(r.Context(), id); err == nil && source != nil {
		enriched := EnrichedTracking{
			ProductSourceID:    source.ID,
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
		return
	}

	http.Error(w, "tracking not found", http.StatusNotFound)
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

	// Resolve to productSourceID if the passed ID is a tracked_product ID
	if tracked, err := h.trackingService.GetTrackingForUser(r.Context(), sourceID, userID); err == nil && tracked != nil {
		sourceID = tracked.ProductSourceID
	} else if h.trackingService != nil {
		if source, err := h.trackingService.GetProductSource(r.Context(), sourceID); err != nil || source == nil {
			http.Error(w, "tracking not found", http.StatusNotFound)
			return
		}
	}

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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	// Resolve to productSourceID if the passed ID is a tracked_product ID
	if h.trackingService != nil {
		if tracked, err := h.trackingService.GetTrackingForUser(r.Context(), sourceID, userID); err == nil && tracked != nil {
			sourceID = tracked.ProductSourceID
		} else {
			if source, err := h.trackingService.GetProductSource(r.Context(), sourceID); err != nil || source == nil {
				http.Error(w, "product not found", http.StatusNotFound)
				return
			}
		}
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		if tracked, err := h.trackingService.GetTrackingForUser(r.Context(), sourceID, userID); err == nil && tracked != nil {
			sourceID = tracked.ProductSourceID
		} else {
			if source, err := h.trackingService.GetProductSource(r.Context(), sourceID); err != nil || source == nil {
				http.Error(w, "product not found", http.StatusNotFound)
				return
			}
		}
	}

	rules, err := h.alertRepo.ListRulesBySourceAndUser(r.Context(), sourceID, userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
			limit = l
		}
	}

	notifs, err := h.notifRepo.ListUserNotifications(r.Context(), userID, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

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

	if req.ZaloID == "" && req.Phone == "" {
		http.Error(w, "either zalo_id or phone is required", http.StatusBadRequest)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "disconnected",
	})
}

// Phase 3: Cross-platform Price Comparison Handlers

func (h *Handler) resolveCanonicalProductID(ctx context.Context, rawID uuid.UUID) (uuid.UUID, error) {
	if h.comparisonSvc != nil {
		if exists, _ := h.comparisonSvc.ProductExists(ctx, rawID); exists {
			return rawID, nil
		}
	}

	if tracked, err := h.trackingService.GetTracking(ctx, rawID); err == nil && tracked != nil {
		if source, err := h.trackingService.GetProductSource(ctx, tracked.ProductSourceID); err == nil && source != nil {
			return source.ProductID, nil
		}
	}

	if source, err := h.trackingService.GetProductSource(ctx, rawID); err == nil && source != nil {
		return source.ProductID, nil
	}

	return uuid.Nil, errors.New("product not found")
}

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

	productID, err := h.resolveCanonicalProductID(r.Context(), rawID)
	if err != nil {
		http.Error(w, "product not found", http.StatusNotFound)
		return
	}

	comparisonResult, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	productID, err := h.resolveCanonicalProductID(r.Context(), rawID)
	if err != nil {
		http.Error(w, "product not found", http.StatusNotFound)
		return
	}

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

	source, err := h.trackingService.LinkSourceToProduct(r.Context(), userID, productID, req.URL)
	if err != nil {
		if errors.Is(err, tracking.ErrSourceAlreadyLinked) {
			http.Error(w, "Sản phẩm từ đường dẫn này đã được liên kết với nhóm sản phẩm", http.StatusConflict)
			return
		}
		if errors.Is(err, tracking.ErrProductNotFound) {
			http.Error(w, "Nhóm sản phẩm không tồn tại", http.StatusNotFound)
			return
		}
		if errors.Is(err, marketplace.ErrProductUnavailable) {
			http.Error(w, "Không đọc được thông tin sản phẩm từ sàn (trang bị chặn, đã gỡ hoặc thay đổi). Vui lòng thử lại sau.", http.StatusBadGateway)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	var productID uuid.UUID
	if tracked, err := h.trackingService.GetTrackingForUser(r.Context(), rawID, userID); err == nil && tracked != nil {
		if source, err := h.trackingService.GetProductSource(r.Context(), tracked.ProductSourceID); err == nil && source != nil {
			productID = source.ProductID
		}
	} else if source, err := h.trackingService.GetProductSource(r.Context(), rawID); err == nil && source != nil {
		productID = source.ProductID
	}

	if productID == uuid.Nil {
		http.Error(w, "tracking not found", http.StatusNotFound)
		return
	}

	comparisonResult, err := h.comparisonSvc.GetComparison(r.Context(), productID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(comparisonResult)
}
