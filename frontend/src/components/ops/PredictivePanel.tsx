import { useEffect, useMemo, useState } from "react";
import {
  Radar,
  RefreshCw,
  MapPin,
  Clock,
  Zap,
  Play,
  Square,
  ShieldAlert,
  Info,
  ArrowRight,
} from "lucide-react";
import { CrimeMap } from "@/components/CrimeMap";
import { intelligence, type ForecastAlert, type ForecastCell } from "@/lib/api/intelligence";
import { useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";

const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-orange-500 text-white",
  Medium: "bg-warning text-foreground",
  Low: "bg-success/20 text-success",
};
const RISK_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

type LL = { lat: number; lng: number };

function cellForAlert(alert: ForecastAlert, cells: ForecastCell[]): ForecastCell | null {
  if (cells.length === 0) return null;
  const sameType = cells.filter(
    (c) => c.crime_type?.toLowerCase() === alert.crime_type?.toLowerCase(),
  );
  const pool = sameType.length > 0 ? sameType : cells;
  return [...pool].sort((a, b) => b.risk_score - a.risk_score)[0] ?? null;
}

export function PredictivePanel() {
  const { t, lang } = useI18n();
  const [cells, setCells] = useState<ForecastCell[]>([]);
  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  const [simAlertId, setSimAlertId] = useState<string | null>(null);
  const [simCar, setSimCar] = useState<LL | null>(null);
  const [simTarget, setSimTarget] = useState<ForecastCell | null>(null);
  const [fitSignal, setFitSignal] = useState(0);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ horizon_days: "7", grid_size: "0.02" });
      const [a, h] = await Promise.all([
        intelligence.getForecastAlerts(),
        intelligence.getForecastHotspots(p),
      ]);
      setAlerts(a.alerts ?? []);
      setAsOf(a.as_of_date ?? null);
      let cs = h.cells ?? [];
      if (cs.length === 0) {
        try {
          const hot = await api.mapHotspots({ mode: "by_crime" });
          const maxW = Math.max(1, ...(hot.points ?? []).map((p2) => p2.weight));
          cs = (hot.points ?? []).slice(0, 60).map((p2, i) => ({
            cell_id: `hot-${i}`,
            lat: p2.lat,
            lng: p2.lng,
            risk_score: Math.round((p2.weight / maxW) * 100),
            risk_level:
              p2.weight / maxW >= 0.6 ? "High" : p2.weight / maxW >= 0.3 ? "Medium" : "Low",
            crime_type: p2.label ?? "All crime",
            why: [`${Math.round(p2.weight)} historical incidents in this grid cell`],
          }));
        } catch {
          /* ignore */
        }
      }
      setCells(cs);
      if (refresh) stopSim();
    } catch {
      setError(
        t("Could not load forecast data. Check you are signed in and the backend is running."),
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(false);
  }, []);

  function startSim(alert: ForecastAlert) {
    const target = cellForAlert(alert, cells);
    if (!target) return;
    setSimAlertId(alert.alert_id);
    setSimTarget(target);
    // Instantly place the patrol car at the hotspot — simulating pre-deployment.
    setSimCar({ lat: target.lat, lng: target.lng });
    setFitSignal((n) => n + 1);
  }

  function stopSim() {
    setSimAlertId(null);
    setSimCar(null);
    setSimTarget(null);
  }

  const simRunning = simAlertId !== null;

  const points = useMemo(
    () =>
      cells.map((c) => ({
        lat: c.lat,
        lng: c.lng,
        weight: c.risk_score,
        label: `${c.risk_level} · ${c.crime_type} (${c.risk_score})`,
      })),
    [cells],
  );

  const sortedAlerts = useMemo(
    () =>
      [...alerts].sort((a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9)),
    [alerts],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <div className="relative h-[560px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap
          points={points}
          mode="heat"
          darkTiles
          lockBounds={simRunning}
          fitSignal={fitSignal}
          liveMarker={
            simRunning && simCar
              ? { lat: simCar.lat, lng: simCar.lng, weight: 3, label: t("Unit on station") }
              : null
          }
        />
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-[8px] border-2 border-foreground bg-background/90 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-extrabold">
            <Radar className="h-4 w-4" /> {t("Predicted Risk Surface")}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {cells.length} {t("forecast cells")}
            {asOf ? ` · ${t("as of")} ${asOf}` : ""}
          </div>
          {simRunning && simTarget && (
            <div className="mt-1 text-[11px] font-bold text-[#0a8f6b]">
              {t("Unit on station")} → {simTarget.crime_type}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold">{t("Deployment suggestions")}</h3>
            <p className="text-[11px] text-muted-foreground">
              {t("Rule-based forecast · real case data · no synthetic incidents")}
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground px-2 py-1 text-xs font-bold hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{" "}
            {t("Recompute")}
          </button>
        </div>

        {error && (
          <p className="rounded-[6px] border-2 border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {!error && sortedAlerts.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground">{t("No active forecast alerts.")}</p>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {sortedAlerts.map((a) => {
            const running = simAlertId === a.alert_id;
            return (
              <div
                key={a.alert_id}
                className={`rounded-[8px] border-2 p-3 ${running ? "border-[#00C896] bg-[#00C896]/5" : "border-foreground bg-background"}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span className="font-extrabold">{tData("crime_type", a.crime_type, lang)}</span>
                  <span
                    className={`ml-auto rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold ${RISK_BG[a.risk_level] ?? "bg-muted"}`}
                  >
                    {tData("risk_label", a.risk_level, lang)}
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {tData("district", a.district, lang)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {a.patrol_window}
                  </span>
                </div>
                {a.why && <p className="mb-2 text-[11px] text-foreground/75">{t(a.why)}</p>}
                <div className="mb-2 flex items-start gap-1.5 rounded-[6px] border-2 border-foreground/20 bg-muted/30 px-2 py-1.5">
                  <Zap className="mt-0.5 h-3 w-3 shrink-0 text-[#0a8f6b]" />
                  <span className="text-[11px] font-semibold">{t(a.recommended_action)}</span>
                </div>
                {a.fairness_note && (
                  <div className="mb-2 flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="text-[10px] italic text-muted-foreground">
                      {t(a.fairness_note)}
                    </span>
                  </div>
                )}
                {running ? (
                  <button
                    onClick={stopSim}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold hover:bg-muted"
                  >
                    <Square className="h-3.5 w-3.5" /> {t("Unit on station — Reset")}
                  </button>
                ) : (
                  <button
                    onClick={() => startSim(a)}
                    disabled={cells.length === 0}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--success,#00C896)] px-2 py-1 text-xs font-bold text-foreground disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" /> {t("Simulate deployment")}{" "}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
