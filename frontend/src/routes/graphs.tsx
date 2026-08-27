import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ArrowLeft, BarChart3, Filter, RefreshCw, RotateCcw, TrendingUp } from "lucide-react";
import { Shell } from "@/components/Shell";
import { ChartContainer } from "@/components/ui/chart";
import { useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { FALLBACK, useChartPalette, useMounted, type Palette } from "@/lib/chartPalette";
import { api, getAuthToken } from "@/lib/api/client";
import {
  dashboard,
  intelligence,
  type DashboardSummary,
  type NamedCount,
  type TrendPoint,
} from "@/lib/api/intelligence";

type Search = { year?: number; district?: string; crime_type?: string };

export const Route = createFileRoute("/graphs")({
  // Filters ride in the URL so the "See more" button on the Console can hand over
  // the scope the officer was already looking at, and so a chart view is a
  // shareable link rather than a dead end.
  validateSearch: (search: Record<string, unknown>): Search => ({
    year:
      search.year != null && !Number.isNaN(Number(search.year)) ? Number(search.year) : undefined,
    district: typeof search.district === "string" && search.district ? search.district : undefined,
    crime_type:
      typeof search.crime_type === "string" && search.crime_type ? search.crime_type : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Graphs · Satyam" },
      {
        name: "description",
        content:
          "Every aggregate in the Satyam dataset rendered across chart types — volume, mix, disposition, geography and station performance.",
      },
    ],
  }),
  component: GraphsScreen,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Layout primitives
 * ──────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toLocaleString();

function ChartCard({
  title,
  kind,
  subtitle,
  note,
  wide,
  tall,
  children,
}: {
  title: string;
  /** The chart family, shown as a chip so the screen doubles as a chart index. */
  kind: string;
  subtitle?: string;
  note?: string;
  wide?: boolean;
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-card p-3.5 shadow-sm ${wide ? "xl:col-span-2" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[11px] font-bold uppercase tracking-wider text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          {kind}
        </span>
      </div>
      <div className={tall ? "h-[300px]" : "h-[230px]"}>{children}</div>
      {note && (
        <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}
    </section>
  );
}

function Skeleton({ tall }: { tall?: boolean }) {
  return (
    <div
      className={`w-full animate-pulse rounded-md bg-muted/50 ${tall ? "h-[300px]" : "h-[230px]"}`}
    />
  );
}

function NoData({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Screen
 * ──────────────────────────────────────────────────────────────────────────── */

function GraphsScreen() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const palette = useChartPalette();
  const mounted = useMounted();

  const [year, setYear] = useState<number | null>(search.year ?? null);
  const [district, setDistrict] = useState(search.district ?? "");
  const [crimeType, setCrimeType] = useState(search.crime_type ?? "");
  const [granularity, setGranularity] = useState<"month" | "quarter" | "week">("month");

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const filters = { year, district: district || undefined, crime_type: crimeType || undefined };

    // The Console has almost certainly already fetched this exact scope, and the
    // read cache is shared, so arriving via "See more" paints real figures on the
    // first frame instead of a skeleton.
    const cached = dashboard.peek(filters);
    if (cached) setSummary(cached);
    setLoading(!cached);
    setErr(null);

    // No re-entrancy ref here on purpose. A `useRef` guard combined with the
    // `cancelled` flag below deadlocks under StrictMode's double-invoke: the first
    // mount claims the ref, its cleanup sets its own `cancelled`, and the second
    // mount then sees the ref still claimed and returns without fetching — so the
    // surviving mount never requests anything and `loading` never clears. The
    // `cancelled` flag alone is sufficient, and is what the Console does.
    (async () => {
      if (!getAuthToken()) {
        try {
          await api.login("demo", "");
        } catch {
          /* surfaced by the request below */
        }
      }
      const p = new URLSearchParams({ granularity });
      if (crimeType) p.set("crime_type", crimeType);
      if (district) p.set("district", district);
      try {
        const [sum, trends] = await Promise.all([
          dashboard.summary(filters),
          intelligence.getTrends(p),
        ]);
        if (cancelled) return;
        setSummary(sum);
        setSeries(trends.series);
      } catch (e: unknown) {
        if (cancelled) return;
        const status = (e as { status?: number })?.status;
        setErr(
          status === 401
            ? t("Session expired — please sign out and sign in again.")
            : status === 403
              ? t("Your rank does not have permission to view analytics.")
              : status != null
                ? `${t("API error")} ${status}`
                : t("Could not reach the API — make sure the backend is running."),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, district, crimeType, granularity, reloadKey]);

  const k = summary?.kpis;

  /* ── Derived series ──────────────────────────────────────────────────────── */

  // Memoised because `?? []` would hand a fresh array to the memos below on every
  // render, so each of them would recompute on every render.
  const yearly = useMemo(() => summary?.yearly ?? [], [summary]);

  /** YoY change as a waterfall: an invisible base bar carries each step's start. */
  const waterfall = useMemo(() => {
    let running = 0;
    return yearly.map((r, i) => {
      // The first year is the opening balance, not a change — there is no prior
      // year to compare it against. Flagged so it is drawn neutral rather than as
      // a +6,552 "increase", which is what it looked like before.
      const opening = i === 0;
      const delta = opening ? r.count : r.count - yearly[i - 1].count;
      const base = opening ? 0 : running;
      running += delta;
      return {
        label: String(r.year),
        base: delta >= 0 ? base : base + delta,
        delta: Math.abs(delta),
        signed: delta,
        opening,
        total: r.count,
      };
    });
  }, [yearly]);

  const topCrimes = useMemo(
    () => (summary?.crime_mix ?? []).slice(0, 6).map((c) => c.name),
    [summary],
  );

  /** Long trend rows pivoted wide, one column per top crime type. */
  const stacked = useMemo(() => {
    const byPeriod = new Map<string, Record<string, number | string>>();
    for (const row of series) {
      if (!byPeriod.has(row.period)) byPeriod.set(row.period, { period: row.period });
      const bucket = byPeriod.get(row.period)!;
      const key = topCrimes.includes(row.crime_type) ? row.crime_type : "__other__";
      bucket[key] = ((bucket[key] as number) ?? 0) + row.count;
    }
    return [...byPeriod.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }, [series, topCrimes]);

  const periodTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of series) m.set(row.period, (m.get(row.period) ?? 0) + row.count);
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, count]) => ({ period, count }));
  }, [series]);

  const topDistricts = useMemo(() => (summary?.districts ?? []).slice(0, 12), [summary]);

  const disposition = useMemo(
    () => (summary?.status_mix ?? []).filter((s) => s.count > 0).slice(0, 8),
    [summary],
  );

  /** Stations plotted as volume against clearance, to expose the outliers. */
  const stationPoints = useMemo(
    () =>
      (summary?.stations ?? [])
        .filter((s) => s.firs > 0)
        .map((s) => ({ x: s.firs, y: s.clearance_percent, name: s.station })),
    [summary],
  );

  const districtBubbles = useMemo(
    () =>
      topDistricts.map((d) => ({
        x: d.count,
        y: d.clearance_percent,
        z: Math.max(1, d.cleared),
        name: d.name,
      })),
    [topDistricts],
  );

  const treemapData = useMemo(
    () => topDistricts.map((d, i) => ({ name: d.name, size: d.count, idx: i })),
    [topDistricts],
  );

  const radarData = useMemo(
    () =>
      (summary?.crime_mix ?? []).slice(0, 6).map((c) => ({
        subject: tData("crime_type", c.name, lang),
        value: c.count,
      })),
    [summary, lang],
  );

  /** Pivot: crime type down the side, period across the top. */
  const pivot = useMemo(() => {
    const periods = [...new Set(series.map((s) => s.period))].sort().slice(-8);
    const cells = new Map<string, number>();
    for (const row of series) {
      if (!periods.includes(row.period)) continue;
      const key = `${row.crime_type}|${row.period}`;
      cells.set(key, (cells.get(key) ?? 0) + row.count);
    }
    const rows = topCrimes.map((crime) => ({
      crime,
      values: periods.map((p) => cells.get(`${crime}|${p}`) ?? 0),
      total: periods.reduce((s, p) => s + (cells.get(`${crime}|${p}`) ?? 0), 0),
    }));
    return { periods, rows };
  }, [series, topCrimes]);

  const shortPeriod = (p: string) => (p.length > 7 ? p.slice(2) : p);

  const axisProps = {
    stroke: palette.axis,
    tick: { fill: palette.axis, fontSize: 10 },
    tickLine: false,
  } as const;

  const tooltipStyle = {
    contentStyle: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      fontSize: 11,
      color: "var(--foreground)",
    },
    labelStyle: { color: "var(--foreground)", fontWeight: 700 },
  } as const;

  const scopeLine = [
    district ? tData("district", district, lang) : t("all of Karnataka"),
    crimeType ? tData("crime_type", crimeType, lang) : null,
    year ? String(year) : t("all years"),
  ]
    .filter(Boolean)
    .join(" · ");

  const yearOptions = yearly.map((r) => r.year);
  const anyFilter = year != null || !!district || !!crimeType;

  return (
    <Shell>
      <div className="h-[calc(100vh-3.5rem)] overflow-auto bg-background">
        <div className="mx-auto max-w-[1500px] px-6 py-5">
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <h1 className="text-lg font-extrabold tracking-tight text-foreground">
                  {t("Graphs")}
                </h1>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("Every aggregate in this scope, drawn every way it is worth drawing.")} ·{" "}
                {scopeLine}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <Link
                to="/console"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-bold text-foreground transition hover:bg-muted"
              >
                <ArrowLeft className="h-3 w-3" />
                {t("Back to dashboard")}
              </Link>
              <button
                onClick={() => setReloadKey((n) => n + 1)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-bold text-foreground transition hover:bg-muted"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                {t("Refresh")}
              </button>
            </div>
          </div>

          {/* ── Filters ────────────────────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <select
              value={year ?? ""}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground"
              aria-label={t("Year")}
            >
              <option value="">{t("All years")}</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <input
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder={t("District")}
              className="w-36 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground"
            />
            <input
              value={crimeType}
              onChange={(e) => setCrimeType(e.target.value)}
              placeholder={t("Crime type")}
              className="w-36 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground"
            />

            <div className="ml-1 flex rounded-md border border-border bg-muted/40 p-0.5">
              {(["week", "month", "quarter"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`rounded px-2 py-1 text-[10px] font-bold capitalize transition ${
                    granularity === g
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(g)}
                </button>
              ))}
            </div>

            {anyFilter && (
              <button
                onClick={() => {
                  setYear(null);
                  setDistrict("");
                  setCrimeType("");
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-bold text-muted-foreground transition hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                {t("Clear")}
              </button>
            )}

            <span className="ml-auto text-[10px] text-muted-foreground">
              {loading ? t("Loading…") : `${fmt(series.length)} ${t("trend rows")}`}
            </span>
          </div>

          {err && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {err}
            </div>
          )}

          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: t("Total FIRs"), value: k ? fmt(k.total_firs) : "—" },
              { label: t("Cleared"), value: k ? fmt(k.cleared) : "—" },
              { label: t("Pending"), value: k ? fmt(k.pending) : "—" },
              {
                label: t("Clearance"),
                value: k ? `${k.clearance_rate_percent}%` : "—",
              },
              { label: t("Per day"), value: k ? String(k.per_day) : "—" },
              { label: t("Districts"), value: k ? String(k.districts_covered) : "—" },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </div>
                <div className="mt-0.5 text-xl font-extrabold tabular-nums text-foreground">
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* ── Charts ─────────────────────────────────────────────────────── */}
          <div
            className={`mt-3 grid gap-3 xl:grid-cols-2 ${loading && summary ? "opacity-50" : ""}`}
            aria-busy={loading}
          >
            {/* 1. Column — FIR volume by year */}
            <ChartCard
              title={t("FIR volume by year")}
              kind={t("Column")}
              subtitle={t("Total FIRs recorded in each year of the dataset")}
            >
              {!mounted ? (
                <Skeleton />
              ) : yearly.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <BarChart data={yearly} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis dataKey="year" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Bar
                      dataKey="count"
                      name={t("FIRs")}
                      fill={palette.series[0]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 2. Line + Column — volume against clearance rate */}
            <ChartCard
              title={t("Volume against clearance rate")}
              kind={t("Line + Column")}
              subtitle={t("Bars are FIR count, the line is clearance percentage")}
              note={t(
                "Clearance sits in a narrow band every year. The variation worth acting on is between stations, not between years.",
              )}
            >
              {!mounted ? (
                <Skeleton />
              ) : yearly.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <ComposedChart data={yearly} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis dataKey="year" {...axisProps} />
                    <YAxis yAxisId="left" {...axisProps} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 40]}
                      unit="%"
                      {...axisProps}
                    />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar
                      yAxisId="left"
                      dataKey="count"
                      name={t("FIRs")}
                      fill={palette.series[0]}
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="clearance_percent"
                      name={t("Clearance %")}
                      stroke={palette.series[1]}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: palette.series[1] }}
                    />
                  </ComposedChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 3. Waterfall — year-on-year change */}
            <ChartCard
              title={t("Year-on-year change")}
              kind={t("Waterfall")}
              subtitle={t(
                "How each year moved the total. Green is a fall in volume; the first bar is the opening total.",
              )}
              note={t(
                "Built from a transparent base bar plus a signed step, because recharts has no waterfall type.",
              )}
            >
              {!mounted ? (
                <Skeleton />
              ) : waterfall.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <BarChart data={waterfall} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(
                        _v: number,
                        _n: string,
                        item: {
                          payload?: { signed?: number; total?: number; opening?: boolean };
                        },
                      ) => {
                        const p = item?.payload;
                        if (p?.opening) return [fmt(p.total ?? 0), t("Opening total")];
                        const s = p?.signed ?? 0;
                        return [`${s > 0 ? "+" : ""}${fmt(s)}`, t("Change")];
                      }}
                    />
                    <Bar dataKey="base" stackId="w" fill="transparent" />
                    <Bar dataKey="delta" stackId="w" radius={[3, 3, 0, 0]}>
                      {waterfall.map((r) => (
                        <Cell
                          key={r.label}
                          fill={
                            r.opening
                              ? palette.series[0]
                              : r.signed >= 0
                                ? palette.up
                                : palette.down
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 4. Line — period totals */}
            <ChartCard
              title={t("Incidents over time")}
              kind={t("Line")}
              subtitle={`${t("Totals per")} ${t(granularity)}`}
            >
              {!mounted ? (
                <Skeleton />
              ) : periodTotals.length === 0 ? (
                <NoData label={t("No trend data")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <LineChart
                    data={periodTotals}
                    margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                  >
                    <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis dataKey="period" tickFormatter={shortPeriod} {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name={t("Incidents")}
                      stroke={palette.series[0]}
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 5. Stacked column — crime mix over time */}
            <ChartCard
              title={t("Crime mix over time")}
              kind={t("Stacked Column")}
              subtitle={t("Top six crime types per period, everything else grouped")}
              wide
              tall
            >
              {!mounted ? (
                <Skeleton tall />
              ) : stacked.length === 0 ? (
                <NoData label={t("No trend data")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <BarChart data={stacked} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis dataKey="period" tickFormatter={shortPeriod} {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {topCrimes.map((crime, i) => (
                      <Bar
                        key={crime}
                        dataKey={crime}
                        name={tData("crime_type", crime, lang)}
                        stackId="c"
                        fill={palette.series[i % palette.series.length]}
                      />
                    ))}
                    <Bar dataKey="__other__" name={t("Other")} stackId="c" fill={palette.muted} />
                  </BarChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 6. Stacked area */}
            <ChartCard
              title={t("Composition over time")}
              kind={t("Stacked Area")}
              subtitle={t("The same mix read as share of volume")}
              wide
              tall
            >
              {!mounted ? (
                <Skeleton tall />
              ) : stacked.length === 0 ? (
                <NoData label={t("No trend data")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <AreaChart data={stacked} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis dataKey="period" tickFormatter={shortPeriod} {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {topCrimes.map((crime, i) => (
                      <Area
                        key={crime}
                        type="monotone"
                        dataKey={crime}
                        name={tData("crime_type", crime, lang)}
                        stackId="a"
                        stroke={palette.series[i % palette.series.length]}
                        fill={palette.series[i % palette.series.length]}
                        fillOpacity={0.75}
                      />
                    ))}
                  </AreaChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 7. Pie — crime mix share */}
            <ChartCard
              title={t("Share by crime type")}
              kind={t("Pie")}
              subtitle={t("Top six categories in this scope")}
            >
              {!mounted ? (
                <Skeleton />
              ) : !summary?.crime_mix?.length ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <PieChart>
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Pie
                      data={summary.crime_mix.slice(0, 6).map((c: NamedCount) => ({
                        name: tData("crime_type", c.name, lang),
                        value: c.count,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      outerRadius="72%"
                      strokeWidth={1}
                    >
                      {summary.crime_mix.slice(0, 6).map((c, i) => (
                        <Cell key={c.name} fill={palette.series[i % palette.series.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 8. Donut — disposition */}
            <ChartCard
              title={t("Case disposition")}
              kind={t("Donut")}
              subtitle={t("Where FIRs in this scope currently stand")}
            >
              {!mounted ? (
                <Skeleton />
              ) : disposition.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <PieChart>
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Pie
                      data={disposition.map((s) => ({ name: s.name, value: s.count }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="45%"
                      outerRadius="72%"
                      strokeWidth={1}
                    >
                      {disposition.map((s, i) => (
                        <Cell key={s.name} fill={palette.series[i % palette.series.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 9. Bar — districts by volume */}
            <ChartCard
              title={t("Districts by volume")}
              kind={t("Bar")}
              subtitle={t("Top twelve districts in this scope")}
              tall
            >
              {!mounted ? (
                <Skeleton tall />
              ) : topDistricts.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <BarChart
                    data={topDistricts.map((d) => ({
                      name: tData("district", d.name, lang),
                      count: d.count,
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid horizontal={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="name" width={104} {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Bar
                      dataKey="count"
                      name={t("FIRs")}
                      fill={palette.series[0]}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 10. Stacked bar — cleared against pending */}
            <ChartCard
              title={t("Cleared against pending")}
              kind={t("Stacked Bar")}
              subtitle={t("Split of each district's caseload")}
              tall
            >
              {!mounted ? (
                <Skeleton tall />
              ) : topDistricts.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <BarChart
                    data={topDistricts.map((d) => ({
                      name: tData("district", d.name, lang),
                      cleared: d.cleared,
                      pending: Math.max(0, d.count - d.cleared),
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid horizontal={false} stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="name" width={104} {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar
                      dataKey="cleared"
                      name={t("Cleared")}
                      stackId="d"
                      fill={palette.series[2]}
                    />
                    <Bar dataKey="pending" name={t("Pending")} stackId="d" fill={palette.muted} />
                  </BarChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 11. Scatter — station volume against clearance */}
            <ChartCard
              title={t("Station volume against clearance")}
              kind={t("Scatter")}
              subtitle={`${fmt(stationPoints.length)} ${t("stations")}`}
              note={t(
                "Each dot is one station. The line is the median clearance across stations in this scope.",
              )}
            >
              {!mounted ? (
                <Skeleton />
              ) : stationPoints.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis type="number" dataKey="x" name={t("FIRs")} {...axisProps} />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={t("Clearance %")}
                      unit="%"
                      {...axisProps}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      cursor={{ strokeDasharray: "3 3" }}
                      formatter={(v: number, n: string) => [fmt(v), n]}
                    />
                    {summary?.station_clearance?.median != null && (
                      <ReferenceLine
                        y={summary.station_clearance.median}
                        stroke={palette.series[1]}
                        strokeDasharray="4 4"
                      />
                    )}
                    <Scatter
                      data={stationPoints}
                      name={t("Station")}
                      fill={palette.series[0]}
                      fillOpacity={0.55}
                    />
                  </ScatterChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 12. Bubble — districts sized by cleared count */}
            <ChartCard
              title={t("District volume, clearance and cleared count")}
              kind={t("Bubble")}
              subtitle={t("Bubble size is the number of cleared cases")}
            >
              {!mounted ? (
                <Skeleton />
              ) : districtBubbles.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke={palette.grid} strokeOpacity={0.35} />
                    <XAxis type="number" dataKey="x" name={t("FIRs")} {...axisProps} />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={t("Clearance %")}
                      unit="%"
                      {...axisProps}
                    />
                    <ZAxis type="number" dataKey="z" range={[60, 620]} name={t("Cleared")} />
                    <Tooltip
                      {...tooltipStyle}
                      cursor={{ strokeDasharray: "3 3" }}
                      formatter={(v: number, n: string) => [fmt(v), n]}
                    />
                    <Scatter data={districtBubbles} name={t("District")} fillOpacity={0.6}>
                      {districtBubbles.map((d, i) => (
                        <Cell key={d.name} fill={palette.series[i % palette.series.length]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 13. Radar — crime profile */}
            <ChartCard
              title={t("Crime profile")}
              kind={t("Radar")}
              subtitle={t("Relative weight of the leading categories")}
            >
              {!mounted ? (
                <Skeleton />
              ) : radarData.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <RadarChart data={radarData} outerRadius="70%">
                    <PolarGrid stroke={palette.grid} />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: palette.axis, fontSize: 9 }} />
                    <PolarRadiusAxis tick={{ fill: palette.axis, fontSize: 9 }} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                    <Radar
                      name={t("FIRs")}
                      dataKey="value"
                      stroke={palette.series[0]}
                      fill={palette.series[0]}
                      fillOpacity={0.45}
                    />
                  </RadarChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 14. Treemap — district share */}
            <ChartCard
              title={t("District share")}
              kind={t("Treemap")}
              subtitle={t("Area is proportional to FIR count")}
            >
              {!mounted ? (
                <Skeleton />
              ) : treemapData.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <Treemap
                    data={treemapData}
                    dataKey="size"
                    nameKey="name"
                    stroke="var(--card)"
                    content={<TreemapCell palette={palette} lang={lang} />}
                  >
                    <Tooltip {...tooltipStyle} formatter={(v: number) => fmt(v)} />
                  </Treemap>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 15. Funnel — disposition as a funnel */}
            <ChartCard
              title={t("Disposition funnel")}
              kind={t("Funnel")}
              subtitle={t("Statuses ordered by how many cases sit in each")}
            >
              {!mounted ? (
                <Skeleton />
              ) : disposition.length === 0 ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <ChartContainer config={{}} className="h-full w-full aspect-auto">
                  <FunnelChart margin={{ top: 8, right: 90, bottom: 8, left: 8 }}>
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: number, name: string) => [fmt(v), tData("status", name, lang)]}
                    />
                    <Funnel
                      dataKey="value"
                      nameKey="name"
                      data={disposition.map((s) => ({ name: tData("status", s.name, lang), value: s.count }))}
                      isAnimationActive={false}
                    >
                      {disposition.map((s, i) => (
                        <Cell key={s.name} fill={palette.series[i % palette.series.length]} />
                      ))}
                      <LabelList
                        position="right"
                        dataKey="name"
                        fill={palette.axis}
                        stroke="none"
                        fontSize={9}
                      />
                    </Funnel>
                  </FunnelChart>
                </ChartContainer>
              )}
            </ChartCard>

            {/* 16. Radial — clearance gauge */}
            <ChartCard
              title={t("Clearance rate")}
              kind={t("Radial")}
              subtitle={t("Convictions as a share of all FIRs in this scope")}
            >
              {!mounted ? (
                <Skeleton />
              ) : !k ? (
                <NoData label={t("No data for this scope.")} />
              ) : (
                <div className="relative h-full">
                  <ChartContainer config={{}} className="h-full w-full aspect-auto">
                    <RadialBarChart
                      data={[{ name: t("Clearance"), value: k.clearance_rate_percent }]}
                      innerRadius="66%"
                      outerRadius="96%"
                      startAngle={90}
                      endAngle={-270}
                    >
                      <PolarAngleAxis
                        type="number"
                        domain={[0, 100]}
                        tick={false}
                        axisLine={false}
                      />
                      <RadialBar
                        dataKey="value"
                        cornerRadius={8}
                        fill={palette.series[0]}
                        background={{ fill: palette.muted }}
                      />
                    </RadialBarChart>
                  </ChartContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-extrabold tabular-nums text-foreground">
                      {k.clearance_rate_percent}%
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {fmt(k.cleared)} / {fmt(k.total_firs)}
                    </span>
                  </div>
                </div>
              )}
            </ChartCard>

            {/* 17. Pivot table */}
            <ChartCard
              title={t("Crime type by period")}
              kind={t("Pivot Table")}
              subtitle={t("Counts per period for the leading categories")}
              wide
              tall
            >
              {pivot.rows.length === 0 || pivot.periods.length === 0 ? (
                <NoData label={t("No trend data")} />
              ) : (
                <div className="h-full overflow-auto">
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-[9px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-2 py-1.5 text-left font-bold">{t("Crime type")}</th>
                        {pivot.periods.map((p) => (
                          <th key={p} className="px-2 py-1.5 text-right font-bold">
                            {shortPeriod(p)}
                          </th>
                        ))}
                        <th className="px-2 py-1.5 text-right font-bold">{t("Total")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pivot.rows.map((r) => {
                        const rowMax = Math.max(1, ...r.values);
                        return (
                          <tr key={r.crime} className="hover:bg-muted/30">
                            <td className="px-2 py-1.5 font-medium text-foreground">
                              {tData("crime_type", r.crime, lang)}
                            </td>
                            {r.values.map((v, i) => (
                              <td
                                key={i}
                                className="px-2 py-1.5 text-right tabular-nums text-foreground"
                                style={{
                                  // Shading the cells makes the table readable as a
                                  // heatmap without a second component.
                                  backgroundColor: v
                                    ? `color-mix(in oklab, var(--main) ${Math.round((v / rowMax) * 55)}%, transparent)`
                                    : undefined,
                                }}
                              >
                                {v || ""}
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-right font-bold tabular-nums text-foreground">
                              {fmt(r.total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>
          </div>

          <p className="mt-4 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            {t(
              "Every figure here is counted from records your rank is cleared to see. All data in this system is synthetic.",
            )}
          </p>
        </div>
      </div>
    </Shell>
  );
}

/**
 * Treemap leaf renderer.
 *
 * Recharts' default treemap content paints every node one colour, and per-node
 * fills are only reachable through a custom `content`. The props are supplied by
 * recharts at render time, hence the loose typing.
 */
function TreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  size?: number;
  palette?: Palette;
  lang?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = "", palette, lang } = props;
  const colors = palette?.series ?? FALLBACK.series;
  const fill = colors[index % colors.length];
  // Only label tiles with room for the text, otherwise it overflows its rect.
  const showLabel = width > 56 && height > 24;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.85}
        stroke="var(--card)"
        strokeWidth={2}
        rx={3}
      />
      {showLabel && (
        <text
          x={x + 6}
          y={y + 15}
          fill="#fff"
          fontSize={10}
          fontWeight={700}
          style={{ pointerEvents: "none" }}
        >
          {lang ? tData("district", name, lang) : name}
        </text>
      )}
    </g>
  );
}
