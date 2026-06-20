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
