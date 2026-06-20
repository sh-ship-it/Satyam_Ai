"""Green corridor — Python port of EMERGE greenCorridor.js.

- activate_near(lat,lng): flip signals GREEN within ACTIVATION_RADIUS_KM of the
  moving unit (per-tick), broadcast SIGNAL_GREEN on real changes.
- activate_corridor(route): light the WHOLE route up-front within CORRIDOR_RADIUS_KM
  and broadcast one GREEN_CORRIDOR_ACTIVE (mirrors activateGreenCorridorForSim).
- reset_all(): restore NORMAL on arrival and broadcast GREEN_CORRIDOR_DEACTIVATED.
"""
from __future__ import annotations

from sqlalchemy import select, update

from app.db.ops_models import TrafficSignal
from app.db.session import get_sessionmaker
from app.services.ops.routing_service import haversine_km
from app.services.ops.ws_manager import manager

ACTIVATION_RADIUS_KM = 0.3  # near the moving unit (mirrors EMERGE greenCorridor.js)
CORRIDOR_RADIUS_KM = 0.5    # along the whole route (mirrors activateGreenCorridorForSim)


async def state() -> dict:
    """Current green-corridor status for the dashboard side panel."""
    sm = get_sessionmaker()
    async with sm() as db:
        rows = (await db.execute(select(TrafficSignal))).scalars().all()
    greens = [s for s in rows if s.state == "GREEN"]
    return {
        "active": len(greens) > 0,
        "count": len(greens),
        "signals": [
            {"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state}
            for s in greens
        ],
    }


async def activate_near(lat: float, lng: float) -> None:
    """Turn signals within the radius GREEN; emit only on real state changes."""
    sm = get_sessionmaker()
    async with sm() as db:
        async with db.begin():
            signals = (await db.execute(select(TrafficSignal))).scalars().all()
            for s in signals:
                d = haversine_km(lat, lng, s.lat, s.lng)
                if d <= ACTIVATION_RADIUS_KM and s.state != "GREEN":
                    await db.execute(update(TrafficSignal).where(TrafficSignal.id == s.id).values(state="GREEN"))
                    await manager.broadcast({
                        "type": "SIGNAL_GREEN", "junctionId": s.junction_id,
                        "lat": s.lat, "lng": s.lng, "distanceKm": round(d, 3),
                    })


async def activate_corridor(route_coords: list[list[float]],
                            patrol_id: int | None = None,
                            callsign: str | None = None) -> list[dict]:
    """Light every signal within CORRIDOR_RADIUS_KM of ANY point on the route,
    then broadcast a single GREEN_CORRIDOR_ACTIVE. route_coords is [[lng,lat],...]."""
    pts = route_coords
    if len(pts) > 50:  # cap O(points*signals) work on long routes
        step = len(pts) / 50.0
        pts = [pts[int(i * step)] for i in range(50)]
    activated: list[dict] = []
    sm = get_sessionmaker()
    async with sm() as db:
        async with db.begin():
            signals = (await db.execute(select(TrafficSignal))).scalars().all()
            for s in signals:
                near = any(haversine_km(lat, lng, s.lat, s.lng) <= CORRIDOR_RADIUS_KM for lng, lat in pts)
                if near:
                    if s.state != "GREEN":
                        await db.execute(update(TrafficSignal).where(TrafficSignal.id == s.id).values(state="GREEN"))
                    activated.append({"junctionId": s.junction_id, "lat": s.lat, "lng": s.lng})
    route_latlng = [[lat, lng] for lng, lat in route_coords]  # Leaflet wants [lat,lng]
    await manager.broadcast({
        "type": "GREEN_CORRIDOR_ACTIVE",
        "patrolId": patrol_id, "callsign": callsign,
        "routeCoords": route_latlng, "signals": activated,
        "message": f"Priority corridor activated — {len(activated)} signals prioritized",
    })
    return activated


async def reset_all() -> None:
    sm = get_sessionmaker()
    async with sm() as db:
        async with db.begin():
            changed = (await db.execute(
                select(TrafficSignal).where(TrafficSignal.state != "NORMAL")
            )).scalars().all()
            if changed:
                await db.execute(update(TrafficSignal).where(TrafficSignal.state != "NORMAL").values(state="NORMAL"))
                await manager.broadcast({"type": "SIGNAL_RESET", "count": len(changed)})
    await manager.broadcast({"type": "GREEN_CORRIDOR_DEACTIVATED"})
