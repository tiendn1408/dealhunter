package matching

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresMatchingRepository implements MatchingRepository backed by PostgreSQL using pgxpool.
type PostgresMatchingRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresMatchingRepository(pool *pgxpool.Pool) *PostgresMatchingRepository {
	return &PostgresMatchingRepository{pool: pool}
}

func (r *PostgresMatchingRepository) SaveSuggestion(ctx context.Context, s *MatchSuggestion) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	now := time.Now()
	if s.CreatedAt.IsZero() {
		s.CreatedAt = now
	}
	s.UpdatedAt = now

	query := `
		INSERT INTO product_match_suggestions (
			id, product_id, candidate_platform, candidate_url,
			candidate_title, candidate_seller, candidate_price,
			match_score, status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (product_id, candidate_url) DO UPDATE
		SET match_score = EXCLUDED.match_score,
		    -- A decision already taken (dismissed, accepted, auto-linked) is never undone by a re-run
		    status = CASE WHEN product_match_suggestions.status = 'pending' THEN EXCLUDED.status
		                  ELSE product_match_suggestions.status END,
		    candidate_title = EXCLUDED.candidate_title,
		    candidate_seller = EXCLUDED.candidate_seller,
		    candidate_price = EXCLUDED.candidate_price,
		    updated_at = NOW()
	`

	_, err := r.pool.Exec(ctx, query,
		s.ID, s.ProductID, s.CandidatePlatform, s.CandidateURL,
		s.CandidateTitle, s.CandidateSeller, s.CandidatePrice,
		s.MatchScore, s.Status, s.CreatedAt, s.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("save match suggestion: %w", err)
	}

	return nil
}

func (r *PostgresMatchingRepository) GetSuggestionsByProductID(ctx context.Context, productID uuid.UUID) ([]*MatchSuggestion, error) {
	query := `
		SELECT id, product_id, candidate_platform, candidate_url,
		       candidate_title, candidate_seller, candidate_price,
		       match_score, status, created_at, updated_at
		FROM product_match_suggestions
		WHERE product_id = $1 AND status = 'pending'
		ORDER BY match_score DESC, created_at DESC
	`

	rows, err := r.pool.Query(ctx, query, productID)
	if err != nil {
		return nil, fmt.Errorf("query match suggestions: %w", err)
	}
	defer rows.Close()

	var results []*MatchSuggestion
	for rows.Next() {
		s := &MatchSuggestion{}
		var seller *string
		if err := rows.Scan(
			&s.ID, &s.ProductID, &s.CandidatePlatform, &s.CandidateURL,
			&s.CandidateTitle, &seller, &s.CandidatePrice,
			&s.MatchScore, &s.Status, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan match suggestion: %w", err)
		}
		if seller != nil {
			s.CandidateSeller = *seller
		}
		results = append(results, s)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate match suggestions: %w", err)
	}

	if results == nil {
		results = make([]*MatchSuggestion, 0)
	}

	return results, nil
}

func (r *PostgresMatchingRepository) GetSuggestionByID(ctx context.Context, id uuid.UUID) (*MatchSuggestion, error) {
	query := `
		SELECT id, product_id, candidate_platform, candidate_url,
		       candidate_title, candidate_seller, candidate_price,
		       match_score, status, created_at, updated_at
		FROM product_match_suggestions
		WHERE id = $1
	`

	s := &MatchSuggestion{}
	var seller *string
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&s.ID, &s.ProductID, &s.CandidatePlatform, &s.CandidateURL,
		&s.CandidateTitle, &seller, &s.CandidatePrice,
		&s.MatchScore, &s.Status, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query suggestion by id: %w", err)
	}
	if seller != nil {
		s.CandidateSeller = *seller
	}

	return s, nil
}

func (r *PostgresMatchingRepository) GetSuggestionByProductAndURL(ctx context.Context, productID uuid.UUID, candidateURL string) (*MatchSuggestion, error) {
	query := `
		SELECT id, product_id, candidate_platform, candidate_url,
		       candidate_title, candidate_seller, candidate_price,
		       match_score, status, created_at, updated_at
		FROM product_match_suggestions
		WHERE product_id = $1 AND candidate_url = $2
	`

	s := &MatchSuggestion{}
	var seller *string
	err := r.pool.QueryRow(ctx, query, productID, candidateURL).Scan(
		&s.ID, &s.ProductID, &s.CandidatePlatform, &s.CandidateURL,
		&s.CandidateTitle, &seller, &s.CandidatePrice,
		&s.MatchScore, &s.Status, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query suggestion by product and url: %w", err)
	}
	if seller != nil {
		s.CandidateSeller = *seller
	}

	return s, nil
}

func (r *PostgresMatchingRepository) UpdateSuggestionStatus(ctx context.Context, id uuid.UUID, status string) error {
	query := `
		UPDATE product_match_suggestions
		SET status = $1, updated_at = NOW()
		WHERE id = $2
	`

	res, err := r.pool.Exec(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("update suggestion status: %w", err)
	}

	if res.RowsAffected() == 0 {
		return fmt.Errorf("suggestion not found: %s", id)
	}

	return nil
}
