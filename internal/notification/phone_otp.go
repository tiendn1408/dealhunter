package notification

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

var (
	// ErrOTPNotConfigured means Zalo OA or the ZNS OTP template is not configured on the server.
	ErrOTPNotConfigured = errors.New("zalo OTP is not configured")
	// ErrOTPInvalid covers a wrong code as well as an expired or never requested one.
	ErrOTPInvalid = errors.New("verification code is wrong or expired")
	// ErrOTPTooManyAttempts means the code was invalidated after too many wrong guesses.
	ErrOTPTooManyAttempts = errors.New("too many wrong verification codes")
)

// OTPRateLimitedError is returned when a code was requested too soon or too often.
type OTPRateLimitedError struct{ RetryAfter time.Duration }

func (e *OTPRateLimitedError) Error() string {
	return fmt.Sprintf("verification code requested too often, retry in %s", e.RetryAfter.Round(time.Second))
}

// MessageSender delivers a ZNS template message (zalo.ZaloClient satisfies it).
type MessageSender interface {
	SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) (string, error)
}

// OTPChallenge describes a code that was just sent.
type OTPChallenge struct {
	Phone       string `json:"phone"`
	ExpiresIn   int    `json:"expires_in"`
	ResendAfter int    `json:"resend_after"`
}

// PhoneVerifier proves that a member owns a phone number before it is linked for Zalo notifications:
// a 6-digit code is sent by ZNS to that number and must be typed back. Only a hash of the code is
// stored (Redis), codes expire, wrong guesses are capped, and sending is rate limited so the feature
// cannot be used to spam someone else's number: per member, per member+number, and per number (a
// higher cap, so one account alone cannot use up the owner's quota). Every check-and-update runs as one
// Redis script, so concurrent requests cannot get past a limit.
type PhoneVerifier struct {
	rdb        *redis.Client
	sender     MessageSender
	templateID string

	TTL               time.Duration
	ResendAfter       time.Duration
	MaxAttempts       int64
	SendsPerHour      int64 // per member, all numbers
	SendsPerHourPair  int64 // per member and number
	SendsPerHourPhone int64 // per number, all members
}

func NewPhoneVerifier(rdb *redis.Client, sender MessageSender, templateID string) *PhoneVerifier {
	return &PhoneVerifier{
		rdb:               rdb,
		sender:            sender,
		templateID:        templateID,
		TTL:               5 * time.Minute,
		ResendAfter:       60 * time.Second,
		MaxAttempts:       5,
		SendsPerHour:      5,
		SendsPerHourPair:  3,
		SendsPerHourPhone: 10,
	}
}

// Configured reports whether codes can be sent at all.
func (v *PhoneVerifier) Configured() bool {
	return v != nil && v.rdb != nil && v.sender != nil && v.templateID != ""
}

func otpKey(userID uuid.UUID, phone string) string {
	return "dh:otp:code:" + userID.String() + ":" + phone
}

func otpHash(userID uuid.UUID, phone, code string) string {
	sum := sha256.Sum256([]byte(userID.String() + "|" + phone + "|" + code))
	return hex.EncodeToString(sum[:])
}

func (v *PhoneVerifier) quotaKeys(userID uuid.UUID, phone string) []string {
	return []string{
		"dh:otp:cooldown:" + userID.String() + ":" + phone,
		"dh:otp:user:" + userID.String(),
		"dh:otp:pair:" + userID.String() + ":" + phone,
		"dh:otp:phone:" + phone,
	}
}

// reserveScript checks the cooldown and the three hourly caps and, only if all pass, records the send.
// Returns 0 when reserved, else the milliseconds to wait.
var reserveScript = redis.NewScript(`
local cooldownMs, hourMs = math.max(1, tonumber(ARGV[1])), 3600000
local wait = redis.call('PTTL', KEYS[1])
if wait > 0 then return wait end
for i = 2, 4 do
  local n = tonumber(redis.call('GET', KEYS[i]) or '0')
  if n >= tonumber(ARGV[i]) then
    local ttl = redis.call('PTTL', KEYS[i])
    if ttl > 0 then return ttl end
    return hourMs
  end
end
redis.call('SET', KEYS[1], 1, 'PX', cooldownMs)
for i = 2, 4 do
  if redis.call('INCR', KEYS[i]) == 1 then redis.call('PEXPIRE', KEYS[i], hourMs) end
end
return 0
`)

// releaseScript gives back a reservation whose code could not be sent.
var releaseScript = redis.NewScript(`
redis.call('DEL', KEYS[1])
for i = 2, 4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') > 0 then redis.call('DECR', KEYS[i]) end
end
return 0
`)

// verifyScript checks one guess atomically. Returns 1 = correct (code consumed), 0 = wrong or no code,
// 2 = too many wrong guesses (code discarded). A guess after the code is gone never recreates it.
var verifyScript = redis.NewScript(`
local stored = redis.call('HGET', KEYS[1], 'hash')
if not stored then return 0 end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 2
end
return 0
`)

// Request sends a new code to phone (already normalized) for userID.
func (v *PhoneVerifier) Request(ctx context.Context, userID uuid.UUID, phone string) (*OTPChallenge, error) {
	if !v.Configured() {
		return nil, ErrOTPNotConfigured
	}

	keys := v.quotaKeys(userID, phone)
	wait, err := reserveScript.Run(ctx, v.rdb, keys,
		v.ResendAfter.Milliseconds(), v.SendsPerHour, v.SendsPerHourPair, v.SendsPerHourPhone).Int64()
	if err != nil {
		return nil, fmt.Errorf("otp rate limit: %w", err)
	}
	if wait > 0 {
		return nil, &OTPRateLimitedError{RetryAfter: time.Duration(wait) * time.Millisecond}
	}

	code, err := randomCode()
	if err != nil {
		v.release(keys)
		return nil, err
	}
	// Hash and expiry are written together: a stored code always expires
	pipe := v.rdb.TxPipeline()
	pipe.Del(ctx, otpKey(userID, phone))
	pipe.HSet(ctx, otpKey(userID, phone), "hash", otpHash(userID, phone, code), "attempts", 0)
	pipe.PExpire(ctx, otpKey(userID, phone), v.TTL)
	if _, err := pipe.Exec(ctx); err != nil {
		v.release(keys)
		return nil, fmt.Errorf("store otp: %w", err)
	}

	if _, err := v.sender.SendMessage(ctx, phone, v.templateID, map[string]string{"otp": code}); err != nil {
		// Nothing reached the phone: drop the code and give the quota back
		v.rdb.Del(context.WithoutCancel(ctx), otpKey(userID, phone))
		v.release(keys)
		return nil, fmt.Errorf("send otp: %w", err)
	}
	return &OTPChallenge{Phone: phone, ExpiresIn: int(v.TTL.Seconds()), ResendAfter: int(v.ResendAfter.Seconds())}, nil
}

func (v *PhoneVerifier) release(keys []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = releaseScript.Run(ctx, v.rdb, keys).Err()
}

// Verify checks code for userID and phone. A correct code is consumed; after MaxAttempts wrong codes
// the code is discarded and a new one must be requested. Concurrent guesses are counted exactly.
func (v *PhoneVerifier) Verify(ctx context.Context, userID uuid.UUID, phone, code string) error {
	if !v.Configured() {
		return ErrOTPNotConfigured
	}
	res, err := verifyScript.Run(ctx, v.rdb, []string{otpKey(userID, phone)},
		otpHash(userID, phone, code), v.MaxAttempts).Int64()
	if err != nil {
		return fmt.Errorf("verify otp: %w", err)
	}
	switch res {
	case 1:
		return nil
	case 2:
		return ErrOTPTooManyAttempts
	default:
		return ErrOTPInvalid
	}
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("generate otp: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
