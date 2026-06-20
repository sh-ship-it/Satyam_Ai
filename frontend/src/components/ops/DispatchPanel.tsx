import { useEffect, useRef, useState } from "react";
import { Truck, Navigation, Radio, Square, Zap, Play, MapPin } from "lucide-react";
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
            <div className={`h-4 w-4 rounded-full border-2 ${
              i < active ? "border-[#00C896] bg-[#00C896]"
              : i === active ? "border-[#2563eb] bg-[#91C5FD]"
              : "border-muted-foreground/40 bg-background"
            }`} />
            <span className={`mt-0.5 text-[8px] font-bold leading-none ${
              i === active ? "text-foreground" : "text-muted-foreground/60"
            }`}>{p.label}</span>
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

type LL = { lat: number; lng: number };
type SimSignal = { id: number; junction_id: string; lat: number; lng: number; state: string };
type DemoDispatch = {
  id: string; callsign: string; incident: string;
  origin: LL; originName: string; scene: LL; sceneName: string;
};

const DEMO_DISPATCHES: DemoDispatch[] = [
  { id: "SIM-01", callsign: "PCR-21", incident: "Armed robbery in progress",
    origin: { lat: 12.9763, lng: 77.5929 }, originName: "Cubbon Park",
    scene: { lat: 12.985, lng: 77.606 }, sceneName: "Commercial Street" },
  { id: "SIM-02", callsign: "PCR-07", incident: "Hit & run with injuries",
    origin: { lat: 12.9116, lng: 77.6389 }, originName: "HSR Layout",
    scene: { lat: 12.9172, lng: 77.6228 }, sceneName: "Silk Board" },
  { id: "SIM-03", callsign: "PCR-14", incident: "Chain snatching",
    origin: { lat: 12.961, lng: 77.6387 }, originName: "Domlur",
    scene: { lat: 12.9719, lng: 77.6412 }, sceneName: "Indiranagar" },
  { id: "SIM-04", callsign: "PCR-03", incident: "Public disturbance",
    origin: { lat: 12.9794, lng: 77.5912 }, originName: "Vidhana Soudha",
    scene: { lat: 12.9767, lng: 77.5713 }, sceneName: "Majestic" },
  { id: "SIM-05", callsign: "PCR-19", incident: "Road accident, multi-vehicle",
    origin: { lat: 12.9166, lng: 77.6101 }, originName: "BTM Layout",
    scene: { lat: 12.9352, lng: 77.6245 }, sceneName: "Koramangala" },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function straightRoute(a: LL, b: LL, n = 56): LL[] {
  const out: LL[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push({ lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) }); }
  return out;
}

function curvedRoute(a: LL, b: LL, bend = 0.22, n = 60): LL[] {
  const mLat = (a.lat + b.lat) / 2, mLng = (a.lng + b.lng) / 2;
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  const cLat = mLat + -dLng * bend, cLng = mLng + dLat * bend;
  const out: LL[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ lat: u*u*a.lat + 2*u*t*cLat + t*t*b.lat, lng: u*u*a.lng + 2*u*t*cLng + t*t*b.lng });
  }
  return out;
}

function haversineKm(a: LL, b: LL): number {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat/2)**2 + Math.cos((a.lat*Math.PI)/180)*Math.cos((b.lat*Math.PI)/180)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makeSignals(route: LL[], id: string): SimSignal[] {
  return [0.2, 0.45, 0.7, 0.9].map((f, k) => {
    const p = route[Math.floor(f * (route.length - 1))];
    return { id: -(9000 + k), junction_id: `${id}-J${k + 1}`, lat: p.lat, lng: p.lng, state: "GREEN" };
  });
}

export function DispatchPanel() {
  const t = useT();
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [active, setActive] = useState<ActiveDispatch[]>([]);
  const [live, setLive] = useState<{ lat: number; lng: number; etaSec: number } | null>(null);
  const [scene, setScene] = useState({ lat: 12.9352, lng: 77.6245 });
  const [signals, setSignals] = useState<{ id: number; junction_id: string; lat: number; lng: number; state: string }[]>([]);
  const [corridor, setCorridor] = useState<Corridor>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── self-contained demo sim state ──────────────────────────────────────────
  const [simId, setSimId] = useState<string | null>(null);
  const [simRoute, setSimRoute] = useState<Hotspot[] | null>(null);
  const [simCorridor, setSimCorridor] = useState<[number, number][] | null>(null);
  const [simFitSignal, setSimFitSignal] = useState(0);
  const [simCar, setSimCar] = useState<LL | null>(null);
  const [simSignals, setSimSignals] = useState<SimSignal[]>([]);
  const [simPhase, setSimPhase] = useState<string>("ACCEPTED");
  const [simEta, setSimEta] = useState<number>(0);
  const simTimer = useRef<number | null>(null);

  const clearSimTimer = () => { if (simTimer.current) { window.clearInterval(simTimer.current); simTimer.current = null; } };
  useEffect(() => () => clearSimTimer(), []);

  function stopSim() {
    clearSimTimer();
    setSimId(null); setSimRoute(null); setSimCorridor(null);
    setSimCar(null); setSimSignals([]); setSimPhase("ACCEPTED"); setSimEta(0);
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
    setSimFitSignal((n) => n + 1); // trigger one-shot fitBounds in CrimeMap
    setSimSignals(sigs);
    setSimCar({ lat: corridorPts[0].lat, lng: corridorPts[0].lng });
    setSimPhase("ACCEPTED");
    setSimEta(Math.max(1, Math.round((totalKm / 40) * 3600)));
    const n = corridorPts.length;
    let i = 0;
    window.setTimeout(() => setSimPhase((p) => (p === "ACCEPTED" ? "EN_ROUTE" : p)), 800);
    simTimer.current = window.setInterval(() => {
      i += 1;
      if (i >= n - 1) {
        clearSimTimer();
        setSimCar({ lat: corridorPts[n - 1].lat, lng: corridorPts[n - 1].lng });
        setSimPhase("ON_SCENE"); setSimEta(0);
        window.setTimeout(() => {
          setSimPhase("COMPLETED");
          // Auto-stop 1.5s after showing COMPLETED so routes/corridor clear cleanly.
          window.setTimeout(() => stopSim(), 1500);
        }, 1600);
        return;
      }
      setSimCar({ lat: corridorPts[i].lat, lng: corridorPts[i].lng });
      setSimPhase("EN_ROUTE");
      setSimEta(Math.max(1, Math.round((((1 - i / n) * totalKm) / 40) * 3600)));
    }, 140);
  }

  const simRunning = simId !== null;
  const simDispatch = DEMO_DISPATCHES.find((d) => d.id === simId) ?? null;

  // ── live backend data ──────────────────────────────────────────────────────
  const refreshActive = () => responseOps.activeDispatches().then((r) => setActive(r.active)).catch(() => {});
  useEffect(() => { responseOps.patrols().then(setPatrols); }, []);
  useEffect(() => { responseOps.signals().then(setSignals); }, []);
  useEffect(() => { refreshActive(); const id = setInterval(refreshActive, 2500); return () => clearInterval(id); }, []);

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
          next[i] = { ...next[i], lat: msg.lat, lng: msg.lng, eta_sec: msg.etaSec,
            progress: msg.progress ?? next[i].progress, phase: msg.phase ?? next[i].phase, status: "EN_ROUTE" };
          return next;
        });
      }
      if (msg.type === "DISPATCH_STATUS") {
        setActive((prev) => prev.map((a) =>
          a.dispatchId === msg.dispatchId ? { ...a, status: msg.status, phase: msg.phase ?? msg.status } : a));
        if (msg.status === "COMPLETED") { setLive(null); responseOps.patrols().then(setPatrols); setTimeout(refreshActive, 300); }
      }
      if (msg.type === "SIGNAL_GREEN") setSignals((prev) => prev.map((s) => s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s));
      if (msg.type === "SIGNAL_RESET") setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
      if (msg.type === "GREEN_CORRIDOR_ACTIVE") setCorridor({ routeCoords: msg.routeCoords ?? [], signals: msg.signals ?? [], message: msg.message ?? "" });
      if (msg.type === "GREEN_CORRIDOR_DEACTIVATED") setCorridor(null);
    };
    return () => ws.close();
  }, []);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bengaluru demo scenes — used when no risk zones are available.
  const FALLBACK_SCENES = [
    { lat: 12.985, lng: 77.606 },
    { lat: 12.9719, lng: 77.6412 },
    { lat: 12.9172, lng: 77.6228 },
  ];

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
      setActionError(err?.message?.includes("409") ? "No patrol unit available. Run python -m seed.init_ops --reset to reset units." : "Dispatch failed — check that the backend is running.");
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
        // Nothing to simulate — seed dispatches from risk zones or fallback scenes.
        let scenes = FALLBACK_SCENES;
        try {
          const rz = await responseOps.riskZones();
          if (rz.zones.length >= 2) scenes = rz.zones.slice(0, 3).map((z) => ({ lat: z.center_lat, lng: z.center_lng }));
        } catch { /* use fallback */ }
        for (const s of scenes) {
          try {
            const d = await responseOps.dispatch({ scene_lat: s.lat, scene_lng: s.lng });
            await responseOps.simulate(d.id);
          } catch { /* no free unit — skip */ }
        }
      }
      refreshActive();
    } catch (err: any) {
      setActionError("Simulate All failed — check that the backend is running and ENABLE_RESPONSE_OPS=true.");
    } finally {
      setActionBusy(false);
    }
  }

  async function stopAll() {
    setActionBusy(true);
    setActionError(null);
    try {
      await responseOps.stopAll();
      setLive(null); setCorridor(null);
      refreshActive();
    } catch {
      // Best-effort — clear UI state even if backend call fails.
      setLive(null); setCorridor(null);
    } finally {
      setActionBusy(false);
    }
  }

  const patrolPoints: Hotspot[] = patrols
    .map((p) => ({ lat: p.lat ?? 0, lng: p.lng ?? 0, weight: 1, label: `${p.callsign} (${p.status})` }))
    .filter((p) => p.lat && p.lng);

  const corridorPanel = simRunning
    ? simCorridor ? {
        message: simDispatch ? `Green corridor cleared for ${simDispatch.callsign} \u2192 ${simDispatch.sceneName}` : "Green corridor active",
        signals: simSignals.map((s) => ({ junctionId: s.junction_id, lat: s.lat, lng: s.lng })),
      } : null
    : corridor;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* LEFT */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={simulateAll} disabled={actionBusy}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 text-xs font-bold disabled:opacity-50">
            <Radio className="h-3.5 w-3.5" /> {actionBusy ? t("Working…") : t("Simulate All")}
          </button>
          <button onClick={stopAll} disabled={actionBusy}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1.5 text-xs font-bold hover:bg-muted disabled:opacity-50">
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
            <input className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1" value={scene.lat}
              onChange={(e) => setScene((s) => ({ ...s, lat: parseFloat(e.target.value) || s.lat }))} />
            <input className="w-1/2 rounded-[4px] border-2 border-foreground px-2 py-1" value={scene.lng}
              onChange={(e) => setScene((s) => ({ ...s, lng: parseFloat(e.target.value) || s.lng }))} />
          </div>
          <button onClick={dispatchNearest} disabled={actionBusy}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1.5 font-bold disabled:opacity-50">
            <Navigation className="h-4 w-4" /> {actionBusy ? t("Working…") : t("Dispatch nearest unit")}
          </button>
        </div>

        <h3 className="text-sm font-extrabold">{t("Active Dispatches")} ({active.length})</h3>
        {active.length === 0 && <p className="text-xs text-muted-foreground">{t("No active dispatches. Use Simulate All or dispatch a unit.")}</p>}
        {active.map((a) => (
          <div key={a.dispatchId} className="rounded-[8px] border-2 border-foreground bg-background p-3 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 font-extrabold"><Truck className="h-4 w-4" /> {a.callsign}</span>
              <span className={`rounded-[4px] px-2 py-0.5 text-[10px] font-bold ${
                a.status === "EN_ROUTE" ? "bg-[var(--main,#91C5FD)] text-foreground"
                : a.status === "ON_SCENE" ? "bg-warning text-foreground"
                : a.status === "COMPLETED" ? "bg-success/20 text-success"
                : "bg-muted"}`}>
                {a.status === "EN_ROUTE" ? t("ACTIVE") : a.status}
              </span>
            </div>
            <div className="mb-2"><PhaseTimeline phase={a.phase} /></div>
            <div className="mb-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-[var(--main,#91C5FD)] transition-all" style={{ width: `${Math.round((a.progress ?? 0) * 100)}%` }} />
              </div>
              <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">{Math.round((a.progress ?? 0) * 100)}%</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{t("ETA")} {a.eta_sec > 60 ? `${Math.ceil(a.eta_sec / 60)}m` : `${a.eta_sec}s`}</div>
          </div>
        ))}

        {/* Self-contained Dispatch + Green Corridor simulation */}
        <div className="mt-1 rounded-[8px] border-2 border-foreground p-3">
          <div className="mb-1 flex items-center gap-1 text-sm font-extrabold">
            <Zap className="h-4 w-4 text-[#00C896]" /> {t("Simulate Dispatch & Green Corridor")}
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">{t("Demo routes only \u2014 not linked to live data or the Demo Simulation tab.")}</p>
          <div className="flex flex-col gap-2">
            {DEMO_DISPATCHES.map((d) => {
              const running = simId === d.id;
              return (
                <div key={d.id} className={`rounded-[8px] border-2 p-2 text-xs ${running ? "border-[#00C896] bg-[#00C896]/10" : "border-foreground bg-background"}`}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 font-extrabold"><Truck className="h-3.5 w-3.5" /> {d.callsign}</span>
                    <span className="rounded-[4px] border-2 border-foreground px-1.5 py-0.5 text-[9px] font-bold">{d.id}</span>
                  </div>
                  <div className="mt-0.5 font-semibold">{d.incident}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {d.originName} → {d.sceneName}
                  </div>
                  {running ? (
                    <div className="mt-2">
                      <PhaseTimeline phase={simPhase} />
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] font-bold">
                          {simPhase === "ON_SCENE" || simPhase === "COMPLETED" ? t("Arrived") : `${t("ETA")} ${simEta}s`}
                        </span>
                        <button onClick={stopSim} className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-[10px] font-bold hover:bg-muted">
                          <Square className="h-3 w-3" /> {t("Stop")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => startSim(d)} className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--main,#91C5FD)] px-2 py-1 font-bold">
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
          points={patrolPoints}
          mode="pins"
          routePath={simRunning ? (simRoute ?? undefined) : undefined}
          corridorPath={simRunning ? (simCorridor ?? undefined) : (corridor?.routeCoords ?? undefined)}
          fitSignal={simFitSignal}
          lockBounds={simRunning}
          liveMarker={
            simRunning
              ? simCar ? { lat: simCar.lat, lng: simCar.lng, weight: 3, label: simDispatch ? `${simDispatch.callsign} ${t("en route")}` : t("Patrol en route") } : null
              : live ? { lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") } : null
          }
          signals={simRunning ? simSignals : signals}
        />

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-[6px] border-2 border-foreground bg-background/90 px-3 py-2 text-[10px] font-bold shadow">
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-[#00C896]" /> {t("Green corridor")}</div>
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-[#91C5FD]" /> {t("Initial route")}</div>
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" /> {t("Patrol unit")}</div>
          <div className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" /> {t("Signal")}</div>
        </div>

        {/* Green corridor floating panel */}
        {corridorPanel && (
          <div className="absolute right-3 top-3 z-[1000] w-56 rounded-[8px] border-2 border-foreground bg-background/95 p-3 shadow">
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00C896]" />
              <span className="text-xs font-extrabold text-[#0a8f6b]">{t("Green Corridor")}</span>
              <span className="ml-auto rounded-[4px] bg-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-foreground">{t("ACTIVE")}</span>
            </div>
            <p className="mb-2 text-[10px] text-muted-foreground">{corridorPanel.message}</p>
            <div className="mb-2 text-[10px] font-bold text-muted-foreground">{t("ACTIVE SIGNALS")}</div>
            <div className="flex flex-wrap gap-1">
              {corridorPanel.signals.slice(0, 8).map((s) => (
                <span key={s.junctionId} className="rounded-[4px] border-2 border-[#00C896] px-1.5 py-0.5 text-[9px] font-bold text-[#0a8f6b]">
                  🚦 {s.junctionId}
                </span>
              ))}
            </div>
            <button onClick={simRunning ? stopSim : stopAll}
              className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-[11px] font-bold hover:bg-muted">
              <Square className="h-3 w-3" /> {t("Deactivate Corridor")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
