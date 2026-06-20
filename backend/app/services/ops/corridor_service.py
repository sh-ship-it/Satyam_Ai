"""Green corridor — Python port of EMERGE greenCorridor.js.

Flips ops_traffic_signals to GREEN within ACTIVATION_RADIUS_KM of a moving patrol
and broadcasts SIGNAL_GREEN; reset_all() restores NORMAL on arrival.
"""
from __future__ import annotations

from sqlalchemy import select, update

from app.db.ops_models import TrafficSignal
from app.db.session import get_sessionmaker
from app.services.ops.routing_service import haversine_km
from app.services.ops.ws_manager import manager

ACTIVATION_RADIUS_KM = 0.3  # mirrors EMERGE


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
