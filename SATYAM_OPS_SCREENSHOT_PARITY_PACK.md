# SATYAM_OPS_SCREENSHOT_PARITY_PACK

**Goal:** make Satyam's Response-Ops simulation *look and behave like the EMERGE screenshots* — an **Active Dispatches** list with a **phase timeline + progress + ETA**, **Simulate All / Stop All** controls, a **green-corridor route glow + floating signal panel**, a **map legend**, and an **animated vehicle marker** that drives along the route while traffic signals flip green ahead of it.

This pack is **drop-in** against the *current* Satyam codebase (verified line-by-line against the uploaded `Satyam_Ai-main`). Every file below was syntax-validated in a sandbox: the Python files pass `python -m py_compile`; the TS/TSX files parse cleanly under Prettier.

It is **additive and reversible** — it only touches the Response-Ops module (`services/ops`, `routes/ops.py`, `lib/api/responseOps.ts`, `components/ops/DispatchPanel.tsx`, `components/CrimeMap.tsx`). RBAC, DB schema, and the rest of the app are untouched.

---

## What changes (6 files)

| # | File | Type | What it adds |
|---|------|------|--------------|
| 1 | `backend/app/services/ops/sim_service.py` | **replace** | `ACCEPTED` phase, `phase` field on every broadcast, active-dispatch registry (`active_states`/`active_ids`), `stop_all`, up-front whole-route corridor activation |
| 2 | `backend/app/services/ops/corridor_service.py` | **replace** | `activate_corridor(route)` (route-wide green) + `GREEN_CORRIDOR_ACTIVE` / `GREEN_CORRIDOR_DEACTIVATED` events |
| 3 | `backend/app/api/routes/ops.py` | **insert** | `GET /dispatch/active`, `POST /dispatch/simulate-all`, `POST /dispatch/stop-all` |
| 4 | `frontend/src/lib/api/responseOps.ts` | **insert** | `ActiveDispatch` type + `activeDispatches` / `simulateAll` / `stopAll` |
| 5 | `frontend/src/components/CrimeMap.tsx` | **insert/replace** | `corridorPath` prop → green glow polyline; animated 🚓 live marker |
| 6 | `frontend/src/components/ops/DispatchPanel.tsx` | **replace** | Active Dispatches list + phase timeline + Simulate All/Stop All + corridor panel + legend |

### New WebSocket / REST contract (added)
- `DISPATCH_STATUS` and `PATROL_LOCATION` now carry a **`phase`** field (`ACCEPTED` → `EN_ROUTE` → `ON_SCENE` → `COMPLETED`).
- New events: **`GREEN_CORRIDOR_ACTIVE`** `{ patrolId, callsign, routeCoords:[[lat,lng]], signals:[{junctionId,lat,lng}], message }` and **`GREEN_CORRIDOR_DEACTIVATED`**.
- New REST: `GET /api/ops/dispatch/active`, `POST /api/ops/dispatch/simulate-all`, `POST /api/ops/dispatch/stop-all`.

---

## 1) REPLACE — `backend/app/services/ops/sim_service.py`

Replace the whole file with:
```python
"""Live patrol simulation — Python port of EMERGE demoSimulationService.js.

Adds (parity pack): an ACCEPTED phase, a `phase` field on every broadcast, an
in-memory active-dispatch registry (active_states/active_ids), simulate-all /
stop-all support, and up-front whole-route green-corridor activation.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select, update

from app.db.ops_models import IncidentDispatch, PatrolUnit
from app.db.session import get_sessionmaker
from app.services.ops import corridor_service
from app.services.ops.ws_manager import manager

TICK_SEC = 0.8            # interval between coordinate steps
MAX_POINTS = 60           # subsample long routes to <= this many steps
ON_SCENE_HOLD_SEC = 6     # keep unit ON_SCENE this long, then free it (-> IDLE)
ACCEPTED_HOLD_SEC = 2     # brief ACCEPTED phase before moving (mirrors EMERGE)

# dispatch_id -> asyncio.Task
_running: dict[int, asyncio.Task] = {}
# dispatch_id -> latest {lat,lng,status,phase,eta_sec,progress,callsign,...}
_latest: dict[int, dict] = {}


def latest_state(dispatch_id: int) -> dict | None:
    return _latest.get(dispatch_id)


def active_states() -> list[dict]:
    """Snapshot of every dispatch that is not finished (drives the Active list)."""
    return [
        {"dispatchId": did, **st}
        for did, st in _latest.items()
        if st.get("status") not in ("COMPLETED", "CANCELLED")
    ]


def active_ids() -> list[int]:
    return list(_running.keys())


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


async def _load_meta(dispatch_id: int, patrol_id: int) -> dict:
    sm = get_sessionmaker()
    async with sm() as db:
        callsign = (await db.execute(
            select(PatrolUnit.callsign).where(PatrolUnit.id == patrol_id)
        )).scalar()
        disp = (await db.execute(
            select(IncidentDispatch).where(IncidentDispatch.id == dispatch_id)
        )).scalar_one_or_none()
    return {
        "patrolId": patrol_id,
        "callsign": callsign or f"Unit #{patrol_id}",
        "sceneLat": disp.scene_lat if disp else None,
        "sceneLng": disp.scene_lng if disp else None,
    }


async def _emit_status(dispatch_id: int, status: str, phase: str) -> None:
    await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": status, "phase": phase})


async def _run(dispatch_id: int, patrol_id: int, coords: list[list[float]],
               duration_sec: int, on_move=None) -> None:
    """on_move(lat,lng) optional async hook (per-tick near-corridor activation)."""
    pts = _subsample(coords)
    n = max(1, len(pts))
    meta = await _load_meta(dispatch_id, patrol_id)

    # --- ACCEPTED (brief) ---
    first_lng, first_lat = pts[0]
    _latest[dispatch_id] = {**meta, "lat": first_lat, "lng": first_lng,
                            "status": "ACCEPTED", "phase": "ACCEPTED",
                            "eta_sec": duration_sec, "progress": 0.0}
    await _persist_status(dispatch_id, patrol_id, "ACCEPTED", first_lat, first_lng)
    await _emit_status(dispatch_id, "ACCEPTED", "ACCEPTED")
    await asyncio.sleep(ACCEPTED_HOLD_SEC)

    # --- EN_ROUTE: light the whole corridor up-front, then start moving ---
    await _persist_status(dispatch_id, patrol_id, "EN_ROUTE")
    await _emit_status(dispatch_id, "EN_ROUTE", "EN_ROUTE")
    try:
        await corridor_service.activate_corridor(pts, patrol_id=patrol_id, callsign=meta["callsign"])
    except Exception:  # noqa: BLE001 - corridor is best-effort
        pass

    try:
        for i, (lng, lat) in enumerate(pts):
            remaining = int(duration_sec * (1 - i / n))
            progress = round((i + 1) / n, 3)
            _latest[dispatch_id] = {**meta, "lat": lat, "lng": lng,
                                    "status": "EN_ROUTE", "phase": "EN_ROUTE",
                                    "eta_sec": remaining, "progress": progress}
            await manager.broadcast({
                "type": "PATROL_LOCATION", "dispatchId": dispatch_id, "patrolId": patrol_id,
                "lat": lat, "lng": lng, "etaSec": remaining, "progress": progress, "phase": "EN_ROUTE",
            })
            if on_move:
                await on_move(lat, lng)
            await asyncio.sleep(TICK_SEC)

        # --- ON_SCENE ---
        last_lng, last_lat = pts[-1]
        await _persist_status(dispatch_id, patrol_id, "ON_SCENE", last_lat, last_lng)
        _latest[dispatch_id] = {**meta, "lat": last_lat, "lng": last_lng,
                                "status": "ON_SCENE", "phase": "ON_SCENE", "eta_sec": 0, "progress": 1.0}
        await _emit_status(dispatch_id, "ON_SCENE", "ON_SCENE")
        await corridor_service.reset_all()
        await asyncio.sleep(ON_SCENE_HOLD_SEC)

        # --- COMPLETED (unit freed -> IDLE) ---
        await _persist_status(dispatch_id, patrol_id, "COMPLETED", last_lat, last_lng)
        _latest[dispatch_id] = {**meta, "lat": last_lat, "lng": last_lng,
                                "status": "COMPLETED", "phase": "COMPLETED", "eta_sec": 0, "progress": 1.0}
        await _emit_status(dispatch_id, "COMPLETED", "COMPLETED")
    except asyncio.CancelledError:
        await _persist_status(dispatch_id, patrol_id, "CANCELLED")
        try:
            await corridor_service.reset_all()
        except Exception:  # noqa: BLE001
            pass
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


def stop_all() -> None:
    for did in list(_running.keys()):
        stop(did)
```

## 2) REPLACE — `backend/app/services/ops/corridor_service.py`

Replace the whole file with:
```python
"""Green corridor — Python port of EMERGE greenCorridor.js.

- activate_near(lat,lng): flip signals GREEN within ACTIVATION_RADIUS_KM of the
  moving unit (per-tick), broadcast SIGNAL_GREEN on real changes.
- activate_corridor(route): light the WHOLE route up-front within CORRIDOR_RADIUS_KM
  and broadcast one GREEN_CORRIDOR_ACTIVE (mirrors activateGreenCorridorForSim).
- reset_all(): restore NORMAL on arrival and broadcast GREEN_CORRIDOR_DEACTIVATED.
"""
from __future__ import annotations

from sqlalchemy import select, update

from app.db.ops_models import TrafficSignal
from app.db.session import get_sessionmaker
from app.services.ops.routing_service import haversine_km
from app.services.ops.ws_manager import manager

ACTIVATION_RADIUS_KM = 0.3  # near the moving unit (mirrors EMERGE greenCorridor.js)
CORRIDOR_RADIUS_KM = 0.5    # along the whole route (mirrors activateGreenCorridorForSim)


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


async def activate_corridor(route_coords: list[list[float]],
                            patrol_id: int | None = None,
                            callsign: str | None = None) -> list[dict]:
    """Light every signal within CORRIDOR_RADIUS_KM of ANY point on the route,
    then broadcast a single GREEN_CORRIDOR_ACTIVE. route_coords is [[lng,lat],...]."""
    pts = route_coords
    if len(pts) > 50:  # cap O(points*signals) work on long routes
        step = len(pts) / 50.0
        pts = [pts[int(i * step)] for i in range(50)]
    activated: list[dict] = []
    sm = get_sessionmaker()
    async with sm() as db:
        async with db.begin():
            signals = (await db.execute(select(TrafficSignal))).scalars().all()
            for s in signals:
                near = any(haversine_km(lat, lng, s.lat, s.lng) <= CORRIDOR_RADIUS_KM for lng, lat in pts)
                if near:
                    if s.state != "GREEN":
                        await db.execute(update(TrafficSignal).where(TrafficSignal.id == s.id).values(state="GREEN"))
                    activated.append({"junctionId": s.junction_id, "lat": s.lat, "lng": s.lng})
    route_latlng = [[lat, lng] for lng, lat in route_coords]  # Leaflet wants [lat,lng]
    await manager.broadcast({
        "type": "GREEN_CORRIDOR_ACTIVE",
        "patrolId": patrol_id, "callsign": callsign,
        "routeCoords": route_latlng, "signals": activated,
        "message": f"Priority corridor activated — {len(activated)} signals prioritized",
    })
    return activated


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
    await manager.broadcast({"type": "GREEN_CORRIDOR_DEACTIVATED"})
```

## 3) INSERT — `backend/app/api/routes/ops.py`

Three new endpoints. **Find** the existing `dispatch_state` handler (it ends with `return sim_service.latest_state(dispatch_id) or {"status": "UNKNOWN"}`) and **insert the following block immediately after it**, before `@router.websocket("/ws")`.

> No new imports are needed — `select`, `update`, `IncidentDispatch`, `AsyncSession`, `get_scoped_session`, `Depends`, `Principal`, `get_principal`, `sim_service`, and `corridor_service` are already imported in this file. The three paths (`/dispatch/active`, `/dispatch/simulate-all`, `/dispatch/stop-all`) do not collide with the parametrised `/dispatch/{dispatch_id}/...` routes.

```python
@router.get("/dispatch/active")
async def dispatch_active(
    principal: Principal = Depends(get_principal),
) -> dict:
    """Every dispatch currently mid-simulation (drives the Active Dispatches list)."""
    _guard(principal)
    return {"active": sim_service.active_states()}


@router.post("/dispatch/simulate-all")
async def simulate_all(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Start a live simulation for every unfinished dispatch that has a route."""
    _guard(principal)
    rows = (await session.execute(
        select(IncidentDispatch).where(IncidentDispatch.status.not_in(["COMPLETED", "CANCELLED"]))
    )).scalars().all()
    started = 0
    for disp in rows:
        if disp.route_geometry and disp.id not in sim_service.active_ids():
            sim_service.start(
                disp.id, disp.patrol_id, disp.route_geometry["coordinates"],
                disp.duration_sec or 60, on_move=corridor_service.activate_near,
            )
            started += 1
    return {"ok": True, "started": started}


@router.post("/dispatch/stop-all")
async def stop_all(
    principal: Principal = Depends(get_principal),
) -> dict:
    """Cancel every running simulation and reset the green corridor."""
    _guard(principal)
    sim_service.stop_all()
    return {"ok": True}
```

---

## 4) INSERT — `frontend/src/lib/api/responseOps.ts`

Two small inserts (no other lines change).

**4a.** Add the `ActiveDispatch` type. Find:

```ts
export type Signal = { id: number; junction_id: string; lat: number; lng: number; state: "NORMAL" | "GREEN" };
```

and insert **above** it:

```ts
export type ActiveDispatch = {
  dispatchId: number; patrolId: number; callsign?: string;
  lat: number; lng: number; status: string; phase: string;
  eta_sec: number; progress: number; sceneLat?: number | null; sceneLng?: number | null;
};
```

**4b.** Add three methods to the `responseOps` object. Find:

```ts
  simulate: (id: number) => opsFetch<{ ok: boolean }>(`/dispatch/${id}/simulate`, { method: "POST" }),
```

and insert **directly after** it:

```ts
  activeDispatches: () => opsFetch<{ active: ActiveDispatch[] }>("/dispatch/active"),
  simulateAll: () => opsFetch<{ ok: boolean; started: number }>("/dispatch/simulate-all", { method: "POST" }),
  stopAll: () => opsFetch<{ ok: boolean }>("/dispatch/stop-all", { method: "POST" }),
```

---

## 5) EDIT — `frontend/src/components/CrimeMap.tsx`

Three edits: add the `corridorPath` prop, then add the corridor-glow + pulse-keyframe effects and swap the live marker for an animated vehicle.

**5a.** In the destructured props, find:

```tsx
  routePath,
  liveMarker,
}: {
```

replace with:

```tsx
  routePath,
  liveMarker,
  corridorPath,
}: {
```

**5b.** In the props type, find:

```tsx
  routePath?: Hotspot[];
  liveMarker?: Hotspot | null;
}) {
```

replace with:

```tsx
  routePath?: Hotspot[];
  liveMarker?: Hotspot | null;
  corridorPath?: [number, number][];
}) {
```

**5c.** Replace the existing live-marker effect. Find the block that starts with `// --- Response-Ops: single live patrol marker that PANS, never hard-zooms ---` (the `liveMarkerRef` effect ending in `}, [liveMarker, ready]);`) and replace the **entire block** with:

```tsx
  // --- Response-Ops: green-corridor glow (3-layer polyline along the route) ---
  const corridorRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (corridorRef.current) { map.removeLayer(corridorRef.current); corridorRef.current = null; }
    if (!corridorPath || corridorPath.length < 2) return;
    const latlngs = corridorPath as [number, number][];
    const group = L.layerGroup();
    L.polyline(latlngs, { color: "#00C896", weight: 16, opacity: 0.18 }).addTo(group);
    L.polyline(latlngs, { color: "#00C896", weight: 8, opacity: 0.4 }).addTo(group);
    L.polyline(latlngs, { color: "#00E6A8", weight: 3, opacity: 0.95 }).addTo(group);
    group.addTo(map);
    corridorRef.current = group;
    try { map.fitBounds(L.latLngBounds(latlngs).pad(0.2)); } catch {}
    return () => { if (corridorRef.current) { map.removeLayer(corridorRef.current); corridorRef.current = null; } };
  }, [corridorPath, ready]);

  // --- Response-Ops: pulse keyframes injected once (for the live marker) ---
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("ops-pulse-kf")) return;
    const st = document.createElement("style");
    st.id = "ops-pulse-kf";
    st.textContent = "@keyframes opspulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.8);opacity:0}}";
    document.head.appendChild(st);
  }, []);

  // --- Response-Ops: single live patrol marker (animated vehicle) that PANS ---
  const liveMarkerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (!liveMarker) {
      if (liveMarkerRef.current) { map.removeLayer(liveMarkerRef.current); liveMarkerRef.current = null; }
      return;
    }
    const ll: [number, number] = [liveMarker.lat, liveMarker.lng];
    if (!liveMarkerRef.current) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px">`
          + `<span style="position:absolute;width:30px;height:30px;border-radius:9999px;background:#00C89644;animation:opspulse 1.4s ease-out infinite"></span>`
          + `<span style="position:relative;font-size:20px;line-height:1">\uD83D\uDE93</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      });
      liveMarkerRef.current = L.marker(ll, { icon }).addTo(map);
      if (liveMarker.label) liveMarkerRef.current.bindTooltip(liveMarker.label);
    } else {
      liveMarkerRef.current.setLatLng(ll);
    }
    if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: true });
  }, [liveMarker, ready]);
```

---

## 6) REPLACE — `frontend/src/components/ops/DispatchPanel.tsx`

Replace the whole file with:
```tsx
import { useEffect, useRef, useState } from "react";
import { Truck, Navigation, Radio, Square, Zap } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, openOpsSocket, type Patrol, type ActiveDispatch } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

const PHASES = [
  { key: "ACCEPTED", label: "Accepted" },
  { key: "EN_ROUTE", label: "En route" },
  { key: "ON_SCENE", label: "On scene" },
  { key: "COMPLETED", label: "Cleared" },
] as const;

function phaseIndex(p: string): number {
  const i = PHASES.findIndex((x) => x.key === p);
  return i < 0 ? 0 : i;
}

function PhaseTimeline({ phase }: { phase: string }) {
  const active = phaseIndex(phase);
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => (
        <div key={p.key} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                i < active
                  ? "border-[#00C896] bg-[#00C896]"
                  : i === active
                  ? "border-[#2563eb] bg-[#91C5FD]"
                  : "border-muted-foreground/40 bg-background"
              }`}
            />
            <span
              className={`mt-0.5 text-[8px] font-bold leading-none ${
                i === active ? "text-foreground" : "text-muted-foreground/60"
              }`}
            >
              {p.label}
            </span>
          </div>
          {i < PHASES.length - 1 && (
            <div className={`mx-0.5 h-0.5 w-4 ${i < active ? "bg-[#00C896]" : "bg-muted-foreground/30"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

type Corridor = {
  routeCoords: [number, number][];
  signals: { junctionId: string; lat: number; lng: number }[];
  message: string;
} | null;

export function DispatchPanel() {
  const t = useT();
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [active, setActive] = useState<ActiveDispatch[]>([]);
  const [live, setLive] = useState<{ lat: number; lng: number; etaSec: number } | null>(null);
  const [scene, setScene] = useState({ lat: 12.9352, lng: 77.6245 });
  const [signals, setSignals] = useState<{ id: number; junction_id: string; lat: number; lng: number; state: string }[]>([]);
  const [corridor, setCorridor] = useState<Corridor>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshActive = () =>
    responseOps.activeDispatches().then((r) => setActive(r.active)).catch(() => {});

  useEffect(() => { responseOps.patrols().then(setPatrols); }, []);
  useEffect(() => { responseOps.signals().then(setSignals); }, []);
  useEffect(() => {
    refreshActive();
    const id = setInterval(refreshActive, 2500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "PATROL_LOCATION") {
        setLive({ lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec });
        setActive((prev) => {
          const i = prev.findIndex((a) => a.dispatchId === msg.dispatchId);
          if (i < 0) { refreshActive(); return prev; }
          const next = [...prev];
          next[i] = {
            ...next[i], lat: msg.lat, lng: msg.lng, eta_sec: msg.etaSec,
            progress: msg.progress ?? next[i].progress, phase: msg.phase ?? next[i].phase, status: "EN_ROUTE",
          };
          return next;
        });
      }
      if (msg.type === "DISPATCH_STATUS") {
        setActive((prev) => prev.map((a) =>
          a.dispatchId === msg.dispatchId ? { ...a, status: msg.status, phase: msg.phase ?? msg.status } : a));
        if (msg.status === "COMPLETED") {
          setLive(null);
          responseOps.patrols().then(setPatrols);
          setTimeout(refreshActive, 300);
        }
      }
      if (msg.type === "SIGNAL_GREEN") {
        setSignals((prev) => prev.map((s) => (s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s)));
      }
      if (msg.type === "SIGNAL_RESET") {
        setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      }
      if (msg.type === "GREEN_CORRIDOR_ACTIVE") {
        setCorridor({ routeCoords: msg.routeCoords ?? [], signals: msg.signals ?? [], message: msg.message ?? "" });
      }
      if (msg.type === "GREEN_CORRIDOR_DEACTIVATED") {
        setCorridor(null);
      }
    };
    return () => ws.close();
  }, []);

  async function dispatchNearest() {
    const d = await responseOps.dispatch({ scene_lat: scene.lat, scene_lng: scene.lng });
    setLive(null);
    await responseOps.simulate(d.id);
    refreshActive();
  }
  async function simulateAll() { await responseOps.simulateAll(); refreshActive(); }
  async function stopAll() { await responseOps.stopAll(); setLive(null); setCorridor(null); refreshActive(); }

  const patrolPoints: Hotspot[] = patrols
    .map((p) => ({ lat: p.lat ?? 0, lng: p.lng ?? 0, weight: 1, label: `${p.callsign} (${p.status})` }))
    .filter((p) => p.lat && p.lng);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* LEFT: controls + active dispatches */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={simulateAll}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 text-xs font-bold">
            <Radio className="h-3.5 w-3.5" /> {t("Simulate All")}
          </button>
          <button onClick={stopAll}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1.5 text-xs font-bold hover:bg-muted">
            <Square className="h-3.5 w-3.5" /> {t("Stop All")}
          </button>
        </div>

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

        <h3 className="text-sm font-extrabold">{t("Active Dispatches")} ({active.length})</h3>
        {active.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("No active dispatches. Use Simulate All or dispatch a unit.")}</p>
        )}
        {active.map((a) => (
          <div key={a.dispatchId} className="rounded-[8px] border-2 border-foreground bg-background p-3 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 font-extrabold"><Truck className="h-4 w-4" /> {a.callsign}</span>
              <span
                className={`rounded-[4px] px-2 py-0.5 text-[10px] font-bold ${
                  a.status === "EN_ROUTE"
                    ? "bg-[var(--main,#91C5FD)] text-foreground"
                    : a.status === "ON_SCENE"
                    ? "bg-warning text-foreground"
                    : a.status === "COMPLETED"
                    ? "bg-success/20 text-success"
                    : "bg-muted"
                }`}
              >
                {a.status === "EN_ROUTE" ? t("ACTIVE") : a.status}
              </span>
            </div>
            <div className="mb-2"><PhaseTimeline phase={a.phase} /></div>
            <div className="mb-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-[var(--main,#91C5FD)] transition-all"
                  style={{ width: `${Math.round((a.progress ?? 0) * 100)}%` }} />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
                {Math.round((a.progress ?? 0) * 100)}%
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("ETA")} {a.eta_sec > 60 ? `${Math.ceil(a.eta_sec / 60)}m` : `${a.eta_sec}s`}
            </div>
          </div>
        ))}
      </div>

      {/* RIGHT: live tracking map */}
      <div className="relative h-[560px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap
          points={patrolPoints}
          mode="pins"
          corridorPath={corridor?.routeCoords ?? undefined}
          liveMarker={live ? { lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") } : null}
          signals={signals}
        />

        {/* Map legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-[6px] border-2 border-foreground bg-background/90 px-3 py-2 text-[10px] font-bold shadow">
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-[#00C896]" /> {t("Green corridor")}</div>
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" /> {t("Patrol unit")}</div>
          <div className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" /> {t("Signal")}</div>
        </div>

        {/* Green corridor floating panel */}
        {corridor && (
          <div className="absolute right-3 top-3 z-[1000] w-56 rounded-[8px] border-2 border-foreground bg-background/95 p-3 shadow">
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00C896]" />
              <span className="text-xs font-extrabold text-[#0a8f6b]">{t("Green Corridor")}</span>
              <span className="ml-auto rounded-[4px] bg-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-foreground">{t("ACTIVE")}</span>
            </div>
            <p className="mb-2 text-[10px] text-muted-foreground">{corridor.message}</p>
            <div className="mb-2 text-[10px] font-bold text-muted-foreground">{t("ACTIVE SIGNALS")}</div>
            <div className="flex flex-wrap gap-1">
              {corridor.signals.slice(0, 8).map((s) => (
                <span key={s.junctionId} className="rounded-[4px] border-2 border-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-[#0a8f6b]">
                  🚦 {s.junctionId}
                </span>
              ))}
            </div>
            <button onClick={stopAll}
              className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-[11px] font-bold hover:bg-muted">
              <Square className="h-3 w-3" /> {t("Deactivate Corridor")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## How it maps to the screenshots

- **Active Dispatches column + phase timeline + progress + ETA** → driven by `GET /dispatch/active` (polled every 2.5s) merged with live `PATROL_LOCATION` / `DISPATCH_STATUS` events that now carry `phase`.
- **Simulate All / Stop All header controls** → `POST /dispatch/simulate-all` (starts every routed, unfinished dispatch) and `POST /dispatch/stop-all`.
- **Green corridor route glow + floating signal panel** → the unit lights its whole route up-front at `EN_ROUTE` via `corridor_service.activate_corridor`, which emits `GREEN_CORRIDOR_ACTIVE` with the route + activated signals; the panel + 3-layer green polyline render from that event and clear on `GREEN_CORRIDOR_DEACTIVATED` (sent on arrival/cancel).
- **Animated vehicle on a live map + legend** → `CrimeMap` now renders a pulsing 🚓 marker that pans along the route, plus a corner legend.

## Domain note

Satyam is a **police** deployment, so the simulation is a single leg (**patrol → scene**) with phases `ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED`. EMERGE's ambulance-specific second leg (→ hospital) is intentionally omitted; everything else mirrors the EMERGE visuals.

## Apply & verify (sandbox-validated)

```bash
# backend (from backend/)
python -m py_compile app/services/ops/sim_service.py \
  app/services/ops/corridor_service.py app/api/routes/ops.py

# frontend (from frontend/)
npm run build      # or: npx tsc --noEmit
```

## Runtime gates (unchanged — all four still required to SEE it)

1. `backend/.env` → `ENABLE_RESPONSE_OPS=true`
2. Seed ops data: `python -m seed.init_ops --reset`
3. Log in as an **L2+** rank (RUN_ANALYTICS clearance)
4. Open **Operations → Dispatch**, then click **Simulate All** (or dispatch a unit)

> If the Operations tab is empty, it's almost always gate #1 or #2 — not the code.
