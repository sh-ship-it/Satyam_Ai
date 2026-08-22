"""Vision tactical-map router. Mounted at /api/vision only when ENABLE_VISION=true.

Design notes that differ deliberately from app/api/routes/ops.py:

  * Every read is audited. ops.py writes no audit rows at all, which is the one
    pattern from that module not worth copying on a screen that exposes
    statewide crime geography.
  * Coordinate precision honours Principal.should_coarsen_coords(). That method
    exists on Principal and, before this router, nothing in the codebase called
    it. A map is exactly where it belongs.
  * Layers degrade individually. A dead upstream returns a `degraded` marker
    rather than failing the whole request, mirroring routing_service's
    OSRM -> STRAIGHT_LINE fallback convention.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.config import get_settings
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.vision import VisionSnapshot, VisionTelemetry
from app.services import vision_service

router = APIRouter()

_STARTED_AT = time.monotonic()

# Karnataka, generously padded. A caller-supplied bbox is clamped to this so a
# malformed or hostile viewport cannot turn into a full-table scan.
STATE_BOUNDS = (73.0, 11.0, 79.5, 19.5)


def _guard(principal: Principal) -> None:
    """Vision reads case geography, so it needs analyst clearance (L2+), the same
    bar map.py applies. This is deliberately stricter than ops.py, which leaves
    reads open to every authenticated officer."""
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _parse_bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    if not raw:
        return None
    parts = raw.split(",")
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail="bbox must be 'west,south,east,north'")
    try:
        west, south, east, north = (float(p) for p in parts)
    except ValueError:
        raise HTTPException(status_code=422, detail="bbox values must be numbers") from None
    if west > east or south > north:
        raise HTTPException(status_code=422, detail="bbox must be west<east and south<north")
    lo_w, lo_s, hi_e, hi_n = STATE_BOUNDS
    return (
        max(west, lo_w),
        max(south, lo_s),
        min(east, hi_e),
        min(north, hi_n),
    )


async def _rls_posture(session: AsyncSession) -> tuple[bool, str | None]:
    """Is row-level security actually in force for the connected role?

    A role with rolsuper or rolbypassrls ignores every policy, and a table
    owner ignores any policy that is not FORCE-enabled. Either way the
    jurisdiction guarantee is void, so report it rather than assume it.
    """
    try:
        row = (
            await session.execute(
                text(
                    "SELECT rolsuper, rolbypassrls FROM pg_roles "
                    "WHERE rolname = current_user"
                )
            )
        ).first()
        if row is None:
            return False, "connected role not found in pg_roles"
        rolsuper, rolbypassrls = bool(row[0]), bool(row[1])
        if rolsuper or rolbypassrls:
            return False, (
                "connected role bypasses RLS "
                f"(rolsuper={rolsuper}, rolbypassrls={rolbypassrls}); "
                "jurisdiction scoping is enforced in the application layer only"
            )
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, f"could not determine RLS posture: {type(exc).__name__}"


@router.get("/telemetry", response_model=VisionTelemetry)
async def telemetry(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> VisionTelemetry:
    """Cheap status probe for the HUD. No audit row: this is a liveness check,
    not a data read, and auditing a 5-second poll would flood the chain."""
    settings = get_settings()

    started = time.perf_counter()
    try:
        await session.execute(text("SELECT 1"))
        latency: float | None = round((time.perf_counter() - started) * 1000, 1)
    except Exception:  # noqa: BLE001
        latency = None

    rls_ok, rls_note = await _rls_posture(session)

    ws_clients = 0
    if settings.enable_response_ops:
        try:
            from app.services.ops.ws_manager import manager

            ws_clients = len(getattr(manager, "_clients", ()) or ())
        except Exception:  # noqa: BLE001
            ws_clients = 0

    from app.db.session import get_db_source

    return VisionTelemetry(
        uptime_sec=int(time.monotonic() - _STARTED_AT),
        db_latency_ms=latency,
        db_source=get_db_source(),
        ops_enabled=settings.enable_response_ops,
        ws_clients=ws_clients,
        rls_enforced=rls_ok,
        rls_note=rls_note,
        coords_coarsened=principal.should_coarsen_coords(),
        rank=principal.rank,
        scope=principal.scope,
        clearance=principal.clearance,
    )


@router.get("/snapshot", response_model=VisionSnapshot)
async def snapshot(
    bbox: str | None = Query(None, description="west,south,east,north"),
    layers: str | None = Query(None, description="comma-separated layer ids"),
    crime_type: str | None = None,
    district: str | None = None,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> VisionSnapshot:
    """Everything the map needs, in one round trip.

    One call rather than three because a bare `SELECT 1` to the managed database
    measures 250-500 ms from here; three sequential client calls would spend over
    a second in pure latency before rendering anything.

    Exactly one audit row per call. Unlike /api/ops/*, which writes none, this
    endpoint exposes statewide crime geography and therefore belongs in the
    tamper-evident chain.
    """
    _guard(principal)
    box = _parse_bbox(bbox)
    wanted = {s.strip() for s in layers.split(",") if s.strip()} if layers else None

    settings = get_settings()
    result = await vision_service.build_snapshot(
        session,
        principal,
        bbox=box,
        layers=wanted,
        ops_enabled=settings.enable_response_ops,
        crime_type=crime_type,
        district=district,
    )

    await write_audit(
        session,
        action="vision.snapshot",
        user_id=principal.officer_id,
        query_text=(
            f"bbox={box} layers={sorted(wanted) if wanted else 'all'} "
            f"crime_type={crime_type} district={district} "
            f"coarsened={result['coords_coarsened']}"
        ),
    )
    return VisionSnapshot(**result)


@router.get("/entity/{kind}/{entity_id}")
async def entity(
    kind: str,
    entity_id: str,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Dossier payload for one map entity, with nearest cross-references."""
    _guard(principal)
    allowed = {"patrol", "camera", "risk_zone", "dispatch"}
    if kind not in allowed:
        raise HTTPException(
            status_code=422, detail=f"kind must be one of {sorted(allowed)}"
        )
    try:
        payload = await vision_service.build_entity(
            session, principal, kind=kind, entity_id=entity_id
        )
    except ValueError:
        # Non-numeric id where an int was required.
        raise HTTPException(status_code=422, detail="malformed entity id") from None
    if payload is None:
        raise HTTPException(status_code=404, detail=f"{kind} {entity_id} not found")

    await write_audit(
        session,
        action="vision.entity",
        user_id=principal.officer_id,
        query_text=f"kind={kind} id={entity_id}",
    )
    return payload
