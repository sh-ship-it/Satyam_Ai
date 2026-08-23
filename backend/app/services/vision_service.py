"""Composes the Vision snapshot from services that already exist.

Two things this module is careful about.

**Layers fail independently.** A dead ops table or an unavailable module marks
that one layer `degraded` with a human-readable reason and leaves the rest of the
payload intact. This follows the convention set by services/ops/routing_service,
which returns provider="STRAIGHT_LINE" instead of raising when OSRM is
unreachable. A police map that renders nothing because one feed is down is worse
than one that renders six layers and says why the seventh is missing.

**Provenance is part of the contract.** Every layer states where its geometry
came from, because an officer may act on what a rendered shape implies. CCTV
field-of-view cones in particular are `simulated`: ops_cameras has no bearing,
fov or range columns, so those cones are fabricated for the demo and must be
labelled as such wherever they appear.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import math
from collections import Counter
from typing import Any, Iterable

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal
from app.db.ops_models import (
    Camera,
    IncidentDispatch,
    IncidentReview,
    PatrolUnit,
    RiskZone,
    TrafficSignal,
)
from app.logging_config import get_logger
from app.pipeline.tools import analytics

log = get_logger()

# Level of detail. A bbox wider than this many degrees is treated as a
# wide-area view and aggregated coarsely; anything tighter gets the fine grid.
LOD_COARSE_SPAN_DEG = 1.5
PRECISION_COARSE = 2  # ~1.1 km cells
PRECISION_FINE = 3  # ~110 m cells

# Cap on returned crime cells. Chosen against measured data: 34,641 distinct
# fine cells exist statewide, so 20k covers any realistic viewport while bounding
# the payload. Truncation is reported, never silent.
CRIME_CELL_CAP = 20000

# Coordinate precision handed to callers whose clearance forces coarsening.
# 2 dp is roughly 1.1 km — enough to see a pattern, not enough to locate a door.
COARSE_DP = 2

ALL_LAYERS = (
    "crime_hex",
    "risk_zones",
    "patrols",
    "dispatches",
    "signals",
    "cameras",
)

OPS_LAYERS = frozenset({"risk_zones", "patrols", "dispatches", "signals", "cameras"})

_ACTIVE_DISPATCH_STATES = ("ACCEPTED", "EN_ROUTE", "ON_SCENE")


def _layer(
    data: Any,
    *,
    provenance: str,
    provider: str,
    count: int | None = None,
    truncated: bool = False,
    note: str | None = None,
) -> dict:
    return {
        "provenance": provenance,
        "provider": provider,
        "count": count if count is not None else (len(data) if hasattr(data, "__len__") else 0),
        "truncated": truncated,
        "note": note,
        "data": data,
    }


def _degraded(reason: str) -> dict:
    return {
        "provenance": "cached",
        "provider": None,
        "count": 0,
        "truncated": False,
        "degraded": reason,
        "data": [],
    }


def _round(value: float | None, dp: int) -> float | None:
    return None if value is None else round(float(value), dp)


def _fabricated_optics(camera_id: str) -> tuple[int, int, int]:
    """Deterministic pseudo-optics for a camera.

    FABRICATED. ops_cameras stores no bearing/fov/range, so a demo needs
    something to draw. Derived from a hash of the camera id rather than random,
    so cones stay put between requests instead of jittering, which would look
    like live pan-tilt movement that is not happening.

    ponytail: replace with real columns from migration 012_camera_optics.sql;
    until then every consumer must label this layer `simulated`.
    """
    digest = hashlib.sha256(camera_id.encode("utf-8")).digest()
    bearing = digest[0] * 360 // 256
    fov = 45 + (digest[1] % 4) * 15  # 45 / 60 / 75 / 90
    reach = 80 + (digest[2] % 5) * 30  # 80..200 m
    return bearing, fov, reach


def _lod_precision(bbox: tuple[float, float, float, float] | None) -> int:
    if bbox is None:
        return PRECISION_COARSE
    west, south, east, north = bbox
    span = max(abs(east - west), abs(north - south))
    return PRECISION_COARSE if span > LOD_COARSE_SPAN_DEG else PRECISION_FINE


async def _crime_layer(
    session: AsyncSession,
    *,
    bbox: tuple[float, float, float, float] | None,
    crime_type: str | None,
    district: str | None,
    dp: int | None,
) -> dict:
    precision = _lod_precision(bbox)
    # Never return finer geometry than the caller's clearance allows.
    if dp is not None:
        precision = min(precision, dp)
    rows = await analytics.hotspots(
        session,
        crime_type=crime_type,
        district=district,
        bbox=bbox,
        precision=precision,
        group_by_crime_type=False,  # true per-cell counts; see analytics.hotspots
        limit=CRIME_CELL_CAP,
    )
    # Compact [lat, lng, weight] triples rather than objects: at 20k cells the
    # object form roughly triples the JSON payload for no added information.
    data = [[float(r["lat"]), float(r["lng"]), int(r["weight"])] for r in rows]
    return _layer(
        data,
        provenance="derived",
        provider="satyam.cases",
        truncated=len(rows) >= CRIME_CELL_CAP,
        note=f"grid {10 ** -precision:g} deg (~{'1.1 km' if precision == 2 else '110 m'})",
    )


async def _risk_layer(session: AsyncSession, dp: int | None) -> dict:
    rows: Iterable[RiskZone] = (
        (await session.execute(select(RiskZone).order_by(RiskZone.risk_score.desc()).limit(500)))
        .scalars()
        .all()
    )
    data = [
        {
            "id": z.id,
            "lat": _round(z.center_lat, dp) if dp else z.center_lat,
            "lng": _round(z.center_lng, dp) if dp else z.center_lng,
            "score": z.risk_score,
            "label": z.risk_label,
            "incidents": z.incident_count,
            "peak_hour": z.peak_hour,
            "reasons": z.reasons or [],
        }
        for z in rows
    ]
    return _layer(data, provenance="derived", provider="satyam.ops.risk_service")


async def _patrol_layer(session: AsyncSession, dp: int | None) -> dict:
    rows: Iterable[PatrolUnit] = (await session.execute(select(PatrolUnit))).scalars().all()
    data = [
        {
            "id": p.id,
            "callsign": p.callsign,
            "status": p.status,
            "lat": _round(p.lat, dp) if dp else p.lat,
            "lng": _round(p.lng, dp) if dp else p.lng,
            "district": p.district,
        }
        for p in rows
        if p.lat is not None and p.lng is not None
    ]
    return _layer(data, provenance="seeded", provider="satyam.ops.patrol_units")


async def _dispatch_layer(session: AsyncSession, dp: int | None) -> dict:
    rows: Iterable[IncidentDispatch] = (
        (
            await session.execute(
                select(IncidentDispatch)
                .where(IncidentDispatch.status.in_(_ACTIVE_DISPATCH_STATES))
                .order_by(IncidentDispatch.created_at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    data = []
    for d in rows:
        geom = d.route_geometry or {}
        # Stored as GeoJSON LineString, i.e. [lng, lat] pairs. Kept in that order
        # here so the client does not have to guess; deck.gl also wants [lng, lat].
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        data.append(
            {
                "id": d.id,
                "case_id": d.case_id,
                "patrol_id": d.patrol_id,
                "status": d.status,
                "scene_lat": _round(d.scene_lat, dp) if dp else d.scene_lat,
                "scene_lng": _round(d.scene_lng, dp) if dp else d.scene_lng,
                "eta_sec": d.eta_sec,
                "distance_km": d.distance_km,
                "route": coords if isinstance(coords, list) else [],
            }
        )
    return _layer(data, provenance="live", provider="satyam.ops.dispatches")


async def _signal_layer(session: AsyncSession, dp: int | None) -> dict:
    rows: Iterable[TrafficSignal] = (await session.execute(select(TrafficSignal))).scalars().all()
    data = [
        {
            "id": s.id,
            "junction_id": s.junction_id,
            "lat": _round(s.lat, dp) if dp else s.lat,
            "lng": _round(s.lng, dp) if dp else s.lng,
            "state": s.state,
        }
        for s in rows
    ]
    return _layer(data, provenance="seeded", provider="satyam.ops.traffic_signals")


async def _camera_layer(session: AsyncSession, dp: int | None) -> dict:
    rows: Iterable[Camera] = (await session.execute(select(Camera))).scalars().all()
    data = []
    for c in rows:
        bearing, fov, reach = _fabricated_optics(c.camera_id)
        data.append(
            {
                "id": c.id,
                "camera_id": c.camera_id,
                "name": c.name,
                "location": c.location,
                "lat": _round(c.lat, dp) if dp else c.lat,
                "lng": _round(c.lng, dp) if dp else c.lng,
                "is_active": c.is_active,
                # Fabricated. See _fabricated_optics.
                "bearing_deg": bearing,
                "fov_deg": fov,
                "range_m": reach,
                "optics_fabricated": True,
            }
        )
    return _layer(
        data,
        provenance="simulated",
        provider="satyam.ops.cameras",
        note=(
            "Positions are real rows. Field-of-view cones are FABRICATED: "
            "ops_cameras has no bearing/fov/range columns yet."
        ),
    )


async def build_snapshot(
    session: AsyncSession,
    principal: Principal,
    *,
    bbox: tuple[float, float, float, float] | None = None,
    layers: set[str] | None = None,
    ops_enabled: bool = True,
    crime_type: str | None = None,
    district: str | None = None,
) -> dict:
    """One payload for the whole screen. Never raises because a layer is missing."""
    wanted = set(layers) if layers else set(ALL_LAYERS)
    coarsen = principal.should_coarsen_coords()
    dp = COARSE_DP if coarsen else None

    out: dict[str, dict] = {}
    degraded: list[str] = []

    builders = {
        "crime_hex": lambda: _crime_layer(
            session, bbox=bbox, crime_type=crime_type, district=district, dp=dp
        ),
        "risk_zones": lambda: _risk_layer(session, dp),
        "patrols": lambda: _patrol_layer(session, dp),
        "dispatches": lambda: _dispatch_layer(session, dp),
        "signals": lambda: _signal_layer(session, dp),
        "cameras": lambda: _camera_layer(session, dp),
    }

    for name in ALL_LAYERS:
        if name not in wanted:
            continue
        if name in OPS_LAYERS and not ops_enabled:
            out[name] = _degraded(
                "Response Ops module is disabled on the server (ENABLE_RESPONSE_OPS)."
            )
            degraded.append(f"{name}:ops_disabled")
            continue
        try:
            out[name] = await builders[name]()
        except Exception as exc:  # noqa: BLE001
            # One broken layer must not take the screen down.
            log.warning("vision.layer_failed", layer=name, error=str(exc))
            out[name] = _degraded(f"Layer unavailable: {type(exc).__name__}")
            degraded.append(f"{name}:error")

    return {
        "bbox": list(bbox) if bbox else None,
        "coords_coarsened": coarsen,
        "layers": out,
        "degraded": degraded,
    }


async def build_entity(
    session: AsyncSession,
    principal: Principal,
    *,
    kind: str,
    entity_id: str,
) -> dict | None:
    """Dossier payload for one entity, with nearest cross-references.

    Distances use routing_service.haversine_km. There is no PostGIS in this
    database, so ST_Distance is not an option and is not needed at these counts.
    """
    from app.services.ops import routing_service

    dp = COARSE_DP if principal.should_coarsen_coords() else None

    def nearest(lat: float | None, lng: float | None, rows: list, latf, lngf, n=3):
        if lat is None or lng is None:
            return []
        scored = [
            (routing_service.haversine_km(lat, lng, latf(r), lngf(r)), r)
            for r in rows
            if latf(r) is not None and lngf(r) is not None
        ]
        scored.sort(key=lambda t: t[0])
        return scored[:n]

    if kind == "patrol":
        p = (
            await session.execute(select(PatrolUnit).where(PatrolUnit.id == int(entity_id)))
        ).scalar_one_or_none()
        if not p:
            return None
        cams = (await session.execute(select(Camera))).scalars().all()
        near_cams = nearest(p.lat, p.lng, list(cams), lambda c: c.lat, lambda c: c.lng)
        return {
            "kind": "patrol",
            "id": p.id,
            "title": p.callsign,
            "status": p.status,
            "lat": _round(p.lat, dp) if dp else p.lat,
            "lng": _round(p.lng, dp) if dp else p.lng,
            "district": p.district,
            "nearest_cameras": [
                {"camera_id": c.camera_id, "name": c.name, "km": round(km, 2)}
                for km, c in near_cams
            ],
        }

    if kind == "camera":
        c = (
            await session.execute(select(Camera).where(Camera.camera_id == entity_id))
        ).scalar_one_or_none()
        if not c:
            return None
        bearing, fov, reach = _fabricated_optics(c.camera_id)
        recent = (
            (
                await session.execute(
                    select(IncidentReview)
                    .where(IncidentReview.camera_id == c.camera_id)
                    .order_by(IncidentReview.created_at.desc())
                    .limit(10)
                )
            )
            .scalars()
            .all()
        )
        return {
            "kind": "camera",
            "id": c.id,
            "camera_id": c.camera_id,
            "title": c.name,
            "location": c.location,
            "lat": _round(c.lat, dp) if dp else c.lat,
            "lng": _round(c.lng, dp) if dp else c.lng,
            "is_active": c.is_active,
            "bearing_deg": bearing,
            "fov_deg": fov,
            "range_m": reach,
            "optics_fabricated": True,
            # IncidentReview.camera_id is plain Text, not a foreign key to
            # ops_cameras, so this join is on an unconstrained string.
            "recent_detections": [
                {
                    "id": r.id,
                    "type": r.candidate_type,
                    "confidence": r.confidence,
                    "status": r.status,
                    "at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in recent
            ],
        }

    if kind == "risk_zone":
        z = (
            await session.execute(select(RiskZone).where(RiskZone.id == int(entity_id)))
        ).scalar_one_or_none()
        if not z:
            return None
        patrols = (await session.execute(select(PatrolUnit))).scalars().all()
        near = nearest(
            z.center_lat, z.center_lng, list(patrols), lambda p: p.lat, lambda p: p.lng
        )
        return {
            "kind": "risk_zone",
            "id": z.id,
            "title": f"{z.risk_label} risk \u00b7 {z.grid_key}",
            "score": z.risk_score,
            "incidents": z.incident_count,
            "peak_hour": z.peak_hour,
            "reasons": z.reasons or [],
            "lat": _round(z.center_lat, dp) if dp else z.center_lat,
            "lng": _round(z.center_lng, dp) if dp else z.center_lng,
            "nearest_patrols": [
                {"id": p.id, "callsign": p.callsign, "status": p.status, "km": round(km, 2)}
                for km, p in near
            ],
        }

    if kind == "dispatch":
        d = (
            await session.execute(
                select(IncidentDispatch).where(IncidentDispatch.id == int(entity_id))
            )
        ).scalar_one_or_none()
        if not d:
            return None
        patrol = (
            await session.execute(select(PatrolUnit).where(PatrolUnit.id == d.patrol_id))
        ).scalar_one_or_none()
        geom = d.route_geometry or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        return {
            "kind": "dispatch",
            "id": d.id,
            "title": f"Dispatch {d.id}",
            "status": d.status,
            "case_id": d.case_id,
            "patrol": {"id": patrol.id, "callsign": patrol.callsign} if patrol else None,
            "eta_sec": d.eta_sec,
            "distance_km": d.distance_km,
            "scene_lat": _round(d.scene_lat, dp) if dp else d.scene_lat,
            "scene_lng": _round(d.scene_lng, dp) if dp else d.scene_lng,
            "route": coords if isinstance(coords, list) else [],
        }

    return None


# ── Point inspection ────────────────────────────────────────────────────────
#
# Radius bounds for a location click. The floor stops a click resolving to a
# single address, the ceiling stops one click aggregating a whole district and
# calling it "here".
LOCATION_RADIUS_MIN_M = 100
LOCATION_RADIUS_MAX_M = 5000
LOCATION_RADIUS_DEFAULT_M = 800
# Worst-case rows pulled before the distance filter. A bbox this small holds far
# fewer in practice; the cap only bounds a pathological click in the densest part
# of Bengaluru, and truncation is reported rather than silent.
LOCATION_ROW_CAP = 4000
LOCATION_RECENT_LIMIT = 8
LOCATION_CRIME_TYPE_LIMIT = 6

_METRES_PER_DEG_LAT = 111_320.0


def _parse_hour(raw: str | None) -> int | None:
    """Hour out of the free-text `cases.incident_time`.

    The column is Text, not Time, so it holds whatever the seed wrote. Parse
    defensively and drop anything that is not a plausible hour rather than
    guessing — a wrong peak hour on a crime screen is worse than no peak hour.
    """
    if not raw:
        return None
    digits = ""
    for ch in str(raw).strip():
        if ch.isdigit():
            digits += ch
            if len(digits) == 2:
                break
        else:
            break
    if not digits:
        return None
    hour = int(digits)
    return hour if 0 <= hour <= 23 else None


async def build_location(
    session: AsyncSession,
    principal: Principal,
    *,
    lat: float,
    lng: float,
    radius_m: int,
) -> dict:
    """What is recorded near one point.

    Two-stage geography, for the same reason build_entity uses haversine: there
    is no PostGIS here. A bounding box does the cheap prefilter in SQL, then
    haversine refines it to a true circle in Python. Without the second stage a
    "800 m" answer would actually be a 1.6 km square, over-reporting by about
    27 percent at the corners.

    Person data is deliberately absent — see schemas.vision.LocationCase.
    """
    from app.services.ops import routing_service

    radius_m = max(LOCATION_RADIUS_MIN_M, min(LOCATION_RADIUS_MAX_M, int(radius_m)))
    coarsen = principal.should_coarsen_coords()
    dp = COARSE_DP if coarsen else None

    # Degree deltas for the prefilter box. Longitude degrees shrink with
    # latitude, so scale by cos(lat) or the box is too narrow near the poles and
    # too wide at the equator.
    dlat = radius_m / _METRES_PER_DEG_LAT
    cos_lat = math.cos(math.radians(lat))
    dlng = radius_m / (_METRES_PER_DEG_LAT * (abs(cos_lat) if abs(cos_lat) > 1e-6 else 1e-6))

    sql = text(
        """
        SELECT case_id, fir_number, fir_year, crime_type, status, district,
               station_name, place_of_offence, incident_date, incident_time,
               latitude, longitude
        FROM cases
        WHERE latitude  BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
        LIMIT :cap
        """
    )
    rows = (
        (
            await session.execute(
                sql,
                {
                    "south": lat - dlat,
                    "north": lat + dlat,
                    "west": lng - dlng,
                    "east": lng + dlng,
                    "cap": LOCATION_ROW_CAP,
                },
            )
        )
        .mappings()
        .all()
    )
    truncated = len(rows) >= LOCATION_ROW_CAP

    # Refine the square to a circle.
    scored: list[tuple[float, Any]] = []
    for r in rows:
        if r["latitude"] is None or r["longitude"] is None:
            continue
        km = routing_service.haversine_km(lat, lng, float(r["latitude"]), float(r["longitude"]))
        if km * 1000.0 <= radius_m:
            scored.append((km, r))
    scored.sort(key=lambda t: t[0])

    types = Counter(r["crime_type"] for _, r in scored if r["crime_type"])
    statuses = Counter(r["status"] for _, r in scored if r["status"])
    hours = Counter(
        h for _, r in scored if (h := _parse_hour(r["incident_time"])) is not None
    )

    # Place context from the closest recorded case. Not a gazetteer lookup: there
    # is no reverse geocoder in this stack, and inventing a place name on a police
    # screen is worse than admitting there is none.
    district = station = place = None
    if scored:
        nearest_row = scored[0][1]
        district = nearest_row["district"]
        station = nearest_row["station_name"]
        place = nearest_row["place_of_offence"]

    # Sentinel rather than a two-part key: a tuple key would compare dates
    # against None whenever two rows share a null date, which raises.
    recent = sorted(
        scored,
        key=lambda t: t[1]["incident_date"] or dt.date.min,
        reverse=True,
    )[:LOCATION_RECENT_LIMIT]

    note = None
    if not scored:
        note = (
            f"No cases recorded within {radius_m} m of this point. "
            "The crime layer bins cases into cells, so a visible cell centre can "
            "sit slightly off the underlying case coordinates."
        )
    elif truncated:
        note = f"Row cap of {LOCATION_ROW_CAP} reached before distance filtering."

    return {
        "lat": _round(lat, dp) if dp else lat,
        "lng": _round(lng, dp) if dp else lng,
        "radius_m": radius_m,
        "coords_coarsened": coarsen,
        "district": district,
        "station_name": station,
        "place_label": place,
        "total_cases": len(scored),
        "crime_types": [
            {"crime_type": t, "count": n}
            for t, n in types.most_common(LOCATION_CRIME_TYPE_LIMIT)
        ],
        "status_breakdown": dict(statuses.most_common()),
        "peak_hours": [h for h, _ in hours.most_common(3)],
        "recent": [
            {
                "case_id": r["case_id"],
                "fir_number": r["fir_number"],
                "fir_year": r["fir_year"],
                "crime_type": r["crime_type"],
                "status": r["status"],
                "station_name": r["station_name"],
                "district": r["district"],
                "place_of_offence": r["place_of_offence"],
                "incident_date": (
                    r["incident_date"].isoformat() if r["incident_date"] else None
                ),
                "distance_m": int(round(km * 1000)),
            }
            for km, r in recent
        ],
        "truncated": truncated,
        "note": note,
    }
