-- A shipping fee the marketplace did not state is unknown (NULL), not 0.
ALTER TABLE price_snapshots
    ALTER COLUMN shipping_fee DROP NOT NULL,
    ALTER COLUMN shipping_fee DROP DEFAULT;

ALTER TABLE comparison_snapshots
    ALTER COLUMN shipping_fee DROP NOT NULL,
    ALTER COLUMN shipping_fee DROP DEFAULT;

-- An empty seller name means the page did not state one.
UPDATE product_sources SET seller_name = NULL WHERE btrim(seller_name) = '';
