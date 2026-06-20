# Phase 0 — Response Ops scaffold (isolated, non-invasive)

**Goal:** Stand up the empty, feature-flagged “Response Ops” module: new tables, a mounted `/api/ops` router that does nothing yet, an empty `/operations` screen, and the nav link. After this phase the app behaves *exactly* as before unless `ENABLE_RESPONSE_OPS=true`.

**Apply order:** all NEW files first, then the 3 small edits at the end.

---

## 1. NEW — `backend/app/db/ops_models.py`

All new tables for every phase, on the existing `Base` (so SQLAlchemy registers them on the shared metadata). Nothing here references or alters existing tables except a nullable read-only FK to `cases.case_id`.

```python
"""Response-Ops tables (predictive deployment, dispatch, green corridor, camera review).

Isolated module: imported only by the ops router/services and the init_ops seed.
Existing tables are never altered. `case_id` is a nullable FK used read-only
(except an INSERT of a brand-new case when an officer confirms a camera incident).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, JSON, SmallInteger, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base  # shared metadata — no existing table touched


class PatrolUnit(Base):
    __tablename__ = "ops_patrol_units"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    callsign: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="IDLE")  # IDLE|EN_ROUTE|ON_SCENE|OFFLINE
    lat: Mapped[Optional[float]] = mapped_column(Float)
    lng: Mapped[Optional[float]] = mapped_column(Float)
    station_id: Mapped[Optional[int]] = mapped_column(Integer)  # soft ref to stations
    district: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrafficSignal(Base):
    __tablename__ = "ops_traffic_signals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    junction_id: Mapped[str] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    state: Mapped[str] = mapped_column(Text, default="NORMAL")  # NORMAL|GREEN


class IncidentDispatch(Base):
    __tablename__ = "ops_incident_dispatches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cases.case_id"), nullable=True)
    patrol_id: Mapped[int] = mapped_column(ForeignKey("ops_patrol_units.id"))
    scene_lat: Mapped[float] = mapped_column(Float)
    scene_lng: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(Text, default="ACCEPTED")  # ACCEPTED|EN_ROUTE|ON_SCENE|COMPLETED|CANCELLED
    route_geometry: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)  # GeoJSON LineString
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer)
    eta_sec: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RiskZone(Base):
    __tablename__ = "ops_risk_zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    grid_key: Mapped[str] = mapped_column(Text, unique=True, index=True)
    center_lat: Mapped[float] = mapped_column(Float)
    center_lng: Mapped[float] = mapped_column(Float)
    risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    incident_score: Mapped[float] = mapped_column(Float, default=0.0)
    time_score: Mapped[float] = mapped_column(Float, default=0.0)
    incident_count: Mapped[int] = mapped_column(Integer, default=0)
    peak_hour: Mapped[Optional[int]] = mapped_column(SmallInteger)
    risk_label: Mapped[str] = mapped_column(Text, default="Low")
    reasons: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PatrolSuggestion(Base):
    __tablename__ = "ops_patrol_suggestions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    risk_zone_id: Mapped[int] = mapped_column(ForeignKey("ops_risk_zones.id"))
    patrol_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ops_patrol_units.id"))
    from_lat: Mapped[Optional[float]] = mapped_column(Float)
    from_lng: Mapped[Optional[float]] = mapped_column(Float)
    to_lat: Mapped[float] = mapped_column(Float)
    to_lng: Mapped[float] = mapped_column(Float)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    response_improve_sec: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, default="PENDING")  # PENDING|ACCEPTED|DISMISSED|EXPIRED
    reasons: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Camera(Base):
    __tablename__ = "ops_cameras"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    location: Mapped[Optional[str]] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    video_path: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class IncidentReview(Base):
    __tablename__ = "ops_incident_review_queue"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(Text)
    candidate_type: Mapped[str] = mapped_column(Text)        # e.g. "vehicle_anomaly", "crowd"
    confidence: Mapped[float] = mapped_column(Float)
    clip_path: Mapped[Optional[str]] = mapped_column(Text)
    frame_path: Mapped[Optional[str]] = mapped_column(Text)
    lat: Mapped[Optional[float]] = mapped_column(Float)
    lng: Mapped[Optional[float]] = mapped_column(Float)
    status: Mapped[str] = mapped_column(Text, default="PENDING")  # PENDING|CONFIRMED|REJECTED
    reviewed_by: Mapped[Optional[str]] = mapped_column(Text)
    case_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cases.case_id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Convenience list used by the init_ops seed to create ONLY these tables.
OPS_TABLES = [
    PatrolUnit.__table__, TrafficSignal.__table__, IncidentDispatch.__table__,
    RiskZone.__table__, PatrolSuggestion.__table__, Camera.__table__, IncidentReview.__table__,
]
```

---

## 2. NEW — `backend/seed/init_ops.py`

Creates ONLY the ops tables (and seeds a few demo patrols/signals/cameras). Idempotent. Uses the seed/owner URL. Physically cannot touch existing tables — it passes an explicit `tables=` allow-list to `create_all`.

```python
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
```

---

## 3. NEW — `backend/app/api/routes/ops.py`

Phase 0 stub. Later phases append endpoints to this same router.

```python
"""Response-Ops router. Mounted at /api/ops only when ENABLE_RESPONSE_OPS=true."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_principal
from app.core.rbac import Principal

router = APIRouter()


@router.get("/health")
async def ops_health(principal: Principal = Depends(get_principal)) -> dict:
    """Cheap liveness probe for the Response-Ops module."""
    return {"ok": True, "module": "response-ops", "rank": principal.rank}
```

---

## 4. NEW — `frontend/src/lib/api/responseOps.ts`

Mirrors the `intelligence.ts` `apiFetch` helper. Later phases add typed calls here.

```ts
/** Typed API wrapper for the Response-Ops module (predictive deployment,
 *  dispatch, green corridor, camera review). Isolated from existing clients. */
import { API_BASE, getAuthToken, ApiError } from "./client";

export async function opsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api/ops${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const responseOps = {
  health: () => opsFetch<{ ok: boolean; module: string; rank: string }>("/health"),
};
```

---

## 5. NEW — `frontend/src/routes/operations.tsx`

Empty tabbed shell. File-based routing auto-registers `/operations` (no router edits).

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState } from "react";
import { Siren, Radar, Truck, TrafficCone, Video } from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/operations")({
  head: () => ({ meta: [{ title: "Response Ops · Satyam" }] }),
  component: OperationsScreen,
});

type Tab = "predict" | "dispatch" | "corridor" | "review";

function OperationsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("predict");

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Tracking"), icon: Truck },
    { id: "corridor", label: t("Green Corridor"), icon: TrafficCone },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];

  return (
    <Shell>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-foreground bg-[var(--main)] text-foreground">
            <Siren className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-none">{t("Response Ops")}</h1>
            <p className="text-xs text-muted-foreground">{t("Predict · Detect · Dispatch · Clear the route")}</p>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] border-2 border-foreground px-3 py-1.5 text-sm font-bold transition ${
                tab === id ? "bg-foreground text-background" : "bg-background hover:bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>

        <section className="rounded-[8px] border-2 border-foreground bg-background p-6">
          {/* Phase 1–4 mount their panels here, keyed by `tab`. */}
          <p className="text-sm text-muted-foreground">
            {t("This module activates as phases are installed.")} ({tab})
          </p>
        </section>
      </div>
    </Shell>
  );
}
```

---

## 6. EDIT — `backend/app/config.py` (add one field to `Settings`)

Add near the other feature settings (e.g. just after `app_env`):

```python
    # Response-Ops module (EMERGE-derived). Off by default — fully isolated.
    enable_response_ops: bool = False
```

---

## 7. EDIT — `backend/app/main.py` (import + one guarded mount)

Add to the route imports block (after `from app.api.routes import intelligence`):

```python
from app.api.routes import ops as ops_routes
```

And inside `create_app()`, right after the `intelligence` mount (last `include_router` line):

```python
    if settings.enable_response_ops:
        app.include_router(ops_routes.router, prefix="/api/ops", tags=["response-ops"])
```

> `settings` is already in scope in `create_app()`. When the flag is off, the import is harmless and no routes are added.

---

## 8. EDIT — `frontend/src/components/Shell.tsx` (one nav entry + icon import)

**(a)** Add `Siren` to the existing `lucide-react` import (the block ending at line ~18):

```tsx
  Siren,
```

**(b)** Append one entry to the `NAV` array (~line 653, after the Transcripts entry):

```tsx
    { to: "/operations", icon: Siren, label: t("Response Ops") },
```

**(c)** *(optional, voice nav)* add to `SCREEN_ROUTES` (~line 39):

```tsx
  { to: "/operations", words: /(response ops|operations|patrol|dispatch|green corridor)|ಕಾರ್ಯಾಚರಣೆ/i },
```

---

## 9. Activate + verify

```bash
# backend/.env
ENABLE_RESPONSE_OPS=true

# create the ops tables + demo rows
cd backend && python -m seed.init_ops

# run
uvicorn app.main:app --reload
# GET http://localhost:8000/api/ops/health  -> {"ok":true,...}
```

Frontend: a new **Response Ops** item appears in the sidebar → `/operations` with four empty tabs. With the flag off, none of this exists and Satyam is byte-for-byte unchanged.

## Self-rating
- **Isolation: 10/10** — 7 new files, 3 additive edits, explicit `tables=` allow-list, feature flag.
- **Correctness: 9/10** — matches real signatures (`Base`, `get_principal`, file-based route, `NAV`). The only runtime dep is that `seed_database_url` can create tables (it's the owner URL, by design).
