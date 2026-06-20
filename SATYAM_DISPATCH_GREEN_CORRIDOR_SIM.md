# Satyam — Dispatch & Green Corridor SIMULATION (self-contained, demo-only)

**Goal (from request):** The *Dispatch & Green Corridor* tab map was not animating because it depends on the live backend WebSocket (`ENABLE_RESPONSE_OPS`, seeded patrols, JWT socket). This pack adds a **fully self-contained simulation** on the **left side, under “Active Dispatches”**, with **5 demo dispatches** that are:

- **NOT related to the dataset** (hard-coded Bengaluru coordinates).
- **NOT added to the Demo Simulation tab** (pure local React state — no backend calls, no `simulateAll`).
- Each one draws on the map: the **initial police patrol route** (blue) **+ the green-corridor shortest route** (highlighted **green**), and animates the patrol car along the corridor with a moving green-signal corridor.

---

## ✅ Verification attestation (I actually checked this, not guessed)

Before writing this pack I re-read the real files in your latest zip (`/satyam_latest/Satyam_Ai-main/`):

- `frontend/src/components/ops/DispatchPanel.tsx` — full file (state, WS handlers, JSX). The new section is inserted **after the `active.map(...)` list, still inside the LEFT `<div className="flex flex-col gap-3">` column** — exactly “under the Active Dispatches”.
- `frontend/src/components/CrimeMap.tsx` — confirmed it **already** supports every prop this feature needs, so **CrimeMap.tsx needs ZERO changes**:
  - `routePath?: Hotspot[]` → blue static route line (`#91C5FD`, weight 5) — used for the **initial patrol route**.
  - `corridorPath?: [number, number][]` → **green** 3-layer glow polyline (`#00C896`/`#00E6A8`) — used for the **green corridor shortest route**.
  - `liveMarker?: Hotspot | null` → animated 🚓 patrol marker that pans — used for the **moving car**.
  - `signals?:  id; junction_id; lat; lng; state []` → junction dots, **green** when `state==='GREEN'`.
- Verified the change is **non-destructive**: all existing backend wiring (patrols/signals fetch, `openOpsSocket`, `dispatchNearest`, `simulateAll`, `stopAll`, the live `corridor`/`live` props) is preserved. The demo sim only **takes precedence on the map while it is running** (`simRunning` gate), then releases control back to live data when stopped.

**Static checks performed in-sandbox on the final file:**
- `prettier --parser typescript --check` → *All matched files use Prettier code style!*
- Confirmed no stray literal escape sequences leak into JSX text (arrow `→` and 🚦 render as real characters; the only `\u2192` left is inside a JS template literal, which is correct).

> ⚠️ Sandbox cannot run the project's full `tsc`/Vite build (node_modules like `lucide-react`, `leaflet`, `@/lib/*` are not installed here), so this is a **syntax + parse + API-contract** verification, not a full type-check. Apply, then run your usual `npm run build` once.

---

## How the simulation works

- **5 demo dispatches** (`DEMO_DISPATCHES`): `SIM-01 … SIM-05`, each with a callsign (`PCR-21` etc.), an incident label, and an `origin → scene` pair across real Bengaluru localities (Cubbon Park→Commercial St, HSR→Silk Board, Domlur→Indiranagar, Vidhana Soudha→Majestic, BTM→Koramangala).
- **Two routes are drawn per dispatch:**
  - **Initial patrol way (blue):** `curvedRoute()` — a quadratic-bezier *longer* path (perpendicular bend) representing the normal road route.
  - **Green corridor shortest way (green):** `straightRoute()` — the direct optimized path, rendered with CrimeMap’s green glow. The patrol car animates along **this** path (the whole point of a green corridor).
- **Animation:** a `setInterval` tick (140 ms) walks the car along the corridor; phase advances `ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED` with a live **ETA** (40 km/h model) and the existing `PhaseTimeline`.
- **Signals:** `makeSignals()` drops 4 junctions along the corridor, all `GREEN`, so the corridor visibly clears.
- **Isolation guarantees:**
  - No network calls — nothing hits `/api/ops/*`, so **nothing shows up in the Demo Simulation tab or Active Dispatches**.
  - `startSim` cancels any prior sim timer; `stopSim` clears it and releases the map.
  - `dispatchNearest()` and `simulateAll()` call `stopSim()` first so live and demo never fight over the map.
  - Timer is cleared on unmount (`useEffect(() => () => clearSimTimer(), [])`).

---

## Drop-in — replace the WHOLE file

**File:** `frontend/src/components/ops/DispatchPanel.tsx`

Replace the entire contents with the code below. **No other file changes are required** (`CrimeMap.tsx` already supports `routePath` + `corridorPath` + `liveMarker` + `signals`).

```tsx
import { useEffect, useRef, useState } from "react";
import {
  Truck,
  Navigation,
  Radio,
  Square,
  Zap,
  Play,
  MapPin,
} from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import {
  responseOps,
  openOpsSocket,
  type Patrol,
  type ActiveDispatch,
} from "@/lib/api/responseOps";
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
            <div
              className={`mx-0.5 h-0.5 w-4 ${i < active ? "bg-[#00C896]" : "bg-muted-foreground/30"}`}
            />
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

// ----------------------------------------------------------------------------
// Self-contained "Dispatch & Green Corridor" simulation (DEMO ONLY).
// This does NOT call the backend, does NOT touch the Demo Simulation tab, and
// is not related to the seeded dataset. It only drives the map via CrimeMap
// props: routePath (initial patrol route, blue), corridorPath (green corridor
// shortest route, green glow), liveMarker (animated patrol car) and signals.
// ----------------------------------------------------------------------------
type LL = { lat: number; lng: number };
type SimSignal = {
  id: number;
  junction_id: string;
  lat: number;
  lng: number;
  state: string;
};

type DemoDispatch = {
  id: string;
  callsign: string;
  incident: string;
  origin: LL;
  originName: string;
  scene: LL;
  sceneName: string;
};

const DEMO_DISPATCHES: DemoDispatch[] = [
  {
    id: "SIM-01",
    callsign: "PCR-21",
    incident: "Armed robbery in progress",
    origin: { lat: 12.9763, lng: 77.5929 },
    originName: "Cubbon Park",
    scene: { lat: 12.985, lng: 77.606 },
    sceneName: "Commercial Street",
  },
  {
    id: "SIM-02",
    callsign: "PCR-07",
    incident: "Hit & run with injuries",
    origin: { lat: 12.9116, lng: 77.6389 },
    originName: "HSR Layout",
    scene: { lat: 12.9172, lng: 77.6228 },
    sceneName: "Silk Board",
  },
  {
    id: "SIM-03",
    callsign: "PCR-14",
    incident: "Chain snatching",
    origin: { lat: 12.961, lng: 77.6387 },
    originName: "Domlur",
    scene: { lat: 12.9719, lng: 77.6412 },
    sceneName: "Indiranagar",
  },
  {
    id: "SIM-04",
    callsign: "PCR-03",
    incident: "Public disturbance / unlawful assembly",
    origin: { lat: 12.9794, lng: 77.5912 },
    originName: "Vidhana Soudha",
    scene: { lat: 12.9767, lng: 77.5713 },
    sceneName: "Majestic",
  },
  {
    id: "SIM-05",
    callsign: "PCR-19",
    incident: "Road accident, multi-vehicle",
    origin: { lat: 12.9166, lng: 77.6101 },
    originName: "BTM Layout",
    scene: { lat: 12.9352, lng: 77.6245 },
    sceneName: "Koramangala",
  },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Direct (shortest) route = the green corridor path.
function straightRoute(a: LL, b: LL, n = 56): LL[] {
  const out: LL[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) });
  }
  return out;
}

// Curved (longer) "initial" patrol route via a perpendicular-offset bezier control point.
function curvedRoute(a: LL, b: LL, bend = 0.22, n = 60): LL[] {
  const mLat = (a.lat + b.lat) / 2;
  const mLng = (a.lng + b.lng) / 2;
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const cLat = mLat + -dLng * bend;
  const cLng = mLng + dLat * bend;
  const out: LL[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      lat: u * u * a.lat + 2 * u * t * cLat + t * t * b.lat,
      lng: u * u * a.lng + 2 * u * t * cLng + t * t * b.lng,
    });
  }
  return out;
}

function haversineKm(a: LL, b: LL): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makeSignals(route: LL[], id: string): SimSignal[] {
  const fracs = [0.2, 0.45, 0.7, 0.9];
  return fracs.map((f, k) => {
    const p = route[Math.floor(f * (route.length - 1))];
    return {
      id: -(9000 + k),
      junction_id: `${id}-J${k + 1}`,
      lat: p.lat,
      lng: p.lng,
      state: "GREEN",
    };
  });
}

export function DispatchPanel() {
  const t = useT();
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [active, setActive] = useState<ActiveDispatch[]>([]);
  const [live, setLive] = useState<{
    lat: number;
    lng: number;
    etaSec: number;
  } | null>(null);
  const [scene, setScene] = useState({ lat: 12.9352, lng: 77.6245 });
  const [signals, setSignals] = useState<
    {
      id: number;
      junction_id: string;
      lat: number;
      lng: number;
      state: string;
    }[]
  >([]);
  const [corridor, setCorridor] = useState<Corridor>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ---- self-contained demo simulation state ----
  const [simId, setSimId] = useState<string | null>(null);
  const [simRoute, setSimRoute] = useState<Hotspot[] | null>(null);
  const [simCorridor, setSimCorridor] = useState<[number, number][] | null>(
    null,
  );
  const [simCar, setSimCar] = useState<LL | null>(null);
  const [simSignals, setSimSignals] = useState<SimSignal[]>([]);
  const [simPhase, setSimPhase] = useState<string>("ACCEPTED");
  const [simEta, setSimEta] = useState<number>(0);
  const simTimer = useRef<number | null>(null);

  const clearSimTimer = () => {
    if (simTimer.current) {
      window.clearInterval(simTimer.current);
      simTimer.current = null;
    }
  };
  useEffect(() => () => clearSimTimer(), []);

  function stopSim() {
    clearSimTimer();
    setSimId(null);
    setSimRoute(null);
    setSimCorridor(null);
    setSimCar(null);
    setSimSignals([]);
    setSimPhase("ACCEPTED");
    setSimEta(0);
  }

  function startSim(d: DemoDispatch) {
    clearSimTimer();
    const initial = curvedRoute(d.origin, d.scene, 0.22, 60);
    const corridorPts = straightRoute(d.origin, d.scene, 56);
    const sigs = makeSignals(corridorPts, d.id);
    const totalKm = haversineKm(d.origin, d.scene);

    setSimId(d.id);
    setSimRoute(initial.map((p) => ({ lat: p.lat, lng: p.lng, weight: 1 })));
    setSimCorridor(corridorPts.map((p) => [p.lat, p.lng] as [number, number]));
    setSimSignals(sigs);
    setSimCar({ lat: corridorPts[0].lat, lng: corridorPts[0].lng });
    setSimPhase("ACCEPTED");
    setSimEta(Math.max(1, Math.round((totalKm / 40) * 3600)));

    const n = corridorPts.length;
    let i = 0;
    window.setTimeout(
      () => setSimPhase((p) => (p === "ACCEPTED" ? "EN_ROUTE" : p)),
      800,
    );
    simTimer.current = window.setInterval(() => {
      i += 1;
      if (i >= n - 1) {
        clearSimTimer();
        setSimCar({ lat: corridorPts[n - 1].lat, lng: corridorPts[n - 1].lng });
        setSimPhase("ON_SCENE");
        setSimEta(0);
        window.setTimeout(() => setSimPhase("COMPLETED"), 1600);
        return;
      }
      setSimCar({ lat: corridorPts[i].lat, lng: corridorPts[i].lng });
      setSimPhase("EN_ROUTE");
      setSimEta(Math.max(1, Math.round((((1 - i / n) * totalKm) / 40) * 3600)));
    }, 140);
  }

  const simRunning = simId !== null;
  const simDispatch = DEMO_DISPATCHES.find((d) => d.id === simId) || null;

  const refreshActive = () =>
    responseOps
      .activeDispatches()
      .then((r) => setActive(r.active))
      .catch(() => {});

  useEffect(() => {
    responseOps.patrols().then(setPatrols);
  }, []);
  useEffect(() => {
    responseOps.signals().then(setSignals);
  }, []);
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
          if (i < 0) {
            refreshActive();
            return prev;
          }
          const next = [...prev];
          next[i] = {
            ...next[i],
            lat: msg.lat,
            lng: msg.lng,
            eta_sec: msg.etaSec,
            progress: msg.progress ?? next[i].progress,
            phase: msg.phase ?? next[i].phase,
            status: "EN_ROUTE",
          };
          return next;
        });
      }
      if (msg.type === "DISPATCH_STATUS") {
        setActive((prev) =>
          prev.map((a) =>
            a.dispatchId === msg.dispatchId
              ? { ...a, status: msg.status, phase: msg.phase ?? msg.status }
              : a,
          ),
        );
        if (msg.status === "COMPLETED") {
          setLive(null);
          responseOps.patrols().then(setPatrols);
          setTimeout(refreshActive, 300);
        }
      }
      if (msg.type === "SIGNAL_GREEN") {
        setSignals((prev) =>
          prev.map((s) =>
            s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s,
          ),
        );
      }
      if (msg.type === "SIGNAL_RESET") {
        setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      }
      if (msg.type === "GREEN_CORRIDOR_ACTIVE") {
        setCorridor({
          routeCoords: msg.routeCoords ?? [],
          signals: msg.signals ?? [],
          message: msg.message ?? "",
        });
      }
      if (msg.type === "GREEN_CORRIDOR_DEACTIVATED") {
        setCorridor(null);
      }
    };
    return () => ws.close();
  }, []);

  async function dispatchNearest() {
    stopSim();
    const d = await responseOps.dispatch({
      scene_lat: scene.lat,
      scene_lng: scene.lng,
    });
    setLive(null);
    await responseOps.simulate(d.id);
    refreshActive();
  }
  async function simulateAll() {
    stopSim();
    await responseOps.simulateAll();
    refreshActive();
  }
  async function stopAll() {
    await responseOps.stopAll();
    setLive(null);
    setCorridor(null);
    refreshActive();
  }

  const patrolPoints: Hotspot[] = patrols
    .map((p) => ({
      lat: p.lat ?? 0,
      lng: p.lng ?? 0,
      weight: 1,
      label: `${p.callsign} (${p.status})`,
    }))
    .filter((p) => p.lat && p.lng);

  // Unified green-corridor panel source (demo sim takes precedence when running).
  const corridorPanel = simRunning
    ? simCorridor
      ? {
          message: simDispatch
            ? `Green corridor cleared for ${simDispatch.callsign} \u2192 ${simDispatch.sceneName}`
            : "Green corridor active",
          signals: simSignals.map((s) => ({
            junctionId: s.junction_id,
            lat: s.lat,
            lng: s.lng,
          })),
        }
      : null
    : corridor;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* LEFT: controls + active dispatches */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={simulateAll}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 text-xs font-bold"
          >
            <Radio className="h-3.5 w-3.5" /> {t("Simulate All")}
          </button>
          <button
            onClick={stopAll}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1.5 text-xs font-bold hover:bg-muted"
          >
            <Square className="h-3.5 w-3.5" /> {t("Stop All")}
          </button>
        </div>

        <div className="rounded-[8px] border-2 border-foreground p-3 text-xs">
          <div className="mb-2 font-bold">{t("Scene")}</div>
          <div className="flex gap-2">
            <input
              className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1"
              value={scene.lat}
              onChange={(e) =>
                setScene((s) => ({
                  ...s,
                  lat: parseFloat(e.target.value) || s.lat,
                }))
              }
            />
            <input
              className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1"
              value={scene.lng}
              onChange={(e) =>
                setScene((s) => ({
                  ...s,
                  lng: parseFloat(e.target.value) || s.lng,
                }))
              }
            />
          </div>
          <button
            onClick={dispatchNearest}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 font-bold"
          >
            <Navigation className="h-4 w-4" /> {t("Dispatch nearest unit")}
          </button>
        </div>

        <h3 className="text-sm font-extrabold">
          {t("Active Dispatches")} ({active.length})
        </h3>
        {active.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("No active dispatches. Use Simulate All or dispatch a unit.")}
          </p>
        )}
        {active.map((a) => (
          <div
            key={a.dispatchId}
            className="rounded-[8px] border-2 border-foreground bg-background p-3 text-xs"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 font-extrabold">
                <Truck className="h-4 w-4" /> {a.callsign}
              </span>
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
            <div className="mb-2">
              <PhaseTimeline phase={a.phase} />
            </div>
            <div className="mb-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[var(--main,#91C5FD)] transition-all"
                  style={{ width: `${Math.round((a.progress ?? 0) * 100)}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
                {Math.round((a.progress ?? 0) * 100)}%
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("ETA")}{" "}
              {a.eta_sec > 60
                ? `${Math.ceil(a.eta_sec / 60)}m`
                : `${a.eta_sec}s`}
            </div>
          </div>
        ))}

        {/* Self-contained Dispatch + Green Corridor simulation (DEMO ONLY) */}
        <div className="mt-1 rounded-[8px] border-2 border-foreground p-3">
          <div className="mb-1 flex items-center gap-1 text-sm font-extrabold">
            <Zap className="h-4 w-4 text-[#00C896]" />{" "}
            {t("Simulate Dispatch & Green Corridor")}
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            {t(
              "Demo routes only \u2014 not linked to live data or the Demo Simulation tab.",
            )}
          </p>
          <div className="flex flex-col gap-2">
            {DEMO_DISPATCHES.map((d) => {
              const running = simId === d.id;
              return (
                <div
                  key={d.id}
                  className={`rounded-[8px] border-2 p-2 text-xs ${
                    running
                      ? "border-[#00C896] bg-[#00C896]/10"
                      : "border-foreground bg-background"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 font-extrabold">
                      <Truck className="h-3.5 w-3.5" /> {d.callsign}
                    </span>
                    <span className="rounded-[4px] border-2 border-foreground px-1.5 py-0.5 text-[9px] font-bold">
                      {d.id}
                    </span>
                  </div>
                  <div className="mt-0.5 font-semibold">{d.incident}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {d.originName} →{" "}
                    {d.sceneName}
                  </div>
                  {running ? (
                    <div className="mt-2">
                      <PhaseTimeline phase={simPhase} />
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] font-bold">
                          {simPhase === "ON_SCENE" || simPhase === "COMPLETED"
                            ? t("Arrived")
                            : `${t("ETA")} ${simEta}s`}
                        </span>
                        <button
                          onClick={stopSim}
                          className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-[10px] font-bold hover:bg-muted"
                        >
                          <Square className="h-3 w-3" /> {t("Stop")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => startSim(d)}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1 font-bold"
                    >
                      <Play className="h-3.5 w-3.5" /> {t("Start simulation")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT: live tracking map */}
      <div className="relative h-[560px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap
          points={patrolPoints}
          mode="pins"
          routePath={simRunning ? (simRoute ?? undefined) : undefined}
          corridorPath={
            simRunning
              ? (simCorridor ?? undefined)
              : (corridor?.routeCoords ?? undefined)
          }
          liveMarker={
            simRunning
              ? simCar
                ? {
                    lat: simCar.lat,
                    lng: simCar.lng,
                    weight: 3,
                    label: simDispatch
                      ? `${simDispatch.callsign} ${t("en route")}`
                      : t("Patrol en route"),
                  }
                : null
              : live
                ? {
                    lat: live.lat,
                    lng: live.lng,
                    weight: 3,
                    label: t("Patrol en route"),
                  }
                : null
          }
          signals={simRunning ? simSignals : signals}
        />

        {/* Map legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-[6px] border-2 border-foreground bg-background/90 px-3 py-2 text-[10px] font-bold shadow">
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-[#00C896]" />{" "}
            {t("Green corridor")}
          </div>
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-[#91C5FD]" />{" "}
            {t("Initial route")}
          </div>
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" />{" "}
            {t("Patrol unit")}
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" />{" "}
            {t("Signal")}
          </div>
        </div>

        {/* Green corridor floating panel */}
        {corridorPanel && (
          <div className="absolute right-3 top-3 z-[1000] w-56 rounded-[8px] border-2 border-foreground bg-background/95 p-3 shadow">
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00C896]" />
              <span className="text-xs font-extrabold text-[#0a8f6b]">
                {t("Green Corridor")}
              </span>
              <span className="ml-auto rounded-[4px] bg-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-foreground">
                {t("ACTIVE")}
              </span>
            </div>
            <p className="mb-2 text-[10px] text-muted-foreground">
              {corridorPanel.message}
            </p>
            <div className="mb-2 text-[10px] font-bold text-muted-foreground">
              {t("ACTIVE SIGNALS")}
            </div>
            <div className="flex flex-wrap gap-1">
              {corridorPanel.signals.slice(0, 8).map((s) => (
                <span
                  key={s.junctionId}
                  className="rounded-[4px] border-2 border-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-[#0a8f6b]"
                >
                  🚦 {s.junctionId}
                </span>
              ))}
            </div>
            <button
              onClick={simRunning ? stopSim : stopAll}
              className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-[11px] font-bold hover:bg-muted"
            >
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

## After applying

1. `cd frontend && npm run build` (or `npm run dev`).
2. Open **Operations → Dispatch & Green Corridor**.
3. On the left, under **Active Dispatches**, the new **“Simulate Dispatch & Green Corridor”** card lists the 5 demo dispatches.
4. Click **Start simulation** on any row:
   - Blue **initial route** + **green corridor** appear on the map.
   - The 🚓 patrol car drives along the green corridor; junctions turn green; the floating **Green Corridor** panel and phase/ETA update.
5. **Stop** (row button, panel “Deactivate Corridor”, or starting another row) clears it. None of this writes to the backend or the Demo tab.
