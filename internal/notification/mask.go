package notification

// MaskRecipient hides most of a phone number or Zalo ID for logs, e.g. "0912345678" -> "09*****678" (SEC-12).
func MaskRecipient(s string) string {
	r := []rune(s)
	if len(r) < 7 {
		return "***"
	}
	masked := make([]rune, len(r))
	for i := range r {
		if i < 2 || i >= len(r)-3 {
			masked[i] = r[i]
		} else {
			masked[i] = '*'
		}
	}
	return string(masked)
}
