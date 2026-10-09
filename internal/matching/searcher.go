package matching

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
	shopeeBase string // https://shopee.vn; a test server in tests
	crawler    *crawler.Client
}

func NewMultiPlatformSearcher(c *crawler.Client) *MultiPlatformSearcher {
	if c == nil {
		client, err := crawler.NewClient(crawler.ClientOptions{Timeout: 10 * time.Second})
		if err == nil {
			c = client
		}
	}
	return &MultiPlatformSearcher{shopeeBase: "https://shopee.vn", crawler: c}
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

// ErrSearchUnavailable means a marketplace search could not be read (blocked, rate limited, unreachable).
var ErrSearchUnavailable = errors.New("marketplace search unavailable")

// searchShopee searches Shopee for candidate items.
func (s *MultiPlatformSearcher) searchShopee(ctx context.Context, query string) ([]*MatchCandidate, error) {
	apiURL := fmt.Sprintf(s.shopeeBase+"/api/v4/search/search_items?by=relevancy&keyword=%s&limit=5&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2", url.QueryEscape(query))

	resp, err := s.crawler.Fetch(ctx, apiURL, map[string]string{
		"Referer": "https://shopee.vn/",
	})
	if err != nil {
		// Blocked, rate limited or unreachable: a failure, not "no candidates"
		return nil, fmt.Errorf("%w: shopee: %w", ErrSearchUnavailable, err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: shopee: search answered HTTP %d", ErrSearchUnavailable, resp.StatusCode)
	}

	var candidates []*MatchCandidate
	{
		var apiResp struct {
			Error int `json:"error"`
			// A pointer tells "no items field" (blocked / changed answer) from a real empty list
			Items *[]struct {
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

		if jErr := json.Unmarshal(resp.Body, &apiResp); jErr != nil {
			// An anti-bot page answered with 200 instead of the search JSON
			return nil, fmt.Errorf("%w: shopee: unreadable search response: %w", ErrSearchUnavailable, jErr)
		} else if apiResp.Error != 0 || apiResp.Items == nil {
			return nil, fmt.Errorf("%w: shopee: search answered error %d without results", ErrSearchUnavailable, apiResp.Error)
		} else {
			for _, item := range *apiResp.Items {
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

	// An empty result is a real "no candidates"; nothing is ever substituted
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
