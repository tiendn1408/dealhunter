DROP INDEX IF EXISTS idx_users_email;

ALTER TABLE users
    DROP COLUMN IF EXISTS email,
    DROP COLUMN IF EXISTS name,
    DROP COLUMN IF EXISTS avatar_url,
    DROP COLUMN IF EXISTS auth_provider,
    DROP COLUMN IF EXISTS password_hash,
    DROP COLUMN IF EXISTS updated_at;
