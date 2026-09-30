-- Revert Migration 000003: Cross-platform Price Comparison

DROP TABLE IF EXISTS comparison_snapshots;

DROP INDEX IF EXISTS idx_tracked_products_user_primary;

ALTER TABLE tracked_products
    DROP COLUMN IF EXISTS is_primary;
