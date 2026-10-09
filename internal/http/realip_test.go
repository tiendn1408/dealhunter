package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// OPS-03: forwarding headers count only when they come from a trusted proxy, and a client cannot choose
// its own address by prepending entries to X-Forwarded-For.
func TestTrustedRealIP(t *testing.T) {
	trusted, err := ParseTrustedProxies("127.0.0.1, 172.16.0.0/12")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, remote, xff, xrealip, want string
	}{
		{"direct client keeps its address, headers ignored", "203.0.113.7:5555", "1.2.3.4", "1.2.3.4", "203.0.113.7"},
		{"trusted proxy: last untrusted hop", "127.0.0.1:40000", "198.51.100.9", "", "198.51.100.9"},
		{"spoofed entries left of the real client are ignored", "127.0.0.1:40000", "1.1.1.1, 9.9.9.9, 198.51.100.9", "", "198.51.100.9"},
		{"chained trusted proxies are skipped", "172.17.0.1:40000", "198.51.100.9, 127.0.0.1", "", "198.51.100.9"},
		{"X-Real-IP when there is no X-Forwarded-For", "172.17.0.1:40000", "", "198.51.100.9", "198.51.100.9"},
		{"malformed hop: nothing believed", "127.0.0.1:40000", "198.51.100.9, not-an-ip", "", "127.0.0.1"},
		{"only proxies in the chain: proxy address kept", "127.0.0.1:40000", "172.17.0.5", "", "127.0.0.1"},
		{"hop with a port (some load balancers)", "127.0.0.1:40000", "198.51.100.9:5678", "", "198.51.100.9"},
		{"IPv6 hop with a port", "127.0.0.1:40000", "[2001:db8::7]:443", "", "2001:db8::7"},
		{"empty trailing hop is ignored", "127.0.0.1:40000", "198.51.100.9, ", "", "198.51.100.9"},
	}
	for _, tc := range cases {
		var got string
		h := TrustedRealIP(trusted)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = clientIP(r) }))
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = tc.remote
		if tc.xff != "" {
			req.Header.Set("X-Forwarded-For", tc.xff)
		}
		if tc.xrealip != "" {
			req.Header.Set("X-Real-IP", tc.xrealip)
		}
		h.ServeHTTP(httptest.NewRecorder(), req)
		if got != tc.want {
			t.Errorf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}

	if _, err := ParseTrustedProxies("10.0.0.0/33"); err == nil {
		t.Error("an invalid CIDR must be rejected")
	}
	if p, err := ParseTrustedProxies(""); err != nil || len(p) != 0 {
		t.Error("an empty list trusts nobody")
	}
}

// Rate limits key IPv6 clients by their /64: one subscriber usually controls a whole /64, so keying by
// the full address would let them rotate addresses to reset every per-IP limit.
func TestRateLimitKey(t *testing.T) {
	for addr, want := range map[string]string{
		"203.0.113.7:1234":           "203.0.113.7",
		"[2001:db8:1:2:aaaa::1]:443": "2001:db8:1:2::/64",
		"[2001:db8:1:2:bbbb::9]:443": "2001:db8:1:2::/64",
		"[::ffff:203.0.113.7]:80":    "203.0.113.7",
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = addr
		if got := rateLimitKey(req); got != want {
			t.Errorf("%s: got %s, want %s", addr, got, want)
		}
	}
}
