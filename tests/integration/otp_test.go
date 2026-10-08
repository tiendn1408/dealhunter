//go:build integration
// +build integration

package integration

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiendang/deal-hunter/internal/notification"
	"github.com/tiendang/deal-hunter/tests/fakezalo"
)

// The OTP limits hold under concurrency (every check-and-update is one Redis script).
func TestPhoneVerifier_Concurrency(t *testing.T) {
	ctx := context.Background()
	rdb := getTestRedisClient(t)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Skipping integration test: Redis not reachable: %v", err)
	}
	defer rdb.Close()
	sender := fakezalo.NewMockZaloClient()
	v := notification.NewPhoneVerifier(rdb, sender, "otp-template")
	phone := func() string { return fmt.Sprintf("8491%07d", uuid.New().ID()%10000000) }

	t.Run("parallel wrong guesses cannot exceed the attempt cap", func(t *testing.T) {
		user, number := uuid.New(), phone()
		if _, err := v.Request(ctx, user, number); err != nil {
			t.Fatal(err)
		}
		realCode := sender.SentMessages[len(sender.SentMessages)-1].Params["otp"]
		wrong := "000000"
		if realCode == wrong {
			wrong = "111111"
		}

		var tooMany, valid int32
		var wg sync.WaitGroup
		for i := 0; i < 200; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				switch err := v.Verify(ctx, user, number, wrong); {
				case err == nil:
					atomic.AddInt32(&valid, 1)
				case errors.Is(err, notification.ErrOTPTooManyAttempts):
					atomic.AddInt32(&tooMany, 1)
				}
			}()
		}
		wg.Wait()
		if valid != 0 || tooMany != 1 {
			t.Fatalf("expected exactly one 'too many attempts' and no success, got tooMany=%d valid=%d", tooMany, valid)
		}
		if err := v.Verify(ctx, user, number, realCode); !errors.Is(err, notification.ErrOTPInvalid) {
			t.Fatalf("the code must be gone after the cap, got %v", err)
		}
		if n, _ := rdb.Exists(ctx, "dh:otp:code:"+user.String()+":"+number).Result(); n != 0 {
			t.Fatal("a guess after the cap must not recreate the code")
		}
	})

	t.Run("parallel requests send one code", func(t *testing.T) {
		user, number := uuid.New(), phone()
		before := sender.CountSent()
		var ok int32
		var wg sync.WaitGroup
		for i := 0; i < 20; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := v.Request(ctx, user, number); err == nil {
					atomic.AddInt32(&ok, 1)
				}
			}()
		}
		wg.Wait()
		if ok != 1 || sender.CountSent()-before != 1 {
			t.Fatalf("expected one code sent, got ok=%d sent=%d", ok, sender.CountSent()-before)
		}
	})

	t.Run("a failed send gives the quota back", func(t *testing.T) {
		user, number := uuid.New(), phone()
		sender.ShouldFail, sender.FailError = true, errors.New("zns down")
		_, err := v.Request(ctx, user, number)
		sender.ShouldFail, sender.FailError = false, nil
		if err == nil {
			t.Fatal("expected the send error")
		}
		if _, err := v.Request(ctx, user, number); err != nil {
			t.Fatalf("after a failed send the member may retry at once, got %v", err)
		}
	})

	t.Run("one account cannot use up the number's quota", func(t *testing.T) {
		attacker, number := uuid.New(), phone()
		v2 := notification.NewPhoneVerifier(rdb, sender, "otp-template")
		v2.ResendAfter = time.Millisecond // short cooldown, to reach the hourly caps quickly
		sent := 0
		for i := 0; i < 10; i++ {
			if _, err := v2.Request(ctx, attacker, number); err == nil {
				sent++
			}
			time.Sleep(3 * time.Millisecond)
		}
		if sent != int(v2.SendsPerHourPair) {
			t.Fatalf("one member may send %d codes per number per hour, sent %d", v2.SendsPerHourPair, sent)
		}
		if _, err := v2.Request(ctx, uuid.New(), number); err != nil {
			t.Fatalf("the owner must still be able to request a code, got %v", err)
		}
	})
}
