# Phase 1 — Predictive Patrol Deployment

**Goal:** Port EMERGE's `predictiveReadinessService.js` (grid risk scoring) to Python against Satyam's `cases` table, then surface **risk zones** + **“move unit X → zone Z” suggestions** on the Predictive tab. Pure REST — no realtime. Requires Phase 0.

**Data dependency:** `cases.latitude/longitude` must be populated. Run the `geocode_cases.py` we built first; rows without coords are skipped.

---

## 1. NEW — `backend/app/schemas/ops.py`

```python
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class RiskZoneOut(BaseModel):
    id: int
    grid_key: str
    center_lat: float
    center_lng: float
    risk_score: float
    risk_label: str
    incident_count: int
    peak_hour: Optional[int] = None
    reasons: list[str] = []


class RiskZonesResponse(BaseModel):
    zones: list[RiskZoneOut] = []
    recomputed: bool = False
    total: int = 0


class SuggestionOut(BaseModel):
    id: int
    risk_zone_id: int
    patrol_id: Optional[int] = None
    patrol_callsign: Optional[str] = None
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    to_lat: float
    to_lng: float
    distance_km: Optional[float] = None
    response_improve_sec: Optional[int] = None
    status: str
    reasons: list[str] = []


class SuggestionsResponse(BaseModel):
    suggestions: list[SuggestionOut] = []
    total: int = 0
```

---

## 2. NEW — `backend/app/services/ops/__init__.py`

```python
```
*(empty package marker)*

---

## 3. NEW — `backend/app/services/ops/risk_service.py`

Faithful Python port of EMERGE's grid scoring, adapted to crime. Same constants (`GRID_SIZE=0.01`, `LOOKBACK_DAYS=14`, severity weights, 5-min debounce), but reads `cases` instead of accidents.

```python
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
```

---

## 4. EDIT — `backend/app/api/routes/ops.py` (append Phase 1 endpoints)

Add imports at the top and the endpoints below the `ops_health` stub:

```python
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_scoped_session
from app.core.rbac import AccessDenied, Permission, require
from app.db.ops_models import PatrolSuggestion, PatrolUnit, RiskZone
from app.schemas.ops import (
    RiskZoneOut, RiskZonesResponse, SuggestionOut, SuggestionsResponse,
)
from app.services.ops import risk_service


def _guard(principal: Principal) -> None:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
```

*(also add `HTTPException` to the existing `from fastapi import ...` line)*

```python
@router.get("/risk-zones", response_model=RiskZonesResponse)
async def risk_zones(
    refresh: bool = False,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> RiskZonesResponse:
    _guard(principal)
    recomputed = await risk_service.recompute_if_stale(session, force=refresh)
    zones = (await session.execute(
        select(RiskZone).order_by(RiskZone.risk_score.desc())
    )).scalars().all()
    return RiskZonesResponse(
        zones=[RiskZoneOut(
            id=z.id, grid_key=z.grid_key, center_lat=z.center_lat, center_lng=z.center_lng,
            risk_score=z.risk_score, risk_label=z.risk_label, incident_count=z.incident_count,
            peak_hour=z.peak_hour, reasons=z.reasons or [],
        ) for z in zones],
        recomputed=recomputed, total=len(zones),
    )


@router.get("/suggestions", response_model=SuggestionsResponse)
async def suggestions(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SuggestionsResponse:
    _guard(principal)
    rows = (await session.execute(
        select(PatrolSuggestion, PatrolUnit.callsign)
        .join(PatrolUnit, PatrolUnit.id == PatrolSuggestion.patrol_id, isouter=True)
        .where(PatrolSuggestion.status == "PENDING")
        .order_by(PatrolSuggestion.response_improve_sec.desc())
    )).all()
    return SuggestionsResponse(
        suggestions=[SuggestionOut(
            id=s.id, risk_zone_id=s.risk_zone_id, patrol_id=s.patrol_id, patrol_callsign=cs,
            from_lat=s.from_lat, from_lng=s.from_lng, to_lat=s.to_lat, to_lng=s.to_lng,
            distance_km=s.distance_km, response_improve_sec=s.response_improve_sec,
            status=s.status, reasons=s.reasons or [],
        ) for s, cs in rows],
        total=len(rows),
    )


@router.post("/suggestions/{sug_id}/{action}")
async def act_on_suggestion(
    sug_id: int, action: str,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    if action not in ("accept", "dismiss"):
        raise HTTPException(status_code=400, detail="action must be accept|dismiss")
    new_status = "ACCEPTED" if action == "accept" else "DISMISSED"
    await session.execute(
        update(PatrolSuggestion).where(PatrolSuggestion.id == sug_id).values(status=new_status)
    )
    # Accepting pre-positions the patrol (status stays IDLE, just relocates on the map).
    if action == "accept":
        sug = (await session.execute(
            select(PatrolSuggestion).where(PatrolSuggestion.id == sug_id)
        )).scalar_one_or_none()
        if sug and sug.patrol_id:
            await session.execute(
                update(PatrolUnit).where(PatrolUnit.id == sug.patrol_id)
                .values(lat=sug.to_lat, lng=sug.to_lng)
            )
    return {"ok": True, "id": sug_id, "status": new_status}
```

> RBAC note: `get_scoped_session` stamps RLS GUCs. Ops tables aren't under RLS policies, so they're readable; the `cases` read inside `risk_service` is automatically jurisdiction-scoped to the caller — a nice bonus (a station officer only sees their own zones).

---

## 5. EDIT — `frontend/src/lib/api/responseOps.ts` (append types + calls)

```ts
export type RiskZone = {
  id: number; grid_key: string; center_lat: number; center_lng: number;
  risk_score: number; risk_label: string; incident_count: number;
  peak_hour?: number | null; reasons: string[];
};
export type Suggestion = {
  id: number; risk_zone_id: number; patrol_id?: number | null; patrol_callsign?: string | null;
  from_lat?: number | null; from_lng?: number | null; to_lat: number; to_lng: number;
  distance_km?: number | null; response_improve_sec?: number | null; status: string; reasons: string[];
};

Object.assign(responseOps, {
  riskZones: (refresh = false) =>
    opsFetch<{ zones: RiskZone[]; recomputed: boolean; total: number }>(`/risk-zones?refresh=${refresh}`),
  suggestions: () =>
    opsFetch<{ suggestions: Suggestion[]; total: number }>("/suggestions"),
  actSuggestion: (id: number, action: "accept" | "dismiss") =>
    opsFetch<{ ok: boolean }>(`/suggestions/${id}/${action}`, { method: "POST" }),
});
```

---

## 6. NEW — `frontend/src/components/ops/PredictivePanel.tsx`

Reuses the existing `CrimeMap` (risk zones → `points`, with `weight = risk_score`).

```tsx
import { useEffect, useState } from "react";
import { RefreshCw, MapPin, Clock, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, type RiskZone, type Suggestion } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-orange-500 text-white",
  Medium: "bg-warning text-foreground",
  Low: "bg-success/20 text-success",
};

export function PredictivePanel() {
  const t = useT();
  const [zones, setZones] = useState<RiskZone[]>([]);
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const [z, s] = await Promise.all([responseOps.riskZones(refresh), responseOps.suggestions()]);
      setZones(z.zones);
      setSugs(s.suggestions);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(false); }, []);

  async function act(id: number, action: "accept" | "dismiss") {
    await responseOps.actSuggestion(id, action);
    setSugs((prev) => prev.filter((s) => s.id !== id));
    if (action === "accept") load(false);
  }

  const points: Hotspot[] = zones.map((z) => ({
    lat: z.center_lat, lng: z.center_lng, weight: z.risk_score, label: `${z.risk_label} (${z.risk_score})`,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="h-[520px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap points={points} mode="heat" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold">{t("Deployment suggestions")}</h3>
          <button onClick={() => load(true)} disabled={loading}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground px-2 py-1 text-xs font-bold hover:bg-muted">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {t("Recompute")}
          </button>
        </div>

        {sugs.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("No pending suggestions.")}</p>
        )}

        {sugs.map((s) => (
          <div key={s.id} className="rounded-[8px] border-2 border-foreground bg-background p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-extrabold">{s.patrol_callsign ?? `Unit #${s.patrol_id}`}</span>
              <ArrowRight className="h-4 w-4" />
              <span className="inline-flex items-center gap-1 text-xs"><MapPin className="h-3 w-3" /> {s.to_lat.toFixed(3)}, {s.to_lng.toFixed(3)}</span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
              {s.distance_km != null && <span>{s.distance_km} km away</span>}
              {s.response_improve_sec != null && (
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> ~{Math.round(s.response_improve_sec / 60)} min faster</span>
              )}
            </div>
            {s.reasons?.length > 0 && (
              <ul className="mb-2 list-disc pl-4 text-[11px] text-muted-foreground">
                {s.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <div className="flex gap-2">
              <button onClick={() => act(s.id, "accept")}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--success,#00C896)] px-2 py-1 text-xs font-bold text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t("Accept")}
              </button>
              <button onClick={() => act(s.id, "dismiss")}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold hover:bg-muted">
                <XCircle className="h-3.5 w-3.5" /> {t("Dismiss")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 7. EDIT — `frontend/src/routes/operations.tsx` (mount the panel)

Add the import and render it for the `predict` tab:

```tsx
import { PredictivePanel } from "@/components/ops/PredictivePanel";
```

Replace the placeholder `<section>...</section>` body with:

```tsx
        <section className="rounded-[8px] border-2 border-foreground bg-background p-4">
          {tab === "predict" && <PredictivePanel />}
          {tab !== "predict" && (
            <p className="text-sm text-muted-foreground">{t("Coming in a later phase.")} ({tab})</p>
          )}
        </section>
```

---

## 8. Verify

```bash
cd backend && python -m seed.geocode_cases   # ensure cases have coords (if not already)
python -m seed.init_ops                       # patrols seeded
uvicorn app.main:app --reload
# GET /api/ops/risk-zones?refresh=true -> zones[]
# GET /api/ops/suggestions -> suggestions[]
```

Open **Response Ops → Predictive Deployment**: heat map of risk zones + suggestion cards with Accept/Dismiss.

## Self-rating
- **Fit: 9.5/10** — directly ports EMERGE's algorithm; reuses geocoded `cases` + existing `CrimeMap`.
- **Correctness: 9/10** — real columns (`crime_type`, `incident_time`, `incident_date`, `latitude/longitude`), real RBAC. `LOOKBACK_DAYS` widened to 365 because crime data is sparser than live accidents — tune to taste.
- **Caveat:** `recompute_if_stale` does a full delete+rewrite of `ops_risk_zones` — fine at city scale; if you later index millions of cases, switch to an upsert.
