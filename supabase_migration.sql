-- Migration: allow NULL telegram_id for placeholder users added by @username
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Drop the NOT NULL constraint
ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;

-- 2. Drop the old unique constraint (allows only one NULL)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_telegram_id_key;

-- 3. Create a partial unique index (only enforces uniqueness for non-NULL values)
--    This allows multiple rows with telegram_id = NULL
CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_unique
  ON users(telegram_id)
  WHERE telegram_id IS NOT NULL;

-- 4. Fix any existing placeholder rows that used telegram_id = 0
UPDATE users SET telegram_id = NULL WHERE telegram_id = 0;
