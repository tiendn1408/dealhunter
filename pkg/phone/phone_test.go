package phone

import "testing"

func TestNormalize(t *testing.T) {
	valid := map[string]string{
		"0912345678":      "84912345678",
		"0912 345 678":    "84912345678",
		"091.234.5678":    "84912345678",
		"84912345678":     "84912345678",
		"+84 912-345-678": "84912345678",
		"0386123456":      "84386123456",
	}
	for in, want := range valid {
		if got, err := Normalize(in); err != nil || got != want {
			t.Errorf("Normalize(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "12345", "0212345678", "091234567", "09123456789", "+1 415 555 0100", "84912345678x"} {
		if got, err := Normalize(in); err == nil {
			t.Errorf("Normalize(%q) = %q, expected an error", in, got)
		}
	}
}
