-- ============================================================================
-- Satyam — Bulk load the synthetic dataset.  Run AFTER schema.sql.
-- Usage (local or Neon, switch by DATABASE_URL):
--   psql "$DATABASE_URL" -v dir="$(pwd)" -f load_seed.sql
-- Run from inside backend/seed/generated/ (or pass -v dir=/abs/path).
-- Explicit column lists are used so the load is robust and excludes generated
-- columns (sections_arr, body_tsv, embedding).  FK-safe order is enforced.
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

-- wipe any existing rows (idempotent reload)
TRUNCATE narratives, case_persons, persons, cases, officers, stations RESTART IDENTITY CASCADE;

-- 1) stations  (no FKs)
\copy stations (station_id, station_name, district, "range", latitude, longitude) FROM 'stations.csv' WITH (FORMAT csv, HEADER true)

-- 2) officers  (FK -> stations)
\copy officers (officer_id, name, rank, station_id) FROM 'officers.csv' WITH (FORMAT csv, HEADER true)

-- 3) cases  (FK -> stations, officers).  sections_arr is generated; do not load it.
\copy cases (case_id, fir_number, fir_year, station_id, station_name, district, "range", crime_type, crime_category, legal_code, sections, fir_type, status, complaint_mode, motive, incident_date, incident_time, report_date, latitude, longitude, place_of_offence, io_officer_id, io_name, victim_count, accused_count, is_group, arrested_count, charge_sheeted, convicted) FROM 'cases.csv' WITH (FORMAT csv, HEADER true)

-- 4) persons  (no FKs)
\copy persons (person_id, name, gender, age, district) FROM 'persons.csv' WITH (FORMAT csv, HEADER true)

-- 5) case_persons  (FK -> cases, persons)
\copy case_persons (case_id, person_id, role) FROM 'case_persons.csv' WITH (FORMAT csv, HEADER true)

-- 6) narratives  (FK -> cases).  embedding + body_tsv are filled later/generated.
\copy narratives (narrative_id, case_id, language, body) FROM 'narratives.csv' WITH (FORMAT csv, HEADER true)

COMMIT;

-- ---------- build indexes AFTER load (faster) -------------------------------
CREATE INDEX IF NOT EXISTS idx_cases_district   ON cases (district);
CREATE INDEX IF NOT EXISTS idx_cases_range      ON cases ("range");
CREATE INDEX IF NOT EXISTS idx_cases_crime_type ON cases (crime_type);
CREATE INDEX IF NOT EXISTS idx_cases_report_dt  ON cases (report_date);
CREATE INDEX IF NOT EXISTS idx_cases_status     ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_station    ON cases (station_id);
CREATE INDEX IF NOT EXISTS idx_cases_legalcode  ON cases (legal_code);
CREATE INDEX IF NOT EXISTS idx_cp_case          ON case_persons (case_id);
CREATE INDEX IF NOT EXISTS idx_cp_person        ON case_persons (person_id);
CREATE INDEX IF NOT EXISTS idx_persons_district ON persons (district);
CREATE INDEX IF NOT EXISTS idx_nar_case         ON narratives (case_id);
CREATE INDEX IF NOT EXISTS idx_nar_bodytsv      ON narratives USING GIN (body_tsv);

-- Vector index: build only AFTER embeddings are populated by the embed job.
--   CREATE INDEX idx_nar_embedding ON narratives USING hnsw (embedding vector_cosine_ops);
--   (Neon free tier: column is halfvec(1024) -> use halfvec_cosine_ops)

ANALYZE stations; ANALYZE officers; ANALYZE cases; ANALYZE persons; ANALYZE case_persons; ANALYZE narratives;

-- sanity counts (expect: stations 1074, officers 6949, cases 100000,
--                persons ~416k, case_persons ~416k, narratives 200000)
SELECT 'stations' t, count(*) FROM stations
UNION ALL SELECT 'officers',     count(*) FROM officers
UNION ALL SELECT 'cases',        count(*) FROM cases
UNION ALL SELECT 'persons',      count(*) FROM persons
UNION ALL SELECT 'case_persons', count(*) FROM case_persons
UNION ALL SELECT 'narratives',   count(*) FROM narratives;
