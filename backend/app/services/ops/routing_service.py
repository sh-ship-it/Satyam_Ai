"""Routing — Python port of EMERGE routingService.js (OSRM + straight-line fallback)."""
from __future__ import annotations

import math
import os

import httpx

OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "http://router.project-osrm.org")


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _straight_line(from_lat, from_lng, to_lat, to_lng, steps: int = 40) -> list[list[float]]:
    out = []
    for i in range(steps + 1):
        t = i / steps
        out.append([from_lng + (to_lng - from_lng) * t, from_lat + (to_lat - from_lat) * t])  # [lng, lat]
    return out


async def get_route(*, from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> dict:
    """Return {provider, distance_km, duration_sec, coords:[[lng,lat],...]}.
    Raises ValueError on null coordinates (callers must guard); otherwise never raises."""
    if None in (from_lat, from_lng, to_lat, to_lng):
        raise ValueError("get_route requires non-null coordinates")
    url = (f"{OSRM_BASE_URL}/route/v1/driving/"
           f"{from_lng},{from_lat};{to_lng},{to_lat}"
           f"?overview=full&geometries=geojson&steps=false")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            r = resp.json()["routes"][0]
        return {
            "provider": "OSRM",
            "distance_km": r["distance"] / 1000.0,
            "duration_sec": int(r["duration"]),
            "coords": r["geometry"]["coordinates"],  # [[lng,lat],...]
        }
    except Exception as exc:  # noqa: BLE001
        d = haversine_km(from_lat, from_lng, to_lat, to_lng)
        return {
            "provider": "STRAIGHT_LINE",
            "distance_km": d,
            "duration_sec": int((d / 40.0) * 3600),  # assume 40 km/h
            "coords": _straight_line(from_lat, from_lng, to_lat, to_lng),
            "error": str(exc),
        }
