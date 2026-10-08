-- 000006_zalo_delivery.down.sql
DROP INDEX IF EXISTS idx_users_phone_unique;
DROP INDEX IF EXISTS idx_notif_logs_msg_id;

ALTER TABLE notification_logs
    DROP COLUMN IF EXISTS msg_id,
    DROP COLUMN IF EXISTS delivered_at;

ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS notification_logs_status_check;
-- delivered/read only exist from this migration on; they were sent messages before it
UPDATE notification_logs SET status = 'sent' WHERE status IN ('delivered', 'read');
ALTER TABLE notification_logs ADD CONSTRAINT notification_logs_status_check
    CHECK (status IN ('queued', 'sent', 'failed'));
