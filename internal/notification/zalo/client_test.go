package zalo

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Only failures that certainly delivered nothing are ErrNotSent; anything that may have reached the
// recipient is not (callers would otherwise give back an OTP quota for a delivered message).
func TestSendMessage_NotSentClassification(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		delay   time.Duration
		wantErr bool
		notSent bool
	}{
		{"delivered", 200, `{"error":0,"data":{"msg_id":"m1"}}`, 0, false, false},
		{"business rejection", 200, `{"error":-124,"message":"invalid phone"}`, 0, true, true},
		{"request refused (4xx)", 400, `bad request`, 0, true, true},
		{"server error (5xx) may have sent", 502, `bad gateway`, 0, true, false},
		{"200 without msg_id may have sent", 200, `{"error":0,"data":{}}`, 0, true, false},
		{"timeout may have sent", 200, `{"error":0,"data":{"msg_id":"m1"}}`, 300 * time.Millisecond, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				time.Sleep(tc.delay)
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c := NewHTTPZaloClient("token", nil)
			c.endpoint = srv.URL
			c.httpClient.Timeout = 100 * time.Millisecond

			_, err := c.SendMessage(context.Background(), "84912345678", "tpl", map[string]string{"otp": "123456"})
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if got := errors.Is(err, ErrNotSent); got != tc.notSent {
				t.Fatalf("errors.Is(err, ErrNotSent) = %v, want %v (err: %v)", got, tc.notSent, err)
			}
		})
	}

	// No token: nothing was sent
	_, err := NewHTTPZaloClient("", nil).SendMessage(context.Background(), "84912345678", "tpl", nil)
	if !errors.Is(err, ErrNotSent) {
		t.Fatalf("missing token must be ErrNotSent, got %v", err)
	}
}

func TestSendMessage_AppSecretProof(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Header.Get("appsecret_proof"))
		w.Write([]byte(`{"error":0,"data":{"msg_id":"m1"}}`))
	}))
	defer srv.Close()

	// With the app secret: hex(HMAC-SHA256(key=app secret, message=access token)), computed independently
	c := NewHTTPZaloClient("access-token-123", nil)
	c.endpoint = srv.URL
	c.SetAppSecret("app-secret-key")
	if _, err := c.SendMessage(context.Background(), "84912345678", "tpl", nil); err != nil {
		t.Fatal(err)
	}

	// Without it: no header at all
	plain := NewHTTPZaloClient("access-token-123", nil)
	plain.endpoint = srv.URL
	if _, err := plain.SendMessage(context.Background(), "84912345678", "tpl", nil); err != nil {
		t.Fatal(err)
	}

	want := "3d272fe3a7d6c3fc846354c1e5d38f601548fa81d456f2549978a2fa1614518c"
	if len(got) != 2 || got[0] != want || got[1] != "" {
		t.Fatalf("appsecret_proof headers = %q, want [%q \"\"]", got, want)
	}
}
