-- Migration: 000005_matching.up.sql
-- Description: Create product_match_suggestions table for cross-platform auto-matching

CREATE TABLE IF NOT EXISTS product_match_suggestions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    candidate_platform  VARCHAR(32) NOT NULL,
    candidate_url       TEXT NOT NULL,
    candidate_title     TEXT NOT NULL,
    candidate_seller    TEXT,
    candidate_price     BIGINT NOT NULL DEFAULT 0,
    match_score         DOUBLE PRECISION NOT NULL,
    status              VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending, accepted, dismissed, auto_linked
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_product_candidate UNIQUE (product_id, candidate_url)
);

CREATE INDEX IF NOT EXISTS idx_match_suggestions_product_status 
    ON product_match_suggestions(product_id, status);

CREATE INDEX IF NOT EXISTS idx_match_suggestions_score 
    ON product_match_suggestions(match_score DESC);
