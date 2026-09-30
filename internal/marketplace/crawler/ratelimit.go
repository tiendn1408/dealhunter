package crawler

import (
	"context"
	"strings"
	"sync"
	"time"
)

type domainState struct {
	lastRequest time.Time
	interval    time.Duration
	backoff     time.Duration
}

type DomainRateLimiter struct {
	mu              sync.Mutex
	domains         map[string]*domainState
	defaultInterval time.Duration
}

var (
	defaultLimiter *DomainRateLimiter
	limiterOnce    sync.Once
)

func DefaultRateLimiter() *DomainRateLimiter {
	limiterOnce.Do(func() {
		defaultLimiter = NewDomainRateLimiter(500 * time.Millisecond) // max 2 req/s
	})
	return defaultLimiter
}

func NewDomainRateLimiter(defaultInterval time.Duration) *DomainRateLimiter {
	if defaultInterval <= 0 {
		defaultInterval = 500 * time.Millisecond
	}
	return &DomainRateLimiter{
		domains:         make(map[string]*domainState),
		defaultInterval: defaultInterval,
	}
}

func (l *DomainRateLimiter) cleanHost(host string) string {
	h := strings.ToLower(host)
	if strings.Contains(h, ":") {
		h = strings.Split(h, ":")[0]
	}
	return h
}

func (l *DomainRateLimiter) Wait(ctx context.Context, host string) error {
	domain := l.cleanHost(host)

	l.mu.Lock()
	state, exists := l.domains[domain]
	if !exists {
		state = &domainState{
			interval: l.defaultInterval,
		}
		l.domains[domain] = state
	}

	now := time.Now()
	if state.lastRequest.IsZero() {
		if state.backoff == 0 {
			state.lastRequest = now
			l.mu.Unlock()
			return nil
		}
		state.lastRequest = now
	}

	requiredGap := state.interval
	if state.backoff > 0 {
		requiredGap += state.backoff
		// Decaying backoff on successful subsequent passes
		state.backoff = state.backoff / 2
		if state.backoff < 100*time.Millisecond {
			state.backoff = 0
		}
	}

	earliestAllowed := state.lastRequest.Add(requiredGap)
	waitDuration := earliestAllowed.Sub(now)

	if waitDuration > 0 {
		// Update next request time now while holding lock
		state.lastRequest = earliestAllowed
		l.mu.Unlock()

		select {
		case <-time.After(waitDuration):
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	state.lastRequest = now
	l.mu.Unlock()
	return nil
}

func (l *DomainRateLimiter) RecordBackoff(host string) {
	domain := l.cleanHost(host)

	l.mu.Lock()
	defer l.mu.Unlock()

	state, exists := l.domains[domain]
	if !exists {
		state = &domainState{
			interval:    l.defaultInterval,
			lastRequest: time.Now(),
		}
		l.domains[domain] = state
	} else {
		state.lastRequest = time.Now()
	}

	if state.backoff == 0 {
		state.backoff = 2 * time.Second
	} else if state.backoff < 30*time.Second {
		state.backoff *= 2
	}
}
