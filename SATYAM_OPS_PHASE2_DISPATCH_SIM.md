# Phase 2 — Dispatch nearest patrol + live GPS simulation

**Goal:** Port EMERGE's `routingService.js` (OSRM + straight-line fallback) and `demoSimulationService.js` (route interpolation + status lifecycle) to Python. Dispatch the nearest IDLE patrol to a scene, compute its driving route, and stream its live position over a **FastAPI WebSocket** (the only realtime endpoint in Satyam, isolated to `/api/ops/ws`). Requires Phase 0 (+ patrols from Phase 1 seed).

---

## 1. NEW — `backend/app/services/ops/routing_service.py`

Python port of `routingService.js`: OSRM driving route, straight-line fallback.

```python
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
    """Return {provider, distance_km, duration_sec, coords:[[lng,lat],...]}. Never raises."""
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
```

---

## 2. NEW — `backend/app/services/ops/ws_manager.py`

Tiny in-memory broadcast hub (replaces Socket.io rooms; one channel is enough for a demo).

```python
"""In-memory WebSocket broadcast hub for Response-Ops live events."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket


class WsManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    async def broadcast(self, event: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_json(event)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)


manager = WsManager()
```

---

## 3. NEW — `backend/app/services/ops/sim_service.py`

Python port of `demoSimulationService.js`: walk the route coords on a timer, broadcast `PATROL_LOCATION`, advance status `ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED`, persist the last position. Each dispatch runs as one `asyncio` task. (Green-corridor hook is added in Phase 3.)

```python
"""Live patrol simulation — Python port of EMERGE demoSimulationService.js."""
from __future__ import annotations

import asyncio

from sqlalchemy import update

from app.db.ops_models import IncidentDispatch, PatrolUnit
from app.db.session import get_sessionmaker
from app.services.ops.ws_manager import manager

TICK_SEC = 0.8           # interval between coordinate steps
MAX_POINTS = 60          # subsample long routes to <= this many steps

# dispatch_id -> asyncio.Task
_running: dict[int, asyncio.Task] = {}
# dispatch_id -> latest {lat,lng,status,eta_sec} for the polling fallback
_latest: dict[int, dict] = {}


def latest_state(dispatch_id: int) -> dict | None:
    return _latest.get(dispatch_id)


def _subsample(coords: list[list[float]], cap: int = MAX_POINTS) -> list[list[float]]:
    if len(coords) <= cap:
        return coords
    step = (len(coords) - 1) / (cap - 1)
    out = [coords[round(i * step)] for i in range(cap)]
    if out[-1] != coords[-1]:
        out.append(coords[-1])
    return out


async def _persist_status(dispatch_id: int, patrol_id: int, status: str,
                          lat: float | None = None, lng: float | None = None) -> None:
    sm = get_sessionmaker()
    async with sm() as db:
        async with db.begin():
            await db.execute(update(IncidentDispatch).where(IncidentDispatch.id == dispatch_id).values(status=status))
            vals: dict = {"status": {"COMPLETED": "IDLE", "ON_SCENE": "ON_SCENE"}.get(status, "EN_ROUTE")}
            if lat is not None:
                vals["lat"], vals["lng"] = lat, lng
            await db.execute(update(PatrolUnit).where(PatrolUnit.id == patrol_id).values(**vals))


async def _run(dispatch_id: int, patrol_id: int, coords: list[list[float]],
               duration_sec: int, on_move=None) -> None:
    """on_move(lat,lng) optional async hook (Phase 3 green corridor)."""
    pts = _subsample(coords)
    n = max(1, len(pts))
    await _persist_status(dispatch_id, patrol_id, "EN_ROUTE")
    await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "EN_ROUTE"})
    try:
        for i, (lng, lat) in enumerate(pts):
            remaining = int(duration_sec * (1 - i / n))
            _latest[dispatch_id] = {"lat": lat, "lng": lng, "status": "EN_ROUTE", "eta_sec": remaining}
            await manager.broadcast({
                "type": "PATROL_LOCATION", "dispatchId": dispatch_id, "patrolId": patrol_id,
                "lat": lat, "lng": lng, "etaSec": remaining,
                "progress": round((i + 1) / n, 3),
            })
            if on_move:
                await on_move(lat, lng)
            await asyncio.sleep(TICK_SEC)
        # arrived
        last_lng, last_lat = pts[-1]
        await _persist_status(dispatch_id, patrol_id, "ON_SCENE", last_lat, last_lng)
        _latest[dispatch_id] = {"lat": last_lat, "lng": last_lng, "status": "ON_SCENE", "eta_sec": 0}
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "ON_SCENE"})
    except asyncio.CancelledError:
        await _persist_status(dispatch_id, patrol_id, "CANCELLED")
        raise
    finally:
        _running.pop(dispatch_id, None)


def start(dispatch_id: int, patrol_id: int, coords: list[list[float]],
          duration_sec: int, on_move=None) -> None:
    if dispatch_id in _running:
        return
    _running[dispatch_id] = asyncio.create_task(
        _run(dispatch_id, patrol_id, coords, duration_sec, on_move)
    )


def stop(dispatch_id: int) -> None:
    task = _running.get(dispatch_id)
    if task:
        task.cancel()
```

---

## 4. EDIT — `backend/app/schemas/ops.py` (append)

```python
class PatrolOut(BaseModel):
    id: int
    callsign: str
    status: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    district: Optional[str] = None


class DispatchRequest(BaseModel):
    scene_lat: float
    scene_lng: float
    case_id: Optional[int] = None
    patrol_id: Optional[int] = None  # if omitted, the nearest IDLE unit is chosen


class DispatchOut(BaseModel):
    id: int
    patrol_id: int
    patrol_callsign: Optional[str] = None
    case_id: Optional[int] = None
    scene_lat: float
    scene_lng: float
    status: str
    distance_km: Optional[float] = None
    duration_sec: Optional[int] = None
    eta_sec: Optional[int] = None
    route: list[list[float]] = []  # [[lng,lat],...]
```

---

## 5. EDIT — `backend/app/api/routes/ops.py` (append Phase 2)

Add imports:

```python
from fastapi import WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.db.ops_models import IncidentDispatch
from app.schemas.ops import DispatchOut, DispatchRequest, PatrolOut
from app.services.ops import routing_service, sim_service
from app.services.ops.ws_manager import manager
```

Endpoints:

```python
@router.get("/patrols", response_model=list[PatrolOut])
async def patrols(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[PatrolOut]:
    _guard(principal)
    rows = (await session.execute(select(PatrolUnit))).scalars().all()
    return [PatrolOut(id=p.id, callsign=p.callsign, status=p.status, lat=p.lat, lng=p.lng, district=p.district) for p in rows]


@router.post("/dispatch", response_model=DispatchOut)
async def dispatch(
    req: DispatchRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> DispatchOut:
    _guard(principal)
    # pick patrol
    if req.patrol_id:
        patrol = (await session.execute(select(PatrolUnit).where(PatrolUnit.id == req.patrol_id))).scalar_one_or_none()
    else:
        idle = (await session.execute(select(PatrolUnit).where(PatrolUnit.status == "IDLE"))).scalars().all()
        patrol = min(
            (p for p in idle if p.lat is not None),
            key=lambda p: routing_service.haversine_km(p.lat, p.lng, req.scene_lat, req.scene_lng),
            default=None,
        )
    if not patrol:
        raise HTTPException(status_code=409, detail="no available patrol unit")

    route = await routing_service.get_route(
        from_lat=patrol.lat, from_lng=patrol.lng, to_lat=req.scene_lat, to_lng=req.scene_lng,
    )
    disp = IncidentDispatch(
        case_id=req.case_id, patrol_id=patrol.id, scene_lat=req.scene_lat, scene_lng=req.scene_lng,
        status="ACCEPTED", route_geometry={"type": "LineString", "coordinates": route["coords"]},
        distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
    )
    session.add(disp)
    await session.flush()
    return DispatchOut(
        id=disp.id, patrol_id=patrol.id, patrol_callsign=patrol.callsign, case_id=req.case_id,
        scene_lat=req.scene_lat, scene_lng=req.scene_lng, status=disp.status,
        distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
        route=route["coords"],
    )


@router.post("/dispatch/{dispatch_id}/simulate")
async def simulate(
    dispatch_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    disp = (await session.execute(select(IncidentDispatch).where(IncidentDispatch.id == dispatch_id))).scalar_one_or_none()
    if not disp or not disp.route_geometry:
        raise HTTPException(status_code=404, detail="dispatch or route not found")
    coords = disp.route_geometry["coordinates"]
    sim_service.start(dispatch_id, disp.patrol_id, coords, disp.duration_sec or 60)
    return {"ok": True, "dispatchId": dispatch_id, "points": len(coords)}


@router.get("/dispatch/{dispatch_id}/state")
async def dispatch_state(
    dispatch_id: int,
    principal: Principal = Depends(get_principal),
) -> dict:
    """Polling fallback for clients that can't hold a WebSocket."""
    _guard(principal)
    return sim_service.latest_state(dispatch_id) or {"status": "UNKNOWN"}


@router.websocket("/ws")
async def ops_ws(ws: WebSocket, token: str | None = None) -> None:
    """Live event stream. Auth via ?token=<jwt> query param (WS can't send headers)."""
    if not token:
        await ws.close(code=4401)
        return
    try:
        decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; client may send pings
    except WebSocketDisconnect:
        await manager.disconnect(ws)
```

> **Why an unscoped sessionmaker in `sim_service`?** The simulation runs in a background task with no request/JWT, so it uses `get_sessionmaker()` directly. It only writes `ops_*` tables (not RLS-protected), so this is safe and intentional.

---

## 6. EDIT — `frontend/src/lib/api/responseOps.ts` (append)

```ts
import { API_BASE, getAuthToken } from "./client";

export type Patrol = { id: number; callsign: string; status: string; lat?: number | null; lng?: number | null; district?: string | null };
export type DispatchResult = {
  id: number; patrol_id: number; patrol_callsign?: string | null; case_id?: number | null;
  scene_lat: number; scene_lng: number; status: string;
  distance_km?: number | null; duration_sec?: number | null; eta_sec?: number | null;
  route: number[][];
};

Object.assign(responseOps, {
  patrols: () => opsFetch<Patrol[]>("/patrols"),
  dispatch: (body: { scene_lat: number; scene_lng: number; case_id?: number; patrol_id?: number }) =>
    opsFetch<DispatchResult>("/dispatch", { method: "POST", body: JSON.stringify(body) }),
  simulate: (id: number) => opsFetch<{ ok: boolean }>(`/dispatch/${id}/simulate`, { method: "POST" }),
});

/** Open the live ops WebSocket. Returns the socket; caller attaches onmessage. */
export function openOpsSocket(): WebSocket {
  const base = API_BASE.replace(/^http/, "ws");
  const token = getAuthToken() ?? "";
  return new WebSocket(`${base}/api/ops/ws?token=${encodeURIComponent(token)}`);
}
```

---

## 7. NEW — `frontend/src/components/ops/DispatchPanel.tsx`

Extends `CrimeMap` via **new optional props** (added in step 8) for a moving patrol marker + route line.

```tsx
import { useEffect, useRef, useState } from "react";
import { Truck, Navigation, Play } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, openOpsSocket, type Patrol, type DispatchResult } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

export function DispatchPanel() {
  const t = useT();
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [active, setActive] = useState<DispatchResult | null>(null);
  const [live, setLive] = useState<{ lat: number; lng: number; etaSec: number } | null>(null);
  const [scene, setScene] = useState({ lat: 12.9352, lng: 77.6245 });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => { responseOps.patrols().then(setPatrols); }, []);

  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "PATROL_LOCATION" && (!active || msg.dispatchId === active.id)) {
        setLive({ lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec });
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function dispatchNearest() {
    const d = await responseOps.dispatch({ scene_lat: scene.lat, scene_lng: scene.lng });
    setActive(d);
    setLive(null);
    await responseOps.simulate(d.id);
  }

  const patrolPoints: Hotspot[] = patrols.map((p) => ({
    lat: p.lat ?? 0, lng: p.lng ?? 0, weight: 1, label: `${p.callsign} (${p.status})`,
  })).filter((p) => p.lat && p.lng);
  const livePoint: Hotspot[] = live ? [{ lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") }] : [];
  const routeLine: Hotspot[] = active ? active.route.map(([lng, lat]) => ({ lat, lng, weight: 1 })) : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="h-[520px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap points={patrolPoints} mode="pins" trail={routeLine} focus={livePoint} animateKey={live ? Date.now() : 0} />
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-extrabold">{t("Dispatch")}</h3>
        <div className="rounded-[8px] border-2 border-foreground p-3 text-xs">
          <div className="mb-2 font-bold">{t("Scene")}</div>
          <div className="flex gap-2">
            <input className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1" value={scene.lat}
              onChange={(e) => setScene((s) => ({ ...s, lat: parseFloat(e.target.value) || s.lat }))} />
            <input className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1" value={scene.lng}
              onChange={(e) => setScene((s) => ({ ...s, lng: parseFloat(e.target.value) || s.lng }))} />
          </div>
          <button onClick={dispatchNearest}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 font-bold">
            <Navigation className="h-4 w-4" /> {t("Dispatch nearest unit")}
          </button>
        </div>
        {active && (
          <div className="rounded-[8px] border-2 border-foreground p-3 text-xs">
            <div className="flex items-center gap-2 font-bold"><Truck className="h-4 w-4" /> {active.patrol_callsign}</div>
            <div className="mt-1 text-muted-foreground">
              {active.distance_km?.toFixed(1)} km · ETA {live ? Math.round(live.etaSec / 60) : Math.round((active.eta_sec ?? 0) / 60)} min
            </div>
            <div className="mt-1 inline-flex items-center gap-1 text-[11px]"><Play className="h-3 w-3" /> {live ? t("Live") : active.status}</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 8. EDIT — `frontend/src/components/CrimeMap.tsx` (additive: render `trail` as a polyline + `focus` as a live marker)

`CrimeMap` already accepts `trail`, `focus`, and `animateKey` props — we only need to ensure `trail` draws a **route polyline** and `focus` draws a **marker**. If your current `focus` handling already renders markers (it does, per the `focusLayerRef` block), add a polyline for `trail` if not present. Insert this effect alongside the existing draw effects:

```tsx
  // Route polyline for dispatch (additive; no-op when trail is empty)
  const trailLineRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (trailLineRef.current) { map.removeLayer(trailLineRef.current); trailLineRef.current = null; }
    if (!trail || trail.length < 2) return;
    trailLineRef.current = L.polyline(trail.map((p) => [p.lat, p.lng]), { color: "#91C5FD", weight: 5, opacity: 0.85 }).addTo(map);
  }, [trail, ready]);
```

> If a `trail` polyline renderer already exists in your `CrimeMap`, skip this and reuse it. The props are unchanged, so existing callers are unaffected.

---

## 9. EDIT — `frontend/src/routes/operations.tsx` (mount dispatch tab)

```tsx
import { DispatchPanel } from "@/components/ops/DispatchPanel";
```
```tsx
          {tab === "dispatch" && <DispatchPanel />}
```

---

## 10. Verify

```bash
uvicorn app.main:app --reload
# POST /api/ops/dispatch {"scene_lat":12.9352,"scene_lng":77.6245} -> {id, route:[...]}
# POST /api/ops/dispatch/<id>/simulate -> ok
# WS  /api/ops/ws?token=<jwt> -> stream of PATROL_LOCATION events
```

Response Ops → **Dispatch & Tracking**: click *Dispatch nearest unit* → the patrol marker animates along the route to the scene with a live ETA.

## Self-rating
- **Fit: 9/10** — faithful port of routing + sim; single-leg (patrol→scene) is the correct crime simplification.
- **Correctness: 8.5/10** — real FastAPI WS + asyncio task model. Public OSRM may rate-limit → straight-line fallback covers it. WS auth via query token (standard for browser WS).
- **Caveat:** in-memory `_running`/`manager` are per-process — fine for a single-instance demo; for multi-worker you'd move to Redis pub/sub.
