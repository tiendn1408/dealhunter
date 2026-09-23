package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// JobStatus represents the lifecycle state of a fetch job.
type JobStatus string

const (
	JobStatusQueued    JobStatus = "queued"
	JobStatusRunning   JobStatus = "running"
	JobStatusSucceeded JobStatus = "succeeded"
	JobStatusFailed    JobStatus = "failed"
	JobStatusDead      JobStatus = "dead"
)

// FetchJob represents a scheduled price-fetch task.
type FetchJob struct {
	ID              uuid.UUID
	ProductSourceID uuid.UUID
	Status          JobStatus
	Attempt         int
	AvailableAt     time.Time
	PickedAt        *time.Time
	FinishedAt      *time.Time
	ErrorCode       *string
	ErrorMessage    *string
	CreatedAt       time.Time
}

// JobRepository defines persistence operations for fetch jobs.
type JobRepository interface {
	CreateJob(ctx context.Context, job *FetchJob) error
	GetJob(ctx context.Context, id uuid.UUID) (*FetchJob, error)
	MarkRunning(ctx context.Context, id uuid.UUID) error
	MarkSucceeded(ctx context.Context, tx pgx.Tx, id uuid.UUID) error
	MarkFailed(ctx context.Context, id uuid.UUID, code, msg string) error
	MarkDead(ctx context.Context, id uuid.UUID) error
}
