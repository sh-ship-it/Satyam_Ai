"""Predictive risk grid — Python port of EMERGE predictiveReadinessService.js.

Lays a ~1.1km grid over geocoded cases, scores each cell from incident volume,
severity, and time-of-day, and persists ops_risk_zones + ops_patrol_suggestions.
Debounced so we never recompute more than once per RECOMPUTE_DEBOUNCE_SEC.
"""
from __future__ import annotations

import datetime as dt
import math
import time
from collections import defaultdict

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Case
from app.db.ops_models import PatrolUnit, PatrolSuggestion, RiskZone

# ── Tunables (mirror EMERGE) ────────────────────────────────────────────────
GRID_SIZE = 0.01            # ~1.1 km cells
LOOKBACK_DAYS = 365         # crime data is sparser than live accidents -> wider window
MIN_INCIDENTS = 2
TOP_ZONES_COUNT = 5
AVG_SPEED_KMH = 40.0
RECOMPUTE_DEBOUNCE_SEC = 300

# Crime severity weights by category/legal context (tunable).
SEVERITY_BY_CRIME = {
    "Murder": 4, "Rape": 4, "Dacoity": 4, "Kidnapping": 4,
    "Robbery": 3, "Burglary": 3, "Assault": 3, "Riot": 3,
    "Theft": 2, "Cheating": 2, "Hurt": 2,
}
DEFAULT_SEVERITY = 1

_last_recompute_ts: float = 0.0


def _grid_key(lat: float, lng: float) -> tuple[str, float, float]:
    gl = math.floor(lat / GRID_SIZE) * GRID_SIZE
    gg = math.floor(lng / GRID_SIZE) * GRID_SIZE
    return f"{gl:.4f}:{gg:.4f}", gl + GRID_SIZE / 2, gg + GRID_SIZE / 2


def _severity(crime_type: str | None) -> int:
    if not crime_type:
        return DEFAULT_SEVERITY
    for key, w in SEVERITY_BY_CRIME.items():
        if key.lower() in crime_type.lower():
            return w
    return DEFAULT_SEVERITY


def _parse_hour(incident_time: str | None) -> int | None:
    if not incident_time:
        return None
    try:
        return int(str(incident_time).split(":")[0])
    except (ValueError, IndexError):
        return None


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _label(score: float) -> str:
    if score >= 75:
        return "Critical"
    if score >= 55:
        return "High"
    if score >= 30:
        return "Medium"
    return "Low"


async def recompute_if_stale(session: AsyncSession, *, force: bool = False) -> bool:
    """Recompute the risk grid if the debounce window elapsed. Returns True if it recomputed."""
    global _last_recompute_ts
    now = time.time()
    if not force and (now - _last_recompute_ts) < RECOMPUTE_DEBOUNCE_SEC:
        return False

    since = dt.date.today() - dt.timedelta(days=LOOKBACK_DAYS)
    rows = (await session.execute(
        select(Case.latitude, Case.longitude, Case.crime_type, Case.incident_time, Case.incident_date)
        .where(Case.latitude.is_not(None), Case.longitude.is_not(None))
        .where(Case.incident_date.is_(None) | (Case.incident_date >= since))
    )).all()

    cells: dict[str, dict] = {}
    hour_hist: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for lat, lng, crime_type, itime, _idate in rows:
        key, clat, clng = _grid_key(lat, lng)
        c = cells.setdefault(key, {"clat": clat, "clng": clng, "count": 0, "sev": 0})
        c["count"] += 1
        c["sev"] += _severity(crime_type)
        h = _parse_hour(itime)
        if h is not None:
            hour_hist[key][h] += 1

    max_count = max((c["count"] for c in cells.values()), default=1)
    max_sev = max((c["sev"] for c in cells.values()), default=1)

    # Wipe + rewrite ops_risk_zones (small table, simplest correct approach).
    await session.execute(delete(RiskZone))
    zone_rows: list[RiskZone] = []
    for key, c in cells.items():
        if c["count"] < MIN_INCIDENTS:
            continue
        incident_score = (c["sev"] / max_sev) * 40.0          # max 40
        density_score = (c["count"] / max_count) * 30.0        # max 30
        peak_hour = max(hour_hist[key], key=hour_hist[key].get) if hour_hist[key] else None
        time_score = 30.0 if peak_hour is not None and (peak_hour >= 20 or peak_hour <= 4) else 12.0
        score = round(incident_score + density_score + time_score, 1)
        reasons = [
            f"{c['count']} incidents in last {LOOKBACK_DAYS}d",
            f"severity weight {c['sev']}",
        ]
        if peak_hour is not None:
            reasons.append(f"peak activity around {peak_hour:02d}:00")
        zone_rows.append(RiskZone(
            grid_key=key, center_lat=c["clat"], center_lng=c["clng"],
            risk_score=score, incident_score=round(incident_score, 1),
            time_score=round(time_score, 1), incident_count=c["count"],
            peak_hour=peak_hour, risk_label=_label(score), reasons=reasons,
        ))
    session.add_all(zone_rows)
    await session.flush()  # assign ids

    await _rebuild_suggestions(session, zone_rows)
    _last_recompute_ts = now
    return True


async def _rebuild_suggestions(session: AsyncSession, zones: list[RiskZone]) -> None:
    """For the top zones, suggest the nearest IDLE patrol to pre-position there."""
    await session.execute(delete(PatrolSuggestion))
    top = sorted(zones, key=lambda z: z.risk_score, reverse=True)[:TOP_ZONES_COUNT]
    patrols = (await session.execute(
        select(PatrolUnit).where(PatrolUnit.status == "IDLE")
    )).scalars().all()
    used: set[int] = set()
    for z in top:
        best = None
        best_d = 1e9
        for p in patrols:
            if p.id in used or p.lat is None or p.lng is None:
                continue
            d = _haversine_km(p.lat, p.lng, z.center_lat, z.center_lng)
            if d < best_d:
                best, best_d = p, d
        if not best:
            continue
        used.add(best.id)
        improve = int((best_d / AVG_SPEED_KMH) * 3600 * 0.5)  # ~half the transit saved by pre-positioning
        session.add(PatrolSuggestion(
            risk_zone_id=z.id, patrol_id=best.id,
            from_lat=best.lat, from_lng=best.lng,
            to_lat=z.center_lat, to_lng=z.center_lng,
            distance_km=round(best_d, 2), response_improve_sec=improve,
            status="PENDING",
            reasons=[f"{z.risk_label} risk zone ({z.risk_score})"] + (z.reasons or [])[:1],
        ))
    await session.flush()
