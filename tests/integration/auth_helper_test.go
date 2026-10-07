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

// demoLogin logs in through demo-login, migrating the guest identified by guestBearer (if any).
func demoLogin(t *testing.T, serverURL, email, guestBearer string) (string, *auth.Session) {
	t.Helper()
	resp, sess, _ := postSession(t, serverURL+"/api/v1/auth/demo-login",
		map[string]string{"email": email, "name": "Integration User"}, guestBearer, nil)
	if sess == nil {
		t.Fatalf("demo login failed: status %d", resp.StatusCode)
	}
	return "Bearer " + sess.AccessToken, sess
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
