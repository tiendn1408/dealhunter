-- A guest that was merged into a member account (auth_provider = 'migrated') must not get new rows:
-- they would be orphaned. The share lock on the user row makes a write wait for an in-flight
-- migration (which holds FOR UPDATE on it) and then see the result; a write that commits first is
-- picked up by the migration, which only moves rows after taking its lock.
CREATE OR REPLACE FUNCTION reject_write_for_migrated_user() RETURNS trigger AS $$
DECLARE
    provider TEXT;
BEGIN
    SELECT auth_provider INTO provider FROM users WHERE id = NEW.user_id FOR SHARE;
    IF provider = 'migrated' THEN
        RAISE EXCEPTION 'user % was merged into another account', NEW.user_id USING ERRCODE = 'DH001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tracked_products_reject_migrated_user
    BEFORE INSERT ON tracked_products
    FOR EACH ROW EXECUTE FUNCTION reject_write_for_migrated_user();

CREATE TRIGGER alert_rules_reject_migrated_user
    BEFORE INSERT ON alert_rules
    FOR EACH ROW EXECUTE FUNCTION reject_write_for_migrated_user();
