import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useState } from "react";
import {
  AlertTriangle, ShieldAlert, Activity, MapPin, Clock,
  ChevronDown, ChevronUp, Filter, RefreshCw, Bell, BellOff,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import {
  intelligence,
  type ForecastAlert,
  type ForecastCell,
  type BacktestResponse,
} from "@/lib/api/intelligence";

export const Route = createFileRoute("/forecast")({
  head: () => ({ meta: [{ title: "Early Warning & Forecast · Satyam" }] }),
  component: ForecastScreen,
});

// ── Risk colour helpers ───────────────────────────────────────────────────────
const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High:     "bg-orange-500 text-white",
  Medium:   "bg-yellow-400 text-foreground",
  Low:      "bg-success/20 text-success",
};
const RISK_BORDER: Record<string, string> = {
  Critical: "border-destructive",
  High:     "border-orange-400",
  Medium:   "border-yellow-400",
  Low:      "border-success",
};
const RISK_DOT: Record<string, string> = {
  Critical: "bg-destructive animate-ping",
  High:     "bg-orange-500",
  Medium:   "bg-yellow-400",
  Low:      "bg-success",
};

function RiskBadge({ level, lang }: { level: string; lang: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[10px] font-bold ${RISK_BG[level] || "bg-muted"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${RISK_DOT[level] || "bg-muted-foreground"}`} />
      {tData("risk_label", level, lang)}
    </span>
  );
}

// ── Risk bar (visual score gauge) ─────────────────────────────────────────────
function RiskBar({ score }: { score: number }) {
  const pct = Math.min(100, score);
  const color = pct >= 75 ? "bg-destructive" : pct >= 55 ? "bg-orange-500" : pct >= 30 ? "bg-yellow-400" : "bg-success";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden border border-border">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-extrabold tabular-nums w-6 text-right">{score}</span>
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────
function AlertCard({ a, expanded, onToggle, lang, t }: {
  a: ForecastAlert; expanded: boolean; onToggle: () => void; lang: string; t: (s: string) => string;
}) {
  return (
    <div className={`rounded-[5px] border-2 bg-card nb-shadow-sm transition-all ${RISK_BORDER[a.risk_level] || "border-foreground"}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <RiskBadge level={a.risk_level} lang={lang} />
            <span className="text-sm font-extrabold">{tData("crime_type", a.crime_type, lang)}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{tData("district", a.district, lang)}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 shrink-0" />
              {t("Patrol")}: <strong className="text-foreground ml-1">{a.patrol_window}</strong>
            </span>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="shrink-0 rounded-[3px] border border-border bg-muted/40 p-1 hover:bg-muted transition"
          aria-label={t("Toggle details")}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Why fired — always visible */}
      <div className="px-4 pb-3">
        <p className="text-xs text-foreground/80 leading-relaxed">{a.why}</p>
      </div>

      {/* Expandable detail drawer */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-2.5 rounded-b-[3px]">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">
              {t("Recommended Action")}
            </div>
            <p className="text-xs font-bold text-primary">{a.recommended_action}</p>
          </div>
          <div className="flex items-start gap-2 rounded-[3px] border border-border bg-background px-2.5 py-2">
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground italic">{a.fairness_note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cell detail drawer ────────────────────────────────────────────────────────
function CellRow({ c, expanded, onToggle, lang, t }: {
  c: ForecastCell; expanded: boolean; onToggle: () => void; lang: string; t: (s: string) => string;
}) {
  return (
    <>
      <tr className="hover:bg-muted/20 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2.5"><RiskBadge level={c.risk_level} lang={lang} /></td>
        <td className="px-4 py-2.5 font-medium text-sm">{tData("crime_type", c.crime_type, lang)}</td>
        <td className="px-4 py-2.5 w-32"><RiskBar score={c.risk_score} /></td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{c.lat.toFixed(3)},&nbsp;{c.lng.toFixed(3)}</td>
        <td className="px-4 py-2.5">
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-6 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
              {t("Why this cell is flagged")}
            </div>
            <ul className="space-y-1">
              {c.why.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function ForecastScreen() {
  const t = useT();
  const { lang } = useI18n();
  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [alertsAsOf, setAlertsAsOf] = useState<string | null>(null);
  const [cells, setCells] = useState<ForecastCell[]>([]);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [horizon, setHorizon] = useState(7);

  // Expanded rows
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  // Group cells by crime type
  const [groupBy, setGroupBy] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ horizon_days: String(horizon) });
    if (crimeType) p.set("crime_type", crimeType);
    if (district)  p.set("district", district);
    Promise.all([
      intelligence.getForecastAlerts(),
      intelligence.getForecastHotspots(p),
      intelligence.getForecastBacktest(),
    ]).then(([a, h, b]) => {
      setAlerts(a.alerts);
      setAlertsAsOf(a.as_of_date);
      setCells(h.cells.slice(0, 30));
      setBacktest(b);
    }).catch(() => setError(t("Could not load forecast data. Check you are signed in and the backend is running.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [crimeType, district, horizon]);

  // Grouped cells: top cell per crime type
  const groupedCells = groupBy
    ? Object.values(
        cells.reduce<Record<string, ForecastCell>>((acc, c) => {
          if (!acc[c.crime_type] || c.risk_score > acc[c.crime_type].risk_score)
            acc[c.crime_type] = c;
          return acc;
        }, {}),
      ).sort((a, b) => b.risk_score - a.risk_score)
    : cells;

  const criticalCount = alerts.filter(a => a.risk_level === "Critical" || a.risk_level === "High").length;

  return (
    <Shell>
      <div className="flex flex-col h-full overflow-auto bg-background">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="border-b-2 border-foreground bg-header px-6 py-4 text-header-foreground">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-0.5">
                {t("PS8 · Predictive Intelligence")}
              </div>
              <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
                <Bell className="h-5 w-5" />
                {t("Early Warning & Forecast")}
              </h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {backtest && (
                <div className="flex items-center gap-2 rounded-[5px] border-2 border-header-foreground bg-success/20 px-3 py-1.5">
                  <Activity className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs font-extrabold">
                    PAI <span className="text-success">{Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%</span> {t("hit rate")}
                  </span>
                </div>
              )}
              {criticalCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-[5px] border-2 border-destructive bg-destructive/10 px-3 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-xs font-extrabold text-destructive">
                    {criticalCount} {t(criticalCount > 1 ? "active alerts" : "active alert")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap px-6 py-3 border-b border-border bg-card/60">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={crimeType}
            onChange={e => setCrimeType(e.target.value)}
            placeholder={t("Crime type…")}
            className="rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-xs font-bold w-36 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={district}
            onChange={e => setDistrict(e.target.value)}
            placeholder={t("District…")}
            className="rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-xs font-bold w-36 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{t("Horizon")}</span>
            {[3, 7, 14, 30].map(d => (
              <button key={d} onClick={() => setHorizon(d)}
                className={`rounded-[3px] border border-border px-2 py-1 text-[10px] font-bold transition ${horizon === d ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
                {d}{t("d")}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1 rounded-[5px] border-2 border-foreground bg-secondary-background px-2.5 py-1.5 text-[11px] font-bold hover:translate-x-[1px] hover:translate-y-[1px] transition nb-shadow-sm"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </button>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {error && (
            <div className="rounded-[5px] border-2 border-destructive bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {/* ── Early Warning Alerts ─────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                {t("Early Warning Alerts")}
                {alerts.length > 0 && (
                  <span className="rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem] text-center">
                    {alerts.length}
                  </span>
                )}
              </h2>
              {alertsAsOf && (
                <span className="text-[10px] text-muted-foreground">
                  {t("Data as of")} <strong>{alertsAsOf}</strong> · {t("comparing last 30 data-days vs prior 30-day baseline")}
                </span>
              )}
            </div>

            {loading && alerts.length === 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {[1, 2].map(i => (
                  <div key={i} className="rounded-[5px] border-2 border-border bg-card p-4 animate-pulse h-28" />
                ))}
              </div>
            )}

            {!loading && alerts.length === 0 && (
              <div className="flex items-center gap-3 rounded-[5px] border-2 border-border bg-card p-4">
                <BellOff className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-sm font-bold text-muted-foreground">{t("No active alerts")}</div>
                  <div className="text-xs text-muted-foreground">{t("No forecast thresholds exceeded for the current filters.")}</div>
                </div>
              </div>
            )}

            {alerts.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {alerts.map(a => (
                  <AlertCard
                    key={a.alert_id}
                    a={a}
                    expanded={expandedAlert === a.alert_id}
                    onToggle={() => setExpandedAlert(prev => prev === a.alert_id ? null : a.alert_id)}
                    lang={lang}
                    t={t}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Forecast Risk Grid ───────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                {t("Forecast Risk Grid")}
                <span className="text-xs font-normal text-muted-foreground normal-case">
                  · {horizon}{t("d")} {t("horizon")}
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{t("Group by crime type")}</span>
                <button
                  onClick={() => setGroupBy(v => !v)}
                  className={`relative h-5 w-9 rounded-[3px] border-2 border-foreground transition ${groupBy ? "bg-primary" : "bg-secondary-background"}`}
                  aria-pressed={groupBy}
                >
                  <span className={`absolute top-0.5 h-3 w-3 rounded-[2px] border border-foreground bg-secondary-background transition-all ${groupBy ? "left-4" : "left-0.5"}`} />
                </button>
              </div>
            </div>

            {loading && cells.length === 0 && (
              <div className="rounded-[5px] border-2 border-border bg-card p-8 animate-pulse text-center text-sm text-muted-foreground">
                {t("Loading grid cells…")}
              </div>
            )}

            {!loading && groupedCells.length === 0 && (
              <div className="rounded-[5px] border-2 border-border bg-card p-6 text-center text-sm text-muted-foreground">
                {t("No risk grid data for the selected filters.")}
              </div>
            )}

            {groupedCells.length > 0 && (
              <div className="overflow-hidden rounded-[5px] border-2 border-foreground nb-shadow-sm">
                <table className="w-full">
                  <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground border-b-2 border-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-bold">{t("Risk Level")}</th>
                      <th className="px-4 py-2.5 text-left font-bold">{t("Crime Type")}</th>
                      <th className="px-4 py-2.5 text-left font-bold w-40">{t("Risk Score")}</th>
                      <th className="px-4 py-2.5 text-left font-bold">{t("Location (lat, lng)")}</th>
                      <th className="px-4 py-2.5 text-left font-bold w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupedCells.map(c => (
                      <CellRow
                        key={c.cell_id}
                        c={c}
                        expanded={expandedCell === c.cell_id}
                        onToggle={() => setExpandedCell(prev => prev === c.cell_id ? null : c.cell_id)}
                        lang={lang}
                        t={t}
                      />
                    ))}
                  </tbody>
                </table>
                {groupBy && cells.length > groupedCells.length && (
                  <div className="border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
                    {t("Showing top-risk cell per crime type")} · {cells.length} {t("total cells analysed")}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Backtest Validation ──────────────────────────────────────── */}
          {(backtest || loading) && (
            <section>
              <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-3">
                <ShieldAlert className="h-4 w-4 text-primary" />
                {t("Model Validation (Backtest)")}
              </h2>
              {loading && !backtest && (
                <div className="rounded-[5px] border-2 border-border bg-card p-4 animate-pulse h-20" />
              )}
              {backtest && (
                <div className="rounded-[5px] border-2 border-foreground bg-card nb-shadow-sm overflow-hidden">
                  <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
                    {/* PAI score */}
                    <div className="p-4">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                        {backtest.metric} {t("Score")}
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="text-3xl font-extrabold text-success tabular-nums">
                          {Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground mb-1">{t("hit rate")}</span>
                      </div>
                    </div>
                    {/* Window */}
                    <div className="p-4">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                        {t("Backtest Window")}
                      </div>
                      <div className="text-sm font-bold capitalize">{backtest.window.replace("_", " ")}</div>
                    </div>
                    {/* Explanation */}
                    <div className="p-4">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                        {t("What This Means")}
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed">{backtest.explanation}</p>
                    </div>
                  </div>
                  {/* Ethics footer */}
                  <div className="border-t border-border bg-muted/30 px-4 py-2.5 flex items-start gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                      {t("Decision support only — not predictive policing. Risk scores are based on historical reported incidents, not arrests or individual characteristics. Patrol decisions require human judgment.")}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
