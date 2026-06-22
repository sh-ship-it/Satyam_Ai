ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_by        INTEGER  NULL REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS clearance_override SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS scope_override     TEXT     NULL;

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_clearance_override
        CHECK (clearance_override IS NULL OR clearance_override BETWEEN 1 AND 4);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_scope_override
        CHECK (scope_override IS NULL OR scope_override IN ('state','range','district','station'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_users_created_by ON users(created_by);
