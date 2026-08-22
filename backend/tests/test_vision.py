"""Vision screen checks.

Split into two groups on purpose:

  * Pure checks run anywhere, no database.
  * Data checks need Postgres. They run against DB_SOURCE=local (the
    least-privilege `satyam_app` role) and SKIP with a clear reason when the
    database is unreachable, rather than failing and looking like a code defect.

The aggregation check is the important one. `analytics.hotspots` historically
grouped by (cell, crime_type), so `weight` was a per-crime-type count. Summing
those to drive one 3D column double-counts. This asserts the cell-only mode adds
up to the real number of geocoded cases in the box.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text

from app.core.rbac import Principal
from app.db.rls import apply_rls_context
from app.pipeline.tools import analytics
from app.services import vision_service

# A box around Bengaluru: dense enough to exercise both grid resolutions.
BBOX = (77.40, 12.80, 77.80, 13.10)


# â”€â”€ Pure checks (no database) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def test_fabricated_optics_is_deterministic():
    """Cones must not jitter between requests. Random optics would read as live
    pan-tilt movement that is not happening."""
    a = vision_service._fabricated_optics("CAM-001")
    b = vision_service._fabricated_optics("CAM-001")
    assert a == b
    bearing, fov, reach = a
    assert 0 <= bearing < 360
    assert fov in (45, 60, 75, 90)
    assert 80 <= reach <= 200
    # Different cameras should not all point the same way.
    assert vision_service._fabricated_optics("CAM-002") != a


def test_lod_precision_switches_on_span():
    wide = (73.0, 11.0, 79.0, 19.0)  # whole state
    tight = (77.5, 12.9, 77.7, 13.0)  # a few km
    assert vision_service._lod_precision(wide) == vision_service.PRECISION_COARSE
    assert vision_service._lod_precision(tight) == vision_service.PRECISION_FINE
    # No bbox means "show me everything", which must not request the fine grid.
    assert vision_service._lod_precision(None) == vision_service.PRECISION_COARSE


async def test_hotspots_rejects_bad_arguments():
    """precision and limit are interpolated into the SQL string, so they are
    validated before any statement is built. session=None proves validation
    happens first: a bad argument must never reach the database."""
    with pytest.raises(ValueError):
        await analytics.hotspots(None, precision=9)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        await analytics.hotspots(None, precision=-1)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        await analytics.hotspots(None, limit=0)  # type: ignore[arg-type]


# â”€â”€ Data checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@asynccontextmanager
async def scoped_session():
    """Session on the least-privilege local role, stamped with state scope.

    State scope is used because these checks are about aggregation arithmetic,
    not jurisdiction filtering; they need to see the whole dataset.

    Deliberately a context manager rather than an async pytest fixture. An async
    fixture runs on pytest-asyncio's fixture event loop, which by default is not
    the test's loop, so the asyncpg connection ends up bound to a loop that is
    already closed by the time the test body uses it â€” surfacing as a bare
    RuntimeError. Opening the session inside the test keeps one loop throughout.

    It also refuses to swallow errors from the test body. An earlier version
    wrapped the yield in `except Exception: pytest.skip(...)`, which reported
    genuine assertion failures as "database unavailable" â€” a test that lies about
    why it did not run is worse than no test.
    """
    from app.db import session as sess

    sess.set_db_source("local")

    # app/db/session.py caches one engine per source in a module-level dict, so
    # its connection pool belongs to whichever event loop created it. pytest-asyncio
    # gives every test a fresh loop, so a cached pool from an earlier test raises
    # "got Future attached to a different loop". Dispose and rebuild per test.
    # This is a test-only concession to the app's global engine cache; production
    # runs one loop for the process lifetime and is unaffected.
    stale = sess._engines.pop("local", None)
    sess._sessionmakers.pop("local", None)
    if stale is not None:
        await stale.dispose()

    sm = sess.get_sessionmaker()
    async with sm() as s:
        async with s.begin():
            await apply_rls_context(
                s,
                scope="state",
                range_name="",
                district="",
                station_id=None,
                clearance=4,
                officer_id=None,
            )
            yield s


async def _require_data() -> None:
    """Skip the data checks when Postgres is unreachable or unseeded.

    Connectivity is probed in its own short-lived session so that a failure here
    is unambiguously about the environment, never about the code under test.
    """
    try:
        async with scoped_session() as s:
            total = (
                await s.execute(text("SELECT count(*) FROM cases WHERE latitude IS NOT NULL"))
            ).scalar() or 0
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"local Postgres unavailable: {type(exc).__name__}: {exc}")
    if total == 0:
        pytest.skip("no geocoded cases visible under state scope; seed the database first")


def _principal(clearance: int) -> Principal:
    return Principal(
        id="test",
        name="Test Officer",
        rank="admin" if clearance >= 4 else "viewer",
        scope="state" if clearance >= 4 else "station",
        clearance=clearance,
    )


async def test_cell_only_aggregation_does_not_double_count():
    """Sum of per-cell weights must equal the geocoded case count in the box.

    This is the check that guards the double-counting bug: with the historical
    group_by_crime_type=True, one cell yields one row per crime type and the
    weights no longer add up to reality.
    """
    await _require_data()
    async with scoped_session() as s:
        expected = (
            await s.execute(
                text(
                    "SELECT count(*) FROM cases WHERE latitude IS NOT NULL "
                    "AND longitude BETWEEN :w AND :e AND latitude BETWEEN :s AND :n"
                ),
                {"w": BBOX[0], "e": BBOX[2], "s": BBOX[1], "n": BBOX[3]},
            )
        ).scalar() or 0

        cells = await analytics.hotspots(
            s,
            bbox=BBOX,
            precision=3,
            group_by_crime_type=False,
            limit=vision_service.CRIME_CELL_CAP,
        )
        assert cells, "expected at least one cell in the Bengaluru box"
        assert sum(int(c["weight"]) for c in cells) == expected
        assert "crime_type" not in cells[0], "cell-only mode must not group by crime type"


async def test_grouped_mode_is_unchanged_for_existing_callers():
    """The original behaviour is still the default, so map_service and the
    orchestrator are unaffected by the new parameters."""
    await _require_data()
    async with scoped_session() as s:
        rows = await analytics.hotspots(s, bbox=BBOX)
        assert rows
        assert "crime_type" in rows[0]
        assert len(rows) <= 500, "default limit must stay at the historical 500"


async def test_bbox_actually_filters():
    await _require_data()
    async with scoped_session() as s:
        cells = await analytics.hotspots(
            s, bbox=BBOX, precision=3, group_by_crime_type=False, limit=5000
        )
        west, south, east, north = BBOX
        for lat, lng in ((float(c["lat"]), float(c["lng"])) for c in cells):
            # Rounding to the grid can nudge a centroid a half-cell outside the box.
            assert west - 0.001 <= lng <= east + 0.001
            assert south - 0.001 <= lat <= north + 0.001


async def test_coarse_grid_aggregates_without_losing_incidents():
    await _require_data()
    async with scoped_session() as s:
        fine = await analytics.hotspots(
            s, bbox=BBOX, precision=3, group_by_crime_type=False, limit=20000
        )
        coarse = await analytics.hotspots(
            s, bbox=BBOX, precision=2, group_by_crime_type=False, limit=20000
        )
        assert 0 < len(coarse) <= len(fine)
        # Changing resolution must not invent or drop incidents.
        assert sum(int(c["weight"]) for c in coarse) == sum(int(c["weight"]) for c in fine)


async def test_l1_coordinates_are_coarsened():
    await _require_data()
    async with scoped_session() as s:
        snap = await vision_service.build_snapshot(
            s, _principal(1), bbox=BBOX, layers={"crime_hex"}, ops_enabled=False
        )
        assert snap["coords_coarsened"] is True
        cells = snap["layers"]["crime_hex"]["data"]
        assert cells
        for lat, lng, _w in cells:
            # 2 dp is ~1.1 km: enough to see a pattern, not to locate a door.
            assert round(lat, vision_service.COARSE_DP) == lat
            assert round(lng, vision_service.COARSE_DP) == lng


async def test_l4_coordinates_are_not_coarsened():
    await _require_data()
    async with scoped_session() as s:
        snap = await vision_service.build_snapshot(
            s, _principal(4), bbox=BBOX, layers={"crime_hex"}, ops_enabled=False
        )
        assert snap["coords_coarsened"] is False
        assert snap["layers"]["crime_hex"]["count"] > 0


async def test_snapshot_degrades_when_ops_disabled():
    await _require_data()
    async with scoped_session() as s:
        snap = await vision_service.build_snapshot(
            s, _principal(4), bbox=BBOX, ops_enabled=False
        )
        # Crime density reads `cases`, so it must survive the ops module being off.
        assert snap["layers"]["crime_hex"]["count"] > 0
        for name in ("patrols", "signals", "cameras", "risk_zones", "dispatches"):
            assert snap["layers"][name]["degraded"], f"{name} should explain itself"
            assert snap["layers"][name]["data"] == []
        assert any(d.endswith(":ops_disabled") for d in snap["degraded"])


async def test_camera_layer_is_labelled_simulated():
    await _require_data()
    async with scoped_session() as s:
        snap = await vision_service.build_snapshot(
            s, _principal(4), bbox=BBOX, layers={"cameras"}, ops_enabled=True
        )
        cam = snap["layers"]["cameras"]
        if cam.get("degraded"):
            pytest.skip(f"ops_cameras unavailable: {cam['degraded']}")
        # Fabricated geometry must never be presented as real.
        assert cam["provenance"] == "simulated"
        assert "FABRICATED" in (cam["note"] or "")
        for row in cam["data"]:
            assert row["optics_fabricated"] is True


async def test_snapshot_audit_row_links_to_its_predecessor():
    """A Vision read must append exactly one audit row, correctly chained.

    This asserts local correctness rather than calling verify_chain(), because
    verify_chain walks the WHOLE table and the shared database already contains
    pre-existing forks (five rows, earliest audit_id=90, all
    `financial.money_trail`, each with a prev_hash that does not match its actual
    predecessor). Those predate this screen. Asserting global validity here would
    fail for reasons this code does not control and would obscure a real
    regression in the rows Vision itself writes.
    """
    await _require_data()
    from sqlalchemy import select

    from app.core.audit import _digest, write_audit
    from app.db.models import AuditLog

    async with scoped_session() as s:
        before = (await s.execute(text("SELECT count(*) FROM audit_log"))).scalar() or 0
        prev_row = (
            await s.execute(select(AuditLog).order_by(AuditLog.audit_id.desc()).limit(1))
        ).scalar_one_or_none()
        prev_hash = prev_row.row_hash if prev_row else "GENESIS"

        entry = await write_audit(
            s,
            action="vision.snapshot",
            user_id=None,
            query_text="test bbox=(77.4,12.8,77.8,13.1)",
        )

        after = (await s.execute(text("SELECT count(*) FROM audit_log"))).scalar() or 0
        assert after - before == 1, "one read must append exactly one audit row"
        assert entry.prev_hash == prev_hash, "new row must link to the current tip"

        payload = {
            "action": entry.action,
            "user_id": entry.user_id,
            "case_id": entry.case_id,
            "reason": entry.reason,
            "query_text": entry.query_text,
            "generated_sql": entry.generated_sql,
        }
        assert entry.row_hash == _digest(prev_hash, payload), (
            "stored row_hash must equal the digest recomputed from the stored fields"
        )
        # Roll back so a test run never leaves rows in a shared audit chain.
        await s.rollback()


# ── Voice planner (no LLM, no database) ──────────────────────────────────────


def _plan(cmd: str, lang: str = "en", current: str | None = None) -> dict:
    from app.pipeline.screen_agent import _rule_plan

    return _rule_plan(cmd, current_route=current, lang=lang)


def _actions(
    cmd: str, lang: str = "en", current: str | None = None
) -> list[tuple[str, dict]]:
    p = _plan(cmd, lang, current)
    assert p["route"] == "/vision", f"expected /vision, got {p['route']!r} for {cmd!r}"
    return [(a["action"], a.get("params", {})) for a in p["actions"]]


def test_vision_is_in_the_capability_manifest():
    """The manifest is rendered into the LLM system prompt, so a missing entry
    means the model has no idea the screen exists."""
    from app.pipeline.screen_agent import SCREEN_CAPABILITIES, _manifest_text

    assert "/vision" in SCREEN_CAPABILITIES
    spec = SCREEN_CAPABILITIES["/vision"]
    assert spec["actions"], "Vision must expose actions, not be navigation-only"
    assert spec["kn"], "Vision needs Kannada trigger words"
    assert "/vision" in _manifest_text()


def test_rule_planner_switches_view_mode():
    assert ("set_view", {"mode": "earth"}) in _actions("show me the earth view in vision")
    assert ("set_view", {"mode": "3d"}) in _actions("switch vision to 3d")
    assert ("set_view", {"mode": "2d"}) in _actions("vision flat map")


def test_rule_planner_maps_thermal_to_flir():
    """An officer says 'thermal', the treatment id is 'flir'."""
    assert ("set_treatment", {"name": "flir"}) in _actions("turn on thermal mode in vision")
    assert ("set_treatment", {"name": "nvg"}) in _actions("vision night vision on")
    assert ("set_treatment", {"name": "noir"}) in _actions("vision monochrome")


def test_rule_planner_handles_kannada():
    """Literal Kannada, not escapes. Kannada is U+0C80-U+0CFF; the visually
    similar Devanagari block at U+0900 will silently fail to match."""
    acts = _actions("ವಿಷನ್ ಥರ್ಮಲ್ ಮೋಡ್", lang="kn")
    assert ("set_treatment", {"name": "flir"}) in acts


def test_rule_planner_layer_on_and_off():
    """Layer commands are issued while already looking at the map, so they are
    tested with current_route="/vision" — the real calling shape. "show cameras"
    from a cold start is genuinely ambiguous with the camera-review screen and is
    not something this branch should try to win."""
    on = _actions("show the cctv cameras", current="/vision")
    assert ("toggle_layer", {"layer": "cameras", "on": True}) in on
    # "hide" has to beat the word "show" appearing in the same sentence.
    off = _actions("hide cameras", current="/vision")
    assert ("toggle_layer", {"layer": "cameras", "on": False}) in off
    # Layer ids are the vocabulary that sticks; see _in_screen_command's note on
    # inflections. Singular "camera layer" is a known miss, not a silent one.


def test_current_screen_is_sticky_for_in_screen_commands():
    """An in-screen command must not navigate the officer away."""
    from app.pipeline.screen_agent import _detect_route

    assert _detect_route("show the cctv cameras", "/vision") == "/vision"
    assert _detect_route("show crime density", "/vision") == "/vision"
    assert _detect_route("switch to earth", "/vision") == "/vision"
    # But explicitly naming another screen still wins.
    assert _detect_route("open the camera review screen", "/vision") == "/ops-camera"
    assert _detect_route("open the network graph", "/vision") == "/network"
    # And with no current screen, content words route on content.
    assert _detect_route("show cctv detections", None) == "/ops-camera"
    # Stickiness is derived from each screen's own manifest, so it is not a
    # Vision-only special case.
    assert _detect_route("generate the pdf report", "/reports") == "/reports"
    assert _detect_route("open reports", "/network") == "/reports"


def test_rule_planner_sets_bin_radius():
    assert ("set_hex_radius", {"radius_m": 500}) in _actions("vision set crime bins to 500")


def test_planner_actions_survive_sanitisation():
    """_sanitize_actions drops any (screen, action) not in the manifest, so a
    typo in the rule branch would be silently discarded rather than error."""
    from app.pipeline.screen_agent import _sanitize_actions

    for cmd in (
        "show me the earth view in vision",
        "turn on thermal mode in vision",
        "vision show cctv cameras",
        "vision set crime bins to 500",
    ):
        raw = _plan(cmd)["actions"]
        kept = _sanitize_actions(raw)
        assert len(kept) == len(raw), f"an action was dropped for {cmd!r}: {raw} -> {kept}"


# ── Row-level security on the ops_* tables (migration 011) ───────────────────


async def _unscoped_session():
    """A session with NO jurisdiction context stamped, on the least-privilege role."""
    from app.db import session as sess

    sess.set_db_source("local")
    stale = sess._engines.pop("local", None)
    sess._sessionmakers.pop("local", None)
    if stale is not None:
        await stale.dispose()
    return sess.get_sessionmaker()


OPS_TABLES = (
    "ops_patrol_units",
    "ops_traffic_signals",
    "ops_cameras",
    "ops_incident_dispatches",
    "ops_risk_zones",
    "ops_patrol_suggestions",
    "ops_incident_review_queue",
)


async def test_ops_tables_have_rls_enabled_and_forced():
    """Both flags matter. ENABLE alone is bypassed by the table owner, and this
    project's deployed role is the table owner."""
    await _require_data()
    async with scoped_session() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = ANY(:t) AND relkind = 'r'"
                ),
                {"t": list(OPS_TABLES)},
            )
        ).all()
        found = {r[0]: (r[1], r[2]) for r in rows}
        missing = [t for t in OPS_TABLES if t not in found]
        if missing:
            pytest.skip(f"ops tables absent (run seed.init_ops): {missing}")
        for table, (enabled, forced) in found.items():
            assert enabled, f"{table} has RLS disabled — apply migrations/011_ops_rls.sql"
            assert forced, f"{table} lacks FORCE RLS — the table owner would bypass it"


async def test_ops_rls_denies_without_jurisdiction_context():
    """The headline check. Before migration 011 these tables returned every row to
    any authenticated caller regardless of jurisdiction; measured 4 patrols,
    2 cameras and 5 signals with no context stamped. An unstamped session must now
    see nothing, so a code path that forgets stamp_rls fails closed."""
    await _require_data()
    sm = await _unscoped_session()
    async with sm() as s:
        async with s.begin():
            role = (await s.execute(text("SELECT current_user"))).scalar()
            bypass = (
                await s.execute(
                    text(
                        "SELECT rolsuper OR rolbypassrls FROM pg_roles "
                        "WHERE rolname = current_user"
                    )
                )
            ).scalar()
            if bypass:
                pytest.skip(
                    f"role {role} bypasses RLS (superuser or rolbypassrls); "
                    "point DATABASE_URL at a least-privilege role to test this"
                )
            for table in OPS_TABLES:
                n = (
                    await s.execute(text(f"SELECT count(*) FROM {table}"))  # noqa: S608
                ).scalar()
                assert n == 0, (
                    f"{table} returned {n} rows with NO jurisdiction context "
                    "— RLS is not being enforced"
                )


async def test_ops_rls_allows_a_scoped_session():
    """The other half: the policy must not be so strict that it denies everyone."""
    await _require_data()
    async with scoped_session() as s:  # stamped with scope=state
        n = (await s.execute(text("SELECT count(*) FROM ops_patrol_units"))).scalar() or 0
        assert n > 0, "a state-scoped session should see the seeded patrol units"
