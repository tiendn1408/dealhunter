package phone

import (
	"errors"
	"regexp"
	"strings"
)

// ErrInvalid is returned for anything that is not a Vietnamese mobile number.
var ErrInvalid = errors.New("invalid Vietnamese mobile number")

var vnMobile = regexp.MustCompile(`^84[35789][0-9]{8}$`)

// Normalize returns a Vietnamese mobile number in the 84xxxxxxxxx form ZNS expects, accepting
// 0912345678, 84912345678 and +84912345678 with spaces, dots or dashes. One number has exactly one
// spelling, so the unique constraint on users.phone cannot be bypassed with another format.
func Normalize(raw string) (string, error) {
	s := strings.Map(func(r rune) rune {
		switch r {
		case ' ', '.', '-', '(', ')':
			return -1
		}
		return r
	}, strings.TrimSpace(raw))
	s = strings.TrimPrefix(s, "+")
	if strings.HasPrefix(s, "0") {
		s = "84" + s[1:]
	}
	if !vnMobile.MatchString(s) {
		return "", ErrInvalid
	}
	return s, nil
}
