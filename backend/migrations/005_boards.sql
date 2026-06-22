-- Investigation Board persistence. Additive & isolated.
-- No FKs to persons/cases/etc. Only a nullable owner -> users. No RLS policy.

CREATE TABLE IF NOT EXISTS boards (
    board_id      SERIAL PRIMARY KEY,
    owner_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    title         TEXT NOT NULL DEFAULT 'Untitled board',
    district      TEXT,
    state_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    thumbnail     TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_snapshots (
    snapshot_id   SERIAL PRIMARY KEY,
    board_id      INT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    state_json    JSONB NOT NULL,
    note          TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_boards_owner ON boards(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_board_snap_bid ON board_snapshots(board_id);
