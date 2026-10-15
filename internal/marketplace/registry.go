package marketplace

import (
	"fmt"
	"net/url"
	"strings"
)

// platformDomains maps each supported real marketplace to the hosts its product URLs use.
// Short-link hosts are listed too: the "Share" button of each marketplace app copies one of them.
var platformDomains = map[string][]string{
	"shopee": {"shopee.vn", "shopee.com", "shopeemobile.com", "shp.ee", "shope.ee"},
	"lazada": {"lazada.vn", "lazada.com", "lzd.co"},
	"tiktok": {"tiktok.com"},
}

// shortLinkHosts are the hosts whose links only redirect to the real product page.
var shortLinkHosts = map[string][]string{
	"shopee": {"shp.ee", "shope.ee", "s.shopee.vn"},
	"lazada": {"s.lazada.vn", "lzd.co"},
	"tiktok": {"vt.tiktok.com", "vm.tiktok.com"},
}

// IsShortLink reports whether rawURL is one of the platform's share short links (e.g. vn.shp.ee/...),
// which must be followed to the product page before it can be read.
func IsShortLink(platform, rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	return isDomainMatch(strings.ToLower(parsed.Hostname()), shortLinkHosts[platform]...)
}

// WithoutQuery drops the query and fragment (share/tracking parameters such as utm_content,
// uls_trackid) from a resolved product URL; the product is identified by its path.
func WithoutQuery(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return rawURL
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

type Registry struct {
	adapters map[string]Marketplace
	domains  map[string][]string
}

func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[string]Marketplace),
		domains:  make(map[string][]string),
	}
}

// Register adds a real marketplace adapter; its hosts come from platformDomains.
func (r *Registry) Register(m Marketplace) {
	r.adapters[m.Name()] = m
	r.domains[m.Name()] = platformDomains[m.Name()]
}

// RegisterForHosts adds an adapter for explicit hosts. Intended for test adapters only.
func (r *Registry) RegisterForHosts(m Marketplace, domains ...string) {
	r.adapters[m.Name()] = m
	r.domains[m.Name()] = domains
}

func (r *Registry) Detect(productURL string) (Marketplace, error) {
	parsed, err := url.Parse(productURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("invalid url: %s", productURL)
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return nil, fmt.Errorf("invalid host in url: %s", productURL)
	}

	// Strict host/suffix matching against the registered adapters' domains
	for name, domains := range r.domains {
		if isDomainMatch(host, domains...) {
			return r.adapters[name], nil
		}
	}

	return nil, fmt.Errorf("unsupported or unregistered platform for url: %s", productURL)
}

func isDomainMatch(host string, domains ...string) bool {
	for _, d := range domains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}
