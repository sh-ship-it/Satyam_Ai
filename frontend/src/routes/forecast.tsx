import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Activity,
  MapPin,
  Clock,
  ChevronDown,
  ChevronUp,
  Filter,
  RefreshCw,
  Bell,
  BellOff,
  ArrowUpRight,
  CheckCircle2,
  Info,
  MessageSquare,
  Zap,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import {
  intelligence,
  type ForecastAlert,
  type ForecastCell,
  type BacktestResponse,
} from "@/lib/api/intelligence";
import { CaseDrawer } from "@/components/CaseDrawer";
import { ModelInferenceTheater } from "@/components/ModelInferenceTheater";

export const Route = createFileRoute("/forecast")({
  head: () => ({ meta: [{ title: "Early Warning & Forecast · Satyam" }] }),
  component: ForecastScreen,
});

// ── Risk helpers ──────────────────────────────────────────────────────────────
const RISK_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const RISK_BG: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-orange-500 text-white",
  Medium: "bg-warning text-foreground",
  Low: "bg-success/20 text-success",
};
const RISK_BORDER: Record<string, string> = {
  Critical: "border-destructive/60",
  High: "border-orange-400/60",
  Medium: "border-warning/60",
  Low: "border-success/40",
};
const RISK_GLOW: Record<string, string> = {
  Critical: "shadow-[0_0_0_1px_rgba(255,77,80,0.35)]",
  High: "shadow-[0_0_0_1px_rgba(249,115,22,0.25)]",
  Medium: "shadow-[0_0_0_1px_rgba(234,179,8,0.2)]",
  Low: "",
};
const RISK_ACCENT: Record<string, string> = {
  Critical: "bg-destructive/10",
  High: "bg-orange-500/10",
  Medium: "bg-warning/10",
  Low: "bg-success/10",
};
const RISK_DOT: Record<string, string> = {
  Critical: "bg-destructive animate-ping",
  High: "bg-orange-500",
  Medium: "bg-warning",
  Low: "bg-success",
};

function RiskBadge({
  level,
  lang,
  size = "sm",
}: {
  level: string;
  lang: string;
  size?: "sm" | "lg";
}) {
  const base = size === "lg" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] font-bold ${base} ${RISK_BG[level] || "bg-muted text-muted-foreground"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${RISK_DOT[level] || "bg-current"}`} />
      {tData("risk_label", level, lang)}
    </span>
  );
}

function RiskBar({ score }: { score: number }) {
  const pct = Math.min(100, score);
  const color =
    pct >= 75
      ? "bg-destructive"
      : pct >= 55
        ? "bg-orange-500"
        : pct >= 30
          ? "bg-warning"
          : "bg-success";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-extrabold tabular-nums w-8 text-right">{score}</span>
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────
function AlertCard({
  a,
  expanded,
  onToggle,
  lang,
  t,
  onSendToChat,
  onOpenNetwork,
}: {
  a: ForecastAlert;
  expanded: boolean;
  onToggle: () => void;
  lang: string;
  t: (s: string) => string;
  onSendToChat: (text: string) => void;
  onOpenNetwork: (district: string, crimeType: string) => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-card transition-all duration-200 hover:shadow-md ${RISK_BORDER[a.risk_level] || "border-border"} ${RISK_GLOW[a.risk_level] || ""}`}
    >
      {/* Coloured top strip */}
      <div
        className={`h-1 rounded-t-xl ${a.risk_level === "Critical" ? "bg-destructive" : a.risk_level === "High" ? "bg-orange-500" : a.risk_level === "Medium" ? "bg-warning" : "bg-success"}`}
      />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <RiskBadge level={a.risk_level} lang={lang} />
              <span className="text-sm font-bold text-foreground truncate">
                {tData("crime_type", a.crime_type, lang)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0 text-primary" />
                {tData("district", a.district, lang)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0 text-primary" />
                {t("Patrol")}: <strong className="text-foreground ml-0.5">{a.patrol_window}</strong>
              </span>
            </div>
          </div>
          <button
            onClick={onToggle}
            className={`shrink-0 rounded-lg p-1.5 transition ${expanded ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
            aria-label={t("Toggle details")}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Why fired */}
        <p className="text-xs text-foreground/75 leading-relaxed">{a.why}</p>

        {/* Quick actions */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() =>
              onSendToChat(
                `${t("Tell me more about")} ${tData("crime_type", a.crime_type, "EN")} ${t("in")} ${a.district}`,
              )
            }
            className="inline-flex items-center gap-1 rounded-md bg-muted/60 hover:bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
          >
            <MessageSquare className="h-3 w-3" />
            {t("Ask AI")}
          </button>
          <button
            onClick={() => onOpenNetwork(a.district, a.crime_type)}
            className="inline-flex items-center gap-1 rounded-md bg-muted/60 hover:bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
          >
            <ArrowUpRight className="h-3 w-3" />
            {t("Network")}
          </button>
        </div>
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div
          className={`border-t border-border/60 px-4 py-3 space-y-3 rounded-b-xl ${RISK_ACCENT[a.risk_level] || "bg-muted/20"}`}
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <Zap className="h-3 w-3" /> {t("Recommended Action")}
            </div>
            <p className="text-xs font-semibold text-foreground">{a.recommended_action}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground italic leading-relaxed">
              {a.fairness_note}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Risk distribution summary bar ─────────────────────────────────────────────
function RiskSummaryBar({
  alerts,
  lang,
  t,
}: {
  alerts: ForecastAlert[];
  lang: string;
  t: (s: string) => string;
}) {
  const counts = alerts.reduce<Record<string, number>>((a, c) => {
    a[c.risk_level] = (a[c.risk_level] || 0) + 1;
    return a;
  }, {});
  const levels = ["Critical", "High", "Medium", "Low"];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {levels.map((lvl) =>
        counts[lvl] ? (
          <div
            key={lvl}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${RISK_BG[lvl]}`}
          >
            <span>{counts[lvl]}</span>
            <span className="font-normal opacity-80">{tData("risk_label", lvl, lang)}</span>
          </div>
        ) : null,
      )}
      {alerts.length === 0 && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {t("All clear")}
        </span>
      )}
    </div>
  );
}

// ── Forecast grid card (replaces table row) ───────────────────────────────────
function CellCard({
  c,
  expanded,
  onToggle,
  lang,
  t,
}: {
  c: ForecastCell;
  expanded: boolean;
  onToggle: () => void;
  lang: string;
  t: (s: string) => string;
}) {
  return (
    <div
      className={`rounded-xl border bg-card cursor-pointer transition-all hover:shadow-md ${RISK_BORDER[c.risk_level] || "border-border"}`}
      onClick={onToggle}
    >
      <div
        className={`h-1 rounded-t-xl ${c.risk_level === "Critical" ? "bg-destructive" : c.risk_level === "High" ? "bg-orange-500" : c.risk_level === "Medium" ? "bg-warning" : "bg-success"}`}
      />
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <RiskBadge level={c.risk_level} lang={lang} />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {c.lat.toFixed(2)}, {c.lng.toFixed(2)}
          </span>
        </div>
        <div className="text-sm font-bold mb-2 leading-tight">
          {tData("crime_type", c.crime_type, lang)}
        </div>
        <RiskBar score={c.risk_score} />
        {expanded && (
          <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {t("Why this cell is flagged")}
            </div>
            {c.why.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                <span className="mt-1 h-1 w-1 rounded-full bg-primary shrink-0" />
                {w}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
function ForecastScreen() {
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [alertsAsOf, setAlertsAsOf] = useState<string | null>(null);
  const [cells, setCells] = useState<ForecastCell[]>([]);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);

  // Filters
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [horizon, setHorizon] = useState(7);
  const [gridSize, setGridSize] = useState(0.02);
  const [severityFilter, setSeverityFilter] = useState<string>("All");

  // UI state
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState(true);
  const [gridView, setGridView] = useState<"cards" | "table">("cards");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ horizon_days: String(horizon), grid_size: String(gridSize) });
    if (crimeType) p.set("crime_type", crimeType);
    if (district) p.set("district", district);
    Promise.all([
      intelligence.getForecastAlerts(),
      intelligence.getForecastHotspots(p),
      intelligence.getForecastBacktest(),
    ])
      .then(([a, h, b]) => {
        setAlerts(a.alerts);
        setAlertsAsOf(a.as_of_date);
        setCells(h.cells.slice(0, 40));
        setBacktest(b);
      })
      .catch(() =>
        setError(
          t("Could not load forecast data. Check you are signed in and the backend is running."),
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [crimeType, district, horizon, gridSize]);

  // Voice Screen Agent: execute structured in-screen actions for /forecast.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/forecast") return;
      const actions = Array.isArray(d.actions) ? d.actions : [];
      for (const a of actions) {
        if (a.screen !== "/forecast") continue;
        const p = a.params || {};
        if (a.action === "set_crime_type" && p.crime_type) setCrimeType(String(p.crime_type));
        else if (a.action === "set_district" && p.district) setDistrict(String(p.district));
        else if (a.action === "set_horizon" && p.days) setHorizon(Number(p.days));
        else if (a.action === "set_grid" && p.grid) {
          const g = String(p.grid).toLowerCase();
          setGridSize(g === "fine" ? 0.01 : g === "coarse" ? 0.05 : 0.02);
        } else if (a.action === "set_severity" && p.level) setSeverityFilter(String(p.level));
        else if (a.action === "toggle_auto") setAutoRefresh((v) => !v);
        else if (a.action === "refresh") load();
      }
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, []);

  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (autoRefresh) autoRefreshRef.current = setInterval(load, 60_000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, crimeType, district, horizon]);

  const filteredAlerts =
    severityFilter === "All" ? alerts : alerts.filter((a) => a.risk_level === severityFilter);

  const sortedAlerts = [...filteredAlerts].sort(
    (a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9),
  );

  const groupedCells = groupBy
    ? Object.values(
        cells.reduce<Record<string, ForecastCell>>((acc, c) => {
          if (!acc[c.crime_type] || c.risk_score > acc[c.crime_type].risk_score)
            acc[c.crime_type] = c;
          return acc;
        }, {}),
      ).sort((a, b) => b.risk_score - a.risk_score)
    : [...cells].sort((a, b) => b.risk_score - a.risk_score);

  const criticalCount = alerts.filter(
    (a) => a.risk_level === "Critical" || a.risk_level === "High",
  ).length;

  const handleSendToChat = (text: string) => {
    try {
      sessionStorage.setItem("satyam:pending-voice", JSON.stringify({ text, speak: false }));
      navigate({ to: "/console" });
    } catch {}
  };

  const handleOpenNetwork = (district: string, crimeType: string) => {
    try {
      sessionStorage.setItem(
        "satyam:network-context",
        JSON.stringify({ district, crime_type: crimeType, ts: Date.now() }),
      );
    } catch {}
    navigate({ to: "/network" });
  };

  return (
    <Shell>
      <div className="flex flex-col h-full overflow-auto bg-background">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("PS8 · Predictive Intelligence")}
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2.5 text-foreground">
                <div className="p-1.5 rounded-lg bg-destructive/10">
                  <Bell className="h-5 w-5 text-destructive" />
                </div>
                {t("Early Warning & Forecast")}
              </h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {backtest && (
                <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2">
                  <Activity className="h-4 w-4 text-success" />
                  <div>
                    <div className="text-[10px] text-muted-foreground">{t("Model accuracy")}</div>
                    <div className="text-sm font-extrabold text-success">
                      PAI {Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%{" "}
                      {t("hit rate")}
                    </div>
                  </div>
                </div>
              )}
              {criticalCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <div>
                    <div className="text-[10px] text-muted-foreground">{t("Active")}</div>
                    <div className="text-sm font-extrabold text-destructive">
                      {criticalCount} {t(criticalCount > 1 ? "active alerts" : "active alert")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-border bg-muted/30">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={crimeType}
            onChange={(e) => setCrimeType(e.target.value)}
            placeholder={t("Crime type…")}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder={t("District…")}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-1 border border-input rounded-lg bg-background px-2 py-1">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">
              {t("Horizon")}
            </span>
            {[3, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setHorizon(d)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${horizon === d ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                {d}
                {t("d")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 border border-input rounded-lg bg-background px-2 py-1">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">
              {t("Grid")}
            </span>
            {(
              [
                ["Fine", 0.01],
                ["Med", 0.02],
                ["Coarse", 0.05],
              ] as [string, number][]
            ).map(([lbl, v]) => (
              <button
                key={v}
                onClick={() => setGridSize(v)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${gridSize === v ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold border transition ${autoRefresh ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground hover:bg-muted"}`}
            >
              {autoRefresh ? "⏱ Auto" : "⏱ Manual"}
            </button>
            <button
              onClick={load}
              className="flex items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[10px] font-bold hover:bg-muted transition"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              {t("Refresh")}
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-8">
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* ── Model inference theater ───────────────────────────────── */}
          <div className="px-0 pt-0">
            <ModelInferenceTheater
              cells={cells}
              backtest={backtest}
              loading={loading}
              asOf={alertsAsOf}
              t={t}
            />
          </div>

          {/* ── Early Warning Alerts ─────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-base font-extrabold uppercase tracking-wide flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  {t("Early Warning Alerts")}
                  {alerts.length > 0 && (
                    <span className="rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem] text-center">
                      {alerts.length}
                    </span>
                  )}
                </h2>
                {alertsAsOf && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {t("Data as of")} <strong className="text-foreground">{alertsAsOf}</strong>
                    {" · "}
                    {t("comparing last 30 data-days vs prior 30-day baseline")}
                  </div>
                )}
              </div>
              {/* severity filter pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {["All", "Critical", "High", "Medium", "Low"].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setSeverityFilter(lvl)}
                    className={`rounded-full px-3 py-1 text-[10px] font-bold border transition ${
                      severityFilter === lvl
                        ? lvl === "All"
                          ? "bg-foreground text-background border-foreground"
                          : `${RISK_BG[lvl]} border-transparent`
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {lvl === "All" ? t("All") : tData("risk_label", lvl, lang)}
                  </button>
                ))}
              </div>
            </div>

            {/* Risk distribution summary */}
            {!loading && alerts.length > 0 && (
              <div className="mb-4 p-3 rounded-xl border border-border bg-muted/30 flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("Distribution")}
                </span>
                <RiskSummaryBar alerts={alerts} lang={lang} t={t} />
              </div>
            )}

            {loading && alerts.length === 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-xl border bg-card p-4 animate-pulse h-28" />
                ))}
              </div>
            )}

            {!loading && filteredAlerts.length === 0 && (
              <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-6">
                <div className="p-3 rounded-full bg-muted">
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-bold text-foreground">{t("No active alerts")}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t("No forecast thresholds exceeded for the current filters.")}
                  </div>
                </div>
              </div>
            )}

            {sortedAlerts.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                {sortedAlerts.map((a) => (
                  <AlertCard
                    key={a.alert_id}
                    a={a}
                    expanded={expandedAlert === a.alert_id}
                    onToggle={() => setExpandedAlert((p) => (p === a.alert_id ? null : a.alert_id))}
                    lang={lang}
                    t={t}
                    onSendToChat={handleSendToChat}
                    onOpenNetwork={handleOpenNetwork}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Forecast Risk Grid ───────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h2 className="text-base font-extrabold uppercase tracking-wide flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                {t("Forecast Risk Grid")}
                <span className="text-xs font-normal text-muted-foreground normal-case">
                  · {horizon}
                  {t("d")} {t("horizon")}
                </span>
              </h2>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={groupBy}
                    onChange={(e) => setGroupBy(e.target.checked)}
                    className="rounded accent-primary"
                  />
                  {t("Group by crime type")}
                </label>
                <div className="flex rounded-lg border border-input bg-background p-0.5">
                  {(["cards", "table"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setGridView(v)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition capitalize ${gridView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {t(v)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading && cells.length === 0 && (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="rounded-xl border bg-card p-4 animate-pulse h-24" />
                ))}
              </div>
            )}

            {!loading && groupedCells.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                {t("No risk grid data for the selected filters.")}
              </div>
            )}

            {groupedCells.length > 0 && gridView === "cards" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {groupedCells.map((c) => (
                    <CellCard
                      key={c.cell_id}
                      c={c}
                      expanded={expandedCell === c.cell_id}
                      onToggle={() => setExpandedCell((p) => (p === c.cell_id ? null : c.cell_id))}
                      lang={lang}
                      t={t}
                    />
                  ))}
                </div>
                {groupBy && cells.length > groupedCells.length && (
                  <p className="text-[11px] text-muted-foreground mt-3 text-center">
                    {t("Showing top-risk cell per crime type")} · {cells.length}{" "}
                    {t("total cells analysed")}
                  </p>
                )}
              </>
            )}

            {groupedCells.length > 0 && gridView === "table" && (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full">
                  <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">{t("Risk Level")}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t("Crime Type")}</th>
                      <th className="px-4 py-3 text-left font-semibold w-40">{t("Risk Score")}</th>
                      <th className="px-4 py-3 text-left font-semibold">
                        {t("Location (lat, lng)")}
                      </th>
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupedCells.map((c) => (
                      <>
                        <tr
                          key={c.cell_id}
                          className="hover:bg-muted/20 cursor-pointer"
                          onClick={() =>
                            setExpandedCell((p) => (p === c.cell_id ? null : c.cell_id))
                          }
                        >
                          <td className="px-4 py-3">
                            <RiskBadge level={c.risk_level} lang={lang} />
                          </td>
                          <td className="px-4 py-3 font-medium text-sm">
                            {tData("crime_type", c.crime_type, lang)}
                          </td>
                          <td className="px-4 py-3 w-40">
                            <RiskBar score={c.risk_score} />
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                            {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                          </td>
                          <td className="px-4 py-3">
                            {expandedCell === c.cell_id ? (
                              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </td>
                        </tr>
                        {expandedCell === c.cell_id && (
                          <tr key={c.cell_id + "-exp"} className="bg-muted/20">
                            <td colSpan={5} className="px-6 py-3">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                                {t("Why this cell is flagged")}
                              </div>
                              <ul className="space-y-1">
                                {c.why.map((w, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs">
                                    <span className="mt-1 h-1 w-1 rounded-full bg-primary shrink-0" />
                                    {w}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Backtest Validation ──────────────────────────────────────── */}
          {(backtest || loading) && (
            <section>
              <h2 className="text-base font-extrabold uppercase tracking-wide flex items-center gap-2 mb-4">
                <ShieldAlert className="h-4 w-4 text-primary" />
                {t("Model Validation (Backtest)")}
              </h2>
              {loading && !backtest && (
                <div className="rounded-xl border bg-card p-4 animate-pulse h-24" />
              )}
              {backtest && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
                    <div className="p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        {backtest.metric} {t("Score")}
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="text-4xl font-extrabold text-success tabular-nums">
                          {Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground mb-1.5">
                          {t("hit rate")}
                        </span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-success rounded-full transition-all"
                          style={{
                            width: `${Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        {t("Backtest Window")}
                      </div>
                      <div className="text-sm font-bold capitalize text-foreground">
                        {backtest.window.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {t("Historical validation period")}
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        {t("What This Means")}
                      </div>
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        {backtest.explanation}
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-border bg-amber-500/5 px-5 py-3 flex items-start gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {t(
                        "Decision support only — not predictive policing. Risk scores are based on historical reported incidents, not arrests or individual characteristics. Patrol decisions require human judgment.",
                      )}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      <CaseDrawer
        open={drawerCaseId !== null}
        onClose={() => setDrawerCaseId(null)}
        caseId={drawerCaseId ?? undefined}
      />
    </Shell>
  );
}
