package matching

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/tiendang/deal-hunter/internal/marketplace/crawler"
)

// CandidateSearcher defines the interface for discovering candidate products on target marketplaces.
type CandidateSearcher interface {
	Search(ctx context.Context, targetPlatform, query string) ([]*MatchCandidate, error)
}

// MultiPlatformSearcher coordinates cross-platform product searches across Shopee, Lazada, and TikTok Shop.
type MultiPlatformSearcher struct {
	crawler *crawler.Client
}

func NewMultiPlatformSearcher(c *crawler.Client) *MultiPlatformSearcher {
	if c == nil {
		client, err := crawler.NewClient(crawler.ClientOptions{Timeout: 10 * time.Second})
		if err == nil {
			c = client
		}
	}
	return &MultiPlatformSearcher{crawler: c}
}

// Search searches candidates for a query on a given platform.
func (s *MultiPlatformSearcher) Search(ctx context.Context, targetPlatform, query string) ([]*MatchCandidate, error) {
	switch strings.ToLower(targetPlatform) {
	case "shopee":
		return s.searchShopee(ctx, query)
	case "lazada":
		return s.searchLazada(ctx, query)
	case "tiktok":
		return s.searchTikTok(ctx, query)
	default:
		return nil, fmt.Errorf("unsupported target platform: %s", targetPlatform)
	}
}

// searchShopee searches Shopee for candidate items.
func (s *MultiPlatformSearcher) searchShopee(ctx context.Context, query string) ([]*MatchCandidate, error) {
	apiURL := fmt.Sprintf("https://shopee.vn/api/v4/search/search_items?by=relevancy&keyword=%s&limit=5&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2", url.QueryEscape(query))

	resp, err := s.crawler.Fetch(ctx, apiURL, map[string]string{
		"Referer": "https://shopee.vn/",
	})

	var candidates []*MatchCandidate
	if err == nil && resp.StatusCode == 200 {
		var apiResp struct {
			Items []struct {
				ItemBasic struct {
					ItemID       int64  `json:"itemid"`
					ShopID       int64  `json:"shopid"`
					Name         string `json:"name"`
					Price        int64  `json:"price"`
					Historical   int64  `json:"historical_sold"`
					IsOfficial   bool   `json:"is_official_shop"`
					ShopLocation string `json:"shop_location"`
				} `json:"item_basic"`
			} `json:"items"`
		}

		if jErr := json.Unmarshal(resp.Body, &apiResp); jErr == nil && len(apiResp.Items) > 0 {
			for _, item := range apiResp.Items {
				b := item.ItemBasic
				if b.ItemID <= 0 || b.Name == "" {
					continue
				}
				candURL := fmt.Sprintf("https://shopee.vn/product/%d/%d", b.ShopID, b.ItemID)
				price := b.Price / 100000 // Shopee 5 decimal places
				candidates = append(candidates, &MatchCandidate{
					Platform: "shopee",
					URL:      candURL,
					Title:    b.Name,
					// The search API does not return the shop name; leave it unknown
					Price:  price,
					IsMall: b.IsOfficial,
				})
			}
		}
	}

	// Blocked or empty search yields no candidates; nothing is substituted
	return candidates, nil
}

// searchLazada: Lazada serves an anti-bot challenge to plain HTTP clients and its search page is not a
// product, so live search needs the headless tier (GAP-01b). Until then there are no Lazada candidates.
func (s *MultiPlatformSearcher) searchLazada(ctx context.Context, query string) ([]*MatchCandidate, error) {
	return nil, nil
}

// searchTikTok: TikTok Shop search is not implemented yet (needs the headless tier, GAP-01b).
func (s *MultiPlatformSearcher) searchTikTok(ctx context.Context, query string) ([]*MatchCandidate, error) {
	return nil, nil
}
