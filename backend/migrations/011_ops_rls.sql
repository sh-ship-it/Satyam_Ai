-- ============================================================================
-- 011_ops_rls.sql — Row-Level Security for the ops_* tables, plus FORCE on core.
--
-- WHY THIS EXISTS
-- The seven ops_* tables are created by seed/init_ops.py via
-- Base.metadata.create_all, not by a SQL migration, so 002_schema_v2.sql's RLS
-- block never covered them. Measured before this migration, in BOTH databases:
--
--   ops_patrol_units      relrowsecurity = false
--   ops_cameras           relrowsecurity = false
--   ops_traffic_signals   relrowsecurity = false
--
-- and row counts were identical with no jurisdiction context and with
-- scope=station — i.e. patrol positions, camera locations and dispatches were
-- visible to every authenticated officer regardless of jurisdiction.
--
-- ALSO: 002_schema_v2.sql:246-249 already declares FORCE ROW LEVEL SECURITY on
-- cases/narratives/persons/case_persons, but both live databases measure
-- relforcerowsecurity = false, so that migration has not been re-applied since
-- those lines were added. The FORCE statements are repeated here, idempotently,
-- to close that gap without re-running all of 002.
--
-- WHAT THIS DOES **NOT** FIX
-- FORCE makes the table OWNER subject to policies. It does NOT defeat a role
-- holding the rolbypassrls attribute. `neondb_owner` has rolbypassrls = true, so
-- while the app connects as that role every policy here is still bypassed. The
-- companion change is a configuration one: point DATABASE_URL at a
-- least-privilege role and leave the owner URL in SEED_DATABASE_URL, which
-- already exists for exactly this split. Both are required; neither alone is
-- sufficient.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ── Core tables: apply the FORCE that 002 declares but the databases lack ────
ALTER TABLE cases        FORCE ROW LEVEL SECURITY;
ALTER TABLE narratives   FORCE ROW LEVEL SECURITY;
ALTER TABLE persons      FORCE ROW LEVEL SECURITY;
ALTER TABLE case_persons FORCE ROW LEVEL SECURITY;

-- ── Helper: is this session carrying a jurisdiction context at all? ─────────
-- Used by the infrastructure tables below, which have no jurisdiction column to
-- scope by. It converts "unstamped session sees everything" into "unstamped
-- session sees nothing", so a code path that forgets stamp_rls fails CLOSED.
-- Note fn_scope_ok already returns FALSE for an unset app.scope; this is the
-- same fail-closed posture for tables that cannot use fn_scope_ok.
CREATE OR REPLACE FUNCTION fn_has_scope()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.scope', true), '') <> ''
$$;

-- ============================================================================
-- GROUP A — tables that DO have a jurisdiction dimension
-- ============================================================================

-- ops_patrol_units: has district and a soft station_id (no FK, no "range").
-- Range-scoped officers need the range, which only `stations` carries, so join
-- when station_id is present and fall back to the denormalised district when it
-- is not. A row we cannot place is excluded rather than shown.
ALTER TABLE ops_patrol_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_patrol_units FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_patrol_units_scope ON ops_patrol_units;
CREATE POLICY p_ops_patrol_units_scope ON ops_patrol_units
  USING (
    CASE
      WHEN ops_patrol_units.station_id IS NOT NULL THEN
        EXISTS (SELECT 1 FROM stations s
                WHERE s.station_id = ops_patrol_units.station_id
                  AND fn_scope_ok(s."range", s.district, s.station_id))
      ELSE fn_scope_ok(NULL, ops_patrol_units.district, NULL)
    END
  );

-- ops_incident_dispatches: prefer the linked case (authoritative jurisdiction);
-- fall back to the assigned patrol unit when case_id is NULL, which it is for a
-- dispatch raised straight from a camera detection.
ALTER TABLE ops_incident_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_incident_dispatches FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_dispatches_scope ON ops_incident_dispatches;
CREATE POLICY p_ops_dispatches_scope ON ops_incident_dispatches
  USING (
    CASE
      WHEN ops_incident_dispatches.case_id IS NOT NULL THEN
        EXISTS (SELECT 1 FROM cases c
                WHERE c.case_id = ops_incident_dispatches.case_id
                  AND fn_scope_ok(c."range", c.district, c.station_id))
      ELSE
        EXISTS (SELECT 1 FROM ops_patrol_units p
                WHERE p.id = ops_incident_dispatches.patrol_id)
    END
  );

-- ops_patrol_suggestions: scoped through the patrol it moves. A suggestion with
-- no patrol assigned yet has no jurisdiction, so it needs a stamped session.
ALTER TABLE ops_patrol_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_patrol_suggestions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_suggestions_scope ON ops_patrol_suggestions;
CREATE POLICY p_ops_suggestions_scope ON ops_patrol_suggestions
  USING (
    CASE
      WHEN ops_patrol_suggestions.patrol_id IS NOT NULL THEN
        EXISTS (SELECT 1 FROM ops_patrol_units p
                WHERE p.id = ops_patrol_suggestions.patrol_id)
      ELSE fn_has_scope()
    END
  );

-- ops_incident_review_queue: gains a jurisdiction only once an officer confirms
-- it and a case row is created. Before that it is an unplaced detection.
ALTER TABLE ops_incident_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_incident_review_queue FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_review_scope ON ops_incident_review_queue;
CREATE POLICY p_ops_review_scope ON ops_incident_review_queue
  USING (
    CASE
      WHEN ops_incident_review_queue.case_id IS NOT NULL THEN
        EXISTS (SELECT 1 FROM cases c
                WHERE c.case_id = ops_incident_review_queue.case_id
                  AND fn_scope_ok(c."range", c.district, c.station_id))
      ELSE fn_has_scope()
    END
  );

-- ============================================================================
-- GROUP B — tables with NO jurisdiction dimension in the schema
--
-- ops_traffic_signals, ops_cameras and ops_risk_zones store geometry and state
-- and nothing else: no district, no station_id, no range. There is therefore
-- nothing to scope by, and a fn_scope_ok policy here would be theatre — it would
-- read as a jurisdiction guarantee while filtering on a column that does not
-- exist.
--
-- What is honest and still useful: require a stamped session. That closes the
-- real hole (an unscoped connection enumerating every camera in the state) while
-- not pretending to per-district scoping.
--
-- ponytail: proper scoping needs district/station_id columns on these three
-- tables plus a backfill from the nearest station. Deferred to a later migration
-- because it is a schema change with a data-quality question attached, not a
-- policy change. Until then, treat these three as state-visible-to-any-officer.
-- ============================================================================

ALTER TABLE ops_traffic_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_traffic_signals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_signals_scoped_session ON ops_traffic_signals;
CREATE POLICY p_ops_signals_scoped_session ON ops_traffic_signals
  USING (fn_has_scope());

ALTER TABLE ops_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_cameras FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_cameras_scoped_session ON ops_cameras;
CREATE POLICY p_ops_cameras_scoped_session ON ops_cameras
  USING (fn_has_scope());

ALTER TABLE ops_risk_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_risk_zones FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ops_risk_zones_scoped_session ON ops_risk_zones;
CREATE POLICY p_ops_risk_zones_scoped_session ON ops_risk_zones
  USING (fn_has_scope());

-- ============================================================================
-- GRANTS — 008_local_app_grants.sql predates the ops_* tables
-- The app both reads and writes these (dispatch, suggestions, review queue), so
-- unlike the core read-only tables it needs INSERT/UPDATE. DELETE is withheld:
-- nothing in the application deletes ops rows, and the risk-zone recompute uses
-- a wipe-and-reinsert that runs under the seed role.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satyam_app') THEN
    GRANT SELECT, INSERT, UPDATE ON
      ops_patrol_units,
      ops_traffic_signals,
      ops_incident_dispatches,
      ops_risk_zones,
      ops_patrol_suggestions,
      ops_cameras,
      ops_incident_review_queue
    TO satyam_app;

    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO satyam_app;
    GRANT EXECUTE ON FUNCTION fn_has_scope() TO satyam_app;
  END IF;
END $$;

COMMIT;

-- ── Verify (run manually; expect 0 rows out of a seeded database) ────────────
--   SET ROLE satyam_app;
--   SELECT count(*) FROM ops_patrol_units;   -- expect 0 with no app.scope set
--   RESET ROLE;
-- Then with context:
--   SELECT set_config('app.scope','state',true);
--   SELECT count(*) FROM ops_patrol_units;   -- expect the seeded count
