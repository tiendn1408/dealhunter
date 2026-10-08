-- Sources created by POST /track did not store raw_title; backfill it from the product title
-- so the API can show the product name.
UPDATE product_sources s
SET raw_title = p.title
FROM products p
WHERE p.id = s.product_id
  AND (s.raw_title IS NULL OR btrim(s.raw_title) = '')
  AND btrim(p.title) <> '';

-- DATA-03: one voucher per (source, type, code). Keep the most recently updated duplicate.
DELETE FROM product_vouchers v
USING product_vouchers newer
WHERE v.product_source_id = newer.product_source_id
  AND v.voucher_type = newer.voucher_type
  AND COALESCE(v.voucher_code, '') = COALESCE(newer.voucher_code, '')
  AND (v.updated_at, v.id) < (newer.updated_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_vouchers_source_type_code
    ON product_vouchers (product_source_id, voucher_type, (COALESCE(voucher_code, '')));
