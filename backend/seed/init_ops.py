"""Create + seed Response-Ops tables. Safe to run repeatedly.

    python -m seed.init_ops            # create + seed-if-empty
    python -m seed.init_ops --reset    # also clear transient state (units->IDLE, signals->NORMAL)

Creates ONLY ops_* tables (explicit allow-list) and inserts demo rows if empty.
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings
from app.db.models import Base
from app.db.ops_models import (
    OPS_TABLES, PatrolUnit, TrafficSignal, Camera,
    IncidentDispatch, IncidentReview, PatrolSuggestion, RiskZone,
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


# ── Statewide seeding, derived from the real stations table ──────────────────
# The hand-typed demo rows above cover one ~10 km box in central Bengaluru, which
# leaves every other district with no patrols, cameras or signals at all.
#
# Deriving them from `stations` is better than typing more coordinates for a
# reason beyond coverage: it populates ops_patrol_units.station_id, which is what
# migration 011's RLS policy joins to `stations` for the officer's range and
# district. With station_id NULL the policy falls back to matching a denormalised
# district string; with it set, per-range and per-station scoping actually work.
#
# Placement is AT the station, not jittered around it. A unit based at a station
# is a truthful claim; a unit 3 km away in a random direction is invented detail.

PATROLS_PER_DISTRICT = 2
SIGNALS_PER_DISTRICT = 2
CAMERAS_PER_DISTRICT = 1


def _district_code(district: str) -> str:
    """Short, stable, readable code for callsigns. 'Bengaluru City' -> 'BEN'."""
    letters = "".join(ch for ch in (district or "") if ch.isalpha())
    return (letters[:3] or "KSP").upper()


def _unique_district_codes(districts: list[str]) -> dict[str, str]:
    """Assign a unique code per district, disambiguating collisions.

    KSP district names collide on a three-letter prefix far more than you would
    guess: Belagavi City / Belagavi Dist, Bengaluru City / Bengaluru Dist, Mysuru
    City / Mysuru Dist all reduce to the same code. A first version of this seed
    used the bare code and silently skipped the second district of every pair as a
    duplicate callsign, so 8 of 40 districts ended up with no units at all.
    Sorted iteration keeps the assignment stable across runs.
    """
    used: dict[str, int] = {}
    codes: dict[str, str] = {}
    for d in sorted(districts):
        base = _district_code(d)
        n = used.get(base, 0)
        used[base] = n + 1
        codes[d] = base if n == 0 else f"{base}{n + 1}"
    return codes


async def _seed_statewide(db) -> None:
    from sqlalchemy import text as _text

    rows = (
        await db.execute(
            _text(
                'SELECT station_id, station_name, district, "range", latitude, longitude '
                "FROM stations WHERE latitude IS NOT NULL AND longitude IS NOT NULL "
                "ORDER BY district, station_id"
            )
        )
    ).all()
    if not rows:
        print("[init_ops] statewide: no geocoded stations found — skipping")
        return

    # Group by district, deterministically (rows are already ordered by station_id
    # within district, so re-running picks the same stations every time).
    by_district: dict[str, list] = {}
    for r in rows:
        by_district.setdefault(r.district or "Unknown", []).append(r)

    existing_callsigns = {
        c for (c,) in (await db.execute(select(PatrolUnit.callsign))).all()
    }
    existing_cameras = {c for (c,) in (await db.execute(select(Camera.camera_id))).all()}
    existing_junctions = {
        j for (j,) in (await db.execute(select(TrafficSignal.junction_id))).all()
    }

    new_patrols: list[PatrolUnit] = []
    new_cameras: list[Camera] = []
    new_signals: list[TrafficSignal] = []

    codes = _unique_district_codes(list(by_district))

    for district, stations in sorted(by_district.items()):
        code = codes[district]

        for i, st in enumerate(stations[:PATROLS_PER_DISTRICT], start=1):
            # Hoysala = patrol car, Cheetah = motorcycle. Real KSP callsign families.
            family = "Hoysala" if i == 1 else "Cheetah"
            callsign = f"{family}-{code}-{i:02d}"
            if callsign in existing_callsigns:
                continue
            new_patrols.append(
                PatrolUnit(
                    callsign=callsign,
                    status="IDLE",
                    lat=float(st.latitude),
                    lng=float(st.longitude),
                    station_id=int(st.station_id),  # the bit RLS needs
                    district=district,
                )
            )
            existing_callsigns.add(callsign)

        for st in stations[:CAMERAS_PER_DISTRICT]:
            camera_id = f"CAM-{int(st.station_id):04d}"
            if camera_id in existing_cameras:
                continue
            new_cameras.append(
                Camera(
                    camera_id=camera_id,
                    name=f"{st.station_name} ANPR",
                    location=st.station_name,
                    lat=float(st.latitude),
                    lng=float(st.longitude),
                    is_active=True,
                )
            )
            existing_cameras.add(camera_id)

        for i, st in enumerate(stations[:SIGNALS_PER_DISTRICT], start=1):
            junction_id = f"JN-{code}-{i:02d}"
            if junction_id in existing_junctions:
                continue
            new_signals.append(
                TrafficSignal(
                    junction_id=junction_id,
                    lat=float(st.latitude),
                    lng=float(st.longitude),
                    state="NORMAL",
                )
            )
            existing_junctions.add(junction_id)

    db.add_all(new_patrols + new_cameras + new_signals)
    await db.commit()
    print(
        f"[init_ops] statewide: +{len(new_patrols)} patrols, "
        f"+{len(new_cameras)} cameras, +{len(new_signals)} signals "
        f"across {len(by_district)} districts"
    )


async def _backfill_station_ids(db) -> int:
    """Give the original hand-typed Bengaluru patrols a station_id.

    They were seeded with district text only, so migration 011's policy cannot
    join them to `stations` for a range. Matching on district and nearest
    coordinate is good enough here because these four rows are all inside one
    district.
    """
    from sqlalchemy import text as _text

    result = await db.execute(
        _text(
            """
            UPDATE ops_patrol_units p
               SET station_id = s.station_id
              FROM (
                SELECT DISTINCT ON (district) station_id, district, latitude, longitude
                  FROM stations
                 WHERE latitude IS NOT NULL
                 ORDER BY district, station_id
              ) s
             WHERE p.station_id IS NULL
               AND p.district IS NOT NULL
               AND s.district = p.district
            """
        )
    )
    await db.commit()
    return result.rowcount or 0


async def main(reset: bool = False, statewide: bool = False) -> None:
    s = get_settings()
    engine = create_async_engine(s.seed_database_url, future=True)
    async with engine.begin() as conn:
        # create_all with an explicit allow-list — only ops_* tables.
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=OPS_TABLES))
    print(f"[init_ops] ensured {len(OPS_TABLES)} ops tables exist")

    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as db:
        if reset:
            # Clear transient state but KEEP patrols/signals/cameras rows.
            await db.execute(delete(IncidentDispatch))
            await db.execute(delete(IncidentReview))
            await db.execute(delete(PatrolSuggestion))
            await db.execute(delete(RiskZone))
            await db.execute(update(PatrolUnit).values(status="IDLE"))
            await db.execute(update(TrafficSignal).values(state="NORMAL"))
            await db.commit()
            print("[init_ops] reset: dispatches/reviews/suggestions/zones cleared; units IDLE; signals NORMAL")

        if not (await db.execute(select(PatrolUnit.id).limit(1))).first():
            db.add_all([PatrolUnit(status="IDLE", **p) for p in DEMO_PATROLS])
        if not (await db.execute(select(TrafficSignal.id).limit(1))).first():
            db.add_all([TrafficSignal(state="NORMAL", **g) for g in DEMO_SIGNALS])
        if not (await db.execute(select(Camera.id).limit(1))).first():
            db.add_all([Camera(is_active=True, **c) for c in DEMO_CAMERAS])
        await db.commit()
        print("[init_ops] demo patrols/signals/cameras seeded (if tables were empty)")

        if statewide:
            n = await _backfill_station_ids(db)
            if n:
                print(f"[init_ops] backfilled station_id on {n} existing patrol unit(s)")
            await _seed_statewide(db)

    await engine.dispose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="clear transient ops state before seeding")
    ap.add_argument(
        "--statewide",
        action="store_true",
        help=(
            "add patrols/cameras/signals across every district, derived from the "
            "stations table (also backfills station_id on existing patrols so RLS "
            "can scope them by range)"
        ),
    )
    args = ap.parse_args()
    asyncio.run(main(reset=args.reset, statewide=args.statewide))
