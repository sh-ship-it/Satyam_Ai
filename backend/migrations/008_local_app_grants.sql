-- 008_local_app_grants.sql
-- ---------------------------------------------------------------------------
-- Make the LOCAL Postgres behave like the cloud DB.
--
-- On Neon (cloud) the API connects as the table OWNER (neondb_owner), so it has
-- full access. On a local install the API connects as the least-privilege role
-- `satyam_app`, which must be explicitly granted access to every table the owner
-- (`satyam`) created — otherwise every query fails with "permission denied for
-- table …".
--
-- CORRECTION: an earlier version of this comment claimed RLS "still applies via
-- FORCE RLS" on the cloud connection. That is FALSE and was the assumption that
-- hid a real gap. No table in either database has FORCE ROW LEVEL SECURITY, and
-- neondb_owner is both the table owner and a rolbypassrls role, so on the cloud
-- connection every RLS policy is bypassed. Verified by measurement: as
-- neondb_owner with no jurisdiction context set, `SELECT count(*) FROM cases`
-- returns all rows, whereas as satyam_app it returns 0.
--
-- Granting satyam_app is therefore not merely a local convenience: connecting as
-- this non-owner role is what makes the RLS policies take effect at all.
--
-- Run ONCE against the local DB as a superuser / the table owner, e.g.:
--   psql "postgresql://postgres:<pw>@localhost:5432/satyam" -f migrations/008_local_app_grants.sql
--
-- Idempotent: safe to re-run after a re-seed or new migration.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO satyam_app;

-- Read access to every table/view in the schema.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO satyam_app;

-- Write access where the app legitimately writes (board save, ops dispatch,
-- admin policy updates, audit appends, …). This mirrors the owner-level access
-- the cloud connection already has.
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO satyam_app;

-- Sequences for SERIAL / BIGSERIAL primary keys so INSERTs can allocate ids.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO satyam_app;

-- PRESERVE the tamper-evident audit chain: the app may APPEND (INSERT) and READ
-- audit rows, but must NEVER mutate or delete an existing entry.
REVOKE UPDATE, DELETE ON audit_log FROM satyam_app;

-- Auto-grant the same access on any FUTURE tables/sequences the owner creates,
-- so a re-seed or later migration never reintroduces "permission denied".
ALTER DEFAULT PRIVILEGES FOR ROLE satyam IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satyam_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satyam IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO satyam_app;

-- ─── Demo users (idempotent) ─────────────────────────────────────────────────
-- Ensure the same "demo" account exists locally that the frontend auto-login
-- uses.  Password hashes are bcrypt(cost=12) of the literal password shown.
-- Promote ALL local users to state scope + L4 clearance so the 100k dataset
-- is visible regardless of which account the officer logs in with.
--
-- bcrypt hash of "demo":
-- $2b$12$... generated once; replace below if you change the password.
DO $$
DECLARE
  v_officer_id INTEGER;
  v_station_id INTEGER;
BEGIN
  SELECT station_id INTO v_station_id FROM stations LIMIT 1;
  IF v_station_id IS NULL THEN v_station_id := 1; END IF;

  -- Ensure a DGP officer row exists for the demo account
  SELECT officer_id INTO v_officer_id FROM officers WHERE rank = 'DGP' LIMIT 1;
  IF v_officer_id IS NULL THEN
    v_officer_id := (SELECT COALESCE(MAX(officer_id), 0) + 1 FROM officers);
    INSERT INTO officers (officer_id, name, rank, station_id)
    VALUES (v_officer_id, 'Demo DGP', 'DGP', v_station_id)
    ON CONFLICT (officer_id) DO NOTHING;
  END IF;

  -- Upsert the "demo" user (password hash = bcrypt("demo"))
  INSERT INTO users (
    username, password_hash, full_name, email,
    officer_id, assigned_rank, is_active,
    scope_override, clearance_override
  ) VALUES (
    'demo',
    -- bcrypt(12, "demo") — replace with a fresh hash if you change the password
    '$2b$12$0CU3YapRcTLQnVZhCmeibeAFXGjEK/cUnvJMLXu1/VijTrb9fHnam',
    'Demo DGP', 'demo@ksp.local',
    v_officer_id, 'DGP', TRUE,
    'state', 4
  )
  ON CONFLICT (username) DO UPDATE SET
    scope_override     = 'state',
    clearance_override = 4,
    is_active          = TRUE;
END $$;

-- Promote every existing local user to state scope + L4 clearance so the
-- full 100k dataset is visible in the local environment.
UPDATE users
SET scope_override = 'state', clearance_override = 4
WHERE scope_override IS DISTINCT FROM 'state'
   OR clearance_override IS DISTINCT FROM 4;
