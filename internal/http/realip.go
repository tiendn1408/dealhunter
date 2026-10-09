package router

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// TrustedRealIP sets r.RemoteAddr to the client address, believing forwarding headers only from the
// given proxies (OPS-03). chi's RealIP trusts X-Forwarded-For from anyone, so a client could pick any IP
// and dodge per-IP limits. Here, when the connection comes from a trusted proxy, the client is the
// rightmost X-Forwarded-For entry that is not itself a trusted proxy (proxies append to the header, so
// anything left of that was written by the client); without X-Forwarded-For, X-Real-IP is used.
// Connections from anywhere else keep their own address.
func TrustedRealIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	isTrusted := func(addr netip.Addr) bool {
		for _, p := range trusted {
			if p.Contains(addr.Unmap()) {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if peer, ok := remoteAddr(r.RemoteAddr); ok && isTrusted(peer) {
				if client, ok := forwardedClient(r, isTrusted); ok {
					r.RemoteAddr = net.JoinHostPort(client.String(), "0")
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func forwardedClient(r *http.Request, isTrusted func(netip.Addr) bool) (netip.Addr, bool) {
	if xff := r.Header.Values("X-Forwarded-For"); len(xff) > 0 {
		hops := strings.Split(strings.Join(xff, ","), ",")
		for i := len(hops) - 1; i >= 0; i-- {
			hop := strings.TrimSpace(hops[i])
			if hop == "" {
				continue // "a, " — an empty entry carries no address
			}
			addr, ok := parseHop(hop)
			if !ok {
				return netip.Addr{}, false // a malformed hop: trust nothing from this header
			}
			if !isTrusted(addr) {
				return addr.Unmap(), true
			}
		}
		return netip.Addr{}, false
	}
	if addr, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("X-Real-IP"))); err == nil {
		return addr.Unmap(), true
	}
	return netip.Addr{}, false
}

// parseHop reads an X-Forwarded-For entry: an address, or an address with a port ("1.2.3.4:5678",
// "[2001:db8::1]:443") as some load balancers write it.
func parseHop(hop string) (netip.Addr, bool) {
	if addr, err := netip.ParseAddr(hop); err == nil {
		return addr, true
	}
	if ap, err := netip.ParseAddrPort(hop); err == nil {
		return ap.Addr(), true
	}
	return netip.Addr{}, false
}

func remoteAddr(s string) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(s)
	if err != nil {
		host = s
	}
	addr, err := netip.ParseAddr(host)
	return addr.Unmap(), err == nil
}

// ParseTrustedProxies parses a comma-separated list of IPs and CIDRs ("127.0.0.1, 172.16.0.0/12").
func ParseTrustedProxies(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if strings.Contains(item, "/") {
			p, err := netip.ParsePrefix(item)
			if err != nil {
				return nil, err
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(item)
		if err != nil {
			return nil, err
		}
		out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
	}
	return out, nil
}
