-- Product image (https URL) as the marketplace states it; NULL when it never stated one.
ALTER TABLE product_sources ADD COLUMN IF NOT EXISTS image_url TEXT;
