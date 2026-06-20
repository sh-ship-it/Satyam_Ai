import { useEffect, useRef, useState } from "react";
import { Truck, Navigation, Play } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, openOpsSocket, type Patrol, type DispatchResult } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

export function DispatchPanel() {
  const t = useT();
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [active, setActive] = useState<DispatchResult | null>(null);
  const [live, setLive] = useState<{ lat: number; lng: number; etaSec: number } | null>(null);
  const [scene, setScene] = useState({ lat: 12.9352, lng: 77.6245 });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => { responseOps.patrols().then(setPatrols); }, []);

  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "PATROL_LOCATION" && (!active || msg.dispatchId === active.id)) {
        setLive({ lat: msg.lat, lng: msg.lng, etaSec: msg.etaSec });
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  async function dispatchNearest() {
    const d = await responseOps.dispatch({ scene_lat: scene.lat, scene_lng: scene.lng });
    setActive(d);
    setLive(null);
    await responseOps.simulate(d.id);
  }

  const patrolPoints: Hotspot[] = patrols.map((p) => ({
    lat: p.lat ?? 0, lng: p.lng ?? 0, weight: 1, label: `${p.callsign} (${p.status})`,
  })).filter((p) => p.lat && p.lng);
  const livePoint: Hotspot[] = live ? [{ lat: live.lat, lng: live.lng, weight: 3, label: t("Patrol en route") }] : [];
  const routeLine: Hotspot[] = active ? active.route.map(([lng, lat]) => ({ lat, lng, weight: 1 })) : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="h-[520px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap points={patrolPoints} mode="pins" trail={routeLine} focus={livePoint} animateKey={live ? Date.now() : 0} />
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-extrabold">{t("Dispatch")}</h3>
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
        {active && (
          <div className="rounded-[8px] border-2 border-foreground p-3 text-xs">
            <div className="flex items-center gap-2 font-bold"><Truck className="h-4 w-4" /> {active.patrol_callsign}</div>
            <div className="mt-1 text-muted-foreground">
              {active.distance_km?.toFixed(1)} km · ETA {live ? Math.round(live.etaSec / 60) : Math.round((active.eta_sec ?? 0) / 60)} min
            </div>
            <div className="mt-1 inline-flex items-center gap-1 text-[11px]"><Play className="h-3 w-3" /> {live ? t("Live") : active.status}</div>
          </div>
        )}
      </div>
    </div>
  );
}
