# SATYAM — Response-Ops Parity Pack (match the EMERGE-AI demo)

**Goal:** make Satyam's **Response Ops** screen actually show and behave like the EMERGE-AI reference you recorded — the **Demo Simulation** (units animating to their destination), the **Green Corridor** (signals flipping green + a side panel with *Deactivate Corridor*), a **Live Event Feed**, and a runnable **YOLO live CCTV** detector started with your exact command:

```
cd model
venv\Scripts\activate
python inference/live_cctv.py
```

> **How to apply:** hand this whole file to your coding agent. Every change is either a full new file or an exact `OLD → NEW` string replacement against the **current** `Satyam_Ai-main` build. Anchors were copied verbatim from your uploaded zip, so each `OLD` block is unique and applies cleanly.

---

## 0. Why nothing was showing (root cause — read this first)

Three concrete reasons, all fixed by this pack:

1. **The module is OFF by default.** `backend/app/config.py` ships `enable_response_ops: bool = False`, and `backend/app/main.py` only mounts the routes when it's true:
   ```python
   if settings.enable_response_ops:
       app.include_router(ops_routes.router, prefix="/api/ops", tags=["response-ops"])
   ```
   Your `.env.example` **never mentions this flag**, so a normal setup leaves every `/api/ops/*` call returning 404 and the screen blank. → **Part 1.**
2. **No demo experience / no data.** Even with the flag on, the UI was 3 plain tabs and the DB had no patrols/signals. → **Parts 2–3** add the rich Demo Simulation UI + seed step.
3. **The YOLO entrypoint your command expects doesn't exist.** The build has `ai_camera/detect_video.py`, not `model/inference/live_cctv.py`. → **Part 4** creates it.

---

## 1. Turn the module ON (this alone un-hides the whole feature)

### 1a. Add the flag to your real env file
In **`backend/.env`** (the live file you actually run with — create it from `.env.example` if missing) add:

```
ENABLE_RESPONSE_OPS=true
```

### 1b. Document it in `.env.example` so it never gets lost again
**File:** `backend/.env.example`

**OLD**
```
CORS_ORIGINS=http://localhost:3000

# Overall compute plane: api | local
MODEL_BACKEND=api
```

**NEW**
```
CORS_ORIGINS=http://localhost:3000

# Response-Ops module (EMERGE-derived: predictive deployment, dispatch, green
# corridor, CCTV review). MUST be true or /api/ops/* and the Response Ops screen
# will NOT exist. This is the #1 reason the decided features were not showing.
ENABLE_RESPONSE_OPS=true

# Overall compute plane: api | local
MODEL_BACKEND=api
```

### 1c. Seed the demo data and (re)start
From `backend/` with your venv active:
```
python -m seed.init_ops --reset     # patrols (Hoysala/Cheetah), 5 signals, 2 cameras
# optional but recommended so Predictive risk-zones populate from real cases:
python -m seed.geocode_cases        # only if you added this earlier; skip if absent
uvicorn app.main:app --reload
```
Then reload the frontend and open **Response Ops** in the sidebar. You must be logged in as an officer with clearance **L2+** (e.g. SP/DCP-level demo account) — every `/api/ops/*` route is gated by `RUN_ANALYTICS`. A plain `viewer` will get 403 and see an empty screen.

---

## 2. Backend — Green-Corridor control + live simulation snapshot

The backend already animates a unit along its route (`sim_service`) and flips signals green (`corridor_service`). We add three small read/control endpoints the demo dashboard needs: corridor **state**, corridor **reset** (the *Deactivate* button), and a live **active simulations** snapshot.

### 2a. `corridor_service.state()`
**File:** `backend/app/services/ops/corridor_service.py`

**OLD**
```python
async def reset_all() -> None:
```

**NEW**
```python
async def state() -> dict:
    """Current green-corridor status for the dashboard side panel."""
    sm = get_sessionmaker()
    async with sm() as db:
        rows = (await db.execute(select(TrafficSignal))).scalars().all()
    greens = [s for s in rows if s.state == "GREEN"]
    return {
        "active": len(greens) > 0,
        "count": len(greens),
        "signals": [
            {"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state}
            for s in greens
        ],
    }


async def reset_all() -> None:
```

### 2b. `sim_service.active_states()`
**File:** `backend/app/services/ops/sim_service.py`

**OLD**
```python
def latest_state(dispatch_id: int) -> dict | None:
    return _latest.get(dispatch_id)
```

**NEW**
```python
def latest_state(dispatch_id: int) -> dict | None:
    return _latest.get(dispatch_id)


def active_states() -> list[dict]:
    """Latest position/status for every simulation still running."""
    return [
        {"dispatchId": did, **_latest[did]}
        for did in list(_running.keys())
        if did in _latest
    ]


def active_ids() -> list[int]:
    """IDs of simulations still running (used by Stop All)."""
    return list(_running.keys())
```

### 2b-2. Free the unit + announce when a sim is cancelled (makes *Stop All* real)
**File:** `backend/app/services/ops/sim_service.py`

Without this, cancelling a sim leaves its patrol stuck in `EN_ROUTE` (the status map has no `CANCELLED` entry, so it falls through to the `EN_ROUTE` default) and the UI never hears about the cancel.

**OLD**
```python
            vals: dict = {"status": {"COMPLETED": "IDLE", "ON_SCENE": "ON_SCENE"}.get(status, "EN_ROUTE")}
```
**NEW**
```python
            vals: dict = {"status": {"COMPLETED": "IDLE", "CANCELLED": "IDLE", "ON_SCENE": "ON_SCENE"}.get(status, "EN_ROUTE")}
```

**OLD**
```python
    except asyncio.CancelledError:
        await _persist_status(dispatch_id, patrol_id, "CANCELLED")
        raise
```
**NEW**
```python
    except asyncio.CancelledError:
        await _persist_status(dispatch_id, patrol_id, "CANCELLED")
        await manager.broadcast({"type": "DISPATCH_STATUS", "dispatchId": dispatch_id, "status": "CANCELLED"})
        raise
```

### 2c. New routes in `ops.py`
**File:** `backend/app/api/routes/ops.py`

Insert right after the `/signals` endpoint (anchor on its return line + the `LOW_CONF` block that follows).

**OLD**
```python
    rows = (await session.execute(select(TrafficSignal))).scalars().all()
    return [{"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state} for s in rows]


LOW_CONF = 0.5
```

**NEW**
```python
    rows = (await session.execute(select(TrafficSignal))).scalars().all()
    return [{"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state} for s in rows]


@router.get("/corridor/state")
async def corridor_state(principal: Principal = Depends(get_principal)) -> dict:
    """Green-corridor status for the Demo dashboard side panel."""
    _guard(principal)
    return await corridor_service.state()


@router.post("/corridor/reset")
async def corridor_reset(principal: Principal = Depends(get_principal)) -> dict:
    """Deactivate the green corridor — restore every signal to NORMAL."""
    _guard(principal)
    await corridor_service.reset_all()
    return {"ok": True}


@router.get("/demo/active")
async def demo_active(principal: Principal = Depends(get_principal)) -> dict:
    """Live snapshot of every running simulation (polling fallback for the dashboard)."""
    _guard(principal)
    return {"active": sim_service.active_states()}


@router.post("/demo/stop-all")
async def demo_stop_all(principal: Principal = Depends(get_principal)) -> dict:
    """Stop All: cancel every running simulation and clear the green corridor."""
    _guard(principal)
    ids = sim_service.active_ids()
    for did in ids:
        sim_service.stop(did)
    await corridor_service.reset_all()
    return {"stopped": len(ids)}


LOW_CONF = 0.5
```

> `corridor_service`, `sim_service`, `select`, `TrafficSignal`, `Principal`, `Depends`, `get_principal` are all already imported at the top of `ops.py` — no new imports needed.

---

## 3. Frontend — the EMERGE-style "Demo Simulation" experience

### 3a. `CrimeMap` — add multi-unit + multi-route layers (additive, safe)
The map already supports a single `liveMarker` + single `routePath`. The demo runs several units at once, so we add `liveMarkers` (array) and `routePaths` (array of routes). Existing props are untouched.

**File:** `frontend/src/components/CrimeMap.tsx`

**OLD (1/3 — destructured params)**
```tsx
  signals,
  routePath,
  liveMarker,
}: {
```
**NEW (1/3)**
```tsx
  signals,
  routePath,
  liveMarker,
  liveMarkers,
  routePaths,
}: {
```

**OLD (2/3 — prop types)**
```tsx
  routePath?: Hotspot[];
  liveMarker?: Hotspot | null;
}) {
```
**NEW (2/3)**
```tsx
  routePath?: Hotspot[];
  liveMarker?: Hotspot | null;
  liveMarkers?: Hotspot[];
  routePaths?: Hotspot[][];
}) {
```

**OLD (3/3 — insert two effects before the final return)**
```tsx
    if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: true });
  }, [liveMarker, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
```
**NEW (3/3)**
```tsx
    if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: true });
  }, [liveMarker, ready]);

  // --- Response-Ops: many live vehicle markers (Demo Simulation) ---
  const liveMarkersRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (liveMarkersRef.current) { map.removeLayer(liveMarkersRef.current); liveMarkersRef.current = null; }
    if (!liveMarkers || liveMarkers.length === 0) return;
    const group = L.layerGroup();
    liveMarkers.forEach((m) => {
      const cm = L.circleMarker([m.lat, m.lng], {
        radius: 8, color: "#0B5", weight: 3, fillColor: "#00C896", fillOpacity: 1,
      });
      if (m.label) cm.bindTooltip(m.label);
      cm.addTo(group);
    });
    group.addTo(map);
    liveMarkersRef.current = group;
  }, [liveMarkers, ready]);

  // --- Response-Ops: many dispatch route lines (Demo Simulation) ---
  const routePathsRef = useRef<any>(null);
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (routePathsRef.current) { map.removeLayer(routePathsRef.current); routePathsRef.current = null; }
    if (!routePaths || routePaths.length === 0) return;
    const group = L.layerGroup();
    routePaths.forEach((rp) => {
      if (rp.length < 2) return;
      L.polyline(rp.map((p) => [p.lat, p.lng]), { color: "#91C5FD", weight: 4, opacity: 0.85 }).addTo(group);
    });
    group.addTo(map);
    routePathsRef.current = group;
  }, [routePaths, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
```

### 3b. API client — corridor + demo helpers
**File:** `frontend/src/lib/api/responseOps.ts`

**OLD**
```tsx
  rejectReview: (id: number) =>
    opsFetch<{ ok: boolean }>(`/review-queue/${id}/reject`, { method: "POST" }),
};
```
**NEW**
```tsx
  rejectReview: (id: number) =>
    opsFetch<{ ok: boolean }>(`/review-queue/${id}/reject`, { method: "POST" }),
  corridorState: () =>
    opsFetch<{ active: boolean; count: number; signals: Signal[] }>("/corridor/state"),
  resetCorridor: () => opsFetch<{ ok: boolean }>("/corridor/reset", { method: "POST" }),
  demoActive: () =>
    opsFetch<{ active: { dispatchId: number; lat: number; lng: number; status: string; eta_sec: number }[] }>("/demo/active"),
  stopAllSims: () => opsFetch<{ stopped: number }>("/demo/stop-all", { method: "POST" }),
};
```

### 3c. New file — `DemoSimPanel.tsx`
**File (create):** `frontend/src/components/ops/DemoSimPanel.tsx`

```tsx
import { useEffect, useRef, useState } from "react";
import { Radio, Square, Zap, Activity } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, openOpsSocket, type Patrol, type DispatchResult, type Signal } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

// Demo crime scenes placed near the seeded junctions so the green corridor
// (0.3 km activation radius) actually trips on the way in.
const DEMO_SCENES = [
  { name: "MG Road armed robbery", lat: 12.9759, lng: 77.6063 },
  { name: "Domlur chain snatching", lat: 12.9609, lng: 77.6387 },
  { name: "Trinity hit-and-run", lat: 12.9731, lng: 77.6200 },
  { name: "Hosur Rd affray", lat: 12.9279, lng: 77.6271 },
];

type FeedItem = { id: string; text: string; ts: string };
type LiveState = { lat: number; lng: number; etaSec: number };

export function DemoSimPanel() {
  const t = useT();
  const [demoMode, setDemoMode] = useState(false);
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [dispatches, setDispatches] = useState<DispatchResult[]>([]);
  const [live, setLive] = useState<Record<number, LiveState>>({});
  const [statuses, setStatuses] = useState<Record<number, string>>({});
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const pushFeed = (text: string) =>
    setFeed((f) => [{ id: `${Date.now()}-${Math.random()}`, text, ts: new Date().toLocaleTimeString() }, ...f].slice(0, 40));

  useEffect(() => { responseOps.patrols().then(setPatrols).catch(() => {}); }, []);
  useEffect(() => { responseOps.signals().then(setSignals).catch(() => {}); }, []);

  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case "PATROL_LOCATION":
          setLive((p) => ({ ...p, [msg.dispatchId]: { lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec } }));
          break;
        case "DISPATCH_STATUS":
          setStatuses((s) => ({ ...s, [msg.dispatchId]: msg.status }));
          pushFeed(`Dispatch #${msg.dispatchId} \u2192 ${msg.status}`);
          if (msg.status === "COMPLETED" || msg.status === "CANCELLED") {
            setLive((p) => { const n = { ...p }; delete n[msg.dispatchId]; return n; });
            responseOps.patrols().then(setPatrols).catch(() => {});
          }
          break;
        case "SIGNAL_GREEN":
          setSignals((prev) => prev.map((s) => (s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s)));
          pushFeed(`Green corridor: ${msg.junctionId} \u2192 GREEN`);
          break;
        case "SIGNAL_RESET":
          setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
          pushFeed("Green corridor deactivated \u2014 signals NORMAL");
          break;
        case "INCIDENT_CANDIDATE":
          pushFeed(`CCTV candidate @ ${msg.cameraId} (${Math.round((msg.confidence ?? 0) * 100)}%)`);
          break;
      }
    };
    return () => ws.close();
  }, []);

  async function simulateAll() {
    if (busy) return;
    setBusy(true);
    setDispatches([]); setLive({}); setStatuses({});
    try {
      for (const scene of DEMO_SCENES) {
        try {
          const d = await responseOps.dispatch({ scene_lat: scene.lat, scene_lng: scene.lng });
          setDispatches((prev) => [...prev, d]);
          setStatuses((s) => ({ ...s, [d.id]: d.status }));
          pushFeed(`${d.patrol_callsign ?? "Unit"} dispatched \u2192 ${scene.name}`);
          await responseOps.simulate(d.id);
        } catch {
          pushFeed(`No free unit for ${scene.name}`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function stopAll() {
    try { await responseOps.stopAllSims(); } catch { /* ignore */ }
    setLive({}); setDispatches([]); setStatuses({});
    responseOps.patrols().then(setPatrols).catch(() => {});
    responseOps.signals().then(setSignals).catch(() => {});
    pushFeed("All simulations stopped");
  }

  const patrolPoints: Hotspot[] = patrols
    .map((p) => ({ lat: p.lat ?? 0, lng: p.lng ?? 0, weight: 1, label: `${p.callsign} (${p.status})` }))
    .filter((p) => p.lat && p.lng);
  const routePaths: Hotspot[][] = dispatches.map((d) => d.route.map(([lng, lat]) => ({ lat, lng, weight: 1 })));
  const liveMarkers: Hotspot[] = Object.entries(live).map(([id, s]) => ({
    lat: s.lat, lng: s.lng, weight: 3, label: `${t("Unit en route")} (#${id})`,
  }));
  const greenCount = signals.filter((s) => s.state === "GREEN").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setDemoMode((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-[6px] border-2 border-foreground px-3 py-1.5 text-sm font-bold ${demoMode ? "bg-[var(--main,#91C5FD)]" : "bg-background"}`}
        >
          <Radio className="h-4 w-4" /> {demoMode ? t("Demo Mode ON") : t("Demo Mode OFF")}
        </button>
        <button
          onClick={simulateAll}
          disabled={!demoMode || busy}
          className="inline-flex items-center gap-2 rounded-[6px] border-2 border-foreground bg-foreground px-3 py-1.5 text-sm font-bold text-background disabled:opacity-40"
        >
          <Zap className="h-4 w-4" /> {busy ? t("Dispatching\u2026") : t("Simulate All")}
        </button>
        <button
          onClick={stopAll}
          className="inline-flex items-center gap-2 rounded-[6px] border-2 border-foreground bg-background px-3 py-1.5 text-sm font-bold"
        >
          <Square className="h-4 w-4" /> {t("Stop All")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_300px]">
        <aside className="flex flex-col gap-2">
          <h3 className="text-sm font-extrabold">{t("Active Dispatches")} ({dispatches.length})</h3>
          {dispatches.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("Turn on Demo Mode, then hit Simulate All.")}</p>
          )}
          {dispatches.map((d) => {
            const st = statuses[d.id] ?? d.status;
            const l = live[d.id];
            return (
              <div key={d.id} className="rounded-[8px] border-2 border-foreground p-2 text-xs">
                <div className="flex items-center justify-between font-bold">
                  <span>{d.patrol_callsign ?? `#${d.patrol_id}`}</span>
                  <span className="rounded-[4px] border-2 border-foreground px-1 text-[10px]">{st}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {(d.distance_km ?? 0).toFixed(1)} km · ETA {Math.round((l?.etaSec ?? d.eta_sec ?? 0) / 60)} {t("min")}
                </div>
              </div>
            );
          })}
        </aside>

        <div className="h-[520px] overflow-hidden rounded-[8px] border-2 border-foreground">
          <CrimeMap points={patrolPoints} mode="pins" routePaths={routePaths} liveMarkers={liveMarkers} signals={signals} />
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-[8px] border-2 border-foreground p-3">
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <Zap className="h-4 w-4" /> {t("Green Corridor")}
              <span className={`ml-auto rounded-[4px] border-2 border-foreground px-1 text-[10px] ${greenCount > 0 ? "bg-[#00C896] text-black" : ""}`}>
                {greenCount > 0 ? t("ACTIVE") : t("IDLE")}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("Signals prioritized for the responding unit.")}</p>
            <div className="mt-2 text-xs"><b>{greenCount}</b> {t("signals green")}</div>
            <button
              onClick={() => responseOps.resetCorridor().catch(() => {})}
              disabled={greenCount === 0}
              className="mt-2 w-full rounded-[6px] border-2 border-foreground bg-[#e11d48] px-2 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              {t("Deactivate Corridor")}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-[8px] border-2 border-foreground p-3">
            <div className="flex items-center gap-2 text-sm font-extrabold"><Activity className="h-4 w-4" /> {t("Live Event Feed")}</div>
            <ul className="mt-2 flex flex-col gap-1 overflow-y-auto text-[11px]">
              {feed.length === 0 && <li className="text-muted-foreground">{t("No events yet.")}</li>}
              {feed.map((f) => (
                <li key={f.id} className="flex justify-between gap-2 border-b border-foreground/20 pb-1">
                  <span>{f.text}</span>
                  <span className="shrink-0 text-muted-foreground">{f.ts}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
```

### 3d. Wire the Demo tab into `operations.tsx` (make it the default)
**File:** `frontend/src/routes/operations.tsx`

**OLD (1/4)**
```tsx
import { Siren, Radar, Truck, Video } from "lucide-react";
```
**NEW (1/4)**
```tsx
import { Siren, Radar, Truck, Video, Radio } from "lucide-react";
```

**OLD (2/4)**
```tsx
import { ReviewPanel } from "@/components/ops/ReviewPanel";
```
**NEW (2/4)**
```tsx
import { ReviewPanel } from "@/components/ops/ReviewPanel";
import { DemoSimPanel } from "@/components/ops/DemoSimPanel";
```

**OLD (3/4)**
```tsx
type Tab = "predict" | "dispatch" | "review";

function OperationsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("predict");

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Green Corridor"), icon: Truck },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];
```
**NEW (3/4)**
```tsx
type Tab = "demo" | "predict" | "dispatch" | "review";

function OperationsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("demo");

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "demo", label: t("Demo Simulation"), icon: Radio },
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Green Corridor"), icon: Truck },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];
```

**OLD (4/4)**
```tsx
          {tab === "predict" && <PredictivePanel />}
```
**NEW (4/4)**
```tsx
          {tab === "demo" && <DemoSimPanel />}
          {tab === "predict" && <PredictivePanel />}
```

---

## 4. YOLO live CCTV — your exact command (`python inference/live_cctv.py`)

Your build only has `ai_camera/detect_video.py`. Your command expects a `model/` folder with `inference/live_cctv.py`. We create that folder so the command works as-is, reusing Satyam's existing `/api/ops/detect/notify` contract. It is **YOLO-only** (no TFLite/CNN dependency) so it runs out of the box.

### 4a. New file — `model/requirements.txt`
```
ultralytics>=8.2
opencv-python>=4.9
httpx>=0.27
numpy>=1.26
```

### 4b. New file — `model/inference/notify.py`
```python
"""POST a detected incident candidate to Satyam's review queue."""
import os
import httpx

SATYAM_URL = os.getenv("SATYAM_URL", "http://localhost:8000")
SATYAM_TOKEN = os.getenv("SATYAM_TOKEN", "")  # an L2+ officer JWT from /auth/login


def notify(camera_id: str, confidence: float, candidate_type: str = "vehicle_anomaly",
           lat=None, lng=None, clip_path=None, frame_path=None) -> dict:
    r = httpx.post(
        f"{SATYAM_URL}/api/ops/detect/notify",
        headers={"authorization": f"Bearer {SATYAM_TOKEN}"},
        json={"camera_id": camera_id, "confidence": confidence, "candidate_type": candidate_type,
              "lat": lat, "lng": lng, "clip_path": clip_path, "frame_path": frame_path},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()
```

### 4c. New file — `model/inference/live_cctv.py`
```python
"""Satyam — live CCTV detection (YOLOv8 + ByteTrack).

Run EXACTLY as:
    cd model
    venv\\Scripts\\activate        # Windows  (source venv/bin/activate on macOS/Linux)
    python inference/live_cctv.py

Plays a video with live person/vehicle detection drawn on screen. When a tracked
vehicle stays abnormally stopped, a medium/high-confidence candidate is POSTed to
Satyam's human-review queue (/api/ops/detect/notify), which is what lights up the
"Camera Review" tab and the Live Event Feed.

Drop your own clip at  model/video.mp4  (or pass --video <path>). With no video
it falls back to webcam (source 0). Set SATYAM_TOKEN to an L2+ officer JWT to push
candidates; without it, detection still runs locally (push is skipped on error).
"""
import argparse
import time
from pathlib import Path

import cv2
from ultralytics import YOLO

from notify import notify  # inference/ is on sys.path when run as `python inference/live_cctv.py`

SCRIPT_DIR = Path(__file__).resolve().parent      # model/inference
MODEL_ROOT = SCRIPT_DIR.parent                    # model/

# COCO classes: 0=person, 2=car, 3=motorcycle, 5=bus, 7=truck
PERSON_CLASS = 0
VEHICLE_CLASSES = {2, 3, 5, 7}


def resolve_video(arg: str | None) -> str | int:
    if arg and arg != "0":
        return int(arg) if arg.isdigit() else arg
    for cand in (MODEL_ROOT / "video.mp4", MODEL_ROOT / "inference" / "sample.mp4", MODEL_ROOT.parent / "video.mp4"):
        if cand.exists():
            print(f"\U0001F3AC Using video: {cand}")
            return str(cand)
    print("\u2139\uFE0F  No video.mp4 found \u2014 falling back to webcam (source 0)")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default=None, help="path to a video file, or webcam index")
    ap.add_argument("--camera", default="CAM-001", help="camera_id registered in Satyam")
    ap.add_argument("--weights", default=str(MODEL_ROOT / "yolov8s.pt"))
    ap.add_argument("--stopped-secs", type=float, default=3.0, help="stall time before a candidate fires")
    ap.add_argument("--cooldown", type=float, default=30.0, help="seconds between candidates")
    args = ap.parse_args()

    source = resolve_video(args.video)
    model = YOLO(args.weights)  # auto-downloads yolov8s.pt on first run
    cap = cv2.VideoCapture(source)

    stopped_since: dict[int, float] = {}
    prev_center: dict[int, tuple[float, float]] = {}
    last_fire = 0.0

    print("\u2705 Live CCTV running \u2014 press 'q' to quit")
    while True:
        ok, frame = cap.read()
        if not ok:
            if isinstance(source, str):
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop the file
                continue
            break

        res = model.track(frame, tracker="bytetrack.yaml", persist=True, conf=0.4, verbose=False)[0]
        now = time.time()
        people = 0

        if res.boxes is not None and res.boxes.id is not None:
            for box, cls, tid in zip(res.boxes.xyxy, res.boxes.cls, res.boxes.id):
                cls, tid = int(cls), int(tid)
                if cls == PERSON_CLASS:
                    people += 1
                    continue
                if cls not in VEHICLE_CLASSES:
                    continue
                x1, y1, x2, y2 = box.tolist()
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                px, py = prev_center.get(tid, (cx, cy))
                moved = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
                prev_center[tid] = (cx, cy)
                if moved < 2.0:  # essentially stationary
                    stopped_since.setdefault(tid, now)
                    stalled = now - stopped_since[tid]
                    if stalled >= args.stopped_secs and (now - last_fire) > args.cooldown:
                        conf = min(0.95, 0.6 + stalled / 20.0)  # demo confidence ramp
                        last_fire = now
                        print(f"\U0001F6A8 candidate: vehicle {tid} stalled {stalled:.1f}s \u2192 conf {conf:.2f}")
                        try:
                            print("   notify:", notify(args.camera, conf, "vehicle_anomaly"))
                        except Exception as e:  # noqa: BLE001
                            print("   notify skipped:", e)
                else:
                    stopped_since.pop(tid, None)

        annotated = res.plot()
        cv2.putText(annotated, f"Satyam CCTV | people:{people}", (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 200), 2)
        cv2.imshow("Satyam CCTV \u2014 YOLO", annotated)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
```

### 4d. One-time setup (matches your command flow)
```
cd model
python -m venv venv
venv\Scripts\activate                 # Windows
# source venv/bin/activate            # macOS / Linux
pip install -r requirements.txt

# (optional) push candidates into Satyam's review queue:
set SATYAM_URL=http://localhost:8000  # Windows;  export SATYAM_URL=... on mac/linux
set SATYAM_TOKEN=<paste an L2+ officer JWT from /auth/login>

# drop your traffic clip at  model\video.mp4  then:
python inference/live_cctv.py
```

---

## 5. Verify (after your agent applies everything)

### 5a. Static checks
```
# backend compiles
cd backend && python -m py_compile app/api/routes/ops.py app/services/ops/corridor_service.py app/services/ops/sim_service.py

# new ops routes exist
grep -n "corridor/reset\|corridor/state\|demo/active\|demo/stop-all" app/api/routes/ops.py

# frontend: panel + map props wired
grep -n "DemoSimPanel" frontend/src/routes/operations.tsx
grep -n "liveMarkers\|routePaths" frontend/src/components/CrimeMap.tsx

# frontend typecheck / build
cd frontend && npm run build
```

### 5b. 5-step demo smoke test
1. `ENABLE_RESPONSE_OPS=true` in `backend/.env` → restart `uvicorn`.
2. `python -m seed.init_ops --reset` → patrols + signals exist.
3. Log in as an **L2+** officer, open **Response Ops** → it defaults to **Demo Simulation**.
4. Click **Demo Mode ON**, then **Simulate All** → units animate along blue routes toward the scenes, junctions flip **green**, the **Green Corridor** panel shows *ACTIVE*, and the **Live Event Feed** scrolls. **Deactivate Corridor** turns signals back to NORMAL.
5. In `model/`, run `python inference/live_cctv.py` → detection window opens; a stalled vehicle posts a candidate that appears under **Camera Review** + the feed.

---

## 6. Scope note (so expectations are clear)

This pack delivers the **demo-critical** EMERGE features you recorded: enablement, the animated **Demo Simulation**, **Green Corridor** + Deactivate, **Live Event Feed**, multi-unit live map, and the **YOLO live_cctv** entrypoint. The broader EMERGE *Admin Control Center* sub-tabs (Operators, Roles, Analytics tables, the dispatch-grid Admin view) are a separate, larger UI build — say the word and I'll deliver those next as an add-on pack.
