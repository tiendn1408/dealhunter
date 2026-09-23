DROP INDEX IF EXISTS idx_fetch_jobs_available;
DROP INDEX IF EXISTS idx_price_snapshots_product_time;
DROP INDEX IF EXISTS idx_tracked_products_due;

DROP TABLE IF EXISTS fetch_jobs;
DROP TABLE IF EXISTS price_snapshots;
DROP TABLE IF EXISTS tracked_products;
DROP TABLE IF EXISTS product_sources;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
