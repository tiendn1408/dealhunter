-- Migration 000003: Cross-platform Price Comparison

-- 1. Add is_primary column to tracked_products to distinguish primary tracking from comparison sources
ALTER TABLE tracked_products
    ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_tracked_products_user_primary
    ON tracked_products(user_id, is_primary)
    WHERE active = TRUE;

-- 2. Materialized comparison snapshot table for low-latency queries
CREATE TABLE IF NOT EXISTS comparison_snapshots (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID        NOT NULL REFERENCES products(id)        ON DELETE CASCADE,
    source_id       UUID        NOT NULL REFERENCES product_sources(id) ON DELETE CASCADE,
    platform        VARCHAR(32) NOT NULL,
    seller_name     TEXT,
    canonical_url   TEXT        NOT NULL,
    listed_price    BIGINT,
    shipping_fee    BIGINT      NOT NULL DEFAULT 0,
    effective_price BIGINT,
    in_stock        BOOLEAN,
    is_best_deal    BOOLEAN     NOT NULL DEFAULT FALSE,
    captured_at     TIMESTAMPTZ,
    refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comparison_snapshot_product_source
    ON comparison_snapshots(product_id, source_id);

CREATE INDEX IF NOT EXISTS idx_comparison_snapshot_product
    ON comparison_snapshots(product_id, effective_price);
