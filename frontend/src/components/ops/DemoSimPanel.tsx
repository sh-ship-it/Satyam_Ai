import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, Square, Zap, Activity, Truck } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { useT } from "@/lib/i18n";

type LL = { lat: number; lng: number };
type Phase = "ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED";
type SimSignal = { id: number; junction_id: string; lat: number; lng: number; state: string };
type Dispatch = {
  id: number;
  callsign: string;
  sceneName: string;
  origin: LL;
  scene: LL;
  route: Hotspot[];
  corridor: [number, number][];
  signals: SimSignal[];
  carIdx: number;
  car: LL;
  phase: Phase;
  distanceKm: number;
  etaSec: number;
  holdTicks: number;
};
type FeedItem = { id: string; text: string; ts: string };

const FALLBACK_SCENES = [
  { name: "MG Road armed robbery", lat: 12.9759, lng: 77.6063 },
  { name: "Domlur chain snatching", lat: 12.9609, lng: 77.6387 },
  { name: "Trinity hit-and-run", lat: 12.9731, lng: 77.62 },
  { name: "Hosur Rd affray", lat: 12.9279, lng: 77.6271 },
];
const CALLSIGNS = ["PCR-21", "PCR-07", "PCR-14", "PCR-03", "PCR-19"];
const SPEED_KMH = 40;
const TICK_MS = 130;

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

function straightRoute(a: LL, b: LL, steps = 50): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    out.push([lerp(a.lat, b.lat, f), lerp(a.lng, b.lng, f)]);
  }
  return out;
}

function curvedRoute(a: LL, b: LL, bend = 0.2, steps = 56): Hotspot[] {
  const mx = (a.lat + b.lat) / 2,
    my = (a.lng + b.lng) / 2;
  const dx = b.lat - a.lat,
    dy = b.lng - a.lng;
  const cx = mx - dy * bend,
    cy = my + dx * bend;
  const out: Hotspot[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    out.push({
      lat: (1 - f) * (1 - f) * a.lat + 2 * (1 - f) * f * cx + f * f * b.lat,
      lng: (1 - f) * (1 - f) * a.lng + 2 * (1 - f) * f * cy + f * f * b.lng,
      weight: 1,
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
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function makeSignals(route: [number, number][], id: number): SimSignal[] {
  return [0.2, 0.45, 0.7, 0.9].map((f, k) => {
    const idx = Math.min(route.length - 1, Math.floor(route.length * f));
    const [lat, lng] = route[idx];
    return { id: -(9000 + id * 10 + k), junction_id: `D${id}-J${k + 1}`, lat, lng, state: "GREEN" };
  });
}

export function DemoSimPanel() {
  const t = useT();
  const [demoMode, setDemoMode] = useState(false);
  const scenes = FALLBACK_SCENES;
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushFeed = (text: string) =>
    setFeed((f) =>
      [
        { id: `${Date.now()}-${Math.random()}`, text, ts: new Date().toLocaleTimeString() },
        ...f,
      ].slice(0, 40),
    );

  const clearTimer = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => () => clearTimer(), []);

  function buildDispatches(): Dispatch[] {
    return scenes.slice(0, 5).map((s, i) => {
      const scene: LL = { lat: s.lat, lng: s.lng };
      const origin: LL = { lat: s.lat - 0.018 - i * 0.004, lng: s.lng - 0.022 - i * 0.003 };
      const route = curvedRoute(origin, scene, 0.22, 56);
      const corridor = straightRoute(origin, scene, 50);
      return {
        id: i + 1,
        callsign: CALLSIGNS[i % CALLSIGNS.length],
        sceneName: s.name,
        origin,
        scene,
        route,
        corridor,
        signals: makeSignals(corridor, i + 1),
        carIdx: 0,
        car: origin,
        phase: "ACCEPTED" as Phase,
        distanceKm: haversineKm(origin, scene),
        etaSec: (haversineKm(origin, scene) / SPEED_KMH) * 3600,
        holdTicks: 0,
      };
    });
  }

  function simulateAll() {
    clearTimer();
    const ds = buildDispatches();
    setDispatches(ds);
    ds.forEach((d) => pushFeed(`${d.callsign} dispatched → ${d.sceneName}`));
    timer.current = setInterval(() => {
      setDispatches((prev) => {
        let allDone = true;
        const next = prev.map((d) => {
          if (d.phase === "COMPLETED") return d;
          allDone = false;
          if (d.phase === "ACCEPTED") return { ...d, phase: "EN_ROUTE" as Phase };
          if (d.phase === "EN_ROUTE") {
            const idx = d.carIdx + 1;
            if (idx >= d.corridor.length) {
              pushFeed(`${d.callsign} on scene — ${d.sceneName}`);
              return { ...d, phase: "ON_SCENE" as Phase, holdTicks: 0, etaSec: 0 };
            }
            const [lat, lng] = d.corridor[idx];
            return {
              ...d,
              carIdx: idx,
              car: { lat, lng },
              etaSec: (haversineKm({ lat, lng }, d.scene) / SPEED_KMH) * 3600,
            };
          }
          if (d.phase === "ON_SCENE") {
            if (d.holdTicks > 12) {
              pushFeed(`${d.callsign} cleared — corridor released`);
              return { ...d, phase: "COMPLETED" as Phase };
            }
            return { ...d, holdTicks: d.holdTicks + 1 };
          }
          return d;
        });
        if (allDone) clearTimer();
        return next;
      });
    }, TICK_MS);
  }

  function stopAll() {
    clearTimer();
    setDispatches([]);
    pushFeed("All simulations stopped");
  }

  function toggleDemo() {
    if (demoMode) {
      stopAll();
      setDemoMode(false);
    } else {
      setDemoMode(true);
    }
  }

  const active = dispatches.filter((d) => d.phase !== "COMPLETED");
  const scenePoints: Hotspot[] = dispatches.map((d) => ({
    lat: d.scene.lat,
    lng: d.scene.lng,
    weight: 2,
    label: d.sceneName,
  }));
  const routePaths: Hotspot[][] = active.map((d) => d.route);
  const liveMarkers: Hotspot[] = active
    .filter((d) => d.phase === "EN_ROUTE")
    .map((d) => ({
      lat: d.car.lat,
      lng: d.car.lng,
      weight: 3,
      label: `${d.callsign} ${t("en route")}`,
    }));
  const signals: SimSignal[] = active.flatMap((d) => d.signals);
  const lead = active.find((d) => d.phase === "EN_ROUTE");
  const corridorPath = lead ? lead.corridor : undefined;
  const greenCount = signals.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggleDemo}
          className={`inline-flex items-center gap-2 rounded-[6px] border-2 border-foreground px-3 py-1.5 text-sm font-bold ${demoMode ? "bg-[var(--main,#91C5FD)]" : "bg-background"}`}
        >
          <Radio className="h-4 w-4" /> {demoMode ? t("Demo Mode ON") : t("Demo Mode OFF")}
        </button>
        <button
          onClick={simulateAll}
          disabled={!demoMode}
          className="inline-flex items-center gap-2 rounded-[6px] border-2 border-foreground bg-foreground px-3 py-1.5 text-sm font-bold text-background disabled:opacity-40"
        >
          <Zap className="h-4 w-4" /> {t("Simulate All")}
        </button>
        <button
          onClick={stopAll}
          className="inline-flex items-center gap-2 rounded-[6px] border-2 border-foreground bg-background px-3 py-1.5 text-sm font-bold"
        >
          <Square className="h-4 w-4" /> {t("Stop All")}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {t("Runs in-browser — scenes from real forecast hotspots, no backend required.")}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_300px]">
        <aside className="flex flex-col gap-2">
          <h3 className="text-sm font-extrabold">
            {t("Active Dispatches")} ({active.length})
          </h3>
          {dispatches.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("Turn on Demo Mode, then hit Simulate All.")}
            </p>
          )}
          {dispatches.map((d) => (
            <div key={d.id} className="rounded-[8px] border-2 border-foreground p-2 text-xs">
              <div className="flex items-center justify-between font-bold">
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" /> {d.callsign}
                </span>
                <span className="rounded-[4px] border-2 border-foreground px-1 text-[10px]">
                  {d.phase}
                </span>
              </div>
              <div className="mt-1 text-muted-foreground">{d.sceneName}</div>
              <div className="mt-0.5 text-muted-foreground">
                {d.distanceKm.toFixed(1)} km · ETA {Math.max(0, Math.round(d.etaSec / 60))}{" "}
                {t("min")}
              </div>
            </div>
          ))}
        </aside>

        <div className="h-[520px] overflow-hidden rounded-[8px] border-2 border-foreground">
          <CrimeMap
            points={scenePoints}
            mode="pins"
            darkTiles
            lockBounds={active.length > 0}
            routePaths={routePaths}
            corridorPath={corridorPath}
            liveMarkers={liveMarkers}
            signals={signals}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-[8px] border-2 border-foreground p-3">
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <Zap className="h-4 w-4" /> {t("Green Corridor")}
              <span
                className={`ml-auto rounded-[4px] border-2 border-foreground px-1 text-[10px] ${greenCount > 0 ? "bg-[#00C896] text-black" : ""}`}
              >
                {greenCount > 0 ? t("ACTIVE") : t("IDLE")}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Signals prioritized for responding units.")}
            </p>
            <div className="mt-2 text-xs">
              <b>{greenCount}</b> {t("signals green")}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-[8px] border-2 border-foreground p-3">
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <Activity className="h-4 w-4" /> {t("Live Event Feed")}
            </div>
            <ul className="mt-2 flex max-h-[320px] flex-col gap-1 overflow-y-auto text-[11px]">
              {feed.length === 0 && (
                <li className="text-muted-foreground">{t("No events yet.")}</li>
              )}
              {feed.map((f) => (
                <li
                  key={f.id}
                  className="flex justify-between gap-2 border-b border-foreground/20 pb-1"
                >
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
