UPDATE price_snapshots SET shipping_fee = 0 WHERE shipping_fee IS NULL;
ALTER TABLE price_snapshots
    ALTER COLUMN shipping_fee SET DEFAULT 0,
    ALTER COLUMN shipping_fee SET NOT NULL;

UPDATE comparison_snapshots SET shipping_fee = 0 WHERE shipping_fee IS NULL;
ALTER TABLE comparison_snapshots
    ALTER COLUMN shipping_fee SET DEFAULT 0,
    ALTER COLUMN shipping_fee SET NOT NULL;
