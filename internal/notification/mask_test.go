package notification

import "testing"

func TestMaskRecipient(t *testing.T) {
	cases := map[string]string{
		"0912345678":   "09*****678",
		"+84912345678": "+8*******678",
		"12345":        "***",
		"":             "***",
	}
	for in, want := range cases {
		if got := MaskRecipient(in); got != want {
			t.Errorf("MaskRecipient(%q) = %q, want %q", in, got, want)
		}
	}
}
