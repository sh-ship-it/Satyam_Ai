-- Satyam initial schema: tables, pgvector, Row-Level Security, hash-chained audit.
-- Apply with: psql "$DATABASE_URL" -f migrations/001_init.sql
-- (Schema is frozen day one per spec risk R8.)

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Reference / org tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stations (
    station_id   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    zone         TEXT,
    district     TEXT,
    lat          DOUBLE PRECISION,
    lng          DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS officers (
    officer_id   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    rank         TEXT,
    station_id   TEXT REFERENCES stations(station_id)
);

CREATE TABLE IF NOT EXISTS app_users (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('admin','investigator','analyst','viewer')),
    station_id      TEXT REFERENCES stations(station_id),
    jurisdiction_id TEXT,
    clearance       INT NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Core crime tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases (
    fir_no          TEXT PRIMARY KEY,
    date            DATE,
    ipc_sections    TEXT,
    crime_type      TEXT,
    status          TEXT,
    station_id      TEXT REFERENCES stations(station_id),
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    district        TEXT,
    zone            TEXT,
    sensitivity_flag INT NOT NULL DEFAULT 0,
    jurisdiction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_crime_type ON cases(crime_type);
CREATE INDEX IF NOT EXISTS idx_cases_district ON cases(district);
CREATE INDEX IF NOT EXISTS idx_cases_jurisdiction ON cases(jurisdiction_id);

CREATE TABLE IF NOT EXISTS persons (
    person_id   TEXT PRIMARY KEY,
    name        TEXT,
    age         INT,
    gender      TEXT,
    role_type   TEXT
);

CREATE TABLE IF NOT EXISTS case_persons (
    case_id     TEXT REFERENCES cases(fir_no),
    person_id   TEXT REFERENCES persons(person_id),
    role        TEXT,
    PRIMARY KEY (case_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_case_persons_person ON case_persons(person_id);

CREATE TABLE IF NOT EXISTS narratives (
    case_id     TEXT PRIMARY KEY REFERENCES cases(fir_no),
    text        TEXT,
    embedding   vector(1024)
);
-- Approximate-nearest-neighbour index for narrative RAG.
-- HNSW needs no training and keeps strong recall even on a small/empty table
-- (ivfflat with lists=100 degrades badly until many thousands of rows exist).
CREATE INDEX IF NOT EXISTS idx_narratives_embedding
    ON narratives USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Hash-chained, tamper-evident audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor       TEXT NOT NULL,
    role        TEXT NOT NULL,
    action      TEXT NOT NULL,
    resource    TEXT,
    detail      TEXT,
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- The app sets per-request context with set_config('satyam.*', ..., true).
-- Policies enforce jurisdiction + clearance on EVERY query lane (chat, map,
-- network, reports) so a bad Text-to-SQL string still can't exceed the row
-- scope of the caller.
-- ---------------------------------------------------------------------------
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives ENABLE ROW LEVEL SECURITY;

-- Helper expressions read the request-scoped GUCs (default to safe values).
-- role 'admin'/'analyst' => cross-jurisdiction; others limited to their own.
-- IMPORTANT: Postgres OR-combines multiple PERMISSIVE policies for the same
-- command. Jurisdiction AND clearance must BOTH hold, so they are expressed as
-- a SINGLE policy joined with AND. Two separate permissive policies would make
-- a row visible if EITHER matched -- a privilege-escalation bug (e.g. a
-- low-clearance officer in-jurisdiction could read high-sensitivity cases).
CREATE POLICY cases_select ON cases
    FOR SELECT USING (
        -- (a) jurisdiction scope: admin/analyst are cross-jurisdiction
        (
            current_setting('satyam.role', true) IN ('admin','analyst')
            OR jurisdiction_id IS NULL
            OR jurisdiction_id = current_setting('satyam.jurisdiction_id', true)
        )
        AND
        -- (b) clearance gate: sensitivity 0 needs >=1, 1 needs >=2, 2 needs >=3
        (
            current_setting('satyam.role', true) = 'admin'
            OR sensitivity_flag = 0
            OR COALESCE(NULLIF(current_setting('satyam.clearance', true), '')::int, 1)
               >= (sensitivity_flag + 1)
        )
    );

CREATE POLICY narratives_select ON narratives
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM cases c WHERE c.fir_no = narratives.case_id)
    );

-- Force RLS so the policies apply even to the table owner (defense in depth).
-- The runtime role below is a NON-superuser, which is what actually makes RLS
-- bite; FORCE guards against an accidental "owner-as-app" misconfiguration.
ALTER TABLE cases FORCE ROW LEVEL SECURITY;
ALTER TABLE narratives FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- In-database PII masking (Fix #2)
-- The Text-to-SQL lane only ever sees persons_v, which masks `name` unless the
-- caller's clearance GUC is >= 2. security_invoker=on (PG15+) makes the view
-- run with the *querying* role's privileges + GUCs, so masking (and any RLS)
-- apply to the caller rather than to the view's owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION satyam_mask_name(p_name TEXT) RETURNS TEXT AS $func$
    SELECT CASE
        WHEN p_name IS NULL OR length(p_name) = 0 THEN p_name
        ELSE left(p_name, 1) || repeat('*', greatest(length(p_name) - 1, 1))
    END;
$func$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE VIEW persons_v WITH (security_invoker = on) AS
    SELECT
        person_id,
        CASE
            WHEN COALESCE(NULLIF(current_setting('satyam.clearance', true), '')::int, 1) >= 2
                THEN name
            ELSE satyam_mask_name(name)
        END AS name,
        age,
        gender,
        role_type
    FROM persons;

-- ---------------------------------------------------------------------------
-- Least-privilege runtime role (Fix #1)
-- The API connects as satyam_app (NOSUPERUSER) so RLS + masking are actually
-- enforced (a superuser would silently bypass both). Migrations + seeding run
-- as the owner/superuser (satyam) via SEED_DATABASE_URL.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'satyam_app') THEN
        CREATE ROLE satyam_app LOGIN PASSWORD 'satyam_app'
            NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $do$;

GRANT USAGE ON SCHEMA public TO satyam_app;
GRANT SELECT ON stations, officers, cases, case_persons, narratives, persons, persons_v TO satyam_app;
-- The chat lane appends to the hash-chained audit log, so it needs INSERT here
-- (and USAGE on the identity sequence). It can never UPDATE/DELETE the chain.
GRANT SELECT, INSERT ON audit_log TO satyam_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO satyam_app;
