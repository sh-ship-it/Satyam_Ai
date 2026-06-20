import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Radio, Square, Route as RouteIcon, Zap } from "lucide-react";
import { responseOps, openOpsSocket, type Patrol, type Signal, type ActiveDispatch } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

const BENGALURU: [number, number] = [12.9716, 77.5946];

type SignalState = { id?: number; junction_id: string; lat: number; lng: number; state: string };
type CorridorState = {
  routeCoords: [number, number][];
  signals: { junctionId: string; lat: number; lng: number }[];
  message: string;
} | null;
type RouteLine = { id: number; coords: [number, number][] };

// Inject keyframes once (pulse / dash / glow).
const KF_ID = "ops-livemap-kf";
function ensureKeyframes() {
  if (typeof document === "undefined" || document.getElementById(KF_ID)) return;
  const st = document.createElement("style");
  st.id = KF_ID;
  st.textContent = `
@keyframes opsmap-pulse{0%{transform:scale(.6);opacity:.85}100%{transform:scale(2.1);opacity:0}}
@keyframes opsmap-dash{to{stroke-dashoffset:-1000}}
@keyframes opsmap-glow{0%,100%{filter:drop-shadow(0 0 3px #3BA0FF)}50%{filter:drop-shadow(0 0 9px #3BA0FF)}}
.opsmap-route-core{stroke-dasharray:14 10;animation:opsmap-dash 18s linear infinite}`;
  document.head.appendChild(st);
}

export function LiveOperationsMap() {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [signals, setSignals] = useState<SignalState[]>([]);
  const [zoneCount, setZoneCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [active, setActive] = useState<ActiveDispatch[]>([]);
  const [routes, setRoutes] = useState<RouteLine[]>([]);
  const [corridor, setCorridor] = useState<CorridorState>(null);
  const [showRoutes, setShowRoutes] = useState(true);
  const [demoOn, setDemoOn] = useState(false);

  // Layer refs
  const tileRef = useRef<any>(null);
  const incidentLayerRef = useRef<any>(null);
  const signalLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const vehiclesRef = useRef<Map<number, any>>(new Map());
  const liveRef = useRef<Record<number, { lat: number; lng: number; etaSec: number }>>({});

  const refreshActive = () =>
    responseOps.activeDispatches().then((r) => setActive(r.active)).catch(() => {});

  // ── Initial data load ──────────────────────────────────────────────────────
  useEffect(() => {
    responseOps.patrols().then(setPatrols).catch(() => {});
    responseOps.signals().then((s) => setSignals(s as any)).catch(() => {});
    responseOps.riskZones().then((r) => setZoneCount(r.zones.length)).catch(() => {});
    responseOps.reviewQueue().then((q) => setReviewCount(q.length)).catch(() => {});
    refreshActive();
    const id = setInterval(refreshActive, 2500);
    return () => clearInterval(id);
  }, []);

  // ── Init Leaflet (dark tiles) ──────────────────────────────────────────────
  useEffect(() => {
    ensureKeyframes();
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, { center: BENGALURU, zoom: 12, zoomControl: true });
      tileRef.current = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
        attribution: "© OSM © CARTO", maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      vehiclesRef.current.clear();
    };
  }, []);

  // ── WebSocket live events ──────────────────────────────────────────────────
  useEffect(() => {
    const ws = openOpsSocket();
    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case "PATROL_LOCATION":
          liveRef.current[msg.dispatchId] = { lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec };
          moveVehicle(msg.dispatchId, msg.lat, msg.lng, msg.patrolId);
          setActive((prev) => {
            const i = prev.findIndex((a) => a.dispatchId === msg.dispatchId);
            if (i < 0) { refreshActive(); return prev; }
            const next = [...prev];
            next[i] = { ...next[i], lat: msg.lat, lng: msg.lng, eta_sec: msg.etaSec,
              progress: msg.progress ?? next[i].progress, phase: msg.phase ?? next[i].phase, status: "EN_ROUTE" };
            return next;
          });
          break;
        case "DISPATCH_STATUS":
          setActive((prev) => prev.map((a) =>
            a.dispatchId === msg.dispatchId ? { ...a, status: msg.status, phase: msg.phase ?? msg.status } : a));
          if (msg.status === "COMPLETED" || msg.status === "CANCELLED") {
            removeVehicle(msg.dispatchId);
            setRoutes((prev) => prev.filter((r) => r.id !== msg.dispatchId));
            responseOps.patrols().then(setPatrols).catch(() => {});
            setTimeout(refreshActive, 300);
          }
          break;
        case "SIGNAL_GREEN":
          setSignals((prev) => prev.map((s) => (s.junction_id === msg.junctionId ? { ...s, state: "GREEN" } : s)));
          break;
        case "SIGNAL_RESET":
          setSignals((prev) => prev.map((s) => ({ ...s, state: "NORMAL" })));
          break;
        case "GREEN_CORRIDOR_ACTIVE":
          setCorridor({ routeCoords: msg.routeCoords ?? [], signals: msg.signals ?? [], message: msg.message ?? "" });
          break;
        case "GREEN_CORRIDOR_DEACTIVATED":
          setCorridor(null);
          break;
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ── Vehicle marker helpers (move, never re-create; panTo only off-screen) ──
  function moveVehicle(dispatchId: number, lat: number, lng: number, _patrolId?: number) {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L) return;
    const ll: [number, number] = [lat, lng];
    let m = vehiclesRef.current.get(dispatchId);
    if (!m) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px">`
          + `<span style="position:absolute;width:30px;height:30px;border-radius:9999px;background:#7c3aed55;animation:opsmap-pulse 1.4s ease-out infinite"></span>`
          + `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;border:2px solid #a855f7;background:#1e1b2e;font-size:15px;line-height:1">\uD83D\uDE93</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      });
      m = L.marker(ll, { icon }).addTo(map);
      vehiclesRef.current.set(dispatchId, m);
    } else {
      m.setLatLng(ll);
    }
    if (!map.getBounds().contains(ll)) map.panTo(ll, { animate: true });
  }

  function removeVehicle(dispatchId: number) {
    const map = mapRef.current;
    const m = vehiclesRef.current.get(dispatchId);
    if (m && map) map.removeLayer(m);
    vehiclesRef.current.delete(dispatchId);
    delete liveRef.current[dispatchId];
  }

  // ── Incident markers (pulsing orange) from review queue + risk zones ───────
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (incidentLayerRef.current) { map.removeLayer(incidentLayerRef.current); incidentLayerRef.current = null; }
    const group = L.layerGroup();
    active.forEach((a) => {
      if (a.sceneLat == null || a.sceneLng == null) return;
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center">`
          + `<span style="position:absolute;width:22px;height:22px;border-radius:9999px;background:#f9731688;animation:opsmap-pulse 1.6s ease-out infinite"></span>`
          + `<span style="position:relative;width:11px;height:11px;border-radius:9999px;background:#ef4444;border:2px solid #fff"></span></div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      });
      L.marker([a.sceneLat, a.sceneLng], { icon }).bindTooltip(`Scene · ${a.callsign ?? ""}`).addTo(group);
    });
    group.addTo(map);
    incidentLayerRef.current = group;
  }, [active, ready]);

  // ── Signal dots (green when GREEN, grey otherwise) ─────────────────────────
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (signalLayerRef.current) { map.removeLayer(signalLayerRef.current); signalLayerRef.current = null; }
    if (!signals.length) return;
    const group = L.layerGroup();
    signals.forEach((s) => {
      const green = s.state === "GREEN";
      L.circleMarker([s.lat, s.lng], {
        radius: green ? 7 : 5,
        color: green ? "#00E6A8" : "#374151",
        weight: 2,
        fillColor: green ? "#00E6A8" : "#6b7280",
        fillOpacity: green ? 1 : 0.8,
      }).bindTooltip(`${s.junction_id} · ${s.state}`).addTo(group);
    });
    group.addTo(map);
    signalLayerRef.current = group;
  }, [signals, ready]);

  // ── Route polylines (3-layer glow); corridor route in green ────────────────
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (routeLayerRef.current) { map.removeLayer(routeLayerRef.current); routeLayerRef.current = null; }
    if (!showRoutes) return;
    const group = L.layerGroup();
    const drawGlow = (coords: [number, number][], color: string, animate: boolean) => {
      if (coords.length < 2) return;
      L.polyline(coords, { color, weight: 16, opacity: 0.15 }).addTo(group);
      L.polyline(coords, { color, weight: 8, opacity: 0.4 }).addTo(group);
      const core = L.polyline(coords, { color, weight: 3, opacity: 0.95 }).addTo(group);
      if (animate && core.getElement) {
        // className set after add so the SVG path exists
        try { core.getElement()?.classList.add("opsmap-route-core"); } catch { /* noop */ }
      }
    };
    routes.forEach((r) => drawGlow(r.coords, "#3BA0FF", true));
    if (corridor && corridor.routeCoords.length >= 2) drawGlow(corridor.routeCoords, "#00E6A8", true);
    group.addTo(map);
    routeLayerRef.current = group;
  }, [routes, corridor, showRoutes, ready]);

  // ── DEMO control ───────────────────────────────────────────────────────────
  async function toggleDemo() {
    if (demoOn) { await stopAll(); return; }
    setDemoOn(true);
    try {
      // Ensure there is something to animate: seed a couple of dispatches from risk zones.
      const cur = await responseOps.activeDispatches().catch(() => ({ active: [] as ActiveDispatch[] }));
      if (cur.active.length === 0) {
        const rz = await responseOps.riskZones().catch(() => ({ zones: [] as any[] }));
        const seeds = rz.zones.slice(0, 3);
        for (const z of seeds) {
          try {
            const d = await responseOps.dispatch({ scene_lat: z.center_lat, scene_lng: z.center_lng });
            const coords = (d.route ?? []).map(([lng, lat]) => [lat, lng] as [number, number]);
            setRoutes((prev) => [...prev, { id: d.id, coords }]);
          } catch { /* no free unit */ }
        }
      }
      await responseOps.simulateAll();
      refreshActive();
    } catch { /* ignore */ }
  }

  async function stopAll() {
    setDemoOn(false);
    try { await responseOps.stopAll(); } catch { /* ignore */ }
    setCorridor(null);
    setRoutes([]);
    liveRef.current = {};
    vehiclesRef.current.forEach((m) => { try { mapRef.current?.removeLayer(m); } catch { /* noop */ } });
    vehiclesRef.current.clear();
    responseOps.patrols().then(setPatrols).catch(() => {});
    responseOps.signals().then((s) => setSignals(s as any)).catch(() => {});
    refreshActive();
  }

  // ── Derived header counts ──────────────────────────────────────────────────
  const enRouteCount = active.filter((a) => a.status === "EN_ROUTE").length;
  const incidents = reviewCount + zoneCount;
  const greenSignals = signals.filter((s) => s.state === "GREEN");

  return (
    <div className="absolute inset-0 bg-[#0b0f17]">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* HEADER (top-left) */}
      <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex flex-col gap-2">
        <div className="pointer-events-auto rounded-[8px] border-2 border-foreground bg-background/90 px-4 py-2 backdrop-blur">
          <div className="text-base font-extrabold leading-none">{t("Live Operations Map")}</div>
          <div className="mt-1 flex items-center gap-1 text-[11px] font-bold tracking-wide text-muted-foreground">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#00E6A8]" />
            LIVE — {incidents} {t("INCIDENTS")} — {patrols.length} {t("UNITS")} — {enRouteCount} {t("ROUTES")}
          </div>
        </div>

        {/* Green corridor banner */}
        {corridor && (
          <div className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-full border-2 border-[#00E6A8] bg-[#06281f]/90 px-3 py-1 text-[11px] font-extrabold text-[#00E6A8] backdrop-blur">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#00E6A8]" />
            {t("GREEN CORRIDOR ACTIVE")} · {corridor.signals.length} {t("signals")}
          </div>
        )}
      </div>

      {/* TOP-RIGHT controls + legend */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button
            onClick={toggleDemo}
            className={`inline-flex items-center gap-1 rounded-full border-2 border-foreground px-3 py-1.5 text-xs font-extrabold backdrop-blur ${
              demoOn ? "bg-[#00E6A8] text-black" : "bg-background/90 text-foreground"
            }`}
          >
            {demoOn ? <Square className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />} DEMO
          </button>
          <button
            onClick={() => setShowRoutes((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border-2 border-foreground px-3 py-1.5 text-xs font-extrabold backdrop-blur ${
              showRoutes ? "bg-[var(--main,#91C5FD)] text-foreground" : "bg-background/90 text-muted-foreground"
            }`}
          >
            <RouteIcon className="h-3.5 w-3.5" /> {t("Routes")}
          </button>
        </div>

        <div className="rounded-[8px] border-2 border-foreground bg-background/90 px-3 py-2 text-[10px] font-bold backdrop-blur">
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f97316]" /> {t("Incident")}</div>
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#a855f7]" /> {t("Patrol")}</div>
          <div className="mb-1 flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#00E6A8]" /> {t("Signal")}</div>
          <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ef4444]" /> {t("Scene")}</div>
        </div>
      </div>

      {/* Floating Green Corridor panel (bottom-right) */}
      {corridor && (
        <div className="absolute bottom-4 right-3 z-[1000] w-64 rounded-[10px] border-2 border-foreground bg-background/95 p-3 backdrop-blur">
          <div className="mb-1 flex items-center gap-2">
            <Zap className="h-4 w-4 text-[#00E6A8]" />
            <span className="text-sm font-extrabold text-[#0a8f6b]">{t("Green Corridor")}</span>
            <span className="ml-auto rounded-[4px] bg-[#00E6A8] px-1.5 py-0.5 text-[9px] font-bold text-black">{t("ACTIVE")}</span>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            {t("Traffic signals prioritized for emergency vehicle")}
          </p>
          <div className="mb-1 text-[10px] font-bold text-muted-foreground">
            {t("ACTIVE SIGNALS")} ({corridor.signals.length})
          </div>
          <div className="mb-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {corridor.signals.map((s) => (
              <span key={s.junctionId} className="rounded-[4px] border-2 border-[#00E6A8] px-1.5 py-0.5 text-[9px] font-bold text-[#0a8f6b]">
                🚦 {s.junctionId}
              </span>
            ))}
          </div>
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold">
            <span className="text-muted-foreground">{t("SIGNALS")}: {greenSignals.length}</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#00E6A8]" /> {t("STATUS")}
            </span>
          </div>
          <button
            onClick={stopAll}
            className="inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[#e11d48] px-2 py-1.5 text-[11px] font-bold text-white"
          >
            <Square className="h-3 w-3" /> {t("Deactivate Corridor")}
          </button>
        </div>
      )}
    </div>
  );
}
