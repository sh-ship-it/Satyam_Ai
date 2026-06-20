import { useEffect, useState } from "react";
import { RefreshCw, MapPin, Clock, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { responseOps, type RiskZone, type Suggestion } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-orange-500 text-white",
  Medium: "bg-warning text-foreground",
  Low: "bg-success/20 text-success",
};

export function PredictivePanel() {
  const t = useT();
  const [zones, setZones] = useState<RiskZone[]>([]);
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const [z, s] = await Promise.all([responseOps.riskZones(refresh), responseOps.suggestions()]);
      setZones(z.zones);
      setSugs(s.suggestions);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(false); }, []);

  async function act(id: number, action: "accept" | "dismiss") {
    await responseOps.actSuggestion(id, action);
    setSugs((prev) => prev.filter((s) => s.id !== id));
    if (action === "accept") load(false);
  }

  const points: Hotspot[] = zones.map((z) => ({
    lat: z.center_lat, lng: z.center_lng, weight: z.risk_score, label: `${z.risk_label} (${z.risk_score})`,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="h-[520px] overflow-hidden rounded-[8px] border-2 border-foreground">
        <CrimeMap points={points} mode="heat" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold">{t("Deployment suggestions")}</h3>
          <button onClick={() => load(true)} disabled={loading}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground px-2 py-1 text-xs font-bold hover:bg-muted">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {t("Recompute")}
          </button>
        </div>

        {sugs.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("No pending suggestions.")}</p>
        )}

        {sugs.map((s) => (
          <div key={s.id} className="rounded-[8px] border-2 border-foreground bg-background p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-extrabold">{s.patrol_callsign ?? `Unit #${s.patrol_id}`}</span>
              <ArrowRight className="h-4 w-4" />
              <span className="inline-flex items-center gap-1 text-xs"><MapPin className="h-3 w-3" /> {s.to_lat.toFixed(3)}, {s.to_lng.toFixed(3)}</span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
              {s.distance_km != null && <span>{s.distance_km} km away</span>}
              {s.response_improve_sec != null && (
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> ~{Math.round(s.response_improve_sec / 60)} min faster</span>
              )}
            </div>
            {s.reasons?.length > 0 && (
              <ul className="mb-2 list-disc pl-4 text-[11px] text-muted-foreground">
                {s.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <div className="flex gap-2">
              <button onClick={() => act(s.id, "accept")}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--success,#00C896)] px-2 py-1 text-xs font-bold text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t("Accept")}
              </button>
              <button onClick={() => act(s.id, "dismiss")}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold hover:bg-muted">
                <XCircle className="h-3.5 w-3.5" /> {t("Dismiss")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
