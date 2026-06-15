-- ============================================================================
-- Satyam — Teardown: drop all old objects so 002_schema_v2.sql starts clean.
-- Idempotent — safe to run multiple times.
-- Usage: psql "$DATABASE_URL" -f migrations/teardown.sql
-- ============================================================================

-- Drop RLS policies (they are dropped automatically with CASCADE on tables,
-- but being explicit avoids "policy does not exist" errors on partial teardowns)
DROP POLICY IF EXISTS cases_select ON cases;
DROP POLICY IF EXISTS narratives_select ON narratives;
DROP POLICY IF EXISTS p_cases_scope ON cases;
DROP POLICY IF EXISTS p_narratives_scope ON narratives;
DROP POLICY IF EXISTS p_case_persons_scope ON case_persons;
DROP POLICY IF EXISTS p_persons_scope ON persons;

-- Drop views
DROP VIEW IF EXISTS persons_v CASCADE;
DROP VIEW IF EXISTS v_officer_session CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS satyam_mask_name(TEXT) CASCADE;
DROP FUNCTION IF EXISTS fn_scope_ok(TEXT, TEXT, INTEGER) CASCADE;

-- Drop all tables (CASCADE handles FK order)
DROP TABLE IF EXISTS audit_log        CASCADE;
DROP TABLE IF EXISTS narratives        CASCADE;
DROP TABLE IF EXISTS case_persons      CASCADE;
DROP TABLE IF EXISTS persons           CASCADE;
DROP TABLE IF EXISTS cases             CASCADE;
DROP TABLE IF EXISTS officers          CASCADE;
DROP TABLE IF EXISTS stations          CASCADE;
DROP TABLE IF EXISTS app_users         CASCADE;
DROP TABLE IF EXISTS users             CASCADE;
DROP TABLE IF EXISTS rank_access       CASCADE;

-- Ensure extensions stay (don't drop vector or pg_trgm)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

SELECT 'teardown complete' AS status;
