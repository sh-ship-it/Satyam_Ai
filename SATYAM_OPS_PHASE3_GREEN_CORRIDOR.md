# Phase 3 — Green Corridor (signals turn green on the patrol's route)

**Goal:** Port EMERGE's `greenCorridor.js` to Python and wire it into the Phase 2 simulation: as the patrol moves toward a confirmed crime scene, traffic signals within `ACTIVATION_RADIUS_KM` flip to **GREEN** and broadcast `SIGNAL_GREEN`; on arrival they reset to **NORMAL**. Requires Phase 0 + Phase 2 (+ signals from the Phase 0 seed).

---

## 1. NEW — `backend/app/services/ops/corridor_service.py`

```python
"""Green corridor — Python port of EMERGE greenCorridor.js.

Flips ops_traffic_signals to GREEN within ACTIVATION_RADIUS_KM of a moving patrol
and broadcasts SIGNAL_GREEN; reset_all() restores NORMAL on arrival.
"""
from __future__ import annotations

from sqlalchemy import select, update

from app.db.ops_models import TrafficSignal
from app.db.session import get_sessionmaker
from app.services.ops.routing_service import haversine_km
from app.services.ops.ws_manager import manager

ACTIVATION_RADIUS_KM = 0.3  # mirrors EMERGE


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
```

---

## 2. EDIT — `backend/app/services/ops/sim_service.py` (hook the corridor into movement)

The `_run` loop already accepts an `on_move` hook and calls it each tick; the `simulate` endpoint just needs to pass the corridor activator, and `_run` should reset signals on arrival. Make two small additions:

**(a)** Add the import at the top:

```python
from app.services.ops import corridor_service
```

**(b)** In `_run`, after the `ON_SCENE` broadcast (arrival), reset signals:

```python
        await corridor_service.reset_all()
```

*(place it right after `await manager.broadcast({"type": "DISPATCH_STATUS", ... "ON_SCENE"})`)*

> The per-tick activation is driven by the `on_move` callback passed from the route handler (step 3), so `sim_service` stays decoupled from corridor logic except for the arrival reset.

---

## 3. EDIT — `backend/app/api/routes/ops.py` (pass the corridor hook + expose signals)

Add import:

```python
from app.db.ops_models import TrafficSignal
from app.services.ops import corridor_service
```

Change the `simulate` endpoint's `sim_service.start(...)` call to pass the activator as `on_move`:

```python
    sim_service.start(
        dispatch_id, disp.patrol_id, coords, disp.duration_sec or 60,
        on_move=corridor_service.activate_near,
    )
```

Add a signals endpoint for the map overlay:

```python
@router.get("/signals")
async def signals(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[dict]:
    _guard(principal)
    rows = (await session.execute(select(TrafficSignal))).scalars().all()
    return [{"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state} for s in rows]
```

---

## 4. EDIT — `frontend/src/lib/api/responseOps.ts` (append)

```ts
export type Signal = { id: number; junction_id: string; lat: number; lng: number; state: "NORMAL" | "GREEN" };

Object.assign(responseOps, {
  signals: () => opsFetch<Signal[]>("/signals"),
});
```

---

## 5. EDIT — `frontend/src/components/ops/DispatchPanel.tsx` (render signals + react to WS)

The Dispatch panel already holds the WebSocket. Extend it to load signals and recolor them on `SIGNAL_GREEN` / `SIGNAL_RESET`. Add state + load, and handle the new event types in the existing `ws.onmessage`:

```tsx
  const [signals, setSignals] = useState<{ id: number; junction_id: string; lat: number; lng: number; state: string }[]>([]);
  useEffect(() => { responseOps.signals().then(setSignals); }, []);
```

Inside the existing `ws.onmessage` handler, add:

```tsx
      if (msg.type === "SIGNAL_GREEN") {
        setSignals((prev) => prev.map((s) => s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s));
      }
      if (msg.type === "SIGNAL_RESET") {
        setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      }
```

Then pass signals to the map as a second marker set. The simplest non-invasive way is a small dedicated overlay prop; reuse `focus` for the live patrol and add green/again-normal junction markers via a tiny extra layer. Add this optional prop to `CrimeMap` (step 6) and pass:

```tsx
        signals={signals}
```

(in the `<CrimeMap ... />` element).

---

## 6. EDIT — `frontend/src/components/CrimeMap.tsx` (additive optional `signals` prop)

Add `signals` to the prop type (all optional — existing callers unaffected):

```tsx
  signals,
}: {
  points: Hotspot[];
  mode?: Mode;
  trail?: Hotspot[];
  animateKey?: number;
  focus?: Hotspot[] | null;
  signals?: { id: number; junction_id: string; lat: number; lng: number; state: string }[];
}) {
```

Add a draw effect (green dot when GREEN, gray when NORMAL):

```tsx
  const signalLayerRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (signalLayerRef.current) { map.removeLayer(signalLayerRef.current); signalLayerRef.current = null; }
    if (!signals || signals.length === 0) return;
    const group = L.layerGroup();
    signals.forEach((s) => {
      L.circleMarker([s.lat, s.lng], {
        radius: 6,
        color: "#1a1a1a",
        weight: 2,
        fillColor: s.state === "GREEN" ? "#00C896" : "#9ca3af",
        fillOpacity: 0.95,
      }).bindTooltip(`${s.junction_id} · ${s.state}`).addTo(group);
    });
    group.addTo(map);
    signalLayerRef.current = group;
  }, [signals, ready]);
```

---

## 7. Verify

```bash
uvicorn app.main:app --reload
# GET /api/ops/signals -> [{junction_id, state:"NORMAL"}, ...]
# Dispatch + simulate (Phase 2) -> watch SIGNAL_GREEN events as the patrol passes junctions,
#                                  then SIGNAL_RESET on ON_SCENE.
```

Response Ops → **Dispatch & Tracking**: junction dots turn green as the patrol approaches within 300 m, and reset to gray on arrival. (Green Corridor tab can show the same map plus a signal status list — optional.)

## Self-rating
- **Fit: 9/10** — exact port; the crime reframe (police racing to a confirmed scene) justifies the corridor cleanly.
- **Correctness: 9/10** — reuses Phase 2 WS + `haversine_km`; only additive optional props on `CrimeMap`.
- **Caveat:** real traffic-signal control is obviously simulated here (no ITMS integration) — present it as a demo/decision-support overlay, exactly as EMERGE does.
