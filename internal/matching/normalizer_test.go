package matching

import (
	"testing"
)

func TestNormalizeTitle(t *testing.T) {
	tests := []struct {
		name               string
		raw                string
		expectSearchTokens []string
		expectModel        string
	}{
		{
			name:               "Shopee Noise with brackets and warranty",
			raw:                "[Chính Hãng] Tai nghe Sony WH-1000XM5 Chống Ồn Đỉnh Cao - Bảo hành 12 tháng - Freeship",
			expectSearchTokens: []string{"sony", "tai", "nghe"},
			expectModel:        "wh-1000xm5",
		},
		{
			name:               "Lazada Akko keyboard with pipes",
			raw:                "Bàn phím cơ không dây AKKO MOD007 PC Blue on White | Hàng chính hãng | BH 1 năm",
			expectSearchTokens: []string{"akko", "ban", "phim"},
			expectModel:        "mod007",
		},
		{
			name:               "Logitech Mouse with special chars",
			raw:                "Chuột Không Dây Logitech MX Master 3S Bluetooth / Wireless - Mới 100% Fullbox",
			expectSearchTokens: []string{"logitech", "chuot", "khong"},
			expectModel:        "3s",
		},
		{
			name:               "Dell Monitor 4K",
			raw:                "Màn Hình Dell UltraSharp U2723QE 4K IPS Black Type-C (3840x2160) - BH 36T",
			expectSearchTokens: []string{"dell", "ultrasharp"},
			expectModel:        "u2723qe",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := NormalizeTitle(tt.raw)
			if res.CleanTitle == "" {
				t.Fatalf("expected non-empty clean title")
			}
			if res.SearchQuery == "" {
				t.Fatalf("expected non-empty search query")
			}

			if tt.expectModel != "" {
				found := false
				for _, m := range res.ModelCodes {
					if m == tt.expectModel {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("expected model %s, found %v", tt.expectModel, res.ModelCodes)
				}
			}
		})
	}
}
