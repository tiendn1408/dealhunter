-- Step 1 hardening follow-up (see docs/plans/hardening-before-phase-4.md)

-- Google account identity: the stable `sub` claim, not only the (reassignable) email.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;

-- Refresh-token families: one family per login; logout and reuse detection revoke the family.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID;
UPDATE refresh_tokens SET family_id = id WHERE family_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Demo login no longer exists: remove demo accounts and everything they own so no fake
-- account can be adopted by a real Google login with the same email.
DELETE FROM tracked_products WHERE user_id IN (SELECT id FROM users WHERE auth_provider = 'demo');
DELETE FROM users WHERE auth_provider = 'demo';
