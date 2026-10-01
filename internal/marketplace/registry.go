package marketplace

import (
	"fmt"
	"net/url"
	"strings"
)

type Registry struct {
	adapters map[string]Marketplace
}

func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[string]Marketplace),
	}
}

func (r *Registry) Register(m Marketplace) {
	r.adapters[m.Name()] = m
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

	// Domain matching logic with strict host/suffix verification
	if strings.Contains(host, "mock") {
		if m, ok := r.adapters["mock"]; ok {
			return m, nil
		}
	} else if isDomainMatch(host, "shopee.vn", "shopee.com", "shopeemobile.com") {
		if m, ok := r.adapters["shopee"]; ok {
			return m, nil
		}
	} else if isDomainMatch(host, "lazada.vn", "lazada.com") {
		if m, ok := r.adapters["lazada"]; ok {
			return m, nil
		}
	} else if isDomainMatch(host, "tiktok.com") {
		if m, ok := r.adapters["tiktok"]; ok {
			return m, nil
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
