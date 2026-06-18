# Satyam — Early Warning & Forecast + Trends & Patterns: UI Redesign

**Scope:** Visual/UX overhaul of the two screens. All data wiring, props, state, API
calls, routes, and types are preserved byte-for-byte — only presentation changed,
so there are **no behavioural regressions**.

## What was wrong (root cause)

1. **Trends × Period heatmap was genuinely broken.** The old cells used
   `flex-1 ... aspect-square`. When the active filter window had only 1–2 periods,
   each cell stretched to the full container width and `aspect-square` made it
   equally tall — producing the giant solid lavender block in your screenshots.
   It also used a hard-coded **indigo** `rgba(99,102,241)` that matches nothing in
   the Satyam palette.
2. **Both screens drifted off-theme.** They leaned on hard-coded `emerald-*`,
   `yellow-400`, and indigo values instead of the app's design tokens
   (`--main` light-blue primary + semantic `success` / `warning` / `destructive`).
   One risk “glow” also used `hsl(var(--destructive)/0.3)`, which is invalid because
   `--destructive` is a hex value (the shadow silently never rendered).

## What changed

**`src/components/ModelInferenceTheater.tsx`** (full rewrite)
- Two-column theater: an animated inference pipeline (ingest → features → model →
  surface) using `primary`/`success` tokens, plus a live **risk surface** grid.
- Risk surface uses a continuous amber→red heat scale with a proper gradient
  legend, an animated reveal, and a cell count. Responsive `grid-cols-8 md:grid-cols-12`.
- Live PAI hit-rate chip in the header.

**`src/routes/trends.tsx`**
- **`CrimeHeatmap` rebuilt** with a real CSS grid: a fixed label column +
  `repeat(periods, minmax(30px,1fr))` tracks and **fixed-height (`h-7`) cells**, so
  it stays legible whether there are 2 periods or 40 (horizontal scroll past 14).
  Proper period axis + crime-type row labels (Kannada-aware via `tData`), a
  “Fewer → More” swatch legend, and theme-aware `var(--main)` intensity.
- Heatmap card given a titled header + one-line explainer.
- Delta trend colour now uses the `success` token instead of `emerald`.

**`src/routes/forecast.tsx`**
- Risk palette unified to system tokens: `Medium` → `warning`, `Low` → `success`
  (across badges, borders, accents, dots, bars, the summary bar, the model-accuracy
  chip, and the backtest panel). `Critical`/`High` keep `destructive`/`orange`.
- Fixed the invalid `hsl(var(--destructive)/0.3)` critical glow → valid `rgba(...)`.

## Verification (4 passes, as requested)
1. Grepped out every off-brand colour (`emerald`/`indigo`/`rgba(99,102,241)`) — now CLEAN.
2. Full read of the rewritten component + heatmap; every import/type/prop resolves
   (`LucideIcon`, `ForecastCell`, `BacktestResponse`, `TrendPoint`, `tData`, `useMemo`).
3. Brace / paren / bracket / backtick balance is even (0) in all three files; JSX nests correctly.
4. Confirmed `intelligence` method signatures, `lang`/`t` scope, and `ModelInferenceTheater`
   props are unchanged at the call site.

> Note: `node_modules` isn't present in this workspace, so a live `tsc` build couldn't be
> run here; verification was done by static analysis against the confirmed type definitions.

---

## Drop-in files

Replace each file with the contents below.

### 1. `src/components/ModelInferenceTheater.tsx`

```tsx
import { useEffect, useState } from "react";
import { Database, Cpu, Activity, CheckCircle2, type LucideIcon } from "lucide-react";
import type { ForecastCell, BacktestResponse } from "@/lib/api/intelligence";

type Stage = {
  key: string;
  label: string;
  icon: LucideIcon;
  detail: string;
};

// Continuous risk-heat colour: amber (low) → red (high). Theme-independent on
// purpose so a "hot zone" always reads as hot regardless of the active palette.
function heatColor(intensity: number): string {
  const x = Math.max(0, Math.min(1, intensity));
  const hue = 40 - 40 * x; // 40° amber → 0° red
  const light = 64 - 16 * x; // 64% → 48%
  const alpha = 0.22 + 0.72 * x; // faint → solid
  return `hsla(${hue}, 92%, ${light}%, ${alpha})`;
}

export function ModelInferenceTheater({
  cells,
  backtest,
  loading,
  asOf,
  t,
}: {
  cells: ForecastCell[];
  backtest: BacktestResponse | null;
  loading: boolean;
  asOf: string | null;
  t: (s: string) => string;
}) {
  const stages: Stage[] = [
    { key: "ingest", label: t("Ingesting FIR signals"), icon: Database, detail: t("Spatio-temporal events") },
    { key: "feature", label: t("Engineering features"), icon: Activity, detail: t("KDE · recency · seasonality") },
    { key: "infer", label: t("Running risk model"), icon: Cpu, detail: t("Self-exciting hotspot model") },
    { key: "surface", label: t("Projecting risk surface"), icon: Cpu, detail: t("Grid cell scoring") },
  ];

  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading) {
      setDone(false);
      setActive(0);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i >= stages.length) {
        clearInterval(id);
        setDone(true);
        setActive(stages.length);
      } else {
        setActive(i);
      }
    }, 420);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cells.length]);

  const pai = backtest ? Math.round(backtest.hit_rate_top_10_percent_cells * 100) : null;
  const top = [...cells].sort((a, b) => b.risk_score - a.risk_score).slice(0, 48);
  const max = top.length ? top[0].risk_score || 1 : 1;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">{t("Model live inference")}</span>
          {asOf && (
            <span className="text-[10px] text-muted-foreground">
              {t("as of")} {asOf}
            </span>
          )}
        </div>
        {pai !== null && (
          <div className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px]">
            <span className="text-muted-foreground">{t("PAI hit rate")}</span>
            <span className="font-extrabold text-success tabular-nums">{pai}%</span>
          </div>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        {/* Pipeline stepper */}
        <div className="p-4 space-y-2 border-b md:border-b-0 md:border-r border-border">
          {stages.map((s, i) => {
            const state = done || i < active ? "done" : i === active ? "running" : "pending";
            const Icon = s.icon;
            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all ${
                  state === "running"
                    ? "bg-primary/10 ring-1 ring-primary/40"
                    : state === "done"
                    ? "bg-success/5"
                    : "opacity-40"
                }`}
              >
                <div
                  className={`grid h-8 w-8 place-items-center rounded-lg shrink-0 ${
                    state === "done"
                      ? "bg-success/15 text-success"
                      : state === "running"
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {state === "done" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Icon className={`h-4 w-4 ${state === "running" ? "animate-pulse" : ""}`} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{s.detail}</div>
                </div>
                {state === "running" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary animate-ping shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Live risk surface grid */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("Projected risk surface")}
            </div>
            {top.length > 0 && (
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {top.length} {t("cells")}
              </div>
            )}
          </div>
          <div className="grid grid-cols-8 md:grid-cols-12 gap-1">
            {top.map((c, i) => {
              const intensity = Math.max(0.06, (c.risk_score || 0) / max);
              return (
                <div
                  key={c.cell_id || i}
                  title={`${c.crime_type} · ${Math.round(c.risk_score || 0)}`}
                  className="aspect-square rounded-[3px] ring-1 ring-inset ring-black/5 transition-all duration-500"
                  style={{
                    backgroundColor: heatColor(intensity),
                    transform: done ? "scale(1)" : "scale(0.6)",
                    transitionDelay: `${i * 10}ms`,
                  }}
                />
              );
            })}
            {top.length === 0 && (
              <div className="col-span-8 md:col-span-12 text-center text-xs text-muted-foreground py-8">
                {loading ? t("Awaiting grid…") : t("No grid cells for the current filters.")}
              </div>
            )}
          </div>
          {/* Gradient legend */}
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{t("Lower risk")}</span>
            <div
              className="h-2 flex-1 rounded-full ring-1 ring-inset ring-black/5"
              style= background: "linear-gradient(90deg, hsla(40,92%,64%,0.25), hsla(20,92%,56%,0.7), hsla(0,92%,50%,0.95))" 
            />
            <span>{t("Higher risk")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 2. `src/routes/trends.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Layers, BarChart3, Calendar, Filter, RefreshCw, ArrowUpRight, Minus } from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { intelligence, type TrendPoint, type MOCluster, type SeasonalPeak, type TrendsResponse } from "@/lib/api/intelligence";
import { CaseDrawer } from "@/components/CaseDrawer";

export const Route = createFileRoute("/trends")({
  head: () => ({ meta: [{ title: "Trends & Patterns · Satyam" }] }),
  component: TrendsScreen,
});

// ── Mini sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ data, color = "text-primary" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 64; const h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className={`${color} overflow-visible`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Time series bar chart (animated, axis-labeled) ────────────────────────────
function TrendChart({ series }: { series: TrendPoint[] }) {
  const byPeriod = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach((s) => { m[s.period] = (m[s.period] || 0) + s.count; });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [series]);
  const max = Math.max(1, ...byPeriod.map(([, v]) => v));
  if (byPeriod.length === 0)
    return <div className="text-xs text-muted-foreground text-center py-10">No trend data</div>;
  return (
    <div className="flex items-end gap-1.5 h-56 pt-4">
      {byPeriod.map(([period, v], i) => (
        <div key={period} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
          <div className="text-[9px] font-bold text-foreground opacity-0 group-hover:opacity-100 transition">{v}</div>
          <div
            className="w-full rounded-t-md bg-gradient-to-t from-primary/60 to-primary transition-all duration-700 group-hover:from-primary group-hover:to-primary"
            style={{ height: `${(v / max) * 100}%`, transitionDelay: `${i * 18}ms` }}
          />
          <div className="text-[8px] text-muted-foreground truncate w-full text-center" title={period}>
            {period.length > 7 ? period.slice(2) : period}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Crime × period heatmap ─────────────────────────────────────────────────────
function CrimeHeatmap({ series, lang, t }: { series: TrendPoint[]; lang: string; t: (s: string) => string }) {
  const { periods, crimes, grid, max } = useMemo(() => {
    const pSet = new Set<string>(), cSet = new Set<string>();
    const g: Record<string, number> = {};
    let mx = 1;
    series.forEach((s) => {
      pSet.add(s.period); cSet.add(s.crime_type);
      const k = `${s.crime_type}|${s.period}`;
      g[k] = (g[k] || 0) + s.count;
      mx = Math.max(mx, g[k]);
    });
    return {
      periods: [...pSet].sort(),
      crimes: [...cSet].sort((a, b) => a.localeCompare(b)).slice(0, 8),
      grid: g, max: mx,
    };
  }, [series]);

  if (periods.length === 0)
    return <div className="text-xs text-muted-foreground text-center py-10">{t("No data for this scope.")}</div>;

  // Fixed track sizing keeps cells legible whether there are 2 periods or 40
  // (the old flex-1 + aspect-square approach blew a single column up to a giant block).
  const cols = `minmax(120px,160px) repeat(${periods.length}, minmax(30px, 1fr))`;
  const fmtPeriod = (p: string) => (p.length > 7 ? p.slice(2) : p);

  return (
    <div className="overflow-x-auto pb-1">
      <div style= minWidth: periods.length > 14 ? periods.length * 34 + 160 : undefined >
        {/* Period axis */}
        <div className="grid items-end gap-1 mb-1" style= gridTemplateColumns: cols >
          <div />
          {periods.map((p) => (
            <div key={p} className="text-[9px] font-medium text-muted-foreground text-center truncate" title={p}>
              {fmtPeriod(p)}
            </div>
          ))}
        </div>
        {/* Rows */}
        <div className="space-y-1">
          {crimes.map((c) => (
            <div key={c} className="grid items-center gap-1" style= gridTemplateColumns: cols >
              <div className="text-[11px] font-medium text-foreground truncate pr-2" title={tData("crime_type", c, lang)}>
                {tData("crime_type", c, lang)}
              </div>
              {periods.map((p) => {
                const v = grid[`${c}|${p}`] || 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <div
                    key={p}
                    title={`${tData("crime_type", c, lang)} · ${p}: ${v}`}
                    className="h-7 rounded-[4px] border border-border/40 flex items-center justify-center"
                    style= backgroundColor: "var(--main)", opacity: v ? Math.max(0.14, intensity) : 0.05 
                  >
                    {v > 0 && intensity >= 0.55 && (
                      <span className="text-[9px] font-bold tabular-nums text-foreground/80 leading-none">{v}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t("Fewer")}</span>
          <div className="flex items-center gap-0.5">
            {[0.12, 0.3, 0.5, 0.7, 1].map((o) => (
              <span key={o} className="h-2.5 w-5 rounded-[2px]" style= backgroundColor: "var(--main)", opacity: o  />
            ))}
          </div>
          <span>{t("More incidents")}</span>
        </div>
      </div>
    </div>
  );
}

// ── Delta stat card ────────────────────────────────────────────────────────────
function DeltaCard({ label, value, trend, sparkData }: {
  label: string; value: string; trend: "up" | "down" | "flat"; sparkData?: number[];
}) {
  const color = trend === "up" ? "text-destructive" : trend === "down" ? "text-success" : "text-muted-foreground";
  const sparkColor = trend === "up" ? "text-destructive" : trend === "down" ? "text-success" : "text-muted-foreground";
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-end gap-2">
          <span className={`text-3xl font-extrabold tabular-nums ${color}`}>{value}</span>
          <Icon className={`h-5 w-5 mb-1 ${color}`} />
        </div>
        {sparkData && <Sparkline data={sparkData} color={sparkColor} />}
      </div>
    </div>
  );
}

// ── MO cluster row ─────────────────────────────────────────────────────────────
function ClusterRow({ c, lang, t, onOpenCase }: {
  c: MOCluster; lang: string; t: (s: string) => string; onOpenCase: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <td className="px-4 py-3">
          <div className="font-semibold text-sm text-foreground">{c.label}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {c.top_crime_types.slice(0, 2).map(ct => (
              <span key={ct} className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
                {tData("crime_type", ct, lang)}
              </span>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 tabular-nums font-bold text-sm">{c.case_count.toLocaleString()}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
          {c.top_sections.slice(0, 3).join(", ") || "—"}
        </td>
        <td className="px-4 py-3 text-xs text-foreground/80 max-w-[200px]">{c.action_hint}</td>
        <td className="px-4 py-3">
          {open ? <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground rotate-90" /> : <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-5 py-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t("Crime Types")}:</span>
              {c.top_crime_types.map(ct => (
                <span key={ct} className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
                  {tData("crime_type", ct, lang)}
                </span>
              ))}
              {c.top_sections.length > 0 && (
                <>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-3">{t("Sections")}:</span>
                  {c.top_sections.map(s => (
                    <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{s}</span>
                  ))}
                </>
              )}
              {c.representative_case_id && (
                <button
                  onClick={e => { e.stopPropagation(); onOpenCase(c.representative_case_id!); }}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 text-primary px-2.5 py-1 text-[10px] font-bold hover:bg-primary/20 transition"
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

// ── Main screen ────────────────────────────────────────────────────────────────
function TrendsScreen() {
  const t = useT();
  const { lang } = useI18n();

  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [clusters, setClusters] = useState<MOCluster[]>([]);
  const [peaks, setPeaks] = useState<SeasonalPeak[]>([]);
  const [deltas, setDeltas] = useState<TrendsResponse["deltas"]>({ qoq_percent: null, yoy_percent: null });
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [granularity, setGranularity] = useState<"month" | "quarter" | "week">("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "timeseries" | "clusters" | "seasonal">("overview");

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams({ granularity });
    if (crimeType) p.set("crime_type", crimeType);
    if (district) p.set("district", district);
    Promise.all([
      intelligence.getTrends(p),
      intelligence.getMOClusters(),
      intelligence.getSeasonal(crimeType || undefined, district || undefined),
    ]).then(([tr, mo, sea]) => {
      setSeries(tr.series.slice(0, 48));
      setDeltas(tr.deltas);
      setClusters(mo.clusters);
      setPeaks(sea.seasonal_peaks);
      setError(null);
    }).catch(() => setError(t("Could not load trends data.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [crimeType, district, granularity]);

  // Aggregate by crime type for the bar chart
  const topByType = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach(s => { m[s.crime_type] = (m[s.crime_type] || 0) + s.count; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [series]);

  // Sparkline data for delta cards (monthly totals)
  const sparkData = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach(s => { m[s.period] = (m[s.period] || 0) + s.count; });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  }, [series]);

  // District breakdown from series
  const topDistricts = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach(s => { if (s.district) m[s.district] = (m[s.district] || 0) + s.count; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [series]);

  const tabs = [
    { key: "overview", label: t("Overview"), icon: BarChart3 },
    { key: "timeseries", label: t("Time Series"), icon: TrendingUp },
    { key: "clusters", label: t("MO Clusters"), icon: Layers },
    { key: "seasonal", label: t("Seasonal"), icon: Calendar },
  ] as const;

  return (
    <Shell>
      <div className="flex flex-col h-full overflow-auto bg-background">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("PS3 · MO Clustering")}
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2.5 text-foreground">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                {t("Trends & Patterns")}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={load} className="flex items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[10px] font-bold hover:bg-muted transition">
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> {t("Refresh")}
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-border bg-muted/30">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input value={crimeType} onChange={e => setCrimeType(e.target.value)}
            placeholder={t("Crime type filter…")}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-ring" />
          <input value={district} onChange={e => setDistrict(e.target.value)}
            placeholder={t("District filter…")}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-ring" />
          <div className="flex items-center gap-1 border border-input rounded-lg bg-background px-2 py-1 ml-auto">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">{t("Granularity")}</span>
            {(["week", "month", "quarter"] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold capitalize transition ${granularity === g ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                {t(g)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-border bg-card px-6 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>

        <div className="flex-1 p-6 space-y-6">
          {loading && <div className="grid grid-cols-2 gap-4">{[1,2].map(i => <div key={i} className="rounded-xl border bg-card p-5 animate-pulse h-24" />)}</div>}
          {error && <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          {activeTab === "overview" && !loading && (

            <>
              {/* Crime × Period heatmap */}
              {series.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-1">
                    <Layers className="h-4 w-4 text-primary" /> {t("Crime × Period intensity")}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mb-4">
                    {t("Darker cells indicate more reported incidents for that crime type in that period.")}
                  </p>
                  <CrimeHeatmap series={series} lang={lang} t={t} />
                </div>
              )}

              {/* Delta cards */}
              {deltas.qoq_percent != null && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DeltaCard
                    label={t("QoQ Change")}
                    value={`${deltas.qoq_percent > 0 ? "+" : ""}${deltas.qoq_percent.toFixed(1)}%`}
                    trend={deltas.qoq_percent > 5 ? "up" : deltas.qoq_percent < -5 ? "down" : "flat"}
                    sparkData={sparkData}
                  />
                  {deltas.yoy_percent != null && (
                    <DeltaCard
                      label={t("YoY Change")}
                      value={`${deltas.yoy_percent > 0 ? "+" : ""}${deltas.yoy_percent.toFixed(1)}%`}
                      trend={deltas.yoy_percent > 5 ? "up" : deltas.yoy_percent < -5 ? "down" : "flat"}
                      sparkData={sparkData}
                    />
                  )}
                </div>
              )}

              {/* Top crime types */}
              {topByType.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-4">
                    <TrendingUp className="h-4 w-4 text-primary" /> {t("Top Crime Types")}
                  </h2>
                  <div className="space-y-3">
                    {topByType.map(([ct, cnt], idx) => {
                      const max = topByType[0][1];
                      const pct = (cnt / max) * 100;
                      return (
                        <div key={ct} className="flex items-center gap-3">
                          <span className="w-5 text-[10px] text-muted-foreground tabular-nums text-right">{idx + 1}</span>
                          <span className="w-36 text-xs font-semibold truncate">{tData("crime_type", ct, lang)}</span>
                          <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums font-bold text-foreground/70">{cnt.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* District breakdown */}
              {topDistricts.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-4">
                    <BarChart3 className="h-4 w-4 text-primary" /> {t("Top Districts")}
                  </h2>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {topDistricts.map(([dist, cnt]) => {
                      const max = topDistricts[0][1];
                      return (
                        <div key={dist} className="flex items-center gap-2">
                          <span className="w-28 text-[11px] font-medium truncate">{tData("district", dist, lang)}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary/60 rounded-full" style={{ width: `${(cnt / max) * 100}%` }} />
                          </div>
                          <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── TIME SERIES TAB ──────────────────────────────────────────── */}
          {activeTab === "timeseries" && !loading && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-4">
                <BarChart3 className="h-4 w-4 text-primary" /> {t("Incident Trend")}
                <span className="text-xs font-normal text-muted-foreground normal-case capitalize">· {granularity}</span>
              </h2>
              {series.length > 0 ? (
                <>
                  <div className="mb-2">
                    <TrendChart series={series} />
                  </div>
                  <div className="mt-4 overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">{t("Period")}</th>
                          <th className="px-3 py-2 text-left font-semibold">{t("Crime Type")}</th>
                          <th className="px-3 py-2 text-left font-semibold">{t("District")}</th>
                          <th className="px-3 py-2 text-right font-semibold">{t("Count")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {series.map((s, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono text-muted-foreground">{s.period}</td>
                            <td className="px-3 py-2">{tData("crime_type", s.crime_type, lang)}</td>
                            <td className="px-3 py-2">{tData("district", s.district, lang)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-bold">{s.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">{t("No data for this scope.")}</div>
              )}
            </div>
          )}

          {/* ── MO CLUSTERS TAB ──────────────────────────────────────────── */}
          {activeTab === "clusters" && !loading && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" /> {t("MO Clusters")}
                </h2>
                <span className="text-xs text-muted-foreground">{clusters.length} {t("clusters")}</span>
              </div>
              {clusters.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">{t("Cluster")}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t("Cases")}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t("Sections")}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t("Action")}</th>
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clusters.map(c => (
                      <ClusterRow key={c.cluster_id} c={c} lang={lang} t={t} onOpenCase={setDrawerCaseId} />
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">{t("No clusters available.")}</div>
              )}
            </div>
          )}

          {/* ── SEASONAL TAB ─────────────────────────────────────────────── */}
          {activeTab === "seasonal" && !loading && (
            <>
              {peaks.length > 0 ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {peaks.map(p => (
                      <div key={p.period} className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-foreground">{p.period}</span>
                          <span className={`text-sm font-extrabold tabular-nums ${p.lift_percent >= 20 ? "text-destructive" : p.lift_percent >= 10 ? "text-orange-500" : "text-primary"}`}>
                            +{p.lift_percent}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                          <div
                            className={`h-full rounded-full transition-all ${p.lift_percent >= 20 ? "bg-destructive" : p.lift_percent >= 10 ? "bg-orange-500" : "bg-primary"}`}
                            style={{ width: `${Math.min(p.lift_percent * 2, 100)}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-relaxed">{p.recommended_action}</div>
                        <div className="text-[10px] text-primary mt-1 font-medium">{t("above baseline")}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{t("Note")}: </span>
                    {t("Seasonal lift % indicates how much higher the crime rate is compared to the year-round baseline for that period. Higher values indicate stronger seasonal patterns.")}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  {t("No seasonal data available for the current filters.")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <CaseDrawer open={drawerCaseId !== null} onClose={() => setDrawerCaseId(null)} caseId={drawerCaseId ?? undefined} />
    </Shell>
  );
}
```

### 3. `src/routes/forecast.tsx`

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ShieldAlert, Activity, MapPin, Clock,
  ChevronDown, ChevronUp, Filter, RefreshCw, Bell, BellOff,
  ArrowUpRight, CheckCircle2, Info, MessageSquare, Zap,
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

function RiskBadge({ level, lang, size = "sm" }: { level: string; lang: string; size?: "sm" | "lg" }) {
  const base = size === "lg" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] font-bold ${base} ${RISK_BG[level] || "bg-muted text-muted-foreground"}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${RISK_DOT[level] || "bg-current"}`} />
      {tData("risk_label", level, lang)}
    </span>
  );
}

function RiskBar({ score }: { score: number }) {
  const pct = Math.min(100, score);
  const color = pct >= 75 ? "bg-destructive" : pct >= 55 ? "bg-orange-500" : pct >= 30 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-extrabold tabular-nums w-8 text-right">{score}</span>
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────
function AlertCard({ a, expanded, onToggle, lang, t, onSendToChat, onOpenNetwork }: {
  a: ForecastAlert; expanded: boolean; onToggle: () => void;
  lang: string; t: (s: string) => string; onSendToChat: (text: string) => void;
  onOpenNetwork: (district: string, crimeType: string) => void;
}) {
  return (
    <div className={`rounded-xl border bg-card transition-all duration-200 hover:shadow-md ${RISK_BORDER[a.risk_level] || "border-border"} ${RISK_GLOW[a.risk_level] || ""}`}>
      {/* Coloured top strip */}
      <div className={`h-1 rounded-t-xl ${a.risk_level === "Critical" ? "bg-destructive" : a.risk_level === "High" ? "bg-orange-500" : a.risk_level === "Medium" ? "bg-warning" : "bg-success"}`} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <RiskBadge level={a.risk_level} lang={lang} />
              <span className="text-sm font-bold text-foreground truncate">{tData("crime_type", a.crime_type, lang)}</span>
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
            onClick={() => onSendToChat(`${t("Tell me more about")} ${tData("crime_type", a.crime_type, "EN")} ${t("in")} ${a.district}`)}
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
        <div className={`border-t border-border/60 px-4 py-3 space-y-3 rounded-b-xl ${RISK_ACCENT[a.risk_level] || "bg-muted/20"}`}>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <Zap className="h-3 w-3" /> {t("Recommended Action")}
            </div>
            <p className="text-xs font-semibold text-foreground">{a.recommended_action}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground italic leading-relaxed">{a.fairness_note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Risk distribution summary bar ─────────────────────────────────────────────
function RiskSummaryBar({ alerts, lang, t }: { alerts: ForecastAlert[]; lang: string; t: (s: string) => string }) {
  const counts = alerts.reduce<Record<string, number>>((a, c) => {
    a[c.risk_level] = (a[c.risk_level] || 0) + 1; return a;
  }, {});
  const levels = ["Critical", "High", "Medium", "Low"];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {levels.map(lvl => counts[lvl] ? (
        <div key={lvl} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${RISK_BG[lvl]}`}>
          <span>{counts[lvl]}</span>
          <span className="font-normal opacity-80">{tData("risk_label", lvl, lang)}</span>
        </div>
      ) : null)}
      {alerts.length === 0 && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {t("All clear")}
        </span>
      )}
    </div>
  );
}

// ── Forecast grid card (replaces table row) ───────────────────────────────────
function CellCard({ c, expanded, onToggle, lang, t }: {
  c: ForecastCell; expanded: boolean; onToggle: () => void;
  lang: string; t: (s: string) => string;
}) {
  return (
    <div
      className={`rounded-xl border bg-card cursor-pointer transition-all hover:shadow-md ${RISK_BORDER[c.risk_level] || "border-border"}`}
      onClick={onToggle}
    >
      <div className={`h-1 rounded-t-xl ${c.risk_level === "Critical" ? "bg-destructive" : c.risk_level === "High" ? "bg-orange-500" : c.risk_level === "Medium" ? "bg-warning" : "bg-success"}`} />
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <RiskBadge level={c.risk_level} lang={lang} />
          <span className="text-[10px] text-muted-foreground tabular-nums">{c.lat.toFixed(2)}, {c.lng.toFixed(2)}</span>
        </div>
        <div className="text-sm font-bold mb-2 leading-tight">{tData("crime_type", c.crime_type, lang)}</div>
        <RiskBar score={c.risk_score} />
        {expanded && (
          <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{t("Why this cell is flagged")}</div>
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
    ]).then(([a, h, b]) => {
      setAlerts(a.alerts);
      setAlertsAsOf(a.as_of_date);
      setCells(h.cells.slice(0, 40));
      setBacktest(b);
    }).catch(() => setError(t("Could not load forecast data. Check you are signed in and the backend is running.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [crimeType, district, horizon, gridSize]);

  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (autoRefresh) autoRefreshRef.current = setInterval(load, 60_000);
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [autoRefresh, crimeType, district, horizon]);

  const filteredAlerts = severityFilter === "All"
    ? alerts
    : alerts.filter(a => a.risk_level === severityFilter);

  const sortedAlerts = [...filteredAlerts].sort((a, b) =>
    (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9)
  );

  const groupedCells = groupBy
    ? Object.values(
        cells.reduce<Record<string, ForecastCell>>((acc, c) => {
          if (!acc[c.crime_type] || c.risk_score > acc[c.crime_type].risk_score) acc[c.crime_type] = c;
          return acc;
        }, {}),
      ).sort((a, b) => b.risk_score - a.risk_score)
    : [...cells].sort((a, b) => b.risk_score - a.risk_score);

  const criticalCount = alerts.filter(a => a.risk_level === "Critical" || a.risk_level === "High").length;

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
                      PAI {Math.round(backtest.hit_rate_top_10_percent_cells * 100)}% {t("hit rate")}
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
            value={crimeType} onChange={e => setCrimeType(e.target.value)}
            placeholder={t("Crime type…")}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={district} onChange={e => setDistrict(e.target.value)}
            placeholder={t("District…")}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-1 border border-input rounded-lg bg-background px-2 py-1">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">{t("Horizon")}</span>
            {[3, 7, 14, 30].map(d => (
              <button key={d} onClick={() => setHorizon(d)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${horizon === d ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                {d}{t("d")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 border border-input rounded-lg bg-background px-2 py-1">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">{t("Grid")}</span>
            {([["Fine", 0.01], ["Med", 0.02], ["Coarse", 0.05]] as [string, number][]).map(([lbl, v]) => (
              <button key={v} onClick={() => setGridSize(v)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${gridSize === v ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold border transition ${autoRefresh ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground hover:bg-muted"}`}
            >
              {autoRefresh ? "⏱ Auto" : "⏱ Manual"}
            </button>
            <button onClick={load}
              className="flex items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[10px] font-bold hover:bg-muted transition">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              {t("Refresh")}
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-8">
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {/* ── Model inference theater ───────────────────────────────── */}
          <div className="px-0 pt-0">
            <ModelInferenceTheater cells={cells} backtest={backtest} loading={loading} asOf={alertsAsOf} t={t} />
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
                    {" · "}{t("comparing last 30 data-days vs prior 30-day baseline")}
                  </div>
                )}
              </div>
              {/* severity filter pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {["All", "Critical", "High", "Medium", "Low"].map(lvl => (
                  <button key={lvl} onClick={() => setSeverityFilter(lvl)}
                    className={`rounded-full px-3 py-1 text-[10px] font-bold border transition ${
                      severityFilter === lvl
                        ? lvl === "All" ? "bg-foreground text-background border-foreground" : `${RISK_BG[lvl]} border-transparent`
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}>
                    {lvl === "All" ? t("All") : tData("risk_label", lvl, lang)}
                  </button>
                ))}
              </div>
            </div>

            {/* Risk distribution summary */}
            {!loading && alerts.length > 0 && (
              <div className="mb-4 p-3 rounded-xl border border-border bg-muted/30 flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Distribution")}</span>
                <RiskSummaryBar alerts={alerts} lang={lang} t={t} />
              </div>
            )}

            {loading && alerts.length === 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {[1,2,3,4].map(i => <div key={i} className="rounded-xl border bg-card p-4 animate-pulse h-28" />)}
              </div>
            )}

            {!loading && filteredAlerts.length === 0 && (
              <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-6">
                <div className="p-3 rounded-full bg-muted">
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-bold text-foreground">{t("No active alerts")}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t("No forecast thresholds exceeded for the current filters.")}</div>
                </div>
              </div>
            )}

            {sortedAlerts.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                {sortedAlerts.map(a => (
                  <AlertCard key={a.alert_id} a={a}
                    expanded={expandedAlert === a.alert_id}
                    onToggle={() => setExpandedAlert(p => p === a.alert_id ? null : a.alert_id)}
                    lang={lang} t={t} onSendToChat={handleSendToChat} onOpenNetwork={handleOpenNetwork}
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
                  · {horizon}{t("d")} {t("horizon")}
                </span>
              </h2>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={groupBy} onChange={e => setGroupBy(e.target.checked)}
                    className="rounded accent-primary" />
                  {t("Group by crime type")}
                </label>
                <div className="flex rounded-lg border border-input bg-background p-0.5">
                  {(["cards", "table"] as const).map(v => (
                    <button key={v} onClick={() => setGridView(v)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition capitalize ${gridView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      {t(v)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading && cells.length === 0 && (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                {[1,2,3,4,5,6].map(i => <div key={i} className="rounded-xl border bg-card p-4 animate-pulse h-24" />)}
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
                  {groupedCells.map(c => (
                    <CellCard key={c.cell_id} c={c}
                      expanded={expandedCell === c.cell_id}
                      onToggle={() => setExpandedCell(p => p === c.cell_id ? null : c.cell_id)}
                      lang={lang} t={t}
                    />
                  ))}
                </div>
                {groupBy && cells.length > groupedCells.length && (
                  <p className="text-[11px] text-muted-foreground mt-3 text-center">
                    {t("Showing top-risk cell per crime type")} · {cells.length} {t("total cells analysed")}
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
                      <th className="px-4 py-3 text-left font-semibold">{t("Location (lat, lng)")}</th>
                      <th className="px-4 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupedCells.map(c => (
                      <>
                        <tr key={c.cell_id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setExpandedCell(p => p === c.cell_id ? null : c.cell_id)}>
                          <td className="px-4 py-3"><RiskBadge level={c.risk_level} lang={lang} /></td>
                          <td className="px-4 py-3 font-medium text-sm">{tData("crime_type", c.crime_type, lang)}</td>
                          <td className="px-4 py-3 w-40"><RiskBar score={c.risk_score} /></td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                          <td className="px-4 py-3">{expandedCell === c.cell_id ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}</td>
                        </tr>
                        {expandedCell === c.cell_id && (
                          <tr key={c.cell_id + "-exp"} className="bg-muted/20">
                            <td colSpan={5} className="px-6 py-3">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">{t("Why this cell is flagged")}</div>
                              <ul className="space-y-1">
                                {c.why.map((w, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs">
                                    <span className="mt-1 h-1 w-1 rounded-full bg-primary shrink-0" />{w}
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
              {loading && !backtest && <div className="rounded-xl border bg-card p-4 animate-pulse h-24" />}
              {backtest && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
                    <div className="p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{backtest.metric} {t("Score")}</div>
                      <div className="flex items-end gap-2">
                        <span className="text-4xl font-extrabold text-success tabular-nums">
                          {Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground mb-1.5">{t("hit rate")}</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-success rounded-full transition-all"
                          style={{ width: `${Math.round(backtest.hit_rate_top_10_percent_cells * 100)}%` }} />
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t("Backtest Window")}</div>
                      <div className="text-sm font-bold capitalize text-foreground">{backtest.window.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground mt-1">{t("Historical validation period")}</div>
                    </div>
                    <div className="p-5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t("What This Means")}</div>
                      <p className="text-xs text-foreground/80 leading-relaxed">{backtest.explanation}</p>
                    </div>
                  </div>
                  <div className="border-t border-border bg-amber-500/5 px-5 py-3 flex items-start gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {t("Decision support only — not predictive policing. Risk scores are based on historical reported incidents, not arrests or individual characteristics. Patrol decisions require human judgment.")}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      <CaseDrawer open={drawerCaseId !== null} onClose={() => setDrawerCaseId(null)} caseId={drawerCaseId ?? undefined} />
    </Shell>
  );
}
```
