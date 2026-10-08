package jobs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiendang/deal-hunter/internal/domain"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateJob(ctx context.Context, job *domain.FetchJob) error {
	query := `
		INSERT INTO fetch_jobs (
			id, product_source_id, status, attempt, available_at,
			picked_at, finished_at, error_code, error_message, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING created_at;
	`
	now := time.Now()
	if job.CreatedAt.IsZero() {
		job.CreatedAt = now
	}
	if job.AvailableAt.IsZero() {
		job.AvailableAt = now
	}

	return r.pool.QueryRow(ctx, query,
		job.ID,
		job.ProductSourceID,
		job.Status,
		job.Attempt,
		job.AvailableAt,
		job.PickedAt,
		job.FinishedAt,
		job.ErrorCode,
		job.ErrorMessage,
		job.CreatedAt,
	).Scan(&job.CreatedAt)
}

func (r *PostgresRepository) GetJob(ctx context.Context, id uuid.UUID) (*domain.FetchJob, error) {
	query := `
		SELECT id, product_source_id, status, attempt, available_at,
		       picked_at, finished_at, error_code, error_message, created_at
		FROM fetch_jobs
		WHERE id = $1;
	`
	var j domain.FetchJob
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&j.ID,
		&j.ProductSourceID,
		&j.Status,
		&j.Attempt,
		&j.AvailableAt,
		&j.PickedAt,
		&j.FinishedAt,
		&j.ErrorCode,
		&j.ErrorMessage,
		&j.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("job not found: %w", err)
		}
		return nil, fmt.Errorf("query job: %w", err)
	}

	return &j, nil
}

func (r *PostgresRepository) MarkRunning(ctx context.Context, id uuid.UUID) error {
	query := `
		UPDATE fetch_jobs
		SET status = $1,
		    picked_at = NOW(),
		    attempt = attempt + 1
		WHERE id = $2;
	`
	_, err := r.pool.Exec(ctx, query, domain.JobStatusRunning, id)
	if err != nil {
		return fmt.Errorf("mark job running: %w", err)
	}
	return nil
}

func (r *PostgresRepository) MarkSucceeded(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	query := `
		UPDATE fetch_jobs
		SET status = $1,
		    finished_at = NOW()
		WHERE id = $2;
	`
	var err error
	if tx != nil {
		_, err = tx.Exec(ctx, query, domain.JobStatusSucceeded, id)
	} else {
		_, err = r.pool.Exec(ctx, query, domain.JobStatusSucceeded, id)
	}

	if err != nil {
		return fmt.Errorf("mark job succeeded: %w", err)
	}
	return nil
}

func (r *PostgresRepository) MarkFailed(ctx context.Context, id uuid.UUID, code, msg string) error {
	query := `
		UPDATE fetch_jobs
		SET status = $1,
		    error_code = $2,
		    error_message = $3
		WHERE id = $4;
	`
	_, err := r.pool.Exec(ctx, query, domain.JobStatusFailed, code, msg, id)
	if err != nil {
		return fmt.Errorf("mark job failed: %w", err)
	}
	return nil
}

// MarkDead ends a job for good, keeping why (error code and message) for diagnosis.
func (r *PostgresRepository) MarkDead(ctx context.Context, id uuid.UUID, code, msg string) error {
	query := `
		UPDATE fetch_jobs
		SET status = $1,
		    error_code = $2,
		    error_message = $3,
		    finished_at = NOW()
		WHERE id = $4;
	`
	_, err := r.pool.Exec(ctx, query, domain.JobStatusDead, code, msg, id)
	if err != nil {
		return fmt.Errorf("mark job dead: %w", err)
	}
	return nil
}
