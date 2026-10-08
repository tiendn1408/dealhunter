package notification

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
// stored (Redis), codes expire, wrong guesses are capped, and sending is rate limited per member and
// per phone so the feature cannot be used to spam someone else's number.
type PhoneVerifier struct {
	rdb        *redis.Client
	sender     MessageSender
	templateID string

	TTL          time.Duration
	ResendAfter  time.Duration
	MaxAttempts  int64
	SendsPerHour int64
}

func NewPhoneVerifier(rdb *redis.Client, sender MessageSender, templateID string) *PhoneVerifier {
	return &PhoneVerifier{
		rdb:          rdb,
		sender:       sender,
		templateID:   templateID,
		TTL:          5 * time.Minute,
		ResendAfter:  60 * time.Second,
		MaxAttempts:  5,
		SendsPerHour: 5,
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

// Request sends a new code to phone (already normalized) for userID.
func (v *PhoneVerifier) Request(ctx context.Context, userID uuid.UUID, phone string) (*OTPChallenge, error) {
	if !v.Configured() {
		return nil, ErrOTPNotConfigured
	}

	// Cooldown between two codes for the same member and number
	cooldownKey := "dh:otp:cooldown:" + userID.String() + ":" + phone
	ok, err := v.rdb.SetNX(ctx, cooldownKey, 1, v.ResendAfter).Result()
	if err != nil {
		return nil, fmt.Errorf("otp cooldown: %w", err)
	}
	if !ok {
		ttl, _ := v.rdb.TTL(ctx, cooldownKey).Result()
		return nil, &OTPRateLimitedError{RetryAfter: positive(ttl, v.ResendAfter)}
	}

	// Hourly caps per member and per number (protects the owner of a number from being spammed)
	for _, key := range []string{"dh:otp:user:" + userID.String(), "dh:otp:phone:" + phone} {
		if retry, err := v.countHourly(ctx, key); err != nil {
			return nil, err
		} else if retry > 0 {
			return nil, &OTPRateLimitedError{RetryAfter: retry}
		}
	}

	code, err := randomCode()
	if err != nil {
		return nil, err
	}
	if err := v.rdb.HSet(ctx, otpKey(userID, phone), "hash", otpHash(userID, phone, code), "attempts", 0).Err(); err != nil {
		return nil, fmt.Errorf("store otp: %w", err)
	}
	if err := v.rdb.Expire(ctx, otpKey(userID, phone), v.TTL).Err(); err != nil {
		return nil, fmt.Errorf("store otp: %w", err)
	}

	if _, err := v.sender.SendMessage(ctx, phone, v.templateID, map[string]string{"otp": code}); err != nil {
		v.rdb.Del(ctx, otpKey(userID, phone))
		return nil, fmt.Errorf("send otp: %w", err)
	}
	return &OTPChallenge{Phone: phone, ExpiresIn: int(v.TTL.Seconds()), ResendAfter: int(v.ResendAfter.Seconds())}, nil
}

// Verify checks code for userID and phone. A correct code is consumed; after MaxAttempts wrong codes
// the code is discarded and a new one must be requested.
func (v *PhoneVerifier) Verify(ctx context.Context, userID uuid.UUID, phone, code string) error {
	if !v.Configured() {
		return ErrOTPNotConfigured
	}
	key := otpKey(userID, phone)
	stored, err := v.rdb.HGet(ctx, key, "hash").Result()
	if errors.Is(err, redis.Nil) {
		return ErrOTPInvalid
	}
	if err != nil {
		return fmt.Errorf("load otp: %w", err)
	}

	attempts, err := v.rdb.HIncrBy(ctx, key, "attempts", 1).Result()
	if err != nil {
		return fmt.Errorf("count otp attempt: %w", err)
	}
	if attempts > v.MaxAttempts {
		v.rdb.Del(ctx, key)
		return ErrOTPTooManyAttempts
	}
	if subtle.ConstantTimeCompare([]byte(stored), []byte(otpHash(userID, phone, code))) != 1 {
		if attempts == v.MaxAttempts {
			v.rdb.Del(ctx, key)
			return ErrOTPTooManyAttempts
		}
		return ErrOTPInvalid
	}
	// Consume the code: a second Verify with it fails
	if n, err := v.rdb.Del(ctx, key).Result(); err != nil || n == 0 {
		return ErrOTPInvalid
	}
	return nil
}

// countHourly counts one more send for key and returns how long to wait when over the hourly cap.
func (v *PhoneVerifier) countHourly(ctx context.Context, key string) (time.Duration, error) {
	pipe := v.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, time.Hour)
	ttl := pipe.TTL(ctx, key)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("otp rate limit: %w", err)
	}
	if incr.Val() > v.SendsPerHour {
		return positive(ttl.Val(), time.Hour), nil
	}
	return 0, nil
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("generate otp: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func positive(d, fallback time.Duration) time.Duration {
	if d > 0 {
		return d
	}
	return fallback
}
