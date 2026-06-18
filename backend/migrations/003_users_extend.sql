-- Migration 003 — extend users table with display name, email, photo
-- Safe to run multiple times (uses IF NOT EXISTS / idempotent ALTER).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS full_name  TEXT,
    ADD COLUMN IF NOT EXISTS email      TEXT,
    ADD COLUMN IF NOT EXISTS photo_b64  TEXT;

-- Optional: unique index on email (skip if already exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'users' AND indexname = 'idx_users_email'
    ) THEN
        CREATE INDEX idx_users_email ON users (email) WHERE email IS NOT NULL;
    END IF;
END $$;
