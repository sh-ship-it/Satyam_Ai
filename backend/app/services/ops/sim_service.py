"""Live patrol simulation — Python port of EMERGE demoSimulationService.js.

Adds (parity pack): an ACCEPTED phase, a `phase` field on every broadcast, an
in-memory active-dispatch registry (active_states/active_ids), simulate-all /
stop-all support, and up-front whole-route green-corridor activation.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select, update

from app.db.ops_models import IncidentDispatch, PatrolUnit
from app.db.session import get_sessionmaker
from app.services.ops import corridor_service
from app.services.ops.ws_manager import manager

log = logging.getLogger("satyam.ops.sim")

TICK_SEC = 0.8            # interval between coordinate steps
MAX_POINTS = 60           # subsample long routes to <= this many steps
ON_SCENE_HOLD_SEC = 6     # keep unit ON_SCENE this long, then free it (-> IDLE)
ACCEPTED_HOLD_SEC = 2     # brief ACCEPTED phase before moving (mirrors EMERGE)

# dispatch_id -> asyncio.Task
_running: dict[int, asyncio.Task] = {}
# dispatch_id -> latest {lat,lng,status,phase,eta_sec,progress,callsign,...}
_latest: dict[int, dict] = {}


def latest_state(dispatch_id: int) -> dict | None:
    return _latest.get(dispatch_id)


def active_states() -> list[dict]:
    """Snapshot of every dispatch that is not finished (drives the Active list)."""
    return [
        {"dispatchId": did, **st}
        for did, st in _latest.items()
        if st.get("status") not in ("COMPLETED", "CANCELLED")
    ]


def active_ids() -> list[int]:
    return list(_running.keys())


def _subsample(coords: list[list[float]], cap: int = MAX_POINTS) -> list[list[float]]:
    if len(coords) <= cap:
        return coords
    step = (len(coords) - 1) / (cap - 1)
    out = [coords[round(i * step)] for i in range(cap)]
    if out[-1] != coords[-1]:
        out.append(coords[-1])
    return out


async def _persist_status(dispatch_id: int, patrol_id: int, status: str,
                          lat: float | None = None, lng: float | None = None) -> None:
    sm = get_sessionmaker()
    async with sm() as db:
        async with db.begin():
            await db.execute(update(IncidentDispatch).where(IncidentDispatch.id == dispatch_id).values(status=status))
            vals: dict = {"status": {"COMPLETED": "IDLE", "ON_SCENE": "ON_SCENE"}.get(status, "EN_ROUTE")}
            if lat is not None:
                vals["lat"], vals["lng"] = lat, lng
            await db.execute(update(PatrolUnit).where(PatrolUnit.id == patrol_id).values(**vals))


async def _load_meta(dispatch_id: int, patrol_id: int) -> dict:
    sm = get_sessionmaker()
    async with sm() as db:
        callsign = (await db.execute(
            select(PatrolUnit.callsign).where(PatrolUnit.id == patrol_id)
        )).scalar()
        disp = (await db.execute(
            select(IncidentDispatch).where(IncidentDispatch.id == dispatch_id)
        )).scalar_one_or_none()
    return {
        "patrolId": patrol_id,
        "callsign": callsign or f"Unit #{patrol_id}",
        "sceneLat": disp.scene_lat if disp else None,
        "sceneLng": disp.scene_lng if disp else None,
    }


async def _emit_status(dispatch_id: int, status: str, phase: str) -> None:
    await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": status, "phase": phase})


async def _run(dispatch_id: int, patrol_id: int, coords: list[list[float]],
               duration_sec: int, on_move=None) -> None:
    """on_move(lat,lng) optional async hook (per-tick near-corridor activation)."""
    pts = _subsample(coords)
    n = max(1, len(pts))
    meta = await _load_meta(dispatch_id, patrol_id)

    # --- ACCEPTED (brief) ---
    first_lng, first_lat = pts[0]
    _latest[dispatch_id] = {**meta, "lat": first_lat, "lng": first_lng,
                            "status": "ACCEPTED", "phase": "ACCEPTED",
                            "eta_sec": duration_sec, "progress": 0.0}
    await _persist_status(dispatch_id, patrol_id, "ACCEPTED", first_lat, first_lng)
    await _emit_status(dispatch_id, "ACCEPTED", "ACCEPTED")
    await asyncio.sleep(ACCEPTED_HOLD_SEC)

    # --- EN_ROUTE: light the whole corridor up-front, then start moving ---
    await _persist_status(dispatch_id, patrol_id, "EN_ROUTE")
    await _emit_status(dispatch_id, "EN_ROUTE", "EN_ROUTE")
    try:
        await corridor_service.activate_corridor(pts, patrol_id=patrol_id, callsign=meta["callsign"])
    except Exception:  # noqa: BLE001 - corridor is best-effort
        pass

    try:
        for i, (lng, lat) in enumerate(pts):
            remaining = int(duration_sec * (1 - i / n))
            progress = round((i + 1) / n, 3)
            _latest[dispatch_id] = {**meta, "lat": lat, "lng": lng,
                                    "status": "EN_ROUTE", "phase": "EN_ROUTE",
                                    "eta_sec": remaining, "progress": progress}
            await manager.broadcast({
                "type": "PATROL_LOCATION", "dispatchId": dispatch_id, "patrolId": patrol_id,
                "lat": lat, "lng": lng, "etaSec": remaining, "progress": progress, "phase": "EN_ROUTE",
            })
            if on_move:
                await on_move(lat, lng)
            await asyncio.sleep(TICK_SEC)

        # --- ON_SCENE ---
        last_lng, last_lat = pts[-1]
        await _persist_status(dispatch_id, patrol_id, "ON_SCENE", last_lat, last_lng)
        _latest[dispatch_id] = {**meta, "lat": last_lat, "lng": last_lng,
                                "status": "ON_SCENE", "phase": "ON_SCENE", "eta_sec": 0, "progress": 1.0}
        await _emit_status(dispatch_id, "ON_SCENE", "ON_SCENE")
        await corridor_service.reset_all()
        await asyncio.sleep(ON_SCENE_HOLD_SEC)

        # --- COMPLETED (unit freed -> IDLE) ---
        await _persist_status(dispatch_id, patrol_id, "COMPLETED", last_lat, last_lng)
        _latest[dispatch_id] = {**meta, "lat": last_lat, "lng": last_lng,
                                "status": "COMPLETED", "phase": "COMPLETED", "eta_sec": 0, "progress": 1.0}
        await _emit_status(dispatch_id, "COMPLETED", "COMPLETED")
    except asyncio.CancelledError:
        await _persist_status(dispatch_id, patrol_id, "CANCELLED")
        try:
            await corridor_service.reset_all()
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        _running.pop(dispatch_id, None)


def start(dispatch_id: int, patrol_id: int, coords: list[list[float]],
          duration_sec: int, on_move=None) -> None:
    if dispatch_id in _running:
        return
    task = asyncio.create_task(
        _run(dispatch_id, patrol_id, coords, duration_sec, on_move)
    )
    _running[dispatch_id] = task

    def _on_done(t: asyncio.Task) -> None:
        # Surface any non-cancellation error instead of silently swallowing it
        # ("Task exception was never retrieved"). Also drop the stale latest
        # state so the in-memory registry doesn't leak completed dispatches.
        try:
            exc = t.exception()
        except asyncio.CancelledError:
            exc = None
        if exc is not None:
            log.error("sim task failed for dispatch %s: %r", dispatch_id, exc)
        _latest.pop(dispatch_id, None)

    task.add_done_callback(_on_done)


def stop(dispatch_id: int) -> None:
    task = _running.get(dispatch_id)
    if task:
        task.cancel()


def stop_all() -> None:
    for did in list(_running.keys()):
        stop(did)
