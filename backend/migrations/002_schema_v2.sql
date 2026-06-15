-- ============================================================================
-- Satyam — Database schema  (matches satyam_synthetic_dataset CSVs exactly)
-- Targets: local Postgres+pgvector  AND  Neon (use halfvec(1024) where noted)
-- Run order: this file (DDL + RBAC + RLS)  ->  load_seed.sql  ->  embed job
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- clean teardown (idempotent; safe to re-run) ---------------------
DROP TABLE IF EXISTS audit_log     CASCADE;
DROP TABLE IF EXISTS narratives    CASCADE;
DROP TABLE IF EXISTS case_persons  CASCADE;
DROP TABLE IF EXISTS persons       CASCADE;
DROP TABLE IF EXISTS cases         CASCADE;
DROP TABLE IF EXISTS officers      CASCADE;
DROP TABLE IF EXISTS stations      CASCADE;
DROP TABLE IF EXISTS users         CASCADE;
DROP TABLE IF EXISTS rank_access   CASCADE;
DROP VIEW  IF EXISTS v_officer_session CASCADE;

-- ============================ CORE DATA TABLES ==============================
-- Column order matches CSV header order so plain COPY ... CSV HEADER works.
-- "range" is quoted because RANGE is a SQL keyword.

CREATE TABLE stations (
    station_id    INTEGER PRIMARY KEY,
    station_name  TEXT NOT NULL,
    district      TEXT NOT NULL,
    "range"       TEXT NOT NULL,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION
);

CREATE TABLE officers (
    officer_id    INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    rank          TEXT NOT NULL,
    station_id    INTEGER NOT NULL REFERENCES stations(station_id)
);

CREATE TABLE cases (
    case_id          INTEGER PRIMARY KEY,
    fir_number       TEXT NOT NULL,
    fir_year         INTEGER NOT NULL,
    station_id       INTEGER NOT NULL REFERENCES stations(station_id),
    station_name     TEXT NOT NULL,
    district         TEXT NOT NULL,
    "range"          TEXT NOT NULL,
    crime_type       TEXT NOT NULL,
    crime_category   TEXT NOT NULL CHECK (crime_category IN ('IPC','SLL')),
    legal_code       TEXT NOT NULL CHECK (legal_code IN ('IPC','BNS')),
    sections         TEXT,                       -- pipe-joined, e.g. '302|34'
    fir_type         TEXT NOT NULL CHECK (fir_type IN ('Heinous','Non Heinous')),
    status           TEXT NOT NULL,
    complaint_mode   TEXT,
    motive           TEXT,
    incident_date    DATE,
    incident_time    TEXT,
    report_date      DATE NOT NULL,
    latitude         DOUBLE PRECISION,
    longitude        DOUBLE PRECISION,
    place_of_offence TEXT,
    io_officer_id    INTEGER REFERENCES officers(officer_id),
    io_name          TEXT,
    victim_count     INTEGER NOT NULL DEFAULT 0,
    accused_count    INTEGER NOT NULL DEFAULT 0,
    is_group         BOOLEAN NOT NULL DEFAULT FALSE,
    arrested_count   INTEGER NOT NULL DEFAULT 0,
    charge_sheeted   BOOLEAN NOT NULL DEFAULT FALSE,
    convicted        BOOLEAN NOT NULL DEFAULT FALSE,
    -- convenience derived column (array form of the pipe-joined sections)
    sections_arr     TEXT[] GENERATED ALWAYS AS (string_to_array(sections,'|')) STORED,
    CHECK (report_date >= incident_date),
    CHECK (arrested_count <= accused_count)
);

CREATE TABLE persons (
    person_id    INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    gender       TEXT,
    age          INTEGER,
    district     TEXT
);

CREATE TABLE case_persons (
    case_id    INTEGER NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('Complainant','Victim','Accused','Witness')),
    PRIMARY KEY (case_id, person_id, role)
);

CREATE TABLE narratives (
    narrative_id INTEGER PRIMARY KEY,
    case_id      INTEGER NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    language     TEXT NOT NULL CHECK (language IN ('en','kn')),
    body         TEXT NOT NULL,
    -- LOCAL: vector(1024).  NEON free tier: change to halfvec(1024).
    embedding    vector(1024),
    body_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);

-- ===================== POLICE RBAC / ABAC (from KSP insignia) ===============
-- scope_level: how wide a jurisdiction the rank can see
-- clearance  : how sensitive a field the rank can see (1=lowest .. 4=full)
CREATE TABLE rank_access (
    rank         TEXT PRIMARY KEY,
    scope_level  TEXT NOT NULL CHECK (scope_level IN ('state','range','district','station')),
    clearance    SMALLINT NOT NULL CHECK (clearance BETWEEN 1 AND 4),
    gazetted     BOOLEAN NOT NULL,
    description  TEXT
);

-- Ranks present in the dataset + the gazetted/admin ranks from the insignia chart.
INSERT INTO rank_access (rank, scope_level, clearance, gazetted, description) VALUES
  ('DGP',    'state',    4, TRUE,  'Director General of Police (state admin)'),
  ('ADGP',   'state',    4, TRUE,  'Additional DGP (state admin)'),
  ('IGP',    'state',    4, TRUE,  'Inspector General of Police (state)'),
  ('DIG',    'range',    4, TRUE,  'Deputy Inspector General (range)'),
  ('SP',     'district', 4, TRUE,  'Superintendent of Police (district head)'),
  ('Addl.SP','district', 4, TRUE,  'Additional Superintendent of Police'),
  ('Dy.SP',  'district', 3, TRUE,  'Deputy Superintendent of Police (sub-division)'),
  ('CPI',    'station',  3, FALSE, 'Circle Police Inspector (circle; station-scoped until circle map added)'),
  ('PI',     'station',  3, FALSE, 'Police Inspector / Circle Inspector'),
  ('PSI',    'station',  2, FALSE, 'Sub Inspector of Police (SHO)'),
  ('SI',     'station',  2, FALSE, 'Sub Inspector'),
  ('ASI',    'station',  2, FALSE, 'Assistant Sub Inspector'),
  ('HC',     'station',  1, FALSE, 'Head Constable'),
  ('PC',     'station',  1, FALSE, 'Police Constable');

-- App login accounts. An account is tied to an officer (inherits station/district/range)
-- OR carries an assigned_rank for state/range admins not in the officers table.
CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    username       TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,                 -- argon2/bcrypt
    officer_id     INTEGER REFERENCES officers(officer_id),
    assigned_rank  TEXT REFERENCES rank_access(rank),  -- overrides officer.rank when set
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only, hash-chained audit log (every sensitive access / query / export).
CREATE TABLE audit_log (
    audit_id      BIGSERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(user_id),
    action        TEXT NOT NULL,                  -- login / view_case / nl_query / sql_exec / export ...
    case_id       INTEGER,
    reason        TEXT,                            -- required when accessing protected-crime PII
    query_text    TEXT,
    generated_sql TEXT,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_hash     TEXT,
    row_hash      TEXT NOT NULL                    -- sha256(prev_hash || row payload)
);

-- Effective session for a logged-in user (app reads this, puts it in the JWT).
CREATE VIEW v_officer_session AS
SELECT u.user_id, u.username,
       COALESCE(u.assigned_rank, o.rank)        AS rank,
       ra.scope_level,
       ra.clearance,
       o.officer_id,
       o.station_id,
       s.district,
       s."range"                                AS range_name
FROM users u
LEFT JOIN officers   o  ON o.officer_id = u.officer_id
LEFT JOIN stations   s  ON s.station_id = o.station_id
LEFT JOIN rank_access ra ON ra.rank = COALESCE(u.assigned_rank, o.rank);

-- ===================== ROW-LEVEL SECURITY (jurisdiction) ====================
-- The API sets these per request from the JWT, inside the transaction:
--   SET LOCAL app.scope = 'district'; SET LOCAL app.range = '...';
--   SET LOCAL app.district = '...';   SET LOCAL app.station_id = '764';
--   SET LOCAL app.clearance = '4';    SET LOCAL app.officer_id = '...';

CREATE OR REPLACE FUNCTION fn_scope_ok(p_range TEXT, p_district TEXT, p_station INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT CASE current_setting('app.scope', true)
           WHEN 'state'    THEN TRUE
           WHEN 'range'    THEN p_range    = current_setting('app.range', true)
           WHEN 'district' THEN p_district = current_setting('app.district', true)
           WHEN 'station'  THEN p_station  = NULLIF(current_setting('app.station_id', true), '')::int
           ELSE FALSE
         END
$$;

ALTER TABLE cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives   ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_cases_scope ON cases
  USING (fn_scope_ok("range", district, station_id));

CREATE POLICY p_narratives_scope ON narratives
  USING (EXISTS (SELECT 1 FROM cases c
                 WHERE c.case_id = narratives.case_id
                   AND fn_scope_ok(c."range", c.district, c.station_id)));

CREATE POLICY p_case_persons_scope ON case_persons
  USING (EXISTS (SELECT 1 FROM cases c
                 WHERE c.case_id = case_persons.case_id
                   AND fn_scope_ok(c."range", c.district, c.station_id)));

CREATE POLICY p_persons_scope ON persons
  USING (EXISTS (SELECT 1 FROM case_persons cp JOIN cases c ON c.case_id = cp.case_id
                 WHERE cp.person_id = persons.person_id
                   AND fn_scope_ok(c."range", c.district, c.station_id)));

-- NOTE: connect the app as a NON-superuser role so RLS is enforced, e.g.:
--   CREATE ROLE satyam_app LOGIN PASSWORD '...';
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO satyam_app;
--   ALTER TABLE cases FORCE ROW LEVEL SECURITY;   -- (and the other 3 tables)
-- Field-level masking (clearance L1-L4: mask victim/accused PII, redact protected-crime
-- narratives, coarsen coordinates) is applied in the API serialization layer using
-- app.clearance + the PROTECTED crime set, then surfaced as lock icons in the UI.

-- ===================== APP ROLE + GRANTS + FORCE RLS ========================
-- CRITICAL: without this block the app role doesn't exist, GRANTs are absent,
-- and FORCE ROW LEVEL SECURITY is never set — so RLS policies silently do
-- nothing when the connection is owned by the table owner (superuser bypass).

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'satyam_app') THEN
        CREATE ROLE satyam_app LOGIN PASSWORD 'satyam_app'
            NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO satyam_app;
GRANT SELECT ON stations, officers, cases, case_persons, narratives, persons,
                rank_access, users, v_officer_session TO satyam_app;
GRANT SELECT, INSERT ON audit_log TO satyam_app;
-- audit_id is BIGSERIAL → sequence name is audit_log_audit_id_seq (not audit_log_id_seq)
GRANT USAGE, SELECT ON SEQUENCE audit_log_audit_id_seq TO satyam_app;

-- Force RLS so even the table OWNER is subject to the jurisdiction policies.
-- Without FORCE, a superuser or table-owner connection bypasses ALL policies.
ALTER TABLE cases        FORCE ROW LEVEL SECURITY;
ALTER TABLE narratives   FORCE ROW LEVEL SECURITY;
ALTER TABLE persons      FORCE ROW LEVEL SECURITY;
ALTER TABLE case_persons FORCE ROW LEVEL SECURITY;
