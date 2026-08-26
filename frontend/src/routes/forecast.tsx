import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as RCell,
  ComposedChart,
  Line,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Filter,
  Flame,
  Info,
  Layers,
  MapPin,
  MessageSquare,
  Minus,
  RefreshCw,
  RotateCcw,
  Radar as RadarIcon,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { ChartContainer } from "@/components/ui/chart";
import { useI18n } from "@/lib/i18n";
import { announceScreenReady, runActions } from "@/lib/taskBus";
import { tData } from "@/lib/tData";
import { useChartPalette, useMounted, type Palette } from "@/lib/chartPalette";
import {
  intelligence,
  translateOnTheFly,
  type BacktestResponse,
  type ForecastAlert,
  type ForecastCell,
  type MOCluster,
  type SeasonalPeak,
  type TrendPoint,
  type TrendsResponse,
} from "@/lib/api/intelligence";

/**
 * Early Warning & Forecast — the predictive surface.
 *
 * WHY TRENDS LIVES HERE NOW
 * `/trends` used to be a separate screen. It asked the same question as this one
 * from the other end of the same data: forecasting is "where is this going", trend
 * analysis is "where has this been", and an officer deciding where to put a patrol
 * needs both in one place. The two screens also shared a filter bar, a KPI idiom,
 * a refresh control and four separate implementations of a horizontal bar. `/trends`
 * now redirects here and its content is the Trends and Patterns tabs.
 *
 * HOW LOADING WORKS, AND WHY IT IS NOT ONE Promise.all
 * Six endpoints feed this screen and the slowest measured 6.2s. The previous
 * version awaited all three of its calls in a single `Promise.all`, so one failure
 * blanked the entire screen — every panel showed zero with no indication which
 * request had died. This settles each source independently with
 * `Promise.allSettled` and records which ones failed, so a dead endpoint degrades
 * exactly one panel and says so.
 *
 * The old "neural forecast engine" panel animated a four-stage pipeline that was
 * pure theatre — the stages were not wired to anything, so a slow load looked
 * identical to a broken one. It is replaced by a status strip that reports the real
 * state of each request.
 *
 * HONESTY ABOUT THE MODEL
 * There is no neural network here. `risk_score` is a hand-tuned formula over
 * incident density and a 30-vs-30-day lift, and the `why` strings are templates.
 * The labelling on this screen says "heuristic" rather than implying a trained
 * model, and `horizon_days` is marked as not yet affecting the computation because
 * the service accepts the parameter and never uses it.
 *
 * The validation card reports a real rolling-origin backtest of that same
 * formula: PAI as a ratio against random targeting of equal area, PEI against
 * the best achievable selection, a Wilson interval on the hit rate, and the
 * per-fold spread. PAI and the hit rate are different numbers and are shown
 * separately — the tile used to print the hit rate under a "PAI" label.
 */

const TAB_KEYS = ["warning", "surface", "trends", "patterns"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Search = { tab?: TabKey; crime_type?: string; district?: string };

export const Route = createFileRoute("/forecast")({
  // `?tab=` exists so the /trends redirect can land on the Trends tab and so a
  // particular view is a shareable link.
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: TAB_KEYS.includes(search.tab as TabKey) ? (search.tab as TabKey) : undefined,
    crime_type:
      typeof search.crime_type === "string" && search.crime_type ? search.crime_type : undefined,
    district: typeof search.district === "string" && search.district ? search.district : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Early Warning & Forecast · Satyam" },
      {
        name: "description",
        content:
          "Forecast risk surface, early-warning alerts, incident trends, modus-operandi clusters and seasonal peaks for the Karnataka State Police dataset.",
      },
    ],
  }),
  component: ForecastScreen,
});

/* ══════════════════════════════════════════════════════════════════════════
 * Primitives
 * ══════════════════════════════════════════════════════════════════════════ */

const fmt = (n: number) => n.toLocaleString();
const RISK_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/**
 * One severity scale for the whole screen, resolved from the theme palette.
 *
 * This replaces five separate hardcoded colour schemes that used to disagree with
 * each other: six `RISK_*` Tailwind maps, a `BAR_COLORS` gradient list, inline
 * `lift_percent >= 20/10` ternaries, the delta-card up/down/flat trio, and direct
 * `var(--main)` fills. Severity now has exactly one definition and follows the
 * theme picker.
 */
function severityColor(level: string, p: Palette): string {
  // Ordered green -> yellow -> orange -> red. The middle stop is `warn`, not a
  // categorical series colour: an earlier version used `--chart-6` (cyan) for
  // Medium, which made Medium read as more urgent than High.
  switch (level) {
    case "Critical":
      return p.up;
    case "High":
      return p.series[1];
    case "Medium":
      return p.warn;
    default:
      return p.down;
  }
}

function Card({
  title,
  subtitle,
  kind,
  right,
  note,
  className = "",
  bodyClass = "",
  children,
}: {
  title?: string;
  subtitle?: string;
  kind?: string;
  right?: React.ReactNode;
  note?: string;
  className?: string;
  bodyClass?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-border bg-card p-3.5 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[11px] font-bold uppercase tracking-wider text-foreground">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {right}
            {kind && (
              <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {kind}
              </span>
            )}
          </div>
        </div>
      )}
      <div className={bodyClass}>{children}</div>
      {note && (
        <p className="mt-2.5 flex items-start gap-1.5 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />
          {note}
        </p>
      )}
    </section>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <div className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
      <div
        className="mt-1 text-xl font-extrabold tabular-nums leading-tight text-foreground"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Empty({
  label,
  hint,
  icon: Icon = BellOff,
}: {
  label: string;
  hint?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-5">
      <div className="rounded-full bg-muted p-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function Skeleton({ h = "h-24", n = 1 }: { h?: string; n?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`w-full animate-pulse rounded-lg bg-muted/50 ${h}`} />
      ))}
    </>
  );
}

/** A labelled horizontal bar. Replaces four separate implementations. */
function MeterBar({
  value,
  max,
  color,
  height = "h-2",
}: {
  value: number;
  max: number;
  color: string;
  height?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`fc-track w-full overflow-hidden rounded-full bg-muted ${height}`}>
      <div
        className="fc-fill h-full rounded-full"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function RiskChip({ level, lang, palette }: { level: string; lang: string; palette: Palette }) {
  const c = severityColor(level, palette);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: `${c}22`, color: c }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} />
      {tData("risk_label", level, lang)}
    </span>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return dv;
}

/** Text filter with a clear affordance. Both filters on this screen are debounced. */
function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-40 rounded-md border border-input bg-background px-2.5 py-1.5 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
          aria-label="Clear"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1">
      {label && (
        <span className="mr-0.5 text-[10px] font-semibold text-muted-foreground">{label}</span>
      )}
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-0.5 text-[10px] font-bold transition ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Panels
 * ══════════════════════════════════════════════════════════════════════════ */

function AlertCard({
  a,
  expanded,
  onToggle,
  lang,
  t,
  palette,
  onAsk,
  onNetwork,
}: {
  a: ForecastAlert;
  expanded: boolean;
  onToggle: () => void;
  lang: string;
  t: (s: string) => string;
  palette: Palette;
  onAsk: (text: string) => void;
  onNetwork: (district: string, crimeType: string) => void;
}) {
  const c = severityColor(a.risk_level, palette);
  return (
    <div className="fc-rise overflow-hidden rounded-lg border border-border bg-card shadow-sm transition hover:shadow-md">
      <div className="h-0.5" style={{ backgroundColor: c }} />
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <RiskChip level={a.risk_level} lang={lang} palette={palette} />
              <span className="truncate text-[13px] font-bold text-foreground">
                {tData("crime_type", a.crime_type, lang)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {tData("district", a.district, lang)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0" />
                <strong className="font-bold text-foreground">{a.patrol_window}</strong>
              </span>
            </div>
          </div>
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-foreground/75">{a.why}</p>

        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            onClick={() =>
              onAsk(
                `${t("Tell me more about")} ${tData("crime_type", a.crime_type, "EN")} ${t("in")} ${a.district}`,
              )
            }
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <MessageSquare className="h-3 w-3" />
            {t("Ask AI")}
          </button>
          <button
            onClick={() => onNetwork(a.district, a.crime_type)}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="h-3 w-3" />
            {t("Network")}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-border bg-muted/20 px-3 py-2.5">
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3 w-3" /> {t("Recommended action")}
            </div>
            <p className="text-[11px] font-semibold text-foreground">{a.recommended_action}</p>
          </div>
          <p className="flex items-start gap-1.5 rounded border border-border bg-background/70 px-2 py-1.5 text-[10px] italic leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            {a.fairness_note}
          </p>
        </div>
      )}
    </div>
  );
}

/** Crime type × period intensity grid. No recharts equivalent, so hand-rolled. */
function CrimeHeatmap({
  series,
  lang,
  t,
  palette,
}: {
  series: TrendPoint[];
  lang: string;
  t: (s: string) => string;
  palette: Palette;
}) {
  const { periods, crimes, grid, max } = useMemo(() => {
    const pSet = new Set<string>();
    const cTotals: Record<string, number> = {};
    const g: Record<string, number> = {};
    let mx = 1;
    for (const s of series) {
      pSet.add(s.period);
      cTotals[s.crime_type] = (cTotals[s.crime_type] ?? 0) + s.count;
      const k = `${s.crime_type}|${s.period}`;
      g[k] = (g[k] ?? 0) + s.count;
      mx = Math.max(mx, g[k]);
    }
    return {
      periods: [...pSet].sort().slice(-14),
      // Ranked by volume, not alphabetically — the point of the grid is to show
      // the categories that matter.
      crimes: Object.entries(cTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([c]) => c),
      grid: g,
      max: mx,
    };
  }, [series]);

  if (periods.length === 0) return <Empty label={t("No trend data")} icon={Layers} />;

  const cols = `minmax(110px,150px) repeat(${periods.length}, minmax(26px, 1fr))`;
  const short = (p: string) => (p.length > 7 ? p.slice(2) : p);

  return (
    <div className="overflow-x-auto pb-1">
      <div style={{ minWidth: periods.length > 12 ? periods.length * 32 + 150 : undefined }}>
        <div className="mb-1 grid items-end gap-1" style={{ gridTemplateColumns: cols }}>
          <div />
          {periods.map((p) => (
            <div
              key={p}
              className="truncate text-center text-[9px] font-medium text-muted-foreground"
              title={p}
            >
              {short(p)}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {crimes.map((c) => (
            <div key={c} className="grid items-center gap-1" style={{ gridTemplateColumns: cols }}>
              <div
                className="truncate pr-2 text-[11px] font-medium text-foreground"
                title={tData("crime_type", c, lang)}
              >
                {tData("crime_type", c, lang)}
              </div>
              {periods.map((p) => {
                const v = grid[`${c}|${p}`] ?? 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <div
                    key={p}
                    title={`${tData("crime_type", c, lang)} · ${p}: ${v}`}
                    className="flex h-6 items-center justify-center rounded-[3px] transition hover:ring-1 hover:ring-primary/50"
                    style={{
                      backgroundColor: palette.series[0],
                      opacity: v ? Math.max(0.1, intensity) : 0.04,
                    }}
                  >
                    {v > 0 && intensity >= 0.6 && (
                      <span className="text-[9px] font-bold leading-none tabular-nums text-background">
                        {v}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t("Fewer")}</span>
          {[0.1, 0.3, 0.5, 0.75, 1].map((o) => (
            <span
              key={o}
              className="h-2.5 w-5 rounded-[2px]"
              style={{ backgroundColor: palette.series[0], opacity: o }}
            />
          ))}
          <span>{t("More incidents")}</span>
        </div>
      </div>
    </div>
  );
}

function ClusterRow({
  c,
  lang,
  t,
  onOpenCase,
}: {
  c: MOCluster;
  lang: string;
  t: (s: string) => string;
  onOpenCase: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className={`cursor-pointer transition-colors ${open ? "bg-primary/5" : "hover:bg-muted/30"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-3 py-2.5">
          <div className="text-[12px] font-semibold text-foreground">{c.label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {c.top_crime_types.slice(0, 2).map((ct) => (
              <span
                key={ct}
                className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
              >
                {tData("crime_type", ct, lang)}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right text-[12px] font-bold tabular-nums text-foreground">
          {fmt(c.case_count)}
        </td>
        <td className="max-w-[150px] truncate px-3 py-2.5 text-[11px] text-muted-foreground">
          {c.top_sections.slice(0, 3).join(", ") || "—"}
        </td>
        <td className="max-w-[220px] px-3 py-2.5 text-[11px] text-foreground/80">
          {c.action_hint}
        </td>
        <td className="px-3 py-2.5">
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("Crime types")}
              </span>
              {c.top_crime_types.map((ct) => (
                <span
                  key={ct}
                  className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
                >
                  {tData("crime_type", ct, lang)}
                </span>
              ))}
              {c.top_sections.length > 0 && (
                <>
                  <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    {t("Sections")}
                  </span>
                  {c.top_sections.map((s) => (
                    <span key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px]">
                      {s}
                    </span>
                  ))}
                </>
              )}
              {c.representative_case_id != null && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCase(c.representative_case_id!);
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary transition hover:bg-primary/20"
                >
                  <ArrowUpRight className="h-3 w-3" /> {t("View case")}
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Screen
 * ══════════════════════════════════════════════════════════════════════════ */

type SourceKey = "alerts" | "hotspots" | "backtest" | "trends" | "clusters" | "seasonal";

const ALL_SOURCES: SourceKey[] = [
  "alerts",
  "hotspots",
  "backtest",
  "trends",
  "clusters",
  "seasonal",
];

/** The only horizons the control offers. Shared with the voice-action handler so
 *  a spoken "9 days" is rejected instead of blanking the select. */
const HORIZONS = [3, 7, 14, 30] as const;

function ForecastScreen() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const palette = useChartPalette();
  const mounted = useMounted();

  const [tab, setTab] = useState<TabKey>(search.tab ?? "warning");

  // Filters. Text inputs are debounced — the previous version fired a request per
  // keystroke against endpoints that take seconds.
  const [crimeInput, setCrimeInput] = useState(search.crime_type ?? "");
  const [districtInput, setDistrictInput] = useState(search.district ?? "");
  const crimeType = useDebounce(crimeInput, 400);
  const district = useDebounce(districtInput, 400);
  const [horizon, setHorizon] = useState(7);
  const [gridSize, setGridSize] = useState(0.02);
  const [granularity, setGranularity] = useState<"week" | "month" | "quarter">("month");
  const [severity, setSeverity] = useState("All");
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Data
  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [cells, setCells] = useState<ForecastCell[]>([]);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [deltas, setDeltas] = useState<TrendsResponse["deltas"]>({
    qoq_percent: null,
    yoy_percent: null,
  });
  const [clusters, setClusters] = useState<MOCluster[]>([]);
  const [peaks, setPeaks] = useState<SeasonalPeak[]>([]);

  // Seeded with every source, not empty. An empty initial set means the very first
  // paint reports "All sources live" before a single request has been made, which
  // is both wrong and briefly shows six "—" KPIs as though they were real zeroes.
  const [pending, setPending] = useState<Set<SourceKey>>(() => new Set(ALL_SOURCES));
  const [failed, setFailed] = useState<Set<SourceKey>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);

  /* ── Load ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    setPending(new Set(ALL_SOURCES));
    setFailed(new Set());

    const hotspotParams = new URLSearchParams({
      horizon_days: String(horizon),
      grid_size: String(gridSize),
    });
    const trendParams = new URLSearchParams({ granularity });
    // The backtest validates the grid actually on screen, so a coarser grid shows
    // a genuinely better score rather than the metric quietly using its own grid.
    const backtestParams = new URLSearchParams({ grid_size: String(gridSize) });
    if (crimeType) {
      hotspotParams.set("crime_type", crimeType);
      trendParams.set("crime_type", crimeType);
      backtestParams.set("crime_type", crimeType);
    }
    if (district) {
      hotspotParams.set("district", district);
      trendParams.set("district", district);
      backtestParams.set("district", district);
    }

    const settle = (key: SourceKey, ok: boolean) => {
      if (cancelled) return;
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
      if (!ok) setFailed((f) => new Set(f).add(key));
    };

    // Each source is awaited and applied on its own. A failure marks that one
    // source and leaves every other panel intact.
    const run = <T,>(key: SourceKey, p: Promise<T>, apply: (v: T) => void) =>
      p.then(
        (v) => {
          if (!cancelled) apply(v);
          settle(key, true);
        },
        () => settle(key, false),
      );

    void Promise.all([
      run("alerts", intelligence.getForecastAlerts(), async (a) => {
        setAsOf(a.as_of_date);
        setAlerts(lang === "KN" ? await translateAlerts(a.alerts) : a.alerts);
      }),
      run("hotspots", intelligence.getForecastHotspots(hotspotParams), async (h) => {
        setCells(lang === "KN" ? await translateCells(h.cells) : h.cells);
      }),
      run("backtest", intelligence.getForecastBacktest(backtestParams), (b) => setBacktest(b)),
      run("trends", intelligence.getTrends(trendParams), (tr) => {
        setSeries(tr.series);
        setDeltas(tr.deltas);
      }),
      run("clusters", intelligence.getMOClusters(), (mo) => setClusters(mo.clusters)),
      run(
        "seasonal",
        intelligence.getSeasonal(crimeType || undefined, district || undefined),
        (s) => setPeaks(s.seasonal_peaks),
      ),
    ]);

    return () => {
      cancelled = true;
    };
  }, [crimeType, district, horizon, gridSize, granularity, lang, reloadKey]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // Auto-refresh. `reload` is stable and bumps a key the effect above depends on,
  // so the interval always refetches with the *current* filters — the old version
  // captured a stale closure and silently refetched the first-render filters.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, reload]);

  /* ── Voice actions ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      // Accepts /trends too, so voice commands aimed at the old screen still land.
      if (d.route !== "/forecast" && d.route !== "/trends") return;
      runActions(["/forecast", "/trends"], d, (action, p) => {
        if (action === "set_crime_type" && p.crime_type) setCrimeInput(String(p.crime_type));
        else if (action === "set_district" && p.district) setDistrictInput(String(p.district));
        else if (action === "set_horizon") {
          // The control only offers HORIZONS. An out-of-range number used to be
          // written into state anyway, leaving a Segmented with no matching
          // option and a forecast that silently kept the old window while the
          // copilot said the change had been made.
          const days = Number(p.days);
          if (!HORIZONS.includes(days as (typeof HORIZONS)[number])) return false;
          setHorizon(days);
        } else if (action === "set_grid" && p.grid) {
          // Matches the backend manifest's fine|medium|coarse domain. "med" is
          // still accepted because older cached plans used it.
          const g = String(p.grid).toLowerCase();
          if (!["fine", "medium", "med", "coarse"].includes(g)) return false;
          setGridSize(g === "fine" ? 0.01 : g === "coarse" ? 0.05 : 0.02);
        } else if (action === "set_severity" && p.level) {
          setSeverity(String(p.level));
          setTab("warning");
        } else if (action === "set_granularity" && p.granularity) {
          const g = String(p.granularity).toLowerCase();
          if (g !== "week" && g !== "month" && g !== "quarter") return false;
          setGranularity(g);
          setTab("trends");
        } else if (action === "toggle_auto") setAutoRefresh((v) => !v);
        else if (action === "refresh") reload();
        else return false;
      });
    };
    window.addEventListener("satyam:run-task", onTask);
    announceScreenReady("/forecast");
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, [reload]);

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const loading = pending.size > 0;
  const isPending = (k: SourceKey) => pending.has(k);
  const didFail = (k: SourceKey) => failed.has(k);

  const shownAlerts = useMemo(() => {
    const f = severity === "All" ? alerts : alerts.filter((a) => a.risk_level === severity);
    return [...f].sort((a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9));
  }, [alerts, severity]);

  const criticalCount = useMemo(
    () => alerts.filter((a) => a.risk_level === "Critical" || a.risk_level === "High").length,
    [alerts],
  );

  const alertDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of alerts) counts[a.risk_level] = (counts[a.risk_level] ?? 0) + 1;
    return ["Critical", "High", "Medium", "Low"]
      .filter((l) => counts[l])
      .map((l) => ({ level: l, count: counts[l] }));
  }, [alerts]);

  const topCells = useMemo(() => [...cells].sort((a, b) => b.risk_score - a.risk_score), [cells]);
  const peakRisk = topCells[0]?.risk_score ?? null;

  const scatterCells = useMemo(
    () =>
      cells.map((c) => ({
        x: c.lng,
        y: c.lat,
        z: c.risk_score,
        level: c.risk_level,
        name: c.crime_type,
        score: c.risk_score,
      })),
    [cells],
  );

  const periodTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of series) m.set(s.period, (m.get(s.period) ?? 0) + s.count);
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, count]) => ({ period, count }));
  }, [series]);

  const totalIncidents = useMemo(() => series.reduce((s, r) => s + r.count, 0), [series]);

  const topByType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of series) m[s.crime_type] = (m[s.crime_type] ?? 0) + s.count;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [series]);

  const topDistricts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of series) if (s.district) m[s.district] = (m[s.district] ?? 0) + s.count;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [series]);

  const trendDir: "up" | "down" | "flat" =
    deltas.qoq_percent == null
      ? "flat"
      : deltas.qoq_percent > 5
        ? "up"
        : deltas.qoq_percent < -5
          ? "down"
          : "flat";

  const scopeLine = [
    district ? tData("district", district, lang) : t("all of Karnataka"),
    crimeType ? tData("crime_type", crimeType, lang) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const anyFilter = !!crimeInput || !!districtInput;

  const handleAsk = (text: string) => {
    try {
      sessionStorage.setItem("satyam:pending-voice", JSON.stringify({ text, speak: false }));
    } catch {
      /* storage unavailable — navigate anyway */
    }
    navigate({ to: "/ask" });
  };
  const handleNetwork = (d: string, ct: string) => {
    try {
      sessionStorage.setItem(
        "satyam:network-context",
        JSON.stringify({ district: d, crime_type: ct, ts: Date.now() }),
      );
    } catch {
      /* storage unavailable — navigate anyway */
    }
    navigate({ to: "/network" });
  };

  const axis = {
    stroke: palette.axis,
    tick: { fill: palette.axis, fontSize: 10 },
    tickLine: false,
  } as const;
  const tip = {
    contentStyle: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      fontSize: 11,
      color: "var(--foreground)",
    },
    labelStyle: { color: "var(--foreground)", fontWeight: 700 },
  } as const;

  const TABS: { key: TabKey; label: string; icon: React.ElementType; badge: number | null }[] = [
    { key: "warning", label: t("Early warning"), icon: Bell, badge: alerts.length || null },
    { key: "surface", label: t("Risk surface"), icon: RadarIcon, badge: cells.length || null },
    { key: "trends", label: t("Trends"), icon: TrendingUp, badge: periodTotals.length || null },
    { key: "patterns", label: t("Patterns"), icon: Layers, badge: clusters.length || null },
  ];

  return (
    <Shell>
      <style>{FC_STYLE}</style>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        {/* ══ Header ═══════════════════════════════════════════════════════ */}
        <div className="shrink-0 border-b border-border bg-card px-6 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("PS8 · Predictive intelligence")}
              </div>
              <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-foreground">
                <span className="rounded-lg bg-destructive/10 p-1.5">
                  <Bell className="h-5 w-5 text-destructive" />
                </span>
                {t("Early Warning & Forecast")}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {scopeLine}
                {asOf && (
                  <>
                    {" · "}
                    {t("data as of")} <strong className="text-foreground">{asOf}</strong>
                  </>
                )}
              </p>
            </div>

            <SourceStatus
              pending={pending}
              failed={failed}
              t={t}
              onRetry={reload}
              palette={palette}
            />
          </div>

          {/* ══ Filters ════════════════════════════════════════════════════ */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <FilterInput
              value={crimeInput}
              onChange={setCrimeInput}
              placeholder={t("Crime type…")}
            />
            <FilterInput
              value={districtInput}
              onChange={setDistrictInput}
              placeholder={t("District…")}
            />

            {(tab === "warning" || tab === "surface") && (
              <>
                <Segmented
                  label={t("Horizon")}
                  value={horizon}
                  onChange={setHorizon}
                  options={HORIZONS.map((d) => ({ value: d, label: `${d}${t("d")}` }))}
                />
                <Segmented
                  label={t("Grid")}
                  value={gridSize}
                  onChange={setGridSize}
                  options={[
                    { value: 0.01, label: t("Fine") },
                    { value: 0.02, label: t("Med") },
                    { value: 0.05, label: t("Coarse") },
                  ]}
                />
              </>
            )}
            {(tab === "trends" || tab === "patterns") && (
              <Segmented
                label={t("Granularity")}
                value={granularity}
                onChange={setGranularity}
                options={[
                  { value: "week" as const, label: t("Week") },
                  { value: "month" as const, label: t("Month") },
                  { value: "quarter" as const, label: t("Quarter") },
                ]}
              />
            )}

            {anyFilter && (
              <button
                onClick={() => {
                  setCrimeInput("");
                  setDistrictInput("");
                }}
                className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-[10px] font-bold text-muted-foreground transition hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                {t("Clear")}
              </button>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`rounded-md border px-2 py-1.5 text-[10px] font-bold transition ${
                  autoRefresh
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {autoRefresh ? t("Auto 60s") : t("Manual")}
              </button>
              <button
                onClick={reload}
                className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-[10px] font-bold text-foreground transition hover:bg-muted"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                {t("Refresh")}
              </button>
            </div>
          </div>

          {/* ══ KPI strip ══════════════════════════════════════════════════ */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              icon={AlertTriangle}
              label={t("Active alerts")}
              value={isPending("alerts") ? "…" : String(criticalCount)}
              sub={`${t("of")} ${alerts.length} ${t("total")}`}
              tone={criticalCount > 0 ? palette.up : undefined}
            />
            <KpiTile
              icon={Flame}
              label={t("Peak risk")}
              value={isPending("hotspots") ? "…" : peakRisk != null ? String(peakRisk) : "—"}
              sub={topCells[0] ? tData("crime_type", topCells[0].crime_type, lang) : undefined}
              tone={peakRisk != null ? severityColor(topCells[0].risk_level, palette) : undefined}
            />
            <KpiTile
              icon={RadarIcon}
              label={t("Cells scored")}
              value={isPending("hotspots") ? "…" : fmt(cells.length)}
              sub={`${t("grid")} ${gridSize}°`}
            />
            <KpiTile
              icon={Activity}
              label={t("Incidents")}
              value={isPending("trends") ? "…" : fmt(totalIncidents)}
              sub={`${periodTotals.length} ${t("periods")}`}
            />
            <KpiTile
              icon={trendDir === "up" ? TrendingUp : trendDir === "down" ? TrendingDown : Minus}
              label={t("QoQ change")}
              value={
                isPending("trends")
                  ? "…"
                  : deltas.qoq_percent != null
                    ? `${deltas.qoq_percent > 0 ? "+" : ""}${deltas.qoq_percent.toFixed(1)}%`
                    : "—"
              }
              sub={
                trendDir === "up" ? t("Rising") : trendDir === "down" ? t("Falling") : t("Stable")
              }
              tone={trendDir === "up" ? palette.up : trendDir === "down" ? palette.down : undefined}
            />
            {/* PAI is a ratio against random targeting of the same area, not a
                percentage. The tile previously showed the hit rate under a "PAI"
                label, which are different numbers. */}
            <KpiTile
              icon={ShieldAlert}
              label={t("Backtest PAI")}
              value={isPending("backtest") ? "…" : backtest ? `${backtest.pai.toFixed(1)}×` : "—"}
              sub={
                backtest
                  ? `${Math.round(backtest.hit_rate_top_10_percent_cells * 100)}% ${t("hit rate")} · ${t("heuristic")}`
                  : t("heuristic, not a model")
              }
            />
          </div>

          {/* ══ Tabs ═══════════════════════════════════════════════════════ */}
          <div className="mt-3 flex gap-0 overflow-x-auto">
            {TABS.map(({ key, label, icon: Icon, badge }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
                  tab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {badge != null && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                      tab === key
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ══ Body ═════════════════════════════════════════════════════════ */}
        <div className="min-h-0 flex-1 overflow-auto p-6">
          {/* ── EARLY WARNING ─────────────────────────────────────────────── */}
          {tab === "warning" && (
            <div className="space-y-4">
              <Card
                title={t("Alert severity mix")}
                subtitle={t("Distribution of open early-warning alerts")}
                // No `kind` chip here on purpose: it renders beside the severity
                // pills and reads as a sixth filter option.
                right={
                  <div className="flex flex-wrap items-center gap-1">
                    {["All", "Critical", "High", "Medium", "Low"].map((lvl) => {
                      const active = severity === lvl;
                      const c = lvl === "All" ? undefined : severityColor(lvl, palette);
                      return (
                        <button
                          key={lvl}
                          onClick={() => setSeverity(lvl)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition ${
                            active
                              ? "border-transparent text-background"
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                          style={
                            active
                              ? {
                                  backgroundColor: c ?? "var(--foreground)",
                                  color: "var(--background)",
                                }
                              : undefined
                          }
                        >
                          {lvl === "All" ? t("All") : tData("risk_label", lvl, lang)}
                        </button>
                      );
                    })}
                  </div>
                }
              >
                {isPending("alerts") ? (
                  <Skeleton h="h-12" />
                ) : didFail("alerts") ? (
                  <Empty
                    label={t("Alerts unavailable")}
                    hint={t("This one request failed. Other panels are unaffected.")}
                    icon={AlertTriangle}
                  />
                ) : alertDistribution.length === 0 ? (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" style={{ color: palette.down }} />
                    {t("All clear — no thresholds exceeded.")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {alertDistribution.map((d) => (
                      <div key={d.level} className="flex items-center gap-2.5">
                        <span className="w-16 shrink-0 text-[11px] font-semibold text-foreground">
                          {tData("risk_label", d.level, lang)}
                        </span>
                        <MeterBar
                          value={d.count}
                          max={alerts.length}
                          color={severityColor(d.level, palette)}
                        />
                        <span className="w-6 shrink-0 text-right text-[11px] font-bold tabular-nums text-foreground">
                          {d.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {isPending("alerts") ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Skeleton h="h-32" n={6} />
                </div>
              ) : shownAlerts.length === 0 && !didFail("alerts") ? (
                <Empty
                  label={t("No active alerts")}
                  hint={t("No forecast thresholds exceeded for the current filters.")}
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {shownAlerts.map((a) => (
                    <AlertCard
                      key={a.alert_id}
                      a={a}
                      expanded={expandedAlert === a.alert_id}
                      onToggle={() =>
                        setExpandedAlert((p) => (p === a.alert_id ? null : a.alert_id))
                      }
                      lang={lang}
                      t={t}
                      palette={palette}
                      onAsk={handleAsk}
                      onNetwork={handleNetwork}
                    />
                  ))}
                </div>
              )}

              {/* Backtest */}
              <Card
                title={t("Model validation")}
                subtitle={backtest ? t(backtest.window.replace(/_/g, " ")) : undefined}
                kind={t("Backtest")}
                note={t(
                  "Decision support only — not predictive policing. Scores come from historical reported incidents, never from arrests or individual characteristics, and every patrol decision needs human judgment.",
                )}
              >
                {isPending("backtest") ? (
                  <Skeleton h="h-20" />
                ) : !backtest ? (
                  <Empty label={t("Backtest unavailable")} icon={ShieldAlert} />
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {/* PAI — the headline, as a ratio. */}
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("PAI vs random")}
                        </div>
                        <div className="mt-1 flex items-end gap-1.5">
                          <span
                            className="text-3xl font-extrabold tabular-nums leading-none"
                            style={{ color: palette.down }}
                          >
                            {backtest.pai.toFixed(2)}×
                          </span>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                          {t("Same area picked at random would hit")}{" "}
                          {(backtest.baseline_hit_rate * 100).toFixed(1)}%
                        </p>
                      </div>

                      {/* Hit rate, with the interval that makes it readable. */}
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("Hit rate")}
                        </div>
                        <div className="mt-1 flex items-end gap-1.5">
                          <span className="text-3xl font-extrabold tabular-nums leading-none">
                            {Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%
                          </span>
                          <span className="mb-0.5 text-[10px] tabular-nums text-muted-foreground">
                            ±
                            {Math.round(
                              ((backtest.hit_rate_ci_high - backtest.hit_rate_ci_low) / 2) * 100,
                            )}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-snug tabular-nums text-muted-foreground">
                          {backtest.hits}/{backtest.test_incidents} · 95% CI{" "}
                          {Math.round(backtest.hit_rate_ci_low * 100)}–
                          {Math.round(backtest.hit_rate_ci_high * 100)}%
                        </p>
                      </div>

                      {/* PEI — bounded 0-1, so it separates a weak model from an
                          unpredictable window. */}
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("PEI of best possible")}
                        </div>
                        <div className="mt-1 flex items-end gap-1.5">
                          <span className="text-3xl font-extrabold tabular-nums leading-none">
                            {backtest.pei.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2">
                          <MeterBar value={backtest.pei * 100} max={100} color={palette.down} />
                        </div>
                      </div>

                      {/* What was actually measured. */}
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("Setup")}
                        </div>
                        <dl className="mt-1 space-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                          <div className="flex justify-between gap-2">
                            <dt>{t("Folds")}</dt>
                            <dd className="text-foreground/80">
                              {backtest.window.replace("rolling_origin_", "")}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Grid")}</dt>
                            <dd className="text-foreground/80">{backtest.grid_degrees_note}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Cells picked")}</dt>
                            <dd className="text-foreground/80">
                              {fmt(backtest.cells_selected)}/{fmt(backtest.cells_study_area)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Train per cell")}</dt>
                            <dd className="text-foreground/80">
                              {backtest.mean_train_incidents_per_cell}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </div>

                    {/* Fold spread: one window is noisy, the shape across windows
                        is what says whether the signal is stable. */}
                    {backtest.per_fold.length > 1 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("Hit rate by fold")}
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {backtest.per_fold.map((f) => (
                            <div key={f.fold} className="flex items-center gap-2">
                              <span className="w-14 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                {f.origin?.slice(0, 7) ?? "—"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <MeterBar
                                  value={f.hit_rate * 100}
                                  max={100}
                                  color={palette.down}
                                  height="h-1.5"
                                />
                              </div>
                              <span className="w-[8.5rem] shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                                {Math.round(f.hit_rate * 100)}% · {f.hits}/{f.test_incidents} ·{" "}
                                {f.pai.toFixed(1)}×
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {t("What this means")}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">
                        {backtest.explanation}
                      </p>
                    </div>

                    {backtest.caveats.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {t("Read this before quoting the number")}
                        </div>
                        <ul className="mt-1 space-y-1">
                          {backtest.caveats.map((c, i) => (
                            <li
                              key={i}
                              className="flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground"
                            >
                              <span className="mt-[0.35rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ── RISK SURFACE ──────────────────────────────────────────────── */}
          {tab === "surface" && (
            <div className="space-y-4">
              <Card
                title={t("Geographic risk surface")}
                subtitle={t(
                  "Every scored grid cell by position. Size and colour are the risk score.",
                )}
                kind={t("Scatter")}
                bodyClass="h-[340px]"
                note={t(
                  "The horizon control does not yet change these numbers — the service accepts the parameter but the underlying windows are fixed at the last 30 data-days against the prior 30.",
                )}
              >
                {!mounted || isPending("hotspots") ? (
                  <Skeleton h="h-full" />
                ) : didFail("hotspots") ? (
                  <Empty label={t("Risk surface unavailable")} icon={RadarIcon} />
                ) : scatterCells.length === 0 ? (
                  <Empty label={t("No cells scored for these filters")} icon={RadarIcon} />
                ) : (
                  <ChartContainer config={{}} className="h-full w-full aspect-auto">
                    <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke={palette.grid} strokeOpacity={0.35} />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name={t("Longitude")}
                        domain={["dataMin - 0.05", "dataMax + 0.05"]}
                        // Two decimals: the grid is 0.02°, so one decimal renders
                        // adjacent ticks with the same label.
                        tickFormatter={(v: number) => v.toFixed(2)}
                        {...axis}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name={t("Latitude")}
                        domain={["dataMin - 0.05", "dataMax + 0.05"]}
                        tickFormatter={(v: number) => v.toFixed(2)}
                        {...axis}
                      />
                      <ZAxis type="number" dataKey="z" range={[40, 420]} name={t("Risk")} />
                      <RTooltip
                        {...tip}
                        cursor={{ strokeDasharray: "3 3" }}
                        formatter={(v: number, n: string) => [
                          typeof v === "number" ? v.toFixed(2) : v,
                          n,
                        ]}
                      />
                      <Scatter data={scatterCells} name={t("Grid cell")} fillOpacity={0.7}>
                        {scatterCells.map((c, i) => (
                          <RCell key={i} fill={severityColor(c.level, palette)} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ChartContainer>
                )}
              </Card>

              <Card
                title={t("Highest-risk cells")}
                subtitle={`${t("Top")} ${Math.min(24, topCells.length)} ${t("of")} ${fmt(cells.length)}`}
                kind={t("Ranked")}
              >
                {isPending("hotspots") ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Skeleton h="h-16" n={6} />
                  </div>
                ) : topCells.length === 0 ? (
                  <Empty label={t("No cells scored for these filters")} icon={RadarIcon} />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {topCells.slice(0, 24).map((c) => (
                      <div
                        key={c.cell_id}
                        className="fc-rise rounded-md border border-border bg-background/60 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <RiskChip level={c.risk_level} lang={lang} palette={palette} />
                          <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                            {c.lat.toFixed(2)}, {c.lng.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-1.5 truncate text-[12px] font-bold text-foreground">
                          {tData("crime_type", c.crime_type, lang)}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <MeterBar
                            value={c.risk_score}
                            max={100}
                            color={severityColor(c.risk_level, palette)}
                            height="h-1.5"
                          />
                          <span className="w-6 shrink-0 text-right text-[11px] font-extrabold tabular-nums text-foreground">
                            {c.risk_score}
                          </span>
                        </div>
                        {c.why.length > 0 && (
                          <p className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                            {c.why[0]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ── TRENDS ────────────────────────────────────────────────────── */}
          {tab === "trends" && (
            <div className="space-y-4">
              <Card
                title={t("Incidents over time")}
                subtitle={`${t("Totals per")} ${t(granularity)}`}
                kind={t("Area + line")}
                bodyClass="h-[300px]"
              >
                {!mounted || isPending("trends") ? (
                  <Skeleton h="h-full" />
                ) : didFail("trends") ? (
                  <Empty label={t("Trend data unavailable")} icon={TrendingUp} />
                ) : periodTotals.length === 0 ? (
                  <Empty label={t("No trend data")} icon={TrendingUp} />
                ) : (
                  <ChartContainer config={{}} className="h-full w-full aspect-auto">
                    <ComposedChart
                      data={periodTotals}
                      margin={{ top: 8, right: 8, bottom: 0, left: -14 }}
                    >
                      <defs>
                        <linearGradient id="fc-area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={palette.series[0]} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={palette.series[0]} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                      <XAxis
                        dataKey="period"
                        tickFormatter={(p: string) => (p.length > 7 ? p.slice(2) : p)}
                        {...axis}
                      />
                      <YAxis {...axis} />
                      <RTooltip {...tip} formatter={(v: number) => fmt(v)} />
                      {periodTotals.length > 1 && (
                        <ReferenceLine
                          y={totalIncidents / periodTotals.length}
                          stroke={palette.axis}
                          strokeDasharray="4 4"
                          strokeOpacity={0.6}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="count"
                        name={t("Incidents")}
                        stroke="none"
                        fill="url(#fc-area)"
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        name={t("Incidents")}
                        stroke={palette.series[0]}
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                )}
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card
                  title={t("Quarter on quarter")}
                  kind={t("Delta")}
                  bodyClass="flex items-end gap-3"
                >
                  <span
                    className="text-4xl font-extrabold leading-none tabular-nums"
                    style={{
                      color:
                        trendDir === "up"
                          ? palette.up
                          : trendDir === "down"
                            ? palette.down
                            : palette.axis,
                    }}
                  >
                    {deltas.qoq_percent != null
                      ? `${deltas.qoq_percent > 0 ? "+" : ""}${deltas.qoq_percent.toFixed(1)}%`
                      : "—"}
                  </span>
                  <span className="mb-1 text-[11px] text-muted-foreground">
                    {trendDir === "up"
                      ? t("more incidents than last quarter")
                      : trendDir === "down"
                        ? t("fewer incidents than last quarter")
                        : t("broadly flat against last quarter")}
                  </span>
                </Card>
                <Card title={t("Year on year")} kind={t("Delta")} bodyClass="flex items-end gap-3">
                  <span
                    className="text-4xl font-extrabold leading-none tabular-nums"
                    style={{
                      color:
                        deltas.yoy_percent == null
                          ? palette.axis
                          : deltas.yoy_percent > 0
                            ? palette.up
                            : palette.down,
                    }}
                  >
                    {deltas.yoy_percent != null
                      ? `${deltas.yoy_percent > 0 ? "+" : ""}${deltas.yoy_percent.toFixed(1)}%`
                      : "—"}
                  </span>
                  <span className="mb-1 text-[11px] text-muted-foreground">
                    {t("against the same period last year")}
                  </span>
                </Card>
              </div>

              <Card
                title={t("Crime type by period")}
                subtitle={t("Intensity of the eight highest-volume categories")}
                kind={t("Heatmap")}
              >
                {isPending("trends") ? (
                  <Skeleton h="h-40" />
                ) : (
                  <CrimeHeatmap series={series} lang={lang} t={t} palette={palette} />
                )}
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card
                  title={t("Top crime types")}
                  subtitle={t("By incident count in this scope")}
                  kind={t("Bar")}
                  bodyClass="h-[280px]"
                >
                  {!mounted || isPending("trends") ? (
                    <Skeleton h="h-full" />
                  ) : topByType.length === 0 ? (
                    <Empty label={t("No trend data")} icon={Flame} />
                  ) : (
                    <ChartContainer config={{}} className="h-full w-full aspect-auto">
                      <BarChart
                        data={topByType.map(([name, count]) => ({
                          name: tData("crime_type", name, lang),
                          count,
                        }))}
                        layout="vertical"
                        margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                      >
                        <CartesianGrid
                          horizontal={false}
                          stroke={palette.grid}
                          strokeOpacity={0.35}
                        />
                        <XAxis type="number" {...axis} />
                        <YAxis type="category" dataKey="name" width={116} {...axis} />
                        <RTooltip {...tip} formatter={(v: number) => fmt(v)} />
                        <Bar dataKey="count" name={t("Incidents")} radius={[0, 4, 4, 0]}>
                          {topByType.map((_, i) => (
                            <RCell key={i} fill={palette.series[i % palette.series.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </Card>

                <Card
                  title={t("Top districts")}
                  subtitle={t("By incident count in this scope")}
                  kind={t("Bar")}
                  bodyClass="h-[280px]"
                >
                  {!mounted || isPending("trends") ? (
                    <Skeleton h="h-full" />
                  ) : topDistricts.length === 0 ? (
                    <Empty label={t("No trend data")} icon={MapPin} />
                  ) : (
                    <ChartContainer config={{}} className="h-full w-full aspect-auto">
                      <BarChart
                        data={topDistricts.map(([name, count]) => ({
                          name: tData("district", name, lang),
                          count,
                        }))}
                        layout="vertical"
                        margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                      >
                        <CartesianGrid
                          horizontal={false}
                          stroke={palette.grid}
                          strokeOpacity={0.35}
                        />
                        <XAxis type="number" {...axis} />
                        <YAxis type="category" dataKey="name" width={116} {...axis} />
                        <RTooltip {...tip} formatter={(v: number) => fmt(v)} />
                        <Bar
                          dataKey="count"
                          name={t("Incidents")}
                          fill={palette.series[0]}
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ChartContainer>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ── PATTERNS ──────────────────────────────────────────────────── */}
          {tab === "patterns" && (
            <div className="space-y-4">
              <Card
                title={t("Modus operandi clusters")}
                subtitle={t("Cases grouped by shared method and legal sections")}
                kind={t("Clusters")}
                note={t(
                  "Clusters are computed over the whole dataset, so the crime-type and district filters above do not narrow this table.",
                )}
              >
                {isPending("clusters") ? (
                  <Skeleton h="h-40" />
                ) : didFail("clusters") ? (
                  <Empty label={t("Clusters unavailable")} icon={Layers} />
                ) : clusters.length === 0 ? (
                  <Empty label={t("No clusters available")} icon={Layers} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[9px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-bold">{t("Cluster")}</th>
                          <th className="px-3 py-2 text-right font-bold">{t("Cases")}</th>
                          <th className="px-3 py-2 font-bold">{t("Sections")}</th>
                          <th className="px-3 py-2 font-bold">{t("Action hint")}</th>
                          <th className="w-8 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {clusters.map((c) => (
                          <ClusterRow
                            key={c.cluster_id}
                            c={c}
                            lang={lang}
                            t={t}
                            onOpenCase={setDrawerCaseId}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card
                title={t("Seasonal peaks")}
                subtitle={t("Periods that run above their own baseline")}
                kind={t("Seasonality")}
              >
                {isPending("seasonal") ? (
                  <Skeleton h="h-28" />
                ) : didFail("seasonal") ? (
                  <Empty label={t("Seasonal data unavailable")} icon={Calendar} />
                ) : peaks.length === 0 ? (
                  <Empty
                    label={t("No seasonal peaks detected")}
                    hint={t("No period in this scope runs far enough above its baseline.")}
                    icon={Calendar}
                  />
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {[...peaks]
                      .sort((a, b) => b.lift_percent - a.lift_percent)
                      .map((p) => {
                        const strong = p.lift_percent >= 20;
                        const c = strong ? palette.up : palette.series[1];
                        return (
                          <div
                            key={p.period}
                            className="fc-rise rounded-md border border-border bg-background/60 p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-bold text-foreground">
                                {p.period}
                              </span>
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                                style={{ backgroundColor: `${c}22`, color: c }}
                              >
                                +{p.lift_percent}%
                              </span>
                            </div>
                            <div className="mt-2">
                              <MeterBar
                                value={Math.min(p.lift_percent, 40)}
                                max={40}
                                color={c}
                                height="h-1.5"
                              />
                            </div>
                            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                              {p.recommended_action}
                            </p>
                          </div>
                        );
                      })}
                  </div>
                )}
              </Card>
            </div>
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

/* ══════════════════════════════════════════════════════════════════════════
 * Load status
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Honest per-source load state.
 *
 * Replaces a four-stage "neural forecast engine" animation whose stages were not
 * connected to anything. Six endpoints feed this screen and the slowest takes
 * about six seconds, so during a load the previous screen showed zeros everywhere
 * and looked broken. This says which requests are still in flight and which failed.
 */
function SourceStatus({
  pending,
  failed,
  t,
  onRetry,
  palette,
}: {
  pending: Set<SourceKey>;
  failed: Set<SourceKey>;
  t: (s: string) => string;
  onRetry: () => void;
  palette: Palette;
}) {
  const total = 6;
  const done = total - pending.size;
  const allGood = pending.size === 0 && failed.size === 0;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${pending.size > 0 ? "animate-pulse" : ""}`}
        style={{
          backgroundColor:
            failed.size > 0 ? palette.up : pending.size > 0 ? palette.series[1] : palette.down,
        }}
      />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {pending.size > 0
            ? `${t("Loading")} ${done}/${total}`
            : failed.size > 0
              ? `${failed.size} ${t("of")} ${total} ${t("failed")}`
              : t("All sources live")}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {allGood
            ? t("heuristic risk model · synthetic data")
            : failed.size > 0
              ? [...failed].join(", ")
              : t("querying aggregates")}
        </div>
      </div>
      {failed.size > 0 && (
        <button
          onClick={onRetry}
          className="ml-1 shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold text-foreground transition hover:bg-muted"
        >
          {t("Retry")}
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kannada pass-through helpers
 * ══════════════════════════════════════════════════════════════════════════ */

async function translateAlerts(alerts: ForecastAlert[]): Promise<ForecastAlert[]> {
  const strings = alerts.flatMap((a) =>
    [a.why, a.recommended_action, a.fairness_note].filter(Boolean),
  );
  try {
    const tr = await translateOnTheFly(strings);
    return alerts.map((a) => ({
      ...a,
      why: tr[a.why] ?? a.why,
      recommended_action: tr[a.recommended_action] ?? a.recommended_action,
      fairness_note: tr[a.fairness_note] ?? a.fairness_note,
    }));
  } catch {
    // Translation is a nicety; English is a correct fallback.
    return alerts;
  }
}

async function translateCells(cells: ForecastCell[]): Promise<ForecastCell[]> {
  const strings = cells.flatMap((c) => c.why ?? []);
  try {
    const tr = await translateOnTheFly(strings);
    return cells.map((c) => ({ ...c, why: (c.why ?? []).map((w) => tr[w] ?? w) }));
  } catch {
    return cells;
  }
}

/* One style block, one prefix, one reduced-motion guard. */
const FC_STYLE = `
.fc-rise{ animation: fc-rise .35s ease-out both; }
@keyframes fc-rise{ from{ opacity:0; transform: translateY(4px); } to{ opacity:1; transform:none; } }
.fc-fill{ transition: width .6s cubic-bezier(.4,0,.2,1); }
@media (prefers-reduced-motion: reduce){
  .fc-rise{ animation: none; }
  .fc-fill{ transition: none; }
}
`;
