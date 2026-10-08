package crawler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

type ExtractedProduct struct {
	Title       string
	Price       int64
	ListedPrice int64
	ShippingFee *int64 // nil when the page does not state a shipping fee
	Currency    string
	InStock     *bool // nil when the page does not state availability
	ImageURL    string
	SellerName  string
	Brand       string
	Description string
}

type JsonLdOffer struct {
	Price         interface{} `json:"price"`
	PriceCurrency string      `json:"priceCurrency"`
	Availability  string      `json:"availability"`
	Seller        interface{} `json:"seller"`
}

type JsonLdProduct struct {
	Type        interface{} `json:"@type"`
	Name        string      `json:"name"`
	Image       interface{} `json:"image"`
	Description string      `json:"description"`
	Brand       interface{} `json:"brand"`
	Offers      interface{} `json:"offers"`
}

// ExtractFromHTML parses HTML content to extract product metadata.
func ExtractFromHTML(body []byte, pageURL string) (*ExtractedProduct, error) {
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("parse html: %w", err)
	}

	metaTags := make(map[string]string)
	jsonLdScripts := make([]string, 0)
	var titleTag string

	var traverse func(*html.Node)
	traverse = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch strings.ToLower(n.Data) {
			case "meta":
				var prop, name, content string
				for _, a := range n.Attr {
					key := strings.ToLower(a.Key)
					if key == "property" {
						prop = strings.ToLower(a.Val)
					} else if key == "name" {
						name = strings.ToLower(a.Val)
					} else if key == "content" {
						content = a.Val
					}
				}
				if prop != "" && content != "" {
					metaTags[prop] = content
				}
				if name != "" && content != "" {
					metaTags[name] = content
				}
			case "script":
				isJsonLd := false
				for _, a := range n.Attr {
					if strings.ToLower(a.Key) == "type" && strings.ToLower(a.Val) == "application/ld+json" {
						isJsonLd = true
						break
					}
				}
				if isJsonLd && n.FirstChild != nil {
					jsonLdScripts = append(jsonLdScripts, n.FirstChild.Data)
				}
			case "title":
				if n.FirstChild != nil {
					titleTag = n.FirstChild.Data
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			traverse(c)
		}
	}
	traverse(doc)

	// Only values present on the page are filled in; nothing is assumed (stock, shipping, seller).
	prod := &ExtractedProduct{
		Currency: "VND",
	}

	// 1. Try extracting from JSON-LD Schema.org first (most structured)
	for _, rawJSON := range jsonLdScripts {
		if parseJsonLd(rawJSON, prod) {
			break
		}
	}

	// 2. OpenGraph & Twitter Fallback / Augmentation
	if prod.Title == "" {
		if ogTitle, ok := metaTags["og:title"]; ok && ogTitle != "" {
			prod.Title = CleanTitle(ogTitle)
		} else if twTitle, ok := metaTags["twitter:title"]; ok && twTitle != "" {
			prod.Title = CleanTitle(twTitle)
		} else if titleTag != "" {
			prod.Title = CleanTitle(titleTag)
		}
	}

	if prod.ImageURL == "" {
		if ogImg, ok := metaTags["og:image"]; ok && ogImg != "" {
			prod.ImageURL = ogImg
		} else if twImg, ok := metaTags["twitter:image"]; ok && twImg != "" {
			prod.ImageURL = twImg
		}
	}

	if prod.Description == "" {
		if ogDesc, ok := metaTags["og:description"]; ok {
			prod.Description = ogDesc
		} else if desc, ok := metaTags["description"]; ok {
			prod.Description = desc
		}
	}

	// Price extraction from meta if not found in JSON-LD
	if prod.Price == 0 {
		var priceStr string
		if p, ok := metaTags["og:price:amount"]; ok {
			priceStr = p
		} else if p, ok := metaTags["product:price:amount"]; ok {
			priceStr = p
		}

		if priceStr != "" {
			parsedPrice, err := ParseVNDPrice(priceStr)
			if err == nil && parsedPrice > 0 {
				prod.Price = parsedPrice
			}
		}
	}

	if prod.ListedPrice == 0 && prod.Price > 0 {
		prod.ListedPrice = prod.Price
	}

	return prod, nil
}

func parseJsonLd(raw string, prod *ExtractedProduct) bool {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "{") && !strings.HasPrefix(raw, "[") {
		return false
	}

	// Check if array
	if strings.HasPrefix(raw, "[") {
		var list []map[string]interface{}
		if err := json.Unmarshal([]byte(raw), &list); err == nil {
			for _, item := range list {
				if extractProductMap(item, prod) {
					return true
				}
			}
		}
		return false
	}

	// Single object
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return false
	}

	// Check @graph structure
	if graph, ok := obj["@graph"].([]interface{}); ok {
		for _, item := range graph {
			if itemMap, ok := item.(map[string]interface{}); ok {
				if extractProductMap(itemMap, prod) {
					return true
				}
			}
		}
	}

	return extractProductMap(obj, prod)
}

func extractProductMap(m map[string]interface{}, prod *ExtractedProduct) bool {
	typeVal, hasType := m["@type"]
	if !hasType {
		return false
	}

	isProduct := false
	switch t := typeVal.(type) {
	case string:
		if strings.EqualFold(t, "Product") || strings.EqualFold(t, "IndividualProduct") {
			isProduct = true
		}
	case []interface{}:
		for _, v := range t {
			if str, ok := v.(string); ok && strings.EqualFold(str, "Product") {
				isProduct = true
				break
			}
		}
	}

	if !isProduct {
		return false
	}

	if name, ok := m["name"].(string); ok && name != "" {
		prod.Title = CleanTitle(name)
	}

	if desc, ok := m["description"].(string); ok {
		prod.Description = desc
	}

	if brandObj, ok := m["brand"].(map[string]interface{}); ok {
		if bName, ok := brandObj["name"].(string); ok {
			prod.Brand = bName
		}
	} else if brandStr, ok := m["brand"].(string); ok {
		prod.Brand = brandStr
	}

	if img, ok := m["image"].(string); ok {
		prod.ImageURL = img
	} else if imgList, ok := m["image"].([]interface{}); ok && len(imgList) > 0 {
		if firstImg, ok := imgList[0].(string); ok {
			prod.ImageURL = firstImg
		}
	}

	// Parse offers
	if offers, ok := m["offers"]; ok {
		extractOffers(offers, prod)
	}

	return prod.Title != ""
}

func extractOffers(offers interface{}, prod *ExtractedProduct) {
	switch o := offers.(type) {
	case map[string]interface{}:
		parseSingleOffer(o, prod)
	case []interface{}:
		for _, item := range o {
			if offerMap, ok := item.(map[string]interface{}); ok {
				parseSingleOffer(offerMap, prod)
				if prod.Price > 0 {
					break
				}
			}
		}
	}
}

func parseSingleOffer(offer map[string]interface{}, prod *ExtractedProduct) {
	if priceVal, ok := offer["price"]; ok {
		switch p := priceVal.(type) {
		case float64:
			prod.Price = int64(p)
		case int64:
			prod.Price = p
		case string:
			parsed, err := ParseVNDPrice(p)
			if err == nil {
				prod.Price = parsed
			}
		}
	}

	if curr, ok := offer["priceCurrency"].(string); ok && curr != "" {
		prod.Currency = curr
	}

	if avail, ok := offer["availability"].(string); ok {
		inStock := strings.Contains(strings.ToLower(avail), "instock") ||
			strings.Contains(strings.ToLower(avail), "instoreonly")
		prod.InStock = &inStock
	}

	if seller, ok := offer["seller"].(map[string]interface{}); ok {
		if sName, ok := seller["name"].(string); ok {
			prod.SellerName = sName
		}
	}
}

var suffixRegex = regexp.MustCompile(`(?i)\s*(\|\s*Shopee\s*Vi[ệe]t\s*Nam|\-\s*Mua\s*ngay\s*\|\s*Lazada\.vn|\|\s*Lazada\.vn|\|\s*TikTok\s*Shop|\|\s*Tiki).*$`)

// CleanTitle removes marketplace branding suffixes and trims whitespace.
func CleanTitle(title string) string {
	cleaned := suffixRegex.ReplaceAllString(title, "")
	cleaned = strings.TrimSpace(cleaned)
	cleaned = strings.ReplaceAll(cleaned, "\n", " ")
	cleaned = strings.ReplaceAll(cleaned, "\r", " ")
	for strings.Contains(cleaned, "  ") {
		cleaned = strings.ReplaceAll(cleaned, "  ", " ")
	}
	return cleaned
}

// ParseVNDPrice parses prices formatted in Vietnamese Dong or raw numerals.
func ParseVNDPrice(priceStr string) (int64, error) {
	clean := strings.TrimSpace(priceStr)
	clean = strings.ReplaceAll(clean, "₫", "")
	clean = strings.ReplaceAll(clean, "VND", "")
	clean = strings.ReplaceAll(clean, "vnd", "")
	clean = strings.ReplaceAll(clean, "đ", "")
	clean = strings.ReplaceAll(clean, " ", "")

	// The last ',' or '.' is a decimal separator when 1-2 digits follow it (6290000.00, 6.290.000,00,
	// 6,290,000.5), or when it is the only separator and more than 3 digits precede it (6290000.000 —
	// thousands groups never exceed 3 digits). Every other separator groups thousands (6.290.000, 1.500).
	if i := strings.LastIndexAny(clean, ".,"); i >= 0 {
		frac := len(clean) - i - 1
		onlySeparator := strings.IndexAny(clean, ".,") == i
		if (frac >= 1 && frac <= 2) || (onlySeparator && i > 3) {
			clean = clean[:i]
		}
	}
	clean = strings.ReplaceAll(clean, ".", "")
	clean = strings.ReplaceAll(clean, ",", "")

	val, err := strconv.ParseInt(clean, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid price string '%s': %w", priceStr, err)
	}
	return val, nil
}
