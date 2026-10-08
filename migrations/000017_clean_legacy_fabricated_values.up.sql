-- Values earlier code made up and that 000010/000012 left in place (no-ops on a fresh database).

-- 1. "Seller" names that were the marketplace's own og:site_name, not a shop
UPDATE product_sources SET seller_name = NULL, updated_at = NOW()
WHERE lower(btrim(seller_name)) IN ('shopee', 'shopee việt nam', 'shopee vietnam', 'shopee.vn',
                                    'lazada', 'lazada vietnam', 'lazada việt nam', 'lazada.vn',
                                    'tiktok', 'tiktok shop', 'tiktok shop việt nam');
UPDATE comparison_snapshots SET seller_name = NULL
WHERE lower(btrim(seller_name)) IN ('shopee', 'shopee việt nam', 'shopee vietnam', 'shopee.vn',
                                    'lazada', 'lazada vietnam', 'lazada việt nam', 'lazada.vn',
                                    'tiktok', 'tiktok shop', 'tiktok shop việt nam', '');

-- 2. Shipping fees: no code path has ever read a shipping fee from a marketplace (the default 15.000đ,
--    0, or the previous value was stored instead), so every stored fee is unknown, and the effective
--    price is the item price alone.
UPDATE price_snapshots SET shipping_fee = NULL, effective_price = price
WHERE shipping_fee IS NOT NULL;
UPDATE product_sources SET last_shipping_fee = NULL, last_effective_price = last_price, updated_at = NOW()
WHERE last_shipping_fee IS NOT NULL;
UPDATE comparison_snapshots SET shipping_fee = NULL, effective_price = listed_price
WHERE shipping_fee IS NOT NULL;
