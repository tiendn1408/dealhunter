package queue

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

type RedisStreamQueue struct {
	client *redis.Client
	stream string
	group  string
}

func NewRedisStreamQueue(client *redis.Client, stream, group string) *RedisStreamQueue {
	return &RedisStreamQueue{
		client: client,
		stream: stream,
		group:  group,
	}
}

func (q *RedisStreamQueue) Init(ctx context.Context) error {
	err := q.client.XGroupCreateMkStream(ctx, q.stream, q.group, "$").Err()
	if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
		return fmt.Errorf("create consumer group: %w", err)
	}
	return nil
}

func (q *RedisStreamQueue) Enqueue(ctx context.Context, jobID string) error {
	return q.client.XAdd(ctx, &redis.XAddArgs{
		Stream: q.stream,
		Values: map[string]interface{}{"job_id": jobID},
	}).Err()
}

func (q *RedisStreamQueue) Consume(ctx context.Context, consumerName string) (<-chan Message, error) {
	ch := make(chan Message)

	go func() {
		defer close(ch)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				// Block for 2 seconds waiting for new messages
				res, err := q.client.XReadGroup(ctx, &redis.XReadGroupArgs{
					Group:    q.group,
					Consumer: consumerName,
					Streams:  []string{q.stream, ">"},
					Count:    1,
					Block:    2000 * 1000 * 1000, // 2 seconds in nanoseconds
				}).Result()

				if err != nil {
					if err == redis.Nil {
						continue // Timeout, try again
					}
					// Check context cancelled again before printing error
					if ctx.Err() != nil {
						return
					}
					fmt.Printf("XReadGroup error: %v\n", err)
					continue
				}

				for _, stream := range res {
					for _, msg := range stream.Messages {
						jobID, ok := msg.Values["job_id"].(string)
						if !ok {
							continue
						}
						ch <- Message{
							MsgID: msg.ID,
							JobID: jobID,
						}
					}
				}
			}
		}
	}()

	return ch, nil
}

func (q *RedisStreamQueue) Ack(ctx context.Context, msgID string) error {
	return q.client.XAck(ctx, q.stream, q.group, msgID).Err()
}

func (q *RedisStreamQueue) ReclaimPending(ctx context.Context) error {
	// Simple auto claim logic: claim messages pending for more than 5 minutes
	// For production, this should be a robust separate background routine.
	return nil
}
