package retry

import (
	"testing"
	"time"
)

func TestNextAvailableAt(t *testing.T) {
	before := time.Now()

	// Attempt 0 should add 1 minute
	t0 := NextAvailableAt(0)
	diff0 := t0.Sub(before)
	if diff0 < 59*time.Second || diff0 > 61*time.Second {
		t.Errorf("attempt 0 expected ~1m, got %v", diff0)
	}

	// Attempt 1 should add 5 minutes
	t1 := NextAvailableAt(1)
	diff1 := t1.Sub(before)
	if diff1 < 4*time.Minute+59*time.Second || diff1 > 5*time.Minute+2*time.Second {
		t.Errorf("attempt 1 expected ~5m, got %v", diff1)
	}

	// Attempt 2 should add 15 minutes
	t2 := NextAvailableAt(2)
	diff2 := t2.Sub(before)
	if diff2 < 14*time.Minute+59*time.Second || diff2 > 15*time.Minute+2*time.Second {
		t.Errorf("attempt 2 expected ~15m, got %v", diff2)
	}

	// Attempt 10 (beyond slice) should cap at 1 hour
	t10 := NextAvailableAt(10)
	diff10 := t10.Sub(before)
	if diff10 < 59*time.Minute+59*time.Second || diff10 > 60*time.Minute+2*time.Second {
		t.Errorf("attempt 10 expected ~1h, got %v", diff10)
	}
}
