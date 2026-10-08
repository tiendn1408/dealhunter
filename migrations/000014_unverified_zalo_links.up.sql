-- Zalo links made before phone verification (OTP) existed were never proven to belong to the account:
-- anyone could link someone else's number. They are dropped; members link again with a code.
UPDATE users SET zalo_id = NULL, phone = NULL, updated_at = NOW()
WHERE zalo_id IS NOT NULL OR phone IS NOT NULL;
