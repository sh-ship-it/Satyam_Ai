import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Layers,
  BarChart3,
  Calendar,
  Filter,
  RefreshCw,
  ArrowUpRight,
  Minus,
  X,
  Flame,
  MapPin,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import {
  intelligence,
  type TrendPoint,
  type MOCluster,
  type SeasonalPeak,
  type TrendsResponse,
} from "@/lib/api/intelligence";
import { CaseDrawer } from "@/components/CaseDrawer";

export const Route = createFileRoute("/trends")({
  head: () => ({ meta: [{ title: "Trends & Patterns · Satyam" }] }),
  component: TrendsScreen,
});

// ── Animated count-up hook ────────────────────────────────────────────────────
function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === 0) {
      setVal(0);
      return;
    }
    let start = 0;
    const step = 16;
    const steps = Math.ceil(duration / step);
    let tick = 0;
    const id = setInterval(() => {
      tick++;
      const t = tick / steps;
      setVal(Math.round(target * (t < 1 ? 1 - Math.pow(1 - t, 3) : 1)));
      if (tick >= steps) clearInterval(id);
    }, step);
    return () => clearInterval(id);
  }, [target, duration]);
  return val;
}

// ── Mini sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ data, color = "text-primary" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 72;
  const h = 30;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg width={w} height={h} className={`${color} overflow-visible`}>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── KPI Summary Card ───────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "text-primary",
  iconBg = "bg-primary/10",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  iconBg?: string;
}) {
  const numVal = typeof value === "number" ? value : NaN;
  const counted = useCountUp(isNaN(numVal) ? 0 : numVal);
  const display = isNaN(numVal) ? String(value) : counted.toLocaleString();
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-xl ${iconBg} shrink-0`}>
        <Icon className={`h-5 w-5 ${accent}`} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
          {label}
        </div>
        <div className={`text-2xl font-extrabold tabular-nums leading-tight ${accent}`}>
          {display}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ── Time series bar chart (pixel-height bars, peak annotation) ───────────────
function TrendChart({ series, t }: { series: TrendPoint[]; t: (s: string) => string }) {
  const byPeriod = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach((s) => {
      m[s.period] = (m[s.period] || 0) + s.count;
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [series]);

  const [hover, setHover] = useState<number | null>(null);

  if (byPeriod.length === 0)
    return (
      <div className="text-xs text-muted-foreground text-center py-10">{t("No trend data")}</div>
    );

  const max = Math.max(1, ...byPeriod.map(([, v]) => v));
  const peakIdx = byPeriod.reduce((b, [, v], i, a) => (v > a[b][1] ? i : b), 0);
  const fmt = (p: string) => (p.length > 7 ? p.slice(2) : p);

  // ── Single period → spotlight (no degenerate full-width block) ──
  if (byPeriod.length === 1) {
    const [period, v] = byPeriod[0];
    return (
      <div className="relative flex h-56 flex-col items-center justify-center gap-3">
        <style>{TREND_STYLE}</style>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {fmt(period)}
        </span>
        <div className="flex items-end gap-2 tc-fade">
          <span className="text-6xl font-extrabold leading-none tabular-nums text-primary">
            {v}
          </span>
          <span className="mb-1.5 text-xs text-muted-foreground">{t("incidents")}</span>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-[10px] font-bold text-destructive">
          <TrendingUp className="h-3 w-3" /> {t("Peak period")}
        </span>
        <div className="mt-1 w-full max-w-md px-2">
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="tc-grow h-full rounded-full bg-gradient-to-r from-primary/60 to-primary" />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
            <span>0</span>
            <span>
              {t("max")} {max}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Multi period → smooth area + line chart ──
  const n = byPeriod.length;
  const TOP = 16,
    BOT = 84,
    PADX = 4;
  const pts = byPeriod.map(([, v], i) => ({
    x: PADX + (i / (n - 1)) * (100 - 2 * PADX),
    y: BOT - (v / max) * (BOT - TOP),
  }));
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${pts[0].x.toFixed(2)},${BOT} ${line} ${pts[n - 1].x.toFixed(2)},${BOT}`;
  const showLabel = (i: number) => n <= 10 || i === 0 || i === n - 1 || i === peakIdx;

  return (
    <div className="relative h-56 w-full">
      <style>{TREND_STYLE}</style>

      {/* gridlines + y scale */}
      {[0, 0.5, 1].map((g) => (
        <div
          key={g}
          className="absolute left-0 right-0 border-t border-dashed border-border/60"
          style={{ top: `${TOP + (1 - g) * (BOT - TOP)}%` }}
        >
          <span className="absolute -top-1.5 left-0 bg-card pr-1 text-[8px] tabular-nums text-muted-foreground">
            {Math.round(max * g)}
          </span>
        </div>
      ))}

      {/* area + line */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="tc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--main)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--main)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon className="tc-area" points={area} fill="url(#tc-fill)" />
        <polyline
          className="tc-line"
          points={line}
          fill="none"
          stroke="var(--main)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
        />
      </svg>

      {/* dots + peak marker */}
      {pts.map((p, i) => {
        const isPeak = i === peakIdx;
        const [period, v] = byPeriod[i];
        return (
          <div
            key={period}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {isPeak && (
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-destructive px-1.5 py-0.5 text-[8px] font-bold text-white">
                ▲ {v}
              </span>
            )}
            <div
              className={`tc-dot rounded-full ${isPeak ? "tc-peak h-3 w-3 bg-destructive ring-2 ring-destructive/30" : "h-2 w-2 bg-primary"}`}
            />
          </div>
        );
      })}

      {/* x-axis labels */}
      {pts.map((p, i) =>
        showLabel(i) ? (
          <div
            key={`l${i}`}
            className="absolute -translate-x-1/2 whitespace-nowrap text-[8px] text-muted-foreground"
            style={{ left: `${p.x}%`, top: "90%" }}
            title={byPeriod[i][0]}
          >
            {fmt(byPeriod[i][0])}
          </div>
        ) : null,
      )}

      {/* hover capture + tooltip */}
      <div
        className="absolute top-0 flex"
        style={{ left: `${PADX}%`, right: `${PADX}%`, height: `${BOT}%` }}
      >
        {byPeriod.map(([period], i) => (
          <div
            key={period}
            className="flex-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-card px-2 py-1 text-[10px] shadow-md"
          style={{ left: `${pts[hover].x}%`, top: `${pts[hover].y}%` }}
        >
          <div className="font-bold text-foreground">
            {byPeriod[hover][1]} {t("incidents")}
          </div>
          <div className="text-muted-foreground">{byPeriod[hover][0]}</div>
        </div>
      )}
    </div>
  );
}

const TREND_STYLE = `
.tc-fade{ animation: tc-fade .7s ease-out both; }
@keyframes tc-fade{ from{ opacity:0; transform: translateY(6px); } to{ opacity:1; transform:none; } }
.tc-grow{ transform-origin:left; animation: tc-grow 1s ease-out both; }
@keyframes tc-grow{ from{ transform: scaleX(0); } to{ transform: scaleX(1); } }
.tc-area{ animation: tc-fade .9s ease-out both; }
.tc-line{ stroke-dasharray:1; animation: tc-draw 1.1s ease-out forwards; }
@keyframes tc-draw{ from{ stroke-dashoffset:1; } to{ stroke-dashoffset:0; } }
.tc-dot{ animation: tc-pop .45s ease-out both; }
@keyframes tc-pop{ from{ transform: scale(0); } to{ transform: scale(1); } }
.tc-peak{ animation: tc-peak 2s ease-in-out infinite; }
@keyframes tc-peak{ 0%,100%{ box-shadow: 0 0 0 0 rgba(255,77,80,.5); } 50%{ box-shadow: 0 0 0 7px rgba(255,77,80,0); } }
@media (prefers-reduced-motion: reduce){
  .tc-fade,.tc-grow,.tc-area,.tc-line,.tc-dot,.tc-peak{ animation: none !important; }
  .tc-grow{ transform: scaleX(1); }
  .tc-line{ stroke-dashoffset: 0; }
}
`;

// ── Crime × period heatmap ─────────────────────────────────────────────────────
function CrimeHeatmap({
  series,
  lang,
  t,
}: {
  series: TrendPoint[];
  lang: string;
  t: (s: string) => string;
}) {
  const { periods, crimes, grid, max } = useMemo(() => {
    const pSet = new Set<string>(),
      cSet = new Set<string>();
    const g: Record<string, number> = {};
    let mx = 1;
    series.forEach((s) => {
      pSet.add(s.period);
      cSet.add(s.crime_type);
      const k = `${s.crime_type}|${s.period}`;
      g[k] = (g[k] || 0) + s.count;
      mx = Math.max(mx, g[k]);
    });
    return {
      periods: [...pSet].sort(),
      crimes: [...cSet].sort((a, b) => a.localeCompare(b)).slice(0, 8),
      grid: g,
      max: mx,
    };
  }, [series]);

  if (periods.length === 0)
    return (
      <div className="text-xs text-muted-foreground text-center py-10">
        {t("No data for this scope.")}
      </div>
    );

  const cols = `minmax(120px,160px) repeat(${periods.length}, minmax(30px, 1fr))`;
  const fmtPeriod = (p: string) => (p.length > 7 ? p.slice(2) : p);

  return (
    <div className="overflow-x-auto pb-1">
      <div style={{ minWidth: periods.length > 14 ? periods.length * 34 + 160 : undefined }}>
        <div className="grid items-end gap-1 mb-1" style={{ gridTemplateColumns: cols }}>
          <div />
          {periods.map((p) => (
            <div
              key={p}
              className="text-[9px] font-medium text-muted-foreground text-center truncate"
              title={p}
            >
              {fmtPeriod(p)}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {crimes.map((c) => (
            <div key={c} className="grid items-center gap-1" style={{ gridTemplateColumns: cols }}>
              <div
                className="text-[11px] font-medium text-foreground truncate pr-2"
                title={tData("crime_type", c, lang)}
              >
                {tData("crime_type", c, lang)}
              </div>
              {periods.map((p) => {
                const v = grid[`${c}|${p}`] || 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <div
                    key={p}
                    title={`${tData("crime_type", c, lang)} · ${p}: ${v}`}
                    className="h-7 rounded-[4px] border border-border/40 flex items-center justify-center transition-all hover:scale-105 hover:border-primary/40 cursor-default"
                    style={{
                      backgroundColor: "var(--main)",
                      opacity: v ? Math.max(0.12, intensity) : 0.04,
                    }}
                  >
                    {v > 0 && intensity >= 0.55 && (
                      <span className="text-[9px] font-bold tabular-nums text-foreground/80 leading-none">
                        {v}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t("Fewer")}</span>
          <div className="flex items-center gap-0.5">
            {[0.1, 0.28, 0.48, 0.7, 1].map((o) => (
              <span
                key={o}
                className="h-2.5 w-5 rounded-[2px]"
                style={{ backgroundColor: "var(--main)", opacity: o }}
              />
            ))}
          </div>
          <span>{t("More incidents")}</span>
        </div>
      </div>
    </div>
  );
}

// ── Delta stat card ────────────────────────────────────────────────────────────
function DeltaCard({
  label,
  value,
  trend,
  sparkData,
}: {
  label: string;
  value: string;
  trend: "up" | "down" | "flat";
  sparkData?: number[];
}) {
  const color =
    trend === "up"
      ? "text-destructive"
      : trend === "down"
        ? "text-success"
        : "text-muted-foreground";
  const sparkColor =
    trend === "up"
      ? "text-destructive"
      : trend === "down"
        ? "text-success"
        : "text-muted-foreground";
  const bg =
    trend === "up"
      ? "bg-destructive/10 border-destructive/20"
      : trend === "down"
        ? "bg-success/10 border-success/20"
        : "bg-muted border-border";
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  return (
    <div className={`rounded-xl border p-5 ${bg}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {label}
      </div>
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
        className={`cursor-pointer transition-colors ${open ? "bg-primary/5" : "hover:bg-muted/20"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-4 py-3">
          <div className="font-semibold text-sm text-foreground">{c.label}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {c.top_crime_types.slice(0, 2).map((ct) => (
              <span
                key={ct}
                className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
              >
                {tData("crime_type", ct, lang)}
              </span>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 tabular-nums font-bold text-sm">
          {c.case_count.toLocaleString()}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
          {c.top_sections.slice(0, 3).join(", ") || "—"}
        </td>
        <td className="px-4 py-3 text-xs text-foreground/80 max-w-[200px]">{c.action_hint}</td>
        <td className="px-4 py-3">
          <ArrowUpRight
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/10 border-b border-border">
          <td colSpan={5} className="px-5 py-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("Crime Types")}:
              </span>
              {c.top_crime_types.map((ct) => (
                <span
                  key={ct}
                  className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
                >
                  {tData("crime_type", ct, lang)}
                </span>
              ))}
              {c.top_sections.length > 0 && (
                <>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-3">
                    {t("Sections")}:
                  </span>
                  {c.top_sections.map((s) => (
                    <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                      {s}
                    </span>
                  ))}
                </>
              )}
              {c.representative_case_id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCase(c.representative_case_id!);
                  }}
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

// ── Debounce hook ──────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return dv;
}

// ── Dominant pattern callout ───────────────────────────────────────────────────
function DominantCallout({
  topByType,
  lang,
  t,
}: {
  topByType: [string, number][];
  lang: string;
  t: (s: string) => string;
}) {
  if (topByType.length < 2) return null;
  const total = topByType.reduce((s, [, v]) => s + v, 0);
  const [topCt, topCnt] = topByType[0];
  const dominance = total > 0 ? ((topCnt / total) * 100).toFixed(0) : "0";
  const isDominant = parseFloat(dominance) >= 30;
  if (!isDominant) return null;
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/8 p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg bg-warning/20 shrink-0">
        <AlertTriangle className="h-4 w-4 text-warning" />
      </div>
      <div>
        <div className="text-xs font-bold text-warning mb-0.5">
          {t("Dominant Pattern Detected")}
        </div>
        <div className="text-xs text-foreground/80">
          <span className="font-semibold">{tData("crime_type", topCt, lang)}</span>{" "}
          {t("accounts for")} <span className="font-bold text-warning">{dominance}%</span>{" "}
          {t("of all incidents in this view.")}
        </div>
      </div>
    </div>
  );
}

// ── Bar rank colors ────────────────────────────────────────────────────────────
const BAR_COLORS = [
  "from-destructive/70 to-destructive",
  "from-orange-500/70 to-orange-500",
  "from-amber-500/70 to-amber-500",
  "from-primary/80 to-primary",
  "from-primary/60 to-primary/80",
  "from-primary/50 to-primary/70",
  "from-primary/40 to-primary/60",
  "from-primary/30 to-primary/50",
];

// ── Animated top crime type bars ───────────────────────────────────────────────
function AnimatedBars({
  topByType,
  lang,
  t,
}: {
  topByType: [string, number][];
  lang: string;
  t: (s: string) => string;
}) {
  const [mounted, setMounted] = useState(false);

  // Use a timeout (not rAF) so the 0% width paint is guaranteed flushed first
  useEffect(() => {
    setMounted(false);
    const id = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(id);
  }, [topByType]);

  const total = topByType.reduce((s, [, v]) => s + v, 0);
  const maxVal = topByType[0]?.[1] ?? 1;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-5">
        <TrendingUp className="h-4 w-4 text-primary" /> {t("Top Crime Types")}
        <span className="ml-auto text-[10px] font-normal text-muted-foreground normal-case">
          {t("by incident count")}
        </span>
      </h2>
      <div className="space-y-4">
        {topByType.map(([ct, cnt], idx) => {
          const pct = (cnt / maxVal) * 100;
          const sharePct = total > 0 ? ((cnt / total) * 100).toFixed(0) : "0";
          const color = BAR_COLORS[Math.min(idx, BAR_COLORS.length - 1)];
          return (
            <div key={ct}>
              <div className="flex items-center gap-3 mb-1.5">
                <span
                  className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0
                  ${
                    idx === 0
                      ? "bg-destructive text-destructive-foreground"
                      : idx === 1
                        ? "bg-orange-500 text-white"
                        : idx === 2
                          ? "bg-amber-500 text-white"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {idx + 1}
                </span>
                <span className="flex-1 text-xs font-semibold text-foreground truncate">
                  {tData("crime_type", ct, lang)}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{sharePct}%</span>
                <span className="w-14 text-right text-xs tabular-nums font-bold text-foreground">
                  {cnt.toLocaleString()}
                </span>
              </div>
              {/* Track is a plain block div — width % resolves correctly */}
              <div className="h-4 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${color}`}
                  style={{
                    width: `${mounted ? pct : 0}%`,
                    transition: mounted ? `width 700ms ease-out ${idx * 60}ms` : "none",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
function TrendsScreen() {
  const t = useT();
  const { lang } = useI18n();

  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [clusters, setClusters] = useState<MOCluster[]>([]);
  const [peaks, setPeaks] = useState<SeasonalPeak[]>([]);
  const [deltas, setDeltas] = useState<TrendsResponse["deltas"]>({
    qoq_percent: null,
    yoy_percent: null,
  });
  const [crimeTypeInput, setCrimeTypeInput] = useState("");
  const [districtInput, setDistrictInput] = useState("");
  const crimeType = useDebounce(crimeTypeInput, 400);
  const district = useDebounce(districtInput, 400);
  const [granularity, setGranularity] = useState<"month" | "quarter" | "week">("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "timeseries" | "clusters" | "seasonal">(
    "overview",
  );
  const loadingRef = useRef(false);

  const load = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const p = new URLSearchParams({ granularity });
    if (crimeType) p.set("crime_type", crimeType);
    if (district) p.set("district", district);
    Promise.all([
      intelligence.getTrends(p),
      intelligence.getMOClusters(),
      intelligence.getSeasonal(crimeType || undefined, district || undefined),
    ])
      .then(([tr, mo, sea]) => {
        setSeries(tr.series.slice(0, 48));
        setDeltas(tr.deltas);
        setClusters(mo.clusters);
        setPeaks(sea.seasonal_peaks);
        setError(null);
      })
      .catch(() => setError(t("Could not load trends data.")))
      .finally(() => {
        setLoading(false);
        loadingRef.current = false;
      });
  };

  useEffect(() => {
    load();
  }, [crimeType, district, granularity]);

  // Aggregate by crime type for the bar chart
  const topByType = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach((s) => {
      m[s.crime_type] = (m[s.crime_type] || 0) + s.count;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [series]);

  // Sparkline data (period totals)
  const sparkData = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach((s) => {
      m[s.period] = (m[s.period] || 0) + s.count;
    });
    return Object.entries(m)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
  }, [series]);

  // Total incidents KPI
  const totalIncidents = useMemo(() => series.reduce((s, r) => s + r.count, 0), [series]);
  const distinctCrimeTypes = useMemo(() => new Set(series.map((s) => s.crime_type)).size, [series]);
  const topDistricts = useMemo(() => {
    const m: Record<string, number> = {};
    series.forEach((s) => {
      if (s.district) m[s.district] = (m[s.district] || 0) + s.count;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [series]);
  const topDistrict = topDistricts[0];
  const trendDir: "up" | "down" | "flat" =
    deltas.qoq_percent != null
      ? deltas.qoq_percent > 5
        ? "up"
        : deltas.qoq_percent < -5
          ? "down"
          : "flat"
      : "flat";

  const tabs = [
    { key: "overview", label: t("Overview"), icon: BarChart3, badge: null },
    {
      key: "timeseries",
      label: t("Time Series"),
      icon: TrendingUp,
      badge: sparkData.length || null,
    },
    { key: "clusters", label: t("MO Clusters"), icon: Layers, badge: clusters.length || null },
    { key: "seasonal", label: t("Seasonal"), icon: Calendar, badge: peaks.length || null },
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
                {loading && (
                  <span className="text-xs font-normal text-muted-foreground flex items-center gap-1 ml-1">
                    <RefreshCw className="h-3 w-3 animate-spin" /> {t("loading…")}
                  </span>
                )}
              </h1>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-bold hover:bg-muted transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{" "}
              {t("Refresh")}
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-border bg-muted/30">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {/* Crime type filter with clear */}
          <div className="relative">
            <input
              value={crimeTypeInput}
              onChange={(e) => setCrimeTypeInput(e.target.value)}
              placeholder={t("Crime type filter…")}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-44 pr-7 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {crimeTypeInput && (
              <button
                onClick={() => setCrimeTypeInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {/* District filter with clear */}
          <div className="relative">
            <input
              value={districtInput}
              onChange={(e) => setDistrictInput(e.target.value)}
              placeholder={t("District filter…")}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs w-44 pr-7 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {districtInput && (
              <button
                onClick={() => setDistrictInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {/* Granularity selector */}
          <div className="flex items-center gap-1 border border-input rounded-lg bg-background px-2 py-1 ml-auto">
            <span className="text-[10px] font-semibold text-muted-foreground mr-1">
              {t("Granularity")}
            </span>
            {(["week", "month", "quarter"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-bold capitalize transition ${
                  granularity === g
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {t(g)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-border bg-card px-6 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {badge != null && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                    activeTab === key
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

        <div className="flex-1 p-6 space-y-6">
          {/* Skeleton while loading */}
          {loading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-xl border bg-card p-5 animate-pulse h-24" />
              ))}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          {activeTab === "overview" && !loading && (
            <>
              {/* KPI summary row */}
              {series.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <KpiCard
                    icon={Activity}
                    label={t("Total Incidents")}
                    value={totalIncidents}
                    sub={`${sparkData.length} ${t("periods")}`}
                    accent="text-primary"
                    iconBg="bg-primary/10"
                  />
                  <KpiCard
                    icon={Flame}
                    label={t("Crime Types")}
                    value={distinctCrimeTypes}
                    sub={topByType[0] ? tData("crime_type", topByType[0][0], lang) : "—"}
                    accent="text-destructive"
                    iconBg="bg-destructive/10"
                  />
                  <KpiCard
                    icon={MapPin}
                    label={t("Top District")}
                    value={topDistrict ? tData("district", topDistrict[0], lang) : "—"}
                    sub={
                      topDistrict
                        ? `${topDistrict[1].toLocaleString()} ${t("incidents")}`
                        : undefined
                    }
                    accent="text-warning"
                    iconBg="bg-warning/10"
                  />
                  <KpiCard
                    icon={
                      trendDir === "up" ? TrendingUp : trendDir === "down" ? TrendingDown : Minus
                    }
                    label={t("QoQ Trend")}
                    value={
                      deltas.qoq_percent != null
                        ? `${deltas.qoq_percent > 0 ? "+" : ""}${deltas.qoq_percent.toFixed(1)}%`
                        : "—"
                    }
                    sub={
                      trendDir === "up"
                        ? t("Rising")
                        : trendDir === "down"
                          ? t("Falling")
                          : t("Stable")
                    }
                    accent={
                      trendDir === "up"
                        ? "text-destructive"
                        : trendDir === "down"
                          ? "text-success"
                          : "text-muted-foreground"
                    }
                    iconBg={
                      trendDir === "up"
                        ? "bg-destructive/10"
                        : trendDir === "down"
                          ? "bg-success/10"
                          : "bg-muted"
                    }
                  />
                </div>
              )}

              {/* Dominant pattern callout */}
              <DominantCallout topByType={topByType} lang={lang} t={t} />

              {/* Crime × Period heatmap */}
              {series.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-1">
                    <Layers className="h-4 w-4 text-primary" /> {t("Crime × Period intensity")}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mb-4">
                    {t(
                      "Darker cells indicate more reported incidents for that crime type in that period.",
                    )}
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
                    trend={
                      deltas.qoq_percent > 5 ? "up" : deltas.qoq_percent < -5 ? "down" : "flat"
                    }
                    sparkData={sparkData}
                  />
                  {deltas.yoy_percent != null && (
                    <DeltaCard
                      label={t("YoY Change")}
                      value={`${deltas.yoy_percent > 0 ? "+" : ""}${deltas.yoy_percent.toFixed(1)}%`}
                      trend={
                        deltas.yoy_percent > 5 ? "up" : deltas.yoy_percent < -5 ? "down" : "flat"
                      }
                      sparkData={sparkData}
                    />
                  )}
                </div>
              )}

              {/* Top crime types — rich animated bars */}
              {topByType.length > 0 && <AnimatedBars topByType={topByType} lang={lang} t={t} />}

              {/* Top Districts */}
              {topDistricts.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-4">
                    <MapPin className="h-4 w-4 text-primary" /> {t("Top Districts")}
                  </h2>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {topDistricts.map(([dist, cnt], idx) => {
                      const maxVal = topDistricts[0][1];
                      const isTop = idx === 0;
                      return (
                        <div
                          key={dist}
                          className={`flex items-center gap-2 rounded-lg p-2 ${isTop ? "bg-warning/8 border border-warning/20" : ""}`}
                        >
                          {isTop && <span className="text-warning text-xs">🥇</span>}
                          <span
                            className={`w-32 text-[11px] font-medium truncate ${isTop ? "text-warning font-bold" : ""}`}
                          >
                            {tData("district", dist, lang)}
                          </span>
                          <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${isTop ? "bg-warning" : "bg-primary/60"}`}
                              style={{
                                width: `${(cnt / maxVal) * 100}%`,
                                transitionDelay: `${idx * 40}ms`,
                              }}
                            />
                          </div>
                          <span className="w-12 text-right text-[10px] tabular-nums font-bold text-foreground/70">
                            {cnt.toLocaleString()}
                          </span>
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
              <h2 className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-primary" /> {t("Incident Trend")}
                <span className="text-xs font-normal text-muted-foreground normal-case capitalize">
                  · {granularity}
                </span>
              </h2>
              <p className="text-[11px] text-muted-foreground mb-4">
                {t("Total reported incidents per period. Peak bar is highlighted.")}
              </p>
              {series.length > 0 ? (
                <>
                  <TrendChart series={series} t={t} />
                  <div className="mt-6 overflow-auto max-h-64 rounded-lg border border-border">
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
                          <tr key={i} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {s.period}
                            </td>
                            <td className="px-3 py-2">{tData("crime_type", s.crime_type, lang)}</td>
                            <td className="px-3 py-2">{tData("district", s.district, lang)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-bold">
                              {s.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                  {t("No data for this scope.")}
                </div>
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
                <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[10px] font-bold">
                  {clusters.length} {t("clusters")}
                </span>
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
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                  {t("No clusters available.")}
                </div>
              )}
            </div>
          )}

          {/* ── SEASONAL TAB ─────────────────────────────────────────────── */}
          {activeTab === "seasonal" && !loading && (
            <>
              {peaks.length > 0 ? (
                <>
                  {/* Summary callout for highest seasonal spike */}
                  {(() => {
                    const topPeak = [...peaks].sort((a, b) => b.lift_percent - a.lift_percent)[0];
                    return topPeak && topPeak.lift_percent >= 15 ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-4 flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-destructive/20 shrink-0">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-destructive mb-0.5">
                            {t("Highest Seasonal Spike")}
                          </div>
                          <div className="text-xs text-foreground/80">
                            <span className="font-semibold">{topPeak.period}</span>
                            {" — "}
                            <span className="font-bold text-destructive">
                              +{topPeak.lift_percent}%
                            </span>{" "}
                            {t("above baseline")}
                          </div>
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {[...peaks]
                      .sort((a, b) => b.lift_percent - a.lift_percent)
                      .map((p) => (
                        <div
                          key={p.period}
                          className="rounded-xl border border-border bg-card p-5 hover:shadow-md transition group"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-bold text-foreground">{p.period}</span>
                            <span
                              className={`text-sm font-extrabold tabular-nums px-2 py-0.5 rounded-full ${
                                p.lift_percent >= 20
                                  ? "text-destructive bg-destructive/10"
                                  : p.lift_percent >= 10
                                    ? "text-warning bg-warning/10"
                                    : "text-primary bg-primary/10"
                              }`}
                            >
                              +{p.lift_percent}%
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                            <div
                              className={`h-full rounded-full transition-all duration-700 group-hover:opacity-90 ${
                                p.lift_percent >= 20
                                  ? "bg-destructive"
                                  : p.lift_percent >= 10
                                    ? "bg-warning"
                                    : "bg-primary"
                              }`}
                              style={{ width: `${Math.min(p.lift_percent * 2.5, 100)}%` }}
                            />
                          </div>
                          <div className="text-[11px] text-muted-foreground leading-relaxed mb-1">
                            {p.recommended_action}
                          </div>
                          <div className="text-[10px] text-primary font-medium">
                            {t("above baseline")}
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{t("Note")}: </span>
                    {t(
                      "Seasonal lift % indicates how much higher the crime rate is compared to the year-round baseline for that period. Higher values indicate stronger seasonal patterns.",
                    )}
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
      <CaseDrawer
        open={drawerCaseId !== null}
        onClose={() => setDrawerCaseId(null)}
        caseId={drawerCaseId ?? undefined}
      />
    </Shell>
  );
}
