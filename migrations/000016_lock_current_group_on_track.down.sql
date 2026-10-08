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
