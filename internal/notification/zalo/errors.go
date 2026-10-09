package zalo

import "errors"

// ErrNotSent marks a send that certainly did not reach the recipient: it failed before the request left
// (no token, bad payload) or Zalo answered with an explicit rejection. Any other failure (timeout,
// dropped connection, unreadable answer) may have been delivered and must be treated as sent.
var ErrNotSent = errors.New("zalo message not sent")
