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

import hashlib
from typing import Any, Iterable

from sqlalchemy import select
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
