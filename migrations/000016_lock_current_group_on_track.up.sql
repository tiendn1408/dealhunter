-- 000015 locked the group of the source as read at the start of the INSERT: if a link-source moved the
-- source meanwhile, the new tracking locked the *old* group and could join the new one unseen.
-- Lock the source row first: that waits for a move in progress and returns the source's current group
-- (and keeps it from moving until this tracking commits); then lock that group.
CREATE OR REPLACE FUNCTION lock_group_for_new_tracking() RETURNS trigger AS $$
DECLARE
    group_id UUID;
BEGIN
    SELECT product_id INTO group_id FROM product_sources WHERE id = NEW.product_source_id FOR SHARE;
    PERFORM 1 FROM products WHERE id = group_id FOR SHARE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
