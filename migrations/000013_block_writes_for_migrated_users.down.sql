DROP TRIGGER IF EXISTS alert_rules_reject_migrated_user ON alert_rules;
DROP TRIGGER IF EXISTS tracked_products_reject_migrated_user ON tracked_products;
DROP FUNCTION IF EXISTS reject_write_for_migrated_user();
