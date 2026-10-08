-- A new tracking joins the comparison group of its source. It takes a share lock on that group so it
-- serializes with a group change (link-source / accept suggestion), which holds FOR UPDATE on the groups
-- while it checks who tracks them: a tracking committed first is seen by the check, one started during
-- the change waits for it. Several trackings of the same group do not block each other.
CREATE OR REPLACE FUNCTION lock_group_for_new_tracking() RETURNS trigger AS $$
BEGIN
    PERFORM 1
    FROM products p
    JOIN product_sources ps ON ps.product_id = p.id
    WHERE ps.id = NEW.product_source_id
    FOR SHARE OF p;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tracked_products_lock_group
    BEFORE INSERT ON tracked_products
    FOR EACH ROW EXECUTE FUNCTION lock_group_for_new_tracking();
