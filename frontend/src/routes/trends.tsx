import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useEffect, useState } from "react";
import { TrendingUp, Layers } from "lucide-react";
import { useT, useI18n } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { intelligence, type TrendPoint, type MOCluster, type SeasonalPeak } from "@/lib/api/intelligence";

export const Route = createFileRoute("/trends")({
  head: () => ({ meta: [{ title: "Trends · Satyam" }] }),
  component: TrendsScreen,
});

function TrendsScreen() {
  const t = useT();
  const { lang } = useI18n();
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [clusters, setClusters] = useState<MOCluster[]>([]);
  const [peaks, setPeaks] = useState<SeasonalPeak[]>([]);
  const [deltas, setDeltas] = useState<{ qoq_percent: number | null; yoy_percent: number | null }>({ qoq_percent: null, yoy_percent: null });
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (crimeType) p.set("crime_type", crimeType);
    if (district) p.set("district", district);
    Promise.all([
      intelligence.getTrends(p),
      intelligence.getMOClusters(),
      intelligence.getSeasonal(crimeType || undefined, district || undefined),
    ]).then(([tr, mo, sea]) => {
      setSeries(tr.series.slice(0, 24));
      setDeltas(tr.deltas);
      setClusters(mo.clusters);
      setPeaks(sea.seasonal_peaks);
      setError(null);
    }).catch(() => setError(t("Could not load trends data.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [crimeType, district]);

  const topByType = series.reduce<Record<string, number>>((acc, s) => {
    acc[s.crime_type] = (acc[s.crime_type] || 0) + s.count;
    return acc;
  }, {});
  const sortedTypes = Object.entries(topByType).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <Shell>
      <div className="flex flex-col h-full overflow-auto">
        {/* Header */}
        <div className="border-b-2 border-foreground bg-header px-6 py-4 text-header-foreground">
          <div className="text-[11px] uppercase tracking-wider opacity-60">{t("PS3 · MO Clustering")}</div>
          <h1 className="text-xl font-extrabold tracking-tight">{t("Trends & Patterns")}</h1>
        </div>

        {/* Filters */}
        <div className="flex gap-3 px-6 py-3 border-b border-border bg-card/60">
          <input
            value={crimeType}
            onChange={e => setCrimeType(e.target.value)}
            placeholder={t("Crime type filter…")}
            className="rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-xs font-bold w-40 focus:outline-none"
          />
          <input
            value={district}
            onChange={e => setDistrict(e.target.value)}
            placeholder={t("District filter…")}
            className="rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-xs font-bold w-40 focus:outline-none"
          />
        </div>

        <div className="flex-1 p-6 space-y-6">
          {loading && <div className="text-muted-foreground text-sm">{t("Loading…")}</div>}
          {error && <div className="text-destructive text-sm">{error}</div>}

          {/* Delta cards */}
          {deltas.qoq_percent != null && (
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label={t("QoQ Change")}
                value={`${deltas.qoq_percent > 0 ? "+" : ""}${deltas.qoq_percent?.toFixed(1)}%`}
                color={deltas.qoq_percent > 0 ? "text-destructive" : "text-success"}
              />
              {deltas.yoy_percent != null && (
                <StatCard
                  label={t("YoY Change")}
                  value={`${deltas.yoy_percent > 0 ? "+" : ""}${deltas.yoy_percent?.toFixed(1)}%`}
                  color={deltas.yoy_percent > 0 ? "text-destructive" : "text-success"}
                />
              )}
            </div>
          )}

          {/* Top crime types */}
          {sortedTypes.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> {t("Top Crime Types")}
              </h2>
              <div className="space-y-2">
                {sortedTypes.map(([ct, cnt]) => {
                  const max = sortedTypes[0][1];
                  return (
                    <div key={ct} className="flex items-center gap-3">
                      <span className="w-32 text-xs font-bold truncate">{tData("crime_type", ct, lang)}</span>
                      <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden border border-border">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(cnt / max) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{cnt}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Seasonal peaks */}
          {peaks.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide">🗓 {t("Seasonal Peaks")}</h2>
              <div className="grid gap-2 md:grid-cols-3">
                {peaks.map(p => (
                  <div key={p.period} className="rounded-[5px] border-2 border-foreground bg-card p-3 nb-shadow-sm">
                    <div className="text-sm font-bold">{p.period}</div>
                    <div className="text-xs text-primary font-bold mt-0.5">+{p.lift_percent}% {t("above baseline")}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.recommended_action}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* MO clusters */}
          {clusters.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
                <Layers className="h-4 w-4" /> {t("MO Clusters")}
              </h2>
              <div className="overflow-hidden rounded-[5px] border-2 border-foreground nb-shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {([
                        t("Cluster"),
                        t("Cases"),
                        t("Sections"),
                        t("Action"),
                      ] as string[]).map(h => (
                        <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clusters.map(c => (
                      <tr key={c.cluster_id} className="hover:bg-muted/20">
                        <td className="px-4 py-2 font-bold">{c.label}</td>
                        <td className="px-4 py-2 tabular-nums">{c.case_count}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{c.top_sections.join(", ") || "—"}</td>
                        <td className="px-4 py-2 text-xs">{c.action_hint}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-[5px] border-2 border-foreground bg-card p-4 nb-shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-extrabold tabular-nums mt-1 ${color}`}>{value}</div>
    </div>
  );
}
