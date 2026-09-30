ALTER TABLE users
    ADD COLUMN IF NOT EXISTS zalo_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS phone   TEXT;

CREATE TABLE alert_rules (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_source_id UUID NOT NULL REFERENCES product_sources(id) ON DELETE CASCADE,
    rule_type         VARCHAR(32) NOT NULL
                          CHECK (rule_type IN ('drop_percent', 'target_price', 'lowest_in_days')),
    threshold_value   BIGINT NOT NULL,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_rules_source_active
    ON alert_rules(product_source_id)
    WHERE active = TRUE;

CREATE INDEX idx_alert_rules_user
    ON alert_rules(user_id, active);

CREATE TABLE notification_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_rule_id  UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel        VARCHAR(32) NOT NULL DEFAULT 'zalo',
    recipient      TEXT NOT NULL,
    status         VARCHAR(32) NOT NULL
                       CHECK (status IN ('queued', 'sent', 'failed')),
    price_before   BIGINT NOT NULL,
    price_after    BIGINT NOT NULL,
    sent_at        TIMESTAMPTZ,
    read_at        TIMESTAMPTZ,
    error_message  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_logs_dedup
    ON notification_logs(user_id, alert_rule_id, created_at DESC);

CREATE INDEX idx_notif_logs_user_feed
    ON notification_logs(user_id, created_at DESC);
