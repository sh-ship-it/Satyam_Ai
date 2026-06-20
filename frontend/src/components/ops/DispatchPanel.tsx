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
