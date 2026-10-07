//go:build integration
// +build integration

package integration

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/auth"
)

// bearerFor mints a guest access token for an existing user ID (tests that seed users directly).
func bearerFor(t *testing.T, jwtMgr *auth.JWTManager, userID uuid.UUID) string {
	t.Helper()
	token, err := jwtMgr.GenerateAccessToken(&auth.User{ID: userID, AuthProvider: "guest"})
	if err != nil {
		t.Fatalf("mint access token: %v", err)
	}
	return "Bearer " + token
}

// postSession calls an auth endpoint and returns the session plus its refresh-token cookie.
func postSession(t *testing.T, url string, body interface{}, bearer string, cookie *http.Cookie) (*http.Response, *auth.Session, *http.Cookie) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(http.MethodPost, url, &buf)
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()

	var refresh *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == "dh_refresh" {
			refresh = c
		}
	}
	if resp.StatusCode != http.StatusOK {
		return resp, nil, refresh
	}
	var sess auth.Session
	if err := json.NewDecoder(resp.Body).Decode(&sess); err != nil {
		t.Fatalf("decode session from %s: %v", url, err)
	}
	return resp, &sess, refresh
}

// startGuest bootstraps a guest session and returns its Authorization header value and refresh cookie.
func startGuest(t *testing.T, serverURL string) (string, *auth.Session, *http.Cookie) {
	t.Helper()
	resp, sess, cookie := postSession(t, serverURL+"/api/v1/auth/guest", nil, "", nil)
	if sess == nil {
		t.Fatalf("guest session failed: status %d", resp.StatusCode)
	}
	return "Bearer " + sess.AccessToken, sess, cookie
}

const testGoogleClientID = "integration-test.apps.googleusercontent.com"

// newTestAuthService wires the auth service to a fake of Google's tokeninfo endpoint (test-only):
// the ID token "valid:<email>" verifies as <email>; any other token is rejected like Google does.
func newTestAuthService(t *testing.T, repo auth.UserRepository, jwtMgr *auth.JWTManager) *auth.AuthService {
	t.Helper()
	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("id_token")
		if !strings.HasPrefix(token, "valid:") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		email := strings.TrimPrefix(token, "valid:")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"aud": testGoogleClientID, "iss": "https://accounts.google.com", "sub": "sub-" + strings.ToLower(email),
			"email": email, "email_verified": "true", "name": "Integration " + email,
		})
	}))
	t.Cleanup(google.Close)

	svc := auth.NewAuthService(repo, jwtMgr, testGoogleClientID)
	svc.SetGoogleTokenInfoURL(google.URL)
	return svc
}

// googleLogin signs in through POST /auth/google, migrating the guest identified by guestBearer (if any).
func googleLogin(t *testing.T, serverURL, email, guestBearer string) (string, *auth.Session, *http.Cookie) {
	t.Helper()
	resp, sess, cookie := postSession(t, serverURL+"/api/v1/auth/google",
		map[string]string{"id_token": "valid:" + email}, guestBearer, nil)
	if sess == nil {
		t.Fatalf("google login failed: status %d", resp.StatusCode)
	}
	return "Bearer " + sess.AccessToken, sess, cookie
}

const (
	testZaloAppID     = "123456"
	testWebhookSecret = "integration-zalo-oa-secret"
)

// postSignedZaloWebhook posts a callback signed like Zalo: mac=sha256(appId + body + timestamp + secret).
func postSignedZaloWebhook(t *testing.T, client *http.Client, url string, payload map[string]interface{}) *http.Response {
	t.Helper()
	if _, ok := payload["timestamp"]; !ok {
		payload["timestamp"] = strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	body, _ := json.Marshal(payload)
	ts := strings.Trim(fmt.Sprint(payload["timestamp"]), `"`)
	sum := sha256.Sum256([]byte(testZaloAppID + string(body) + ts + testWebhookSecret))

	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ZEvent-Signature", "mac="+hex.EncodeToString(sum[:]))
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return resp
}
