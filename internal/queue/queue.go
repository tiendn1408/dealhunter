package queue

import (
	"context"
)

type Message struct {
	MsgID string
	JobID string
}

type Queue interface {
	Enqueue(ctx context.Context, jobID string) error
	Consume(ctx context.Context, consumerName string) (<-chan Message, error)
	Ack(ctx context.Context, msgID string) error
	ReclaimPending(ctx context.Context) error
}
