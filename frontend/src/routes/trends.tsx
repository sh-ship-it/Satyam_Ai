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
function CrimeHeatmap({ series }: { series: TrendPoint[] }) {
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
      crimes: [...cSet].sort().slice(0, 8),
      grid: g, max: mx,
    };
  }, [series]);
  if (periods.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className="w-36 shrink-0" />
          {periods.map((p) => (
            <div key={p} className="flex-1 min-w-[28px] text-[8px] text-muted-foreground text-center -rotate-45 origin-left h-6">
              {p.slice(2)}
            </div>
          ))}
        </div>
        {crimes.map((c) => (
          <div key={c} className="flex items-center">
            <div className="w-36 shrink-0 text-[10px] font-medium text-foreground truncate pr-2" title={c}>{c}</div>
            {periods.map((p) => {
              const v = grid[`${c}|${p}`] || 0;
              const intensity = v / max;
              return (
                <div
                  key={p}
                  title={`${c} · ${p}: ${v}`}
                  className="flex-1 min-w-[28px] aspect-square m-[1px] rounded-[3px]"
                  style={{
                    backgroundColor: v
                      ? `rgba(99,102,241,${Math.max(0.1, intensity)})`
                      : "rgba(120,120,120,0.06)",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Delta stat card ────────────────────────────────────────────────────────────
function DeltaCard({ label, value, trend, sparkData }: {
  label: string; value: string; trend: "up" | "down" | "flat"; sparkData?: number[];
}) {
  const color = trend === "up" ? "text-destructive" : trend === "down" ? "text-emerald-500" : "text-muted-foreground";
  const sparkColor = trend === "up" ? "text-destructive" : trend === "down" ? "text-emerald-500" : "text-muted-foreground";
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
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
                    {t("Crime × Period intensity")}
                  </div>
                  <CrimeHeatmap series={series} />
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
