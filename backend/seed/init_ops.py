"""Create + seed Response-Ops tables. Safe to run repeatedly.

    python -m seed.init_ops

Creates ONLY ops_* tables (explicit allow-list) and inserts demo rows if empty.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings
from app.db.models import Base
from app.db.ops_models import (
    OPS_TABLES, PatrolUnit, TrafficSignal, Camera,
)

# A few demo patrols around Bengaluru/Karnataka for the simulation.
DEMO_PATROLS = [
    {"callsign": "Hoysala-01", "lat": 12.9716, "lng": 77.5946, "district": "Bengaluru City"},
    {"callsign": "Hoysala-02", "lat": 12.9352, "lng": 77.6245, "district": "Bengaluru City"},
    {"callsign": "Hoysala-03", "lat": 12.9081, "lng": 77.6476, "district": "Bengaluru City"},
    {"callsign": "Cheetah-11", "lat": 12.9986, "lng": 77.5547, "district": "Bengaluru City"},
]
DEMO_SIGNALS = [
    {"junction_id": "JN-MG-Road", "lat": 12.9759, "lng": 77.6063},
    {"junction_id": "JN-Trinity", "lat": 12.9731, "lng": 77.6200},
    {"junction_id": "JN-Domlur", "lat": 12.9609, "lng": 77.6387},
    {"junction_id": "JN-Richmond", "lat": 12.9610, "lng": 77.5980},
    {"junction_id": "JN-Hosur", "lat": 12.9279, "lng": 77.6271},
]
DEMO_CAMERAS = [
    {"camera_id": "CAM-001", "name": "MG Road Junction Cam", "location": "MG Road", "lat": 12.9759, "lng": 77.6063},
    {"camera_id": "CAM-002", "name": "Silk Board Cam", "location": "Silk Board", "lat": 12.9172, "lng": 77.6228},
]


async def main() -> None:
    s = get_settings()
    engine = create_async_engine(s.seed_database_url, future=True)
    async with engine.begin() as conn:
        # create_all with an explicit allow-list — only ops_* tables.
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=OPS_TABLES))
    print(f"[init_ops] ensured {len(OPS_TABLES)} ops tables exist")

    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as db:
        if not (await db.execute(select(PatrolUnit.id).limit(1))).first():
            db.add_all([PatrolUnit(status="IDLE", **p) for p in DEMO_PATROLS])
        if not (await db.execute(select(TrafficSignal.id).limit(1))).first():
            db.add_all([TrafficSignal(state="NORMAL", **g) for g in DEMO_SIGNALS])
        if not (await db.execute(select(Camera.id).limit(1))).first():
            db.add_all([Camera(is_active=True, **c) for c in DEMO_CAMERAS])
        await db.commit()
    print("[init_ops] demo patrols/signals/cameras seeded (if tables were empty)")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
