package router

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/alert"
	"github.com/tiendang/deal-hunter/internal/comparison"
	"github.com/tiendang/deal-hunter/internal/notification"
)

type mockAlertRepo struct {
	rules []*alert.AlertRule
}

func (m *mockAlertRepo) CreateRule(ctx context.Context, rule *alert.AlertRule) error {
	m.rules = append(m.rules, rule)
	return nil
}

func (m *mockAlertRepo) GetRule(ctx context.Context, id uuid.UUID) (*alert.AlertRule, error) {
	for _, r := range m.rules {
		if r.ID == id {
			return r, nil
		}
	}
	return nil, nil
}

func (m *mockAlertRepo) ListActiveRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*alert.AlertRule, error) {
	var res []*alert.AlertRule
	for _, r := range m.rules {
		if r.ProductSourceID == productSourceID && r.Active {
			res = append(res, r)
		}
	}
	return res, nil
}

func (m *mockAlertRepo) ListRulesByUser(ctx context.Context, userID uuid.UUID) ([]*alert.AlertRule, error) {
	var res []*alert.AlertRule
	for _, r := range m.rules {
		if r.UserID == userID {
			res = append(res, r)
		}
	}
	return res, nil
}

func (m *mockAlertRepo) ListRulesBySource(ctx context.Context, productSourceID uuid.UUID) ([]*alert.AlertRule, error) {
	var res []*alert.AlertRule
	for _, r := range m.rules {
		if r.ProductSourceID == productSourceID {
			res = append(res, r)
		}
	}
	return res, nil
}

func (m *mockAlertRepo) DeactivateRule(ctx context.Context, id uuid.UUID) error {
	for _, r := range m.rules {
		if r.ID == id {
			r.Active = false
			return nil
		}
	}
	return nil
}

type mockNotifRepo struct {
	logs []*notification.NotificationLog
}

func (m *mockNotifRepo) InsertLog(ctx context.Context, log *notification.NotificationLog) error {
	m.logs = append(m.logs, log)
	return nil
}

func (m *mockNotifRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status notification.Status, errorMessage *string) error {
	return nil
}

func (m *mockNotifRepo) UpdateStatusAndMsgID(ctx context.Context, id uuid.UUID, status notification.Status, msgID string, errorMessage *string) error {
	return nil
}

func (m *mockNotifRepo) GetLogByMsgID(ctx context.Context, msgID string) (*notification.NotificationLog, error) {
	return nil, nil
}

func (m *mockNotifRepo) UpdateDeliveryStatus(ctx context.Context, msgID string, status notification.Status, timestamp *time.Time) error {
	return nil
}

func (m *mockNotifRepo) CheckDedup(ctx context.Context, userID, alertRuleID uuid.UUID, within time.Duration) (bool, error) {
	return false, nil
}

func (m *mockNotifRepo) ListUserNotifications(ctx context.Context, userID uuid.UUID, limit int) ([]*notification.EnrichedNotification, error) {
	var res []*notification.EnrichedNotification
	for _, l := range m.logs {
		if l.UserID == userID {
			res = append(res, &notification.EnrichedNotification{
				NotificationLog: *l,
				ProductTitle:    "Test Product",
			})
		}
	}
	return res, nil
}

func (m *mockNotifRepo) ListRuleLogs(ctx context.Context, alertRuleID uuid.UUID) ([]*notification.NotificationLog, error) {
	var res []*notification.NotificationLog
	for _, l := range m.logs {
		if l.AlertRuleID == alertRuleID {
			res = append(res, l)
		}
	}
	return res, nil
}

func (m *mockNotifRepo) MarkAsRead(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	for _, l := range m.logs {
		if l.ID == id && l.UserID == userID {
			now := time.Now()
			l.ReadAt = &now
			return nil
		}
	}
	return nil
}

func (m *mockNotifRepo) GetLog(ctx context.Context, id uuid.UUID) (*notification.NotificationLog, error) {
	return nil, nil
}

func (m *mockNotifRepo) GetUserRecipient(ctx context.Context, userID uuid.UUID, channel string) (string, error) {
	return "0123456789", nil
}

func (m *mockNotifRepo) GetUserProfile(ctx context.Context, userID uuid.UUID) (*notification.UserProfile, error) {
	return &notification.UserProfile{
		UserID:        userID,
		ZaloConnected: false,
	}, nil
}

func (m *mockNotifRepo) UpdateUserZalo(ctx context.Context, userID uuid.UUID, zaloID, phone string) error {
	return nil
}

func (m *mockNotifRepo) DisconnectUserZalo(ctx context.Context, userID uuid.UUID) error {
	return nil
}

func setupTestRouter() (*chi.Mux, *mockAlertRepo, *mockNotifRepo) {
	handler := &Handler{}
	alertRepo := &mockAlertRepo{}
	notifRepo := &mockNotifRepo{}
	handler.SetAlertAndNotificationRepos(alertRepo, notifRepo)

	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/tracked-products/{id}/alerts", handler.CreateAlert)
		r.Get("/tracked-products/{id}/alerts", handler.ListAlerts)
		r.Get("/alert-rules", handler.ListUserAlerts)
		r.Delete("/alerts/{alert_id}", handler.DeactivateAlert)
		r.Get("/alerts/{alert_id}/logs", handler.GetAlertLogs)
		r.Get("/notifications", handler.ListNotifications)
		r.Post("/notifications/{id}/read", handler.MarkNotificationAsRead)
		r.Get("/users/me", handler.GetUserProfile)
		r.Post("/users/me/zalo", handler.ConnectZalo)
		r.Delete("/users/me/zalo", handler.DisconnectZalo)
	})

	return r, alertRepo, notifRepo
}

func TestCreateAlert_Success(t *testing.T) {
	r, alertRepo, _ := setupTestRouter()
	sourceID := uuid.New()

	body, _ := json.Marshal(map[string]interface{}{
		"rule_type":       "drop_percent",
		"threshold_value": 15,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tracked-products/"+sourceID.String()+"/alerts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	if len(alertRepo.rules) != 1 {
		t.Fatalf("expected 1 rule in repo, got %d", len(alertRepo.rules))
	}
	if alertRepo.rules[0].ThresholdValue != 15 {
		t.Errorf("expected threshold 15, got %d", alertRepo.rules[0].ThresholdValue)
	}
}

func TestCreateAlert_InvalidType(t *testing.T) {
	r, _, _ := setupTestRouter()
	sourceID := uuid.New()

	body, _ := json.Marshal(map[string]interface{}{
		"rule_type":       "invalid_rule_type",
		"threshold_value": 15,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tracked-products/"+sourceID.String()+"/alerts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", w.Code)
	}
}

func TestListAlerts(t *testing.T) {
	r, alertRepo, _ := setupTestRouter()
	sourceID := uuid.New()

	alertRepo.rules = append(alertRepo.rules, &alert.AlertRule{
		ID:              uuid.New(),
		ProductSourceID: sourceID,
		RuleType:        alert.RuleTypeTargetPrice,
		ThresholdValue:  1000000,
		Active:          true,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tracked-products/"+sourceID.String()+"/alerts", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp struct {
		Data []*alert.AlertRule `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(resp.Data))
	}
}

func TestDeactivateAlert(t *testing.T) {
	r, alertRepo, _ := setupTestRouter()
	alertID := uuid.New()

	alertRepo.rules = append(alertRepo.rules, &alert.AlertRule{
		ID:     alertID,
		Active: true,
	})

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/alerts/"+alertID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	if alertRepo.rules[0].Active != false {
		t.Errorf("expected rule to be deactivated")
	}
}

func TestListNotifications(t *testing.T) {
	r, _, notifRepo := setupTestRouter()
	defaultUserID := uuid.MustParse("00000000-0000-0000-0000-000000000001")

	notifRepo.logs = append(notifRepo.logs, &notification.NotificationLog{
		ID:          uuid.New(),
		UserID:      defaultUserID,
		AlertRuleID: uuid.New(),
		PriceBefore: 2000000,
		PriceAfter:  1500000,
		Status:      notification.StatusSent,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/notifications", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp struct {
		Data []*notification.EnrichedNotification `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(resp.Data))
	}
	if resp.Data[0].PriceAfter != 1500000 {
		t.Errorf("expected PriceAfter 1500000, got %d", resp.Data[0].PriceAfter)
	}
}

func TestMarkNotificationAsRead(t *testing.T) {
	r, _, notifRepo := setupTestRouter()
	defaultUserID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	notifID := uuid.New()

	notifRepo.logs = append(notifRepo.logs, &notification.NotificationLog{
		ID:     notifID,
		UserID: defaultUserID,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/"+notifID.String()+"/read", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	if notifRepo.logs[0].ReadAt == nil {
		t.Errorf("expected ReadAt to be set")
	}
}

func TestListUserAlerts(t *testing.T) {
	r, alertRepo, _ := setupTestRouter()
	defaultUserID := uuid.MustParse("00000000-0000-0000-0000-000000000001")

	alertRepo.rules = append(alertRepo.rules, &alert.AlertRule{
		ID:              uuid.New(),
		UserID:          defaultUserID,
		ProductSourceID: uuid.New(),
		RuleType:        alert.RuleTypeDropPercent,
		ThresholdValue:  10,
		Active:          true,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/alert-rules", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp struct {
		Data []*alert.AlertRule `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)

	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(resp.Data))
	}
}

func TestUserProfileAndZaloConnect(t *testing.T) {
	r, _, _ := setupTestRouter()

	// 1. Get profile
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	// 2. Connect Zalo
	connectBody, _ := json.Marshal(map[string]interface{}{
		"phone": "0912345678",
	})
	connectReq := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/zalo", bytes.NewReader(connectBody))
	connectReq.Header.Set("Content-Type", "application/json")
	wConnect := httptest.NewRecorder()
	r.ServeHTTP(wConnect, connectReq)
	if wConnect.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", wConnect.Code, wConnect.Body.String())
	}

	// 3. Disconnect Zalo
	disconnectReq := httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/zalo", nil)
	wDisconnect := httptest.NewRecorder()
	r.ServeHTTP(wDisconnect, disconnectReq)
	if wDisconnect.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", wDisconnect.Code)
	}
}

type mockCompRepoForHandler struct {
	title   string
	sources []comparison.SourcePrice
	groups  []comparison.ProductGroupSummary
}

func (m *mockCompRepoForHandler) GetSourcesByProductID(ctx context.Context, productID uuid.UUID) (string, []comparison.SourcePrice, error) {
	return m.title, m.sources, nil
}
func (m *mockCompRepoForHandler) UpsertComparisonSnapshot(ctx context.Context, productID uuid.UUID, sources []comparison.SourcePrice) error {
	return nil
}
func (m *mockCompRepoForHandler) GetUserMultiSourceProducts(ctx context.Context, userID uuid.UUID) ([]comparison.ProductGroupSummary, error) {
	return m.groups, nil
}
func (m *mockCompRepoForHandler) GetSnapshotAge(ctx context.Context, productID uuid.UUID) (*time.Time, error) {
	return nil, nil
}
func (m *mockCompRepoForHandler) GetAllMultiSourceProductIDs(ctx context.Context) ([]uuid.UUID, error) {
	return nil, nil
}
func (m *mockCompRepoForHandler) ProductExists(ctx context.Context, productID uuid.UUID) (bool, error) {
	return true, nil
}

func TestGetProductComparison_Handler(t *testing.T) {
	productID := uuid.New()
	compRepo := &mockCompRepoForHandler{
		title: "Sony WH-1000XM6",
		sources: []comparison.SourcePrice{
			{
				SourceID:       uuid.New(),
				ProductID:      productID,
				Platform:       "shopee",
				EffectivePrice: 6290000,
				InStock:        true,
			},
			{
				SourceID:       uuid.New(),
				ProductID:      productID,
				Platform:       "tiktok",
				EffectivePrice: 6190000,
				InStock:        true,
			},
		},
	}

	compSvc := comparison.NewComparisonService(compRepo, nil)
	handler := &Handler{}
	handler.SetComparisonService(compSvc)

	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/products/{product_id}/comparison", handler.GetProductComparison)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/products/"+productID.String()+"/comparison", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var res comparison.ComparisonResult
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !res.ComparisonAvailable {
		t.Error("expected comparison_available = true")
	}
	if res.BestDeal == nil || res.BestDeal.Platform != "tiktok" {
		t.Errorf("expected best deal on tiktok, got %+v", res.BestDeal)
	}
}

func TestListProductGroups_Handler(t *testing.T) {
	compRepo := &mockCompRepoForHandler{
		groups: []comparison.ProductGroupSummary{
			{
				ProductID:    uuid.New(),
				ProductTitle: "Sony WH-1000XM6",
				BestPlatform: "tiktok",
				SourceCount:  2,
			},
		},
	}

	compSvc := comparison.NewComparisonService(compRepo, nil)
	handler := &Handler{}
	handler.SetComparisonService(compSvc)

	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/product-groups", handler.ListProductGroups)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/product-groups", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var res struct {
		Groups []comparison.ProductGroupSummary `json:"groups"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}

	if len(res.Groups) != 1 {
		t.Fatalf("expected 1 group, got %d", len(res.Groups))
	}
}
