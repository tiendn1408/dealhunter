package zalo

import (
	"context"
	"sync"

	"github.com/google/uuid"
)

type SentMessage struct {
	MsgID      string
	Recipient  string
	TemplateID string
	Params     map[string]string
}

type MockZaloClient struct {
	mu           sync.Mutex
	SentMessages []SentMessage
	ShouldFail   bool
	FailError    error
}

func NewMockZaloClient() *MockZaloClient {
	return &MockZaloClient{
		SentMessages: make([]SentMessage, 0),
	}
}

func (m *MockZaloClient) SendMessage(ctx context.Context, recipient string, templateID string, params map[string]string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.ShouldFail && m.FailError != nil {
		return "", m.FailError
	}

	msgID := "mock-msg-" + uuid.NewString()
	m.SentMessages = append(m.SentMessages, SentMessage{
		MsgID:      msgID,
		Recipient:  recipient,
		TemplateID: templateID,
		Params:     params,
	})
	return msgID, nil
}

func (m *MockZaloClient) CountSent() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.SentMessages)
}

func (m *MockZaloClient) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SentMessages = make([]SentMessage, 0)
}
