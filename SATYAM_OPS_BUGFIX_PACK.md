# Satyam Response-Ops — Bug-Fix Pack (drop-in)

## Prompt for your coding agent

> You are editing the **Satyam_Ai** repo. Apply the edits in this file **exactly as written** — they are surgical `old → new` replacements. Do **not** refactor, rename, or reformat anything else. Every change is additive or a minimal in-place fix. After applying, run the **Verify** block at the bottom. Files touched: `backend/app/api/routes/ops.py`, `backend/app/services/ops/sim_service.py`, `backend/app/services/ops/routing_service.py`, `backend/seed/init_ops.py`, `frontend/src/components/CrimeMap.tsx`, `frontend/src/components/ops/DispatchPanel.tsx`, `frontend/src/components/ops/ReviewPanel.tsx`, `frontend/src/routes/operations.tsx`.

---

## Bugs found (this pass)

| # | Severity | Bug | File |
|---|---|---|---|
| 1 | 🔴 HIGH | Patrol **never marked busy** on dispatch and **never returns to IDLE** after arrival → same unit gets double-dispatched and then stuck `ON_SCENE` forever | `ops.py`, `sim_service.py` |
| 2 | 🔴 HIGH | `dispatch` with an explicit `patrol_id` whose `lat/lng` is NULL → `get_route` builds `None,None` URL → fallback `haversine_km(None…)` → **500 crash** (the “never raises” promise is false) | `ops.py`, `routing_service.py` |
| 3 | 🔴 HIGH | Camera-confirm `Case` INSERT uses `station_id = principal.station_id or 0`; `cases.station_id` is a **NOT-NULL FK** → FK violation if the officer JWT has no station | `ops.py` |
| 4 | 🔴 HIGH | `confirm_item` returns `dispatch_id` but `ReviewPanel` **ignores it** → the auto-dispatch is created but **never simulated/animated**, and the unit is left in a half-state | `ReviewPanel.tsx` |
| 5 | 🟡 MED | Live map **renders the route twice** (animated red offender-trail + blue line) and **re-zooms every GPS tick** because `trail`/`focus`/`animateKey` are overloaded | `CrimeMap.tsx`, `DispatchPanel.tsx` |
| 6 | 🟡 MED | `DispatchPanel` WS effect keyed on `[active?.id]` → **reconnects the socket on every dispatch** (drops events during the gap) + stale-closure on `active` | `DispatchPanel.tsx` |
| 7 | 🟡 MED | **“Green Corridor” tab is dead** — shows “Coming in a later phase” even though the corridor is fully implemented (it renders on the Dispatch map) | `operations.tsx` |
| 8 | 🟡 MED | `suggestions` orders by `response_improve_sec.desc()` → on Postgres `DESC` puts **NULLs first**, so empty suggestions float to the top | `ops.py` |
| 9 | 🟡 MED | `init_ops` has **no `--reset`** — the demo script tells you to run `python -m seed.init_ops --reset`, but the arg is silently ignored, so stuck units can’t be cleared between runs | `init_ops.py` |

*(Low/noted, no code change required: ETA never quite hits 0 before arrival — now fixed implicitly by the lifecycle hold; and the WS endpoint validates the JWT signature but doesn’t re-check `RUN_ANALYTICS` — acceptable for the demo.)*

---

# Backend fixes

## FIX 1 + 2 + 3 + 8 — `backend/app/api/routes/ops.py`

### 1a. Import `Station` (needed by FIX 3)
```python
# OLD
from app.db.models import Case
```
```python
# NEW
from app.db.models import Case, Station
```

### 8. Suggestions: NULLs last
```python
# OLD
        .where(PatrolSuggestion.status == "PENDING")
        .order_by(PatrolSuggestion.response_improve_sec.desc())
```
```python
# NEW
        .where(PatrolSuggestion.status == "PENDING")
        .order_by(PatrolSuggestion.response_improve_sec.is_(None),
                  PatrolSuggestion.response_improve_sec.desc())
```

### 2. Guard null patrol coords in `dispatch`
```python
# OLD
    if not patrol:
        raise HTTPException(status_code=409, detail="no available patrol unit")

    route = await routing_service.get_route(
```
```python
# NEW
    if not patrol:
        raise HTTPException(status_code=409, detail="no available patrol unit")
    if patrol.lat is None or patrol.lng is None:
        raise HTTPException(status_code=409, detail="selected patrol has no location")

    route = await routing_service.get_route(
```

### 1 (part A). Mark the unit busy when a dispatch is created (manual path)
```python
# OLD
    session.add(disp)
    await session.flush()
    return DispatchOut(
```
```python
# NEW
    session.add(disp)
    await session.flush()
    await session.execute(
        update(PatrolUnit).where(PatrolUnit.id == patrol.id).values(status="EN_ROUTE")
    )
    return DispatchOut(
```

### 3 + 1 (part B). Camera-confirm: valid station FK + mark unit busy
```python
# OLD
    # Create a minimal case row from the confirmed incident.
    today = dt.date.today()
    new_case = Case(
        fir_number=f"CCTV-{item.id}", fir_year=today.year,
        station_id=principal.station_id or 0,
        station_name="", district=principal.district or "", range_name=principal.range_name or "",
        crime_type="CCTV-detected incident", crime_category="SLL", legal_code="BNS",
```
```python
# NEW
    # Create a minimal case row from the confirmed incident.
    today = dt.date.today()
    # station_id is a NOT-NULL FK -> resolve a valid station (officer's, else first seeded).
    sid = principal.station_id
    if not sid:
        sid = (await session.execute(select(Station.station_id).limit(1))).scalar()
    if not sid:
        raise HTTPException(status_code=409, detail="no station available to file case")
    sname = (await session.execute(
        select(Station.station_name).where(Station.station_id == sid)
    )).scalar() or ""
    new_case = Case(
        fir_number=f"CCTV-{item.id}", fir_year=today.year,
        station_id=sid,
        station_name=sname, district=principal.district or "", range_name=principal.range_name or "",
        crime_type="CCTV-detected incident", crime_category="SLL", legal_code="BNS",
```

```python
# OLD
            session.add(disp)
            await session.flush()
            dispatch_id = disp.id
```
```python
# NEW
            session.add(disp)
            await session.flush()
            await session.execute(
                update(PatrolUnit).where(PatrolUnit.id == patrol.id).values(status="EN_ROUTE")
            )
            dispatch_id = disp.id
```

---

## FIX 1 (part C) — `backend/app/services/ops/sim_service.py` (return unit to IDLE after arrival)

```python
# OLD
TICK_SEC = 0.8           # interval between coordinate steps
MAX_POINTS = 60          # subsample long routes to <= this many steps
```
```python
# NEW
TICK_SEC = 0.8           # interval between coordinate steps
MAX_POINTS = 60          # subsample long routes to <= this many steps
ON_SCENE_HOLD_SEC = 6    # keep unit ON_SCENE this long, then free it (-> IDLE)
```

```python
# OLD
        # arrived
        last_lng, last_lat = pts[-1]
        await _persist_status(dispatch_id, patrol_id, "ON_SCENE", last_lat, last_lng)
        _latest[dispatch_id] = {"lat": last_lat, "lng": last_lng, "status": "ON_SCENE", "eta_sec": 0}
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "ON_SCENE"})
        await corridor_service.reset_all()
```
```python
# NEW
        # arrived
        last_lng, last_lat = pts[-1]
        await _persist_status(dispatch_id, patrol_id, "ON_SCENE", last_lat, last_lng)
        _latest[dispatch_id] = {"lat": last_lat, "lng": last_lng, "status": "ON_SCENE", "eta_sec": 0}
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "ON_SCENE"})
        await corridor_service.reset_all()
        # Hold on-scene briefly, then free the unit so it can be dispatched again.
        await asyncio.sleep(ON_SCENE_HOLD_SEC)
        await _persist_status(dispatch_id, patrol_id, "COMPLETED", last_lat, last_lng)
        _latest[dispatch_id] = {"lat": last_lat, "lng": last_lng, "status": "COMPLETED", "eta_sec": 0}
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "COMPLETED"})
```
> Note: `_persist_status` already maps dispatch status `"COMPLETED" → PatrolUnit.status "IDLE"`, so this line both closes the dispatch and frees the unit.

---

## FIX 2 (hardening) — `backend/app/services/ops/routing_service.py` (fail fast, never crash on None)

```python
# OLD
async def get_route(*, from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> dict:
    """Return {provider, distance_km, duration_sec, coords:[[lng,lat],...]}. Never raises."""
    url = (f"{OSRM_BASE_URL}/route/v1/driving/"
```
```python
# NEW
async def get_route(*, from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> dict:
    """Return {provider, distance_km, duration_sec, coords:[[lng,lat],...]}.
    Raises ValueError on null coordinates (callers must guard); otherwise never raises."""
    if None in (from_lat, from_lng, to_lat, to_lng):
        raise ValueError("get_route requires non-null coordinates")
    url = (f"{OSRM_BASE_URL}/route/v1/driving/"
```

---

## FIX 9 — `backend/seed/init_ops.py` (add `--reset`)  — full file replacement

```python
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


async def main(reset: bool = False) -> None:
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
    await engine.dispose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="clear transient ops state before seeding")
    args = ap.parse_args()
    asyncio.run(main(reset=args.reset))
```

---

# Frontend fixes

## FIX 5 (part A) — `frontend/src/components/CrimeMap.tsx` (clean route + live marker props)

### Add two optional props (destructure)
```tsx
// OLD
  focus,
  signals,
}: {
```
```tsx
// NEW
  focus,
  signals,
  routePath,
  liveMarker,
}: {
```

### Add their types
```tsx
// OLD
  signals?: { id: number; junction_id: string; lat: number; lng: number; state: string }[];
}) {
```
```tsx
// NEW
  signals?: { id: number; junction_id: string; lat: number; lng: number; state: string }[];
  routePath?: Hotspot[];
  liveMarker?: Hotspot | null;
}) {
```

### Add two effects (insert right before the final `return`)
```tsx
// OLD
    group.addTo(map);
    signalLayerRef.current = group;
  }, [signals, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
```
```tsx
// NEW
    group.addTo(map);
    signalLayerRef.current = group;
  }, [signals, ready]);

  // --- Response-Ops: static dispatch route line (no animation, fits once) ---
  const routePathRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (routePathRef.current) { map.removeLayer(routePathRef.current); routePathRef.current = null; }
    if (!routePath || routePath.length < 2) return;
    const line = L.polyline(routePath.map((p: Hotspot) => [p.lat, p.lng]), {
      color: "#91C5FD", weight: 5, opacity: 0.9,
    }).addTo(map);
    routePathRef.current = line;
    map.fitBounds(line.getBounds().pad(0.2));
    return () => { if (routePathRef.current) { map.removeLayer(routePathRef.current); routePathRef.current = null; } };
  }, [routePath, ready]);

  // --- Response-Ops: single live patrol marker that PANS, never hard-zooms ---
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
      liveMarkerRef.current = L.circleMarker(ll, {
        radius: 9, color: "#0B5", weight: 3, fillColor: "#00C896", fillOpacity: 1,
      }).addTo(map);
      if (liveMarker.label) liveMarkerRef.current.bindTooltip(liveMarker.label);
    } else {
      liveMarkerRef.current.setLatLng(ll);
    }
    if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: true });
  }, [liveMarker, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
```
> The existing `trail`/`focus`/`animateKey` props are untouched — the offender-trail feature keeps working. We simply stop using them for dispatch.

---

## FIX 5 (part B) + 6 — `frontend/src/components/ops/DispatchPanel.tsx`

### Add an `activeRef` (kept in sync) under the existing refs
```tsx
// OLD
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => { responseOps.patrols().then(setPatrols); }, []);
```
```tsx
// NEW
  const wsRef = useRef<WebSocket | null>(null);
  const activeRef = useRef<DispatchResult | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => { responseOps.patrols().then(setPatrols); }, []);
```

### Subscribe to the WS once (no reconnect churn) + free unit on COMPLETED
```tsx
// OLD
  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "PATROL_LOCATION" && (!active || msg.dispatchId === active.id)) {
        setLive({ lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec });
      }
      if (msg.type === "SIGNAL_GREEN") {
        setSignals((prev) => prev.map((s) => s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s));
      }
      if (msg.type === "SIGNAL_RESET") {
        setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
```
```tsx
// NEW
  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const cur = activeRef.current;
      if (msg.type === "PATROL_LOCATION" && (!cur || msg.dispatchId === cur.id)) {
        setLive({ lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec });
      }
      if (msg.type === "DISPATCH_STATUS" && cur && msg.dispatchId === cur.id && msg.status === "COMPLETED") {
        setLive(null);
        responseOps.patrols().then(setPatrols);  // freed unit reappears as IDLE
      }
      if (msg.type === "SIGNAL_GREEN") {
        setSignals((prev) => prev.map((s) => s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s));
      }
      if (msg.type === "SIGNAL_RESET") {
        setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      }
    };
    return () => ws.close();
  }, []);
```

### Drop the unused `livePoint`, keep `routeLine`
```tsx
// OLD
  const livePoint: Hotspot[] = live ? [{ lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") }] : [];
  const routeLine: Hotspot[] = active ? active.route.map(([lng, lat]) => ({ lat, lng, weight: 1 })) : [];
```
```tsx
// NEW
  const routeLine: Hotspot[] = active ? active.route.map(([lng, lat]) => ({ lat, lng, weight: 1 })) : [];
```

### Use the new clean props on the map
```tsx
// OLD
        <CrimeMap points={patrolPoints} mode="pins" trail={routeLine} focus={livePoint} animateKey={live ? Date.now() : 0} signals={signals} />
```
```tsx
// NEW
        <CrimeMap
          points={patrolPoints}
          mode="pins"
          routePath={routeLine}
          liveMarker={live ? { lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") } : null}
          signals={signals}
        />
```

---

## FIX 4 — `frontend/src/components/ops/ReviewPanel.tsx` (confirm actually dispatches + animates)

```tsx
// OLD
  async function confirm(id: number) { await responseOps.confirmReview(id, true); setItems((p) => p.filter((i) => i.id !== id)); }
```
```tsx
// NEW
  async function confirm(id: number) {
    const res = await responseOps.confirmReview(id, true);
    setItems((p) => p.filter((i) => i.id !== id));
    // Kick off the live simulation for the auto-created dispatch (best-effort).
    if (res.dispatch_id) {
      try { await responseOps.simulate(res.dispatch_id); } catch { /* sim is best-effort */ }
    }
  }
```
> After confirming a candidate, switch to the **Dispatch & Green Corridor** tab to watch the unit move.

---

## FIX 7 — `frontend/src/routes/operations.tsx` (remove dead “Green Corridor” tab)

```tsx
// OLD
import { Siren, Radar, Truck, TrafficCone, Video } from "lucide-react";
```
```tsx
// NEW
import { Siren, Radar, Truck, Video } from "lucide-react";
```

```tsx
// OLD
type Tab = "predict" | "dispatch" | "corridor" | "review";
```
```tsx
// NEW
type Tab = "predict" | "dispatch" | "review";
```

```tsx
// OLD
  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Tracking"), icon: Truck },
    { id: "corridor", label: t("Green Corridor"), icon: TrafficCone },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];
```
```tsx
// NEW
  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Green Corridor"), icon: Truck },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];
```

```tsx
// OLD
          {tab === "predict" && <PredictivePanel />}
          {tab === "dispatch" && <DispatchPanel />}
          {tab === "review" && <ReviewPanel />}
          {tab !== "predict" && tab !== "dispatch" && tab !== "review" && (
            <p className="text-sm text-muted-foreground">{t("Coming in a later phase.")} ({tab})</p>
          )}
```
```tsx
// NEW
          {tab === "predict" && <PredictivePanel />}
          {tab === "dispatch" && <DispatchPanel />}
          {tab === "review" && <ReviewPanel />}
```

---

# Verify (run after applying)

```bash
# Backend: syntax must pass
cd backend
python -m py_compile app/api/routes/ops.py app/services/ops/sim_service.py \
  app/services/ops/routing_service.py seed/init_ops.py && echo PY_OK

# Reset works now
python -m seed.init_ops --reset

# Frontend: typecheck + build (no new errors)
cd ../frontend
npm run build
```

**Manual smoke (with `ENABLE_RESPONSE_OPS=true` + uvicorn + vite):**
1. Dispatch tab → **Dispatch nearest unit** → the unit shows **one** blue route line + a single green marker that **glides** (no zoom-bounce, no red dotted duplicate). ETA counts down; after arrival it holds ~6s then the unit reappears as **IDLE**.
2. Dispatch a second time → a **different** unit is chosen (no double-booking).
3. Camera Review → `POST /api/ops/detect/notify` (or YOLO) → **Confirm → file case** → a case is filed with a **valid station_id** and the auto-dispatch **animates** on the Dispatch tab.
4. Only three tabs show; there is no “Coming in a later phase” screen.

---

## Appendix A — Bug #10 (added in follow-up pass)

> Paste this section the same way as the rest of the pack: each block is an exact `old → new` replacement. Apply it to the **same `ops.py`** you edited for Bugs #1–#4.

### Bug #10 — [HIGH/SECURITY] Live WebSocket feed skips the RUN_ANALYTICS gate

**File:** `backend/app/api/routes/ops.py`

**Why it's a bug:** Every HTTP ops endpoint runs `_guard(principal)` → `require(principal, Permission.RUN_ANALYTICS)`, which needs clearance **L2+**. But the WebSocket handler only calls `decode_token(token)` and connects on *any* valid JWT. A clearance-L1 `viewer`/`HC`/`PC` token — blocked from `/risk-zones`, `/patrols`, `/dispatch`, etc. — can still open `/api/ops/ws?token=...` and stream live patrol GPS coordinates, scene locations, and green-corridor signal events. That leaks exactly the operational data RBAC is meant to scope. WS routes can't use `Depends(get_principal)` (no headers), so the principal has to be re-derived from the JWT claims and gated explicitly.

**Fix 1 — widen the rbac import** so we can rebuild a `Principal` from claims.

```python
# OLD
from app.core.rbac import AccessDenied, Permission, Principal, require
```

```python
# NEW
from app.core.rbac import AccessDenied, Permission, Principal, require, resolve_clearance, resolve_scope
```

**Fix 2 — enforce the same clearance gate before accepting the socket.**

```python
# OLD
    try:
        decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    await manager.connect(ws)
```

```python
# NEW
    try:
        claims = decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    # WS connections can't use Depends(get_principal) (no headers), so rebuild the
    # Principal from the JWT claims and enforce the same RUN_ANALYTICS gate (clearance
    # L2+) that every HTTP ops endpoint applies via _guard().
    rank = str(claims.get("rank") or claims.get("role") or "viewer")
    principal = Principal(
        id=str(claims.get("sub", "")),
        name=str(claims.get("name", "")),
        rank=rank,
        scope=str(claims.get("scope") or resolve_scope(rank)),
        clearance=int(claims.get("clearance") or resolve_clearance(rank)),
    )
    if not principal.has(Permission.RUN_ANALYTICS):
        await ws.close(code=4403)
        return
    await manager.connect(ws)
```

**Verify:**

```bash
cd backend && python -m py_compile app/api/routes/ops.py && echo OK
```

Manual: log in as a clearance-L1 user (e.g. `viewer`/`PC`), grab the token, and try to open `ws://localhost:8000/api/ops/ws?token=$TOK` — it must close with code `4403`. An L2+ token (e.g. `SI`/`analyst`) must stay connected and receive `PATROL_LOCATION` events.

---

## Appendix B — reviewed & intentionally NOT changed (safe at demo scale)

These came up in the second pass but are **not** worth code changes for the datathon build — listed so you know they were considered:

- **ETA never hits 0 before arrival.** Already resolved implicitly by Bug #1's on-scene hold + `COMPLETED` broadcast (`eta_sec: 0`). No separate fix needed.
- **`corridor_service.activate_near` opens a session + scans all signals every 0.8s tick.** Correct and cheap at demo signal counts (tens of rows). Caching would risk stale `state` reads vs. `reset_all()`. Leave as-is unless you scale to thousands of junctions.
- **`corridor_service`/`sim_service` use `get_sessionmaker()` directly (unscoped, no RLS).** Intentional — background tasks have no request principal, and ops tables are jurisdiction-agnostic operational data. Acceptable.
