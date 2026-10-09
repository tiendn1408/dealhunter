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
