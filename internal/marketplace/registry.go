package marketplace

import (
	"fmt"
	"net/url"
	"strings"
)

// platformDomains maps each supported real marketplace to the hosts its product URLs use.
var platformDomains = map[string][]string{
	"shopee": {"shopee.vn", "shopee.com", "shopeemobile.com"},
	"lazada": {"lazada.vn", "lazada.com"},
	"tiktok": {"tiktok.com"},
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
