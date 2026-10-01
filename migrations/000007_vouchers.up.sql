-- Migration: 000007_vouchers.up.sql
-- Description: Create product_vouchers table and add voucher discount tracking to price_snapshots

CREATE TABLE IF NOT EXISTS product_vouchers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_source_id UUID NOT NULL REFERENCES product_sources(id) ON DELETE CASCADE,
    voucher_type      VARCHAR(32) NOT NULL 
                          CHECK (voucher_type IN ('shop_voucher', 'platform_voucher', 'freeship_voucher')),
    voucher_code      TEXT,
    title             TEXT NOT NULL,
    discount_amount   BIGINT NOT NULL DEFAULT 0,
    discount_percent  INT NOT NULL DEFAULT 0,
    min_order_value   BIGINT NOT NULL DEFAULT 0,
    collect_url       TEXT,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_vouchers_source
    ON product_vouchers(product_source_id, expires_at);

-- Bổ sung trường bóc tách voucher vào bảng price_snapshots
ALTER TABLE price_snapshots
    ADD COLUMN IF NOT EXISTS shop_discount BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_coupon BIGINT NOT NULL DEFAULT 0;
