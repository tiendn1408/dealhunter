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
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}

	host := strings.ToLower(parsed.Host)
	
	// Basic domain matching logic
	if strings.Contains(host, "shopee.vn") {
		if m, ok := r.adapters["shopee"]; ok {
			return m, nil
		}
	} else if strings.Contains(host, "lazada.vn") {
		if m, ok := r.adapters["lazada"]; ok {
			return m, nil
		}
	} else if strings.Contains(host, "tiktok.com") {
		if m, ok := r.adapters["tiktok"]; ok {
			return m, nil
		}
	} else if strings.Contains(host, "mock") {
		if m, ok := r.adapters["mock"]; ok {
			return m, nil
		}
	}

	return nil, fmt.Errorf("unsupported or unregistered platform for url: %s", productURL)
}
