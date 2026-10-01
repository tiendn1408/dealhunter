-- Migration: 000007_vouchers.down.sql
-- Description: Revert product_vouchers table and snapshot discount columns

DROP TABLE IF EXISTS product_vouchers;

ALTER TABLE price_snapshots
    DROP COLUMN IF EXISTS shop_discount,
    DROP COLUMN IF EXISTS platform_coupon;
