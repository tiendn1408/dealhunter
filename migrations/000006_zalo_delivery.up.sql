-- 000006_zalo_delivery.up.sql
-- Expand status CHECK constraint on notification_logs to support full delivery lifecycle
ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS notification_logs_status_check;
ALTER TABLE notification_logs ADD CONSTRAINT notification_logs_status_check
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed'));

-- Add Zalo message ID and delivery timestamp
ALTER TABLE notification_logs
    ADD COLUMN IF NOT EXISTS msg_id TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notif_logs_msg_id
    ON notification_logs(msg_id)
    WHERE msg_id IS NOT NULL;

-- Ensure phone numbers cannot be claimed by multiple users
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
    ON users(phone)
    WHERE phone IS NOT NULL;

