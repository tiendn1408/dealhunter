CREATE TABLE users (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    variant TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_sources (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id),
    platform VARCHAR(32) NOT NULL,
    external_product_id TEXT,
    canonical_url TEXT NOT NULL,
    seller_name TEXT,
    raw_title TEXT,
    currency CHAR(3) NOT NULL DEFAULT 'VND',
    last_price BIGINT,
    last_shipping_fee BIGINT,
    last_effective_price BIGINT,
    last_in_stock BOOLEAN,
    last_fetched_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(platform, external_product_id)
);

CREATE TABLE tracked_products (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    product_source_id UUID NOT NULL REFERENCES product_sources(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    polling_interval_seconds INT NOT NULL DEFAULT 1800,
    next_fetch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, product_source_id)
);

CREATE TABLE price_snapshots (
    id BIGSERIAL PRIMARY KEY,
    product_source_id UUID NOT NULL REFERENCES product_sources(id),
    price BIGINT NOT NULL,
    shipping_fee BIGINT NOT NULL DEFAULT 0,
    effective_price BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'VND',
    in_stock BOOLEAN,
    captured_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fetch_jobs (
    id UUID PRIMARY KEY,
    product_source_id UUID NOT NULL REFERENCES product_sources(id),
    status VARCHAR(32) NOT NULL,
    attempt INT NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL,
    picked_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tracked_products_due ON tracked_products(next_fetch_at) WHERE active = TRUE;
CREATE INDEX idx_price_snapshots_product_time ON price_snapshots(product_source_id, captured_at DESC);
CREATE INDEX idx_fetch_jobs_available ON fetch_jobs(status, available_at);
