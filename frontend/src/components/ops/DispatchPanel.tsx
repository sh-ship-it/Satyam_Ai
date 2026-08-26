import { useEffect, useRef, useState } from "react";
import { Truck, Navigation, Radio, Square, Zap, Play, MapPin } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, openOpsSocket, type ActiveDispatch } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { fetchRoadGraph, resampleByDistance, shortestPath, type RoadGraph } from "@/lib/roadPath";
import { DEMO_SCENES, type SimScene } from "@/lib/simScenes";

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
  const t = useT();
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
              {t(p.label)}
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

type LL = { lat: number; lng: number };
type SimSignal = { id: number; junction_id: string; lat: number; lng: number; state: string };
// `DemoDispatch` and its five hardcoded Bengaluru scenarios (PCR-21 / Cubbon Park
// -> Commercial Street, and so on) lived here. They looked like data and were not:
// switching the Settings panel between the cloud and local databases changed every
// other figure on this screen and left these five untouched, so the panel
// contradicted the rest of the app.
//
// A later revision derived them from real patrol units and crime hotspots on the
// active database, which worked but produced an 18 km Bidar leg whose endpoints sat
// in disconnected fragments of the arterial network — the card could only report
// NO_ROUTE. They are now five curated short Bengaluru legs, each verified to route.
// See `lib/simScenes.ts` for the measurements.

/** Bengaluru anchor points, used only to seed backend dispatches for "Simulate
 *  All" when the risk grid has not been computed yet. Not the simulation cards —
 *  those come from `lib/simScenes.ts`. */
const SEED_SCENE_POINTS: LL[] = [
  { lat: 12.985, lng: 77.606 },
  { lat: 12.9719, lng: 77.6412 },
  { lat: 12.9172, lng: 77.6228 },
];

// `lerp` and `straightRoute` lived here. `straightRoute` drew the line the car
// used to follow; once the car started following real roads its only remaining job
// was a "straight-line reference" overlay, and that turned out to be pure clutter
// across a map already covered in the search frontier. The road-vs-crow-flies
// comparison it existed to support is still made, as numbers, in the panel:
// "1.99 km by road vs 1.72 km straight". A number states the comparison without
// drawing a line that looks like a route.
//
// `curvedRoute` lived here too: a quadratic Bézier that bowed the "Initial route"
// line sideways so it would not sit exactly on top of the straight corridor. It
// was cosmetic — no road data, and the car never followed it. Deleted rather than
// kept, because a curve that looks like a route but is not one is the kind of
// decoration that gets mistaken for data.

function haversineKm(a: LL, b: LL): number {
  const R = 6371,
    dLat = ((b.lat - a.lat) * Math.PI) / 180,
    dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makeSignals(route: LL[], id: string): SimSignal[] {
  return [0.2, 0.45, 0.7, 0.9].map((f, k) => {
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
  // The `patrols` list used to live here purely to draw 83 static red pins on the
  // map. Now that the dots are the crime scenes, nothing read it, so the state and
  // its two fetches are gone rather than left as dead reads.
  const [active, setActive] = useState<ActiveDispatch[]>([]);

  /** The five verified demo scenes. Fixed on purpose — see lib/simScenes.ts. */
  const scenes: SimScene[] = DEMO_SCENES;
  /** Which database the rest of the screen is reading, shown for context. */
  const [dbSource, setDbSource] = useState<string | null>(null);
  const [live, setLive] = useState<{ lat: number; lng: number; etaSec: number } | null>(null);
  const [scene, setScene] = useState({ lat: 12.9352, lng: 77.6245 });
  const [signals, setSignals] = useState<
    { id: number; junction_id: string; lat: number; lng: number; state: string }[]
  >([]);
  const [corridor, setCorridor] = useState<Corridor>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── self-contained demo sim state ──────────────────────────────────────────
  const [simId, setSimId] = useState<string | null>(null);

  const [simCorridor, setSimCorridor] = useState<[number, number][] | null>(null);
  const [simFitSignal, setSimFitSignal] = useState(0);
  /** The two endpoints, used only to frame the map. Never drawn. */
  const [simFitTo, setSimFitTo] = useState<[number, number][] | null>(null);
  const [simCar, setSimCar] = useState<LL | null>(null);
  const [simSignals, setSimSignals] = useState<SimSignal[]>([]);
  const [simPhase, setSimPhase] = useState<string>("ACCEPTED");
  const [simEta, setSimEta] = useState<number>(0);
  const simTimer = useRef<number | null>(null);

  // ── path search state ──────────────────────────────────────────────────────
  /** Road edges settled so far, revealed progressively as the search animates. */
  const [simSearch, setSimSearch] = useState<[number, number][][] | null>(null);
  /** Human-readable status for the search: what it is doing, or why it cannot. */
  const [simNote, setSimNote] = useState<string | null>(null);
  const [simRoadKm, setSimRoadKm] = useState<number | null>(null);
  /** Bumped on every start/stop so async work from a previous run cannot write
   *  into the current one. Without this, starting SIM-02 while SIM-01's graph
   *  fetch is still in flight would animate SIM-01's search over SIM-02. */
  const simRun = useRef(0);

  const clearSimTimer = () => {
    if (simTimer.current) {
      window.clearInterval(simTimer.current);
      simTimer.current = null;
    }
  };
  useEffect(() => () => clearSimTimer(), []);

  function stopSim() {
    simRun.current += 1; // invalidate any in-flight search for the old run
    clearSimTimer();
    setSimId(null);

    setSimCorridor(null);
    setSimCar(null);
    setSimSignals([]);
    setSimPhase("ACCEPTED");
    setSimEta(0);
    setSimSearch(null);
    setSimNote(null);
    setSimRoadKm(null);
    setSimFitTo(null);
  }

  /** Drive the car along a road path, one resampled step per tick. */
  function driveAlong(pathLatLng: [number, number][], roadKm: number, runId: number) {
    // Resampled so each tick covers the same ground. Road vertices are unevenly
    // spaced — two points across a highway, thirty round a roundabout — so
    // stepping vertex-to-vertex made the car crawl at junctions and jump on
    // straights.
    const pts = resampleByDistance(pathLatLng, 90);
    const n = pts.length;
    setSimCorridor(pts);
    setSimSignals(
      makeSignals(
        pts.map(([lat, lng]) => ({ lat, lng })),
        // Junction markers sit ON the real path now, not on a straight line.
        pathLatLng.length ? "SIM" : "SIM",
      ),
    );
    setSimCar({ lat: pts[0][0], lng: pts[0][1] });
    setSimEta(Math.max(1, Math.round((roadKm / 40) * 3600)));
    setSimPhase("EN_ROUTE");

    let i = 0;
    simTimer.current = window.setInterval(() => {
      if (simRun.current !== runId) {
        clearSimTimer();
        return;
      }
      i += 1;
      if (i >= n - 1) {
        clearSimTimer();
        setSimCar({ lat: pts[n - 1][0], lng: pts[n - 1][1] });
        setSimPhase("ON_SCENE");
        setSimEta(0);
        window.setTimeout(() => {
          if (simRun.current !== runId) return;
          setSimPhase("COMPLETED");
          window.setTimeout(() => {
            if (simRun.current === runId) stopSim();
          }, 1500);
        }, 1600);
        return;
      }
      setSimCar({ lat: pts[i][0], lng: pts[i][1] });
      setSimEta(Math.max(1, Math.round((((1 - i / n) * roadKm) / 40) * 3600)));
    }, 90);
  }

  /** Replay the search frontier, then hand over to the car.
   *
   *  Reveals settled edges in chunks on a timer rather than one per frame: a city
   *  search settles a couple of thousand edges, and one edge per frame would take
   *  half a minute to watch. */
  function animateSearch(explored: [number, number][][], onDone: () => void, runId: number) {
    const FRAMES = 46;
    const chunk = Math.max(1, Math.ceil(explored.length / FRAMES));
    let shown = 0;
    simTimer.current = window.setInterval(() => {
      if (simRun.current !== runId) {
        clearSimTimer();
        return;
      }
      shown = Math.min(explored.length, shown + chunk);
      setSimSearch(explored.slice(0, shown));
      if (shown >= explored.length) {
        clearSimTimer();
        onDone();
      }
    }, 45);
  }

  async function startSim(d: SimScene) {
    simRun.current += 1;
    const runId = simRun.current;
    clearSimTimer();

    // Reset to a clean slate, then show the straight-line reference immediately so
    // the map has something while the road graph is fetched. This blue line is
    // explicitly labelled "straight-line reference" in the legend — it is NOT the
    // route, and the car never follows it. Previously the car followed a straight
    // line while a cosmetic curve was drawn beside it.
    setSimId(d.id);
    setSimFitTo([
      [d.origin.lat, d.origin.lng],
      [d.scene.lat, d.scene.lng],
    ]);
    setSimCorridor(null);
    setSimSearch(null);
    setSimRoadKm(null);
    setSimSignals([]);
    setSimCar({ lat: d.origin.lat, lng: d.origin.lng });
    setSimPhase("PLANNING");
    setSimEta(0);
    setSimFitSignal((n) => n + 1);
    setSimNote(t("Fetching road network from OpenStreetMap\u2026"));

    let graph: RoadGraph;
    try {
      graph = await fetchRoadGraph(d.origin, d.scene);
    } catch (e) {
      if (simRun.current !== runId) return;
      setSimPhase("NO_ROUTE");
      setSimNote(
        `${t("Road network unavailable")} \u2014 ${e instanceof Error ? e.message : String(e)}. ${t(
          "The search needs road geometry, so no route is shown.",
        )}`,
      );
      return;
    }
    if (simRun.current !== runId) return;

    if (graph.provider !== "OVERPASS" || !graph.nodes.length) {
      setSimPhase("NO_ROUTE");
      setSimNote(graph.note ?? t("Road network unavailable, so no route can be computed."));
      return;
    }

    setSimNote(
      `${t("Searching")} ${graph.nodes.length.toLocaleString()} ${t("road nodes")} \u00b7 ${graph.edges.length.toLocaleString()} ${t("segments")}${graph.cached ? ` \u00b7 ${t("cached")}` : ""}`,
    );
    setSimPhase("SEARCHING");

    const result = shortestPath(graph, d.origin, d.scene);
    if (simRun.current !== runId) return;
    if (!result) {
      // Honest dead end. The old code would have drawn a straight line here.
      setSimPhase("NO_ROUTE");
      setSimNote(
        t(
          "No connected road path found between these two points in the fetched area. Nothing is drawn rather than guessing a straight line.",
        ),
      );
      return;
    }

    const roadKm = result.distanceM / 1000;
    const straightKm = haversineKm(d.origin, d.scene);
    setSimRoadKm(roadKm);
    setSimNote(
      `${t("Dijkstra settled")} ${result.settled.toLocaleString()} ${t("nodes")} \u00b7 ${roadKm.toFixed(
        2,
      )} km ${t("by road")} vs ${straightKm.toFixed(2)} km ${t("straight")}`,
    );

    animateSearch(
      result.explored,
      () => {
        if (simRun.current !== runId) return;
        driveAlong(result.path, roadKm, runId);
      },
      runId,
    );
  }

  const simRunning = simId !== null;
  const simDispatch = scenes.find((d) => d.id === simId) ?? null;

  // Which database the rest of this screen is reading. The demo scenes themselves
  // are fixed, so this is context rather than their provenance.
  useEffect(() => {
    api
      .getDbSource()
      .then((r) => setDbSource(r.db_source))
      .catch(() => setDbSource(null));
  }, []);

  // ── live backend data ──────────────────────────────────────────────────────
  const refreshActive = () =>
    responseOps
      .activeDispatches()
      .then((r) => setActive(r.active))
      .catch(() => {});

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
          setTimeout(refreshActive, 300);
        }
      }
      if (msg.type === "SIGNAL_GREEN")
        setSignals((prev) =>
          prev.map((s) => (s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s)),
        );
      if (msg.type === "SIGNAL_RESET")
        setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      if (msg.type === "GREEN_CORRIDOR_ACTIVE")
        setCorridor({
          routeCoords: msg.routeCoords ?? [],
          signals: msg.signals ?? [],
          message: msg.message ?? "",
        });
      if (msg.type === "GREEN_CORRIDOR_DEACTIVATED") setCorridor(null);
    };
    return () => ws.close();
  }, []);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // NOTE: this used to be a component-local `FALLBACK_SCENES`, which silently
  // shadowed the imported one of the same name and made the simulation cards fall
  // back to three bare coordinates with no callsign or crime type. Renamed, and
  // moved to module scope since it is a constant.

  async function dispatchNearest() {
    stopSim();
    setActionBusy(true);
    setActionError(null);
    try {
      const d = await responseOps.dispatch({ scene_lat: scene.lat, scene_lng: scene.lng });
      setLive(null);
      await responseOps.simulate(d.id);
      refreshActive();
    } catch (err: any) {
      setActionError(
        err?.message?.includes("409")
          ? "No patrol unit available. Run python -m seed.init_ops --reset to reset units."
          : "Dispatch failed — check that the backend is running.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function simulateAll() {
    stopSim();
    setActionBusy(true);
    setActionError(null);
    try {
      // Try the backend simulate-all first.
      const res = await responseOps.simulateAll();
      if (res.started === 0) {
        // Nothing to simulate — seed dispatches from risk zones, or from the
        // anchor points if the risk grid has not been computed yet.
        let seedPoints: LL[] = SEED_SCENE_POINTS;
        try {
          const rz = await responseOps.riskZones();
          if (rz.zones.length >= 2)
            seedPoints = rz.zones
              .slice(0, 3)
              .map((z) => ({ lat: z.center_lat, lng: z.center_lng }));
        } catch {
          /* use the anchor points */
        }
        for (const s of seedPoints) {
          try {
            const d = await responseOps.dispatch({ scene_lat: s.lat, scene_lng: s.lng });
            await responseOps.simulate(d.id);
          } catch {
            /* no free unit — skip */
          }
        }
      }
      refreshActive();
    } catch (err: any) {
      setActionError(
        "Simulate All failed — check that the backend is running and ENABLE_RESPONSE_OPS=true.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function stopAll() {
    setActionBusy(true);
    setActionError(null);
    try {
      await responseOps.stopAll();
      setLive(null);
      setCorridor(null);
      refreshActive();
    } catch {
      // Best-effort — clear UI state even if backend call fails.
      setLive(null);
      setCorridor(null);
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * The dots on the map are the five CRIME SCENES — the places a unit drives to.
   *
   * This used to plot `patrols`, which on the local database is 83 units spread
   * across 40 districts: the map became a solid mass of red covering Karnataka,
   * none of it related to the simulation being run. Scene markers are the useful
   * layer, because they are the destinations the cards actually dispatch to.
   *
   * The unit's own position is not drawn as a static pin either — during a run it
   * is the animated vehicle marker (`liveMarker`), which is where it belongs.
   */
  const scenePoints: Hotspot[] = scenes.map((s) => ({
    lat: s.scene.lat,
    lng: s.scene.lng,
    weight: 1,
    label: `${s.id} · ${s.incident} — ${s.sceneName}`,
  }));

  const corridorPanel = simRunning
    ? simCorridor
      ? {
          message: simDispatch
            ? `Green corridor cleared for ${simDispatch.callsign} \u2192 ${simDispatch.sceneName}`
            : "Green corridor active",
          signals: simSignals.map((s) => ({ junctionId: s.junction_id, lat: s.lat, lng: s.lng })),
        }
      : null
    : corridor;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* LEFT */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={simulateAll}
            disabled={actionBusy}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 text-xs font-bold disabled:opacity-50"
          >
            <Radio className="h-3.5 w-3.5" /> {actionBusy ? t("Working…") : t("Simulate All")}
          </button>
          <button
            onClick={stopAll}
            disabled={actionBusy}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1.5 text-xs font-bold hover:bg-muted disabled:opacity-50"
          >
            <Square className="h-3.5 w-3.5" /> {t("Stop All")}
          </button>
        </div>
        {actionError && (
          <div className="rounded-[6px] border-2 border-destructive/60 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {actionError}
          </div>
        )}

        <div className="rounded-[8px] border-2 border-foreground p-3 text-xs">
          <div className="mb-2 font-bold">{t("Scene")}</div>
          <div className="flex gap-2">
            <input
              className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1"
              value={scene.lat}
              onChange={(e) =>
                setScene((s) => ({ ...s, lat: parseFloat(e.target.value) || s.lat }))
              }
            />
            <input
              className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1"
              value={scene.lng}
              onChange={(e) =>
                setScene((s) => ({ ...s, lng: parseFloat(e.target.value) || s.lng }))
              }
            />
          </div>
          <button
            onClick={dispatchNearest}
            disabled={actionBusy}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 font-bold disabled:opacity-50"
          >
            <Navigation className="h-4 w-4" />{" "}
            {actionBusy ? t("Working…") : t("Dispatch nearest unit")}
          </button>
        </div>

        {/* Self-contained Dispatch + Green Corridor simulation */}
        <div className="mt-1 rounded-[8px] border-2 border-foreground p-3">
          <div className="mb-1 flex items-center gap-1 text-sm font-extrabold">
            <Zap className="h-4 w-4 text-[#00C896]" /> {t("Simulate Dispatch & Green Corridor")}
          </div>

          {/* The scenes are fixed and verified routable; the badge says which
              database the rest of the screen is reading, which is separate. */}
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {dbSource && (
              <span
                className={`rounded-[4px] border-2 border-foreground px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                  dbSource === "local" ? "bg-[#00C896]/20" : "bg-[var(--main,#91C5FD)]/30"
                }`}
              >
                {dbSource === "local" ? t("Local DB") : t("Cloud DB")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {scenes.length} {t("demo scenes \u00b7 short Bengaluru legs, each verified to route")}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {scenes.map((d) => {
              const running = simId === d.id;
              return (
                <div
                  key={d.id}
                  className={`rounded-[8px] border-2 p-2 text-xs ${running ? "border-[#00C896] bg-[#00C896]/10" : "border-foreground bg-background"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 font-extrabold">
                      <Truck className="h-3.5 w-3.5" /> {d.callsign}
                    </span>
                    <span className="rounded-[4px] border-2 border-foreground px-1.5 py-0.5 text-[9px] font-bold">
                      {d.id}
                    </span>
                  </div>
                  {/* All written UI copy now, so plain t(). The derived version had
                      DB crime types and districts here and needed tData. */}
                  <div className="mt-0.5 font-semibold">{t(d.incident)}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {t(d.originName)} → {t(d.sceneName)} · {d.distanceKm.toFixed(1)} km
                    </span>
                  </div>
                  {running ? (
                    <div className="mt-2">
                      <PhaseTimeline phase={simPhase} />
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] font-bold">
                          {simPhase === "ON_SCENE" || simPhase === "COMPLETED"
                            ? t("Arrived")
                            : simPhase === "PLANNING"
                              ? t("Fetching roads\u2026")
                              : simPhase === "SEARCHING"
                                ? t("Searching roads\u2026")
                                : simPhase === "NO_ROUTE"
                                  ? t("No route")
                                  : `${t("ETA")} ${simEta}s`}
                        </span>
                        <button
                          onClick={stopSim}
                          className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-[10px] font-bold hover:bg-muted"
                        >
                          <Square className="h-3 w-3" /> {t("Stop")}
                        </button>
                      </div>
                      {/* What the search is doing, or why it cannot run. Shown
                          rather than logged: a silent failure here used to mean a
                          straight line the officer could mistake for a route. */}
                      {simNote && (
                        <p
                          className={`mt-1 text-[9px] leading-snug ${
                            simPhase === "NO_ROUTE"
                              ? "font-bold text-[#b91c1c]"
                              : "text-muted-foreground"
                          }`}
                        >
                          {simNote}
                        </p>
                      )}
                      {simRoadKm != null && (
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          {t(
                            "Shortest distance on arterial roads \u2014 no one-ways or turn restrictions, so not a drive-time estimate.",
                          )}
                        </p>
                      )}
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

      {/* RIGHT: map */}
      <div className="relative h-[560px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap
          points={scenePoints}
          mode="pins"
          corridorPath={
            simRunning ? (simCorridor ?? undefined) : (corridor?.routeCoords ?? undefined)
          }
          searchEdges={simRunning ? (simSearch ?? undefined) : undefined}
          // Framed on the origin/scene pair, not on any drawn line. That keeps the
          // camera correct while the only thing on screen is the search frontier.
          fitTo={simRunning ? (simFitTo ?? undefined) : undefined}
          fitSignal={simFitSignal}
          lockBounds={simRunning}
          darkTiles
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
                ? { lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") }
                : null
          }
          signals={simRunning ? simSignals : signals}
        />

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-[6px] border-2 border-foreground bg-background/90 px-3 py-2 text-[10px] font-bold shadow">
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-[#00C896]" /> {t("Green corridor")}
          </div>
          {/* The old "Initial route" entry is gone with the line it described: it
              never was a route, and the straight-line overlay that briefly replaced
              it was clutter. Every line on this map is now real road geometry. */}
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-1 w-4 rounded bg-[#00E6A8] opacity-50" />{" "}
            {t("Roads searched")}
          </div>
          {/* The red dot was labelled "Patrol unit" while it plotted the patrol
              list. It now marks the crime scene a unit drives TO, so the label had
              to move with it — a legend that names the wrong thing is worse than
              no legend. The unit itself is the animated vehicle marker. */}
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" /> {t("Crime scene")}
          </div>
          <div className="mb-1 flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[#00C896]" />{" "}
            {t("Patrol unit (moving)")}
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" /> {t("Signal")}
          </div>
        </div>

        {/* Green corridor floating panel */}
        {corridorPanel && (
          <div className="absolute right-3 top-3 z-[1000] w-56 rounded-[8px] border-2 border-foreground bg-background/95 p-3 shadow">
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00C896]" />
              <span className="text-xs font-extrabold text-[#0a8f6b]">{t("Green Corridor")}</span>
              <span className="ml-auto rounded-[4px] bg-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-foreground">
                {t("ACTIVE")}
              </span>
            </div>
            <p className="mb-2 text-[10px] text-muted-foreground">{corridorPanel.message}</p>
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
