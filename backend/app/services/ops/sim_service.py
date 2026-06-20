"""Live patrol simulation — Python port of EMERGE demoSimulationService.js."""
from __future__ import annotations

import asyncio

from sqlalchemy import update

from app.db.ops_models import IncidentDispatch, PatrolUnit
from app.db.session import get_sessionmaker
from app.services.ops import corridor_service
from app.services.ops.ws_manager import manager

TICK_SEC = 0.8           # interval between coordinate steps
MAX_POINTS = 60          # subsample long routes to <= this many steps
ON_SCENE_HOLD_SEC = 6    # keep unit ON_SCENE this long, then free it (-> IDLE)

# dispatch_id -> asyncio.Task
_running: dict[int, asyncio.Task] = {}
# dispatch_id -> latest {lat,lng,status,eta_sec} for the polling fallback
_latest: dict[int, dict] = {}


def latest_state(dispatch_id: int) -> dict | None:
    return _latest.get(dispatch_id)


def active_states() -> list[dict]:
    """Latest position/status for every simulation still running."""
    return [
        {"dispatchId": did, **_latest[did]}
        for did in list(_running.keys())
        if did in _latest
    ]


def active_ids() -> list[int]:
    """IDs of simulations still running (used by Stop All)."""
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
            vals: dict = {"status": {"COMPLETED": "IDLE", "CANCELLED": "IDLE", "ON_SCENE": "ON_SCENE"}.get(status, "EN_ROUTE")}
            if lat is not None:
                vals["lat"], vals["lng"] = lat, lng
            await db.execute(update(PatrolUnit).where(PatrolUnit.id == patrol_id).values(**vals))


async def _run(dispatch_id: int, patrol_id: int, coords: list[list[float]],
               duration_sec: int, on_move=None) -> None:
    """on_move(lat,lng) optional async hook (Phase 3 green corridor)."""
    pts = _subsample(coords)
    n = max(1, len(pts))
    await _persist_status(dispatch_id, patrol_id, "EN_ROUTE")
    await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "EN_ROUTE"})
    try:
        for i, (lng, lat) in enumerate(pts):
            remaining = int(duration_sec * (1 - i / n))
            _latest[dispatch_id] = {"lat": lat, "lng": lng, "status": "EN_ROUTE", "eta_sec": remaining}
            await manager.broadcast({
                "type": "PATROL_LOCATION", "dispatchId": dispatch_id, "patrolId": patrol_id,
                "lat": lat, "lng": lng, "etaSec": remaining,
                "progress": round((i + 1) / n, 3),
            })
            if on_move:
                await on_move(lat, lng)
            await asyncio.sleep(TICK_SEC)
        # arrived
        last_lng, last_lat = pts[-1]
        await _persist_status(dispatch_id, patrol_id, "ON_SCENE", last_lat, last_lng)
        _latest[dispatch_id] = {"lat": last_lat, "lng": last_lng, "status": "ON_SCENE", "eta_sec": 0}
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "ON_SCENE"})
        await corridor_service.reset_all()
        # Hold on-scene briefly, then free the unit so it can be dispatched again.
        await asyncio.sleep(ON_SCENE_HOLD_SEC)
        await _persist_status(dispatch_id, patrol_id, "COMPLETED", last_lat, last_lng)
        _latest[dispatch_id] = {"lat": last_lat, "lng": last_lng, "status": "COMPLETED", "eta_sec": 0}
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "COMPLETED"})
    except asyncio.CancelledError:
        await _persist_status(dispatch_id, patrol_id, "CANCELLED")
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "CANCELLED"})
        raise
    finally:
        _running.pop(dispatch_id, None)


def start(dispatch_id: int, patrol_id: int, coords: list[list[float]],
          duration_sec: int, on_move=None) -> None:
    if dispatch_id in _running:
        return
    _running[dispatch_id] = asyncio.create_task(
        _run(dispatch_id, patrol_id, coords, duration_sec, on_move)
    )


def stop(dispatch_id: int) -> None:
    task = _running.get(dispatch_id)
    if task:
        task.cancel()
