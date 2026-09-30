DROP INDEX IF EXISTS idx_notif_logs_user_feed;
DROP INDEX IF EXISTS idx_notif_logs_dedup;
DROP TABLE IF EXISTS notification_logs;

DROP INDEX IF EXISTS idx_alert_rules_user;
DROP INDEX IF EXISTS idx_alert_rules_source_active;
DROP TABLE IF EXISTS alert_rules;

ALTER TABLE users
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS zalo_id;
