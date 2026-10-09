package router

import (
	"net/url"
	"testing"
	"time"
)

// The price-history range accepts what the web sends (RFC3339) as well as plain dates, and a value it
// cannot read is an error — never silently replaced by the 30-day default.
func TestParseHistoryRange(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	q := func(kv ...string) url.Values {
		v := url.Values{}
		for i := 0; i < len(kv); i += 2 {
			v.Set(kv[i], kv[i+1])
		}
		return v
	}

	from, to, err := parseHistoryRange(q(), now)
	if err != nil || !from.Equal(now.AddDate(0, 0, -30)) || !to.Equal(now) {
		t.Fatalf("default: got %v..%v (%v)", from, to, err)
	}
	from, _, err = parseHistoryRange(q("from", "2026-07-11T12:00:00Z"), now)
	if err != nil || !from.Equal(time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("RFC3339 from: got %v (%v)", from, err)
	}
	from, to, err = parseHistoryRange(q("from", "2026-07-11", "to", "2026-07-20"), now)
	if err != nil || !from.Equal(time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC)) || !to.Equal(time.Date(2026, 7, 20, 23, 59, 59, 0, time.UTC)) {
		t.Fatalf("date range: got %v..%v (%v)", from, to, err)
	}
	for _, bad := range []url.Values{q("from", "yesterday"), q("to", "2026-13-01"), q("from", "2026-10-01T00:00:00Z", "to", "2026-09-01T00:00:00Z")} {
		if _, _, err := parseHistoryRange(bad, now); err == nil {
			t.Errorf("%v: expected an error", bad)
		}
	}
}
