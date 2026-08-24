import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  Gauge,
  Hourglass,
  Info,
  Layers,
  ListOrdered,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { SimilarCaseSearch } from "@/components/SimilarCaseSearch";
import { useI18n, useT } from "@/lib/i18n";
import { tData } from "@/lib/tData";
import { api, API_BASE, getAuthToken, getCachedUser } from "@/lib/api/client";
import {
  dashboard,
  type DashboardStationRow,
  type DashboardSummary,
  type DistrictRow,
  type NamedCount,
} from "@/lib/api/intelligence";

/**
 * Crime Intelligence dashboard.
 *
 * Chat lives at /ask, so this screen is for reading the state of a jurisdiction
 * rather than asking about it. Everything comes from `GET /api/dashboard/summary`,
 * computed in SQL on the RLS-scoped session.
 *
 * WHAT IS NOT ON THIS SCREEN, AND WHY
 * - No map. The geospatial view is /vision, which is built for it. A second map
 *   here competed for the largest slot on the page while showing less.
 * - No hour-of-day or day-of-week chart. Measured on this corpus: only 12 of 24
 *   hours hold any incident and weekday counts vary by under 4%. Both are flat,
 *   so they are stated as coverage facts instead of drawn as patterns.
 * - No clearance-rate-over-time line. 20.3 / 20.3 / 20.5 / 20.6 / 19.9 across five
 *   years is a flat line pretending to be a trend. The variance is *between
 *   stations* (11.0% to 27.9%), which is what the outlier panel shows.
 * - No per-KPI sparklines. They were the same yearly series repeated four times.
 */

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: "Crime Intelligence · Satyam" },
      {
        name: "description",
        content:
          "Analytical dashboard: FIR volume and year-on-year change, case disposition, clearance outliers by station, district league table.",
      },
    ],
  }),
  component: Console,
});

const ROWS_PER_PAGE = 10;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const fmt = (n: number) => n.toLocaleString();

function Console() {
  const t = useT();
  const { lang } = useI18n();

  const [drawerCaseId, setDrawerCaseId] = useState<number | null>(null);

  const [year, setYear] = useState<number | null>(null);
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<"firs" | "clearance">("firs");

  // Seed from the read cache so coming back to this screen paints the previous
  // figures on the first frame. Without it the component remounts with null and
  // renders the empty skeleton for a frame even when the data is already in hand.
  const [summary, setSummary] = useState<DashboardSummary | null>(() => dashboard.peek() ?? null);
  const [loading, setLoading] = useState(() => dashboard.peek() === undefined);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const [crimeOptions, setCrimeOptions] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);

  // Client-only: `greeting()` reads the clock and `getCachedUser()` reads
  // localStorage, so computing either during render makes the SSR HTML disagree
  // with the first client render and React discards the tree.
  const [officer, setOfficer] = useState<{ name?: string } | null>(null);
  const [hello, setHello] = useState("");
  useEffect(() => {
    setOfficer(getCachedUser());
    setHello(greeting());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!getAuthToken()) {
          try {
            await api.login("demo", "");
          } catch {
            /* surfaced by the main load */
          }
        }
        const token = getAuthToken();
        const r = await fetch(`${API_BASE}/settings/db-source/data-values`, {
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        setCrimeOptions(Array.isArray(d.crime_types) ? d.crime_types : []);
        setDistrictOptions(Array.isArray(d.districts) ? d.districts : []);
      } catch {
        /* the "All …" options still work */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const filters = { year, district: district || undefined, crime_type: crimeType || undefined };

    // If this exact scope is already cached, show it immediately and skip the
    // loading state entirely — the refetch below still runs and silently updates.
    const cached = dashboard.peek(filters);
    if (cached) setSummary(cached);
    setLoading(!cached);
    setErr(null);
    setPage(0);

    (async () => {
      if (!getAuthToken()) {
        try {
          await api.login("demo", "");
        } catch {
          /* handled below */
        }
      }
      try {
        // One request for the whole screen. The station table used to come from
        // /map/station-breakdown, but that endpoint counts charge-sheeted cases
        // while everything else here counts convictions, so the table's clearance
        // rate could not be compared against the median beside it.
        const sum = await dashboard.summary({
          year,
          district: district || undefined,
          crime_type: crimeType || undefined,
        });
        if (cancelled) return;
        setSummary(sum);
        setLoadedAt(new Date());
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
        setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, crimeType, district]);

  // Voice Screen Agent actions. Filtering only — there is no composer here.
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/console") return;
      for (const a of Array.isArray(d.actions) ? d.actions : []) {
        if (a.screen !== "/console") continue;
        const p = a.params || {};
        if (a.action === "set_district" && p.district) setDistrict(String(p.district));
        else if (a.action === "set_crime_type" && p.crime_type) setCrimeType(String(p.crime_type));
      }
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, []);

  const k = summary?.kpis;
  const sc = summary?.station_clearance;

  const sortedStations: DashboardStationRow[] = useMemo(() => {
    const rows = [...(summary?.stations ?? [])];
    // Worst-first when sorting by clearance: the underperforming end is the
    // actionable one, so it should not require paging to the back of the list.
    rows.sort((a, b) =>
      sortKey === "clearance" ? a.clearance_percent - b.clearance_percent : b.firs - a.firs,
    );
    return rows;
  }, [summary, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedStations.length / ROWS_PER_PAGE));
  const pageRows = sortedStations.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  const scopeLine = [
    district ? tData("district", district, lang) : t("all of Karnataka"),
    crimeType ? tData("crime_type", crimeType, lang) : null,
    year ? String(year) : t("all years"),
  ]
    .filter(Boolean)
    .join(" · ");

  const activeFilters = [
    year ? { label: String(year), clear: () => setYear(null) } : null,
    district ? { label: tData("district", district, lang), clear: () => setDistrict("") } : null,
    crimeType
      ? { label: tData("crime_type", crimeType, lang), clear: () => setCrimeType("") }
      : null,
  ].filter(Boolean) as { label: string; clear: () => void }[];

  function exportCsv() {
    const head = [
      "station",
      "district",
      "firs",
      "cleared_convicted",
      "pending",
      "clearance_percent",
      "vs_median_points",
      "top_crime",
    ];
    const lines = sortedStations.map((r) =>
      [
        r.station,
        r.district ?? "",
        r.firs,
        r.cleared,
        r.pending,
        r.clearance_percent,
        r.vs_median_points,
        r.top_crime ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `satyam-stations-${year ?? "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell>
      <div className="h-[calc(100vh-3.5rem)] overflow-auto bg-background">
        <div className="mx-auto max-w-[1500px] px-6 py-5">
          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-foreground">
                {hello ? t(hello) : t("Crime intelligence")}
                {officer?.name ? `, ${officer.name}` : ""}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("Analysis for")}{" "}
                <span className="font-semibold text-foreground">{scopeLine}</span>
                {k?.first_day && k?.last_day ? ` · ${k.first_day} → ${k.last_day}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse bg-amber-500" : err ? "bg-destructive" : "bg-emerald-500"}`}
                />
                {loading
                  ? t("Loading…")
                  : err
                    ? t("Unavailable")
                    : loadedAt
                      ? loadedAt.toLocaleTimeString()
                      : ""}
              </span>
              <Select
                value={year == null ? "" : String(year)}
                onChange={(v) => setYear(v ? Number(v) : null)}
                options={(summary?.yearly ?? []).map((y) => String(y.year)).reverse()}
                allLabel={t("All years")}
              />
              <Select
                value={crimeType}
                onChange={setCrimeType}
                options={crimeOptions}
                allLabel={t("All crime types")}
                render={(v) => tData("crime_type", v, lang)}
              />
              <Select
                value={district}
                onChange={setDistrict}
                options={districtOptions}
                allLabel={t("All districts")}
                render={(v) => tData("district", v, lang)}
              />
            </div>
          </div>

          {activeFilters.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("Filtered")}
              </span>
              {activeFilters.map((f) => (
                <button
                  key={f.label}
                  onClick={f.clear}
                  className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground transition hover:bg-card"
                >
                  {f.label} ✕
                </button>
              ))}
            </div>
          )}

          {err && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {err}
            </div>
          )}

          {/* Everything below is dimmed while a refetch is in flight. Without it
              the filter chips update instantly while the figures beneath them are
              still the previous scope's, so the screen briefly asserts something
              false — "2024" above an all-years total. */}
          <div
            className={`transition-opacity duration-200 ${loading && summary ? "pointer-events-none opacity-40" : "opacity-100"}`}
            aria-busy={loading}
          >
            {/* ── KPI strip ───────────────────────────────────────────────────── */}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Metric label={t("FIRs")} value={k ? fmt(k.total_firs) : "—"} big />
              <Metric
                label={t("Clearance")}
                value={k ? `${k.clearance_rate_percent}%` : "—"}
                sub={k ? `${fmt(k.cleared)} ${t("convicted")}` : ""}
                big
              />
              <Metric label={t("Pending")} value={k ? fmt(k.pending) : "—"} />
              <Metric
                label={t("FIRs / day")}
                value={k ? String(k.per_day) : "—"}
                sub={k ? `${fmt(k.span_days)} ${t("days")}` : ""}
              />
              <Metric label={t("Districts")} value={k ? String(k.districts_covered) : "—"} />
              <Metric label={t("Stations")} value={k ? String(k.stations_covered) : "—"} />
            </div>

            {/* ── Volume + disposition ───────────────────────────────────────── */}
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <Panel
                title={t("FIR volume by year")}
                icon={ListOrdered}
                subtitle={t("Year-on-year change. Click a year to filter the whole dashboard.")}
              >
                <YearBars
                  rows={summary?.yearly ?? []}
                  selected={year}
                  onSelect={(y) => setYear(year === y ? null : y)}
                  t={t}
                />
              </Panel>

              <Panel
                title={t("Case disposition")}
                icon={Scale}
                subtitle={t("Where every FIR in this scope currently stands")}
                note={t(
                  "'Cleared' above counts convictions only. These fourteen statuses are the full picture.",
                )}
              >
                <RankedBars
                  rows={summary?.status_mix ?? []}
                  total={k?.total_firs ?? 0}
                  accent="slate"
                />
              </Panel>
            </div>

            {/* ── Clearance outliers + crime mix ─────────────────────────────── */}
            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel
                title={t("Clearance outliers by station")}
                icon={Gauge}
                subtitle={
                  sc
                    ? `${sc.stations} ${t("stations with")} ${sc.min_firs}+ ${t("FIRs")}`
                    : undefined
                }
                note={summary?.clearance_stable_note ?? undefined}
              >
                {sc && sc.stations > 0 ? (
                  <>
                    <Distribution sc={sc} t={t} />
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <TailList
                        title={t("Lowest clearance")}
                        rows={sc.bottom}
                        lang={lang}
                        tone="rose"
                        onPick={setDistrict}
                      />
                      <TailList
                        title={t("Highest clearance")}
                        rows={sc.top}
                        lang={lang}
                        tone="emerald"
                        onPick={setDistrict}
                      />
                    </div>
                  </>
                ) : (
                  <Empty t={t} />
                )}
              </Panel>

              <Panel
                title={t("Crime mix")}
                icon={Layers}
                subtitle={
                  summary?.compare_year
                    ? `${t("Change vs")} ${summary.compare_year}`
                    : t("Share of FIRs in this scope")
                }
              >
                <RankedBars
                  rows={summary?.crime_mix ?? []}
                  total={k?.total_firs ?? 0}
                  accent="blue"
                  showYoy
                  lang={lang}
                  translateKey="crime_type"
                />
              </Panel>
            </div>

            {/* ── District league + similar cases ────────────────────────────── */}
            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Panel
                title={t("District league table")}
                icon={ListOrdered}
                subtitle={
                  sc?.median
                    ? `${t("Clearance compared against the")} ${sc.median}% ${t("station median")}`
                    : undefined
                }
              >
                <DistrictTable
                  rows={summary?.districts ?? []}
                  lang={lang}
                  t={t}
                  onPick={setDistrict}
                />
              </Panel>

              <Panel title={t("Similar case lookup")} icon={Info}>
                <SimilarCaseSearch onOpenCase={(id) => setDrawerCaseId(id)} />
                {summary && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    <SectionLabel>{t("Data coverage")}</SectionLabel>
                    <Coverage
                      label={t("Hours of day with incidents")}
                      value={`${summary.hours_populated}/24`}
                      warn={summary.hours_populated < 24}
                    />
                    <Coverage
                      label={t("Weekday variation")}
                      value={`${summary.dow_spread_percent}%`}
                      warn={summary.dow_spread_percent < 10}
                    />
                    <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {t(
                        "Time-of-day and weekday breakdowns are omitted because this dataset is near-uniform on both, so any peak would be noise.",
                      )}
                    </p>
                  </div>
                )}
              </Panel>
            </div>

            {/* ── Station table ─────────────────────────────────────────────── */}
            <div className="mt-3 mb-8">
              <Panel
                title={t("Station performance")}
                icon={ShieldCheck}
                subtitle={`${sortedStations.length} ${t("stations")} · ${scopeLine}`}
                right={
                  <div className="flex items-center gap-1.5">
                    <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
                      {(
                        [
                          ["firs", t("By volume")],
                          ["clearance", t("Worst clearance")],
                        ] as const
                      ).map(([v, label]) => (
                        <button
                          key={v}
                          onClick={() => {
                            setSortKey(v);
                            setPage(0);
                          }}
                          className={`rounded px-2 py-1 text-[10px] font-bold transition ${
                            sortKey === v
                              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={exportCsv}
                      disabled={!sortedStations.length}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-bold text-foreground transition hover:bg-muted disabled:opacity-40"
                    >
                      <Download className="h-3 w-3" />
                      {t("CSV")}
                    </button>
                  </div>
                }
              >
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5 text-left font-bold">#</th>
                      <th className="px-2 py-1.5 text-left font-bold">{t("Station")}</th>
                      <th className="px-2 py-1.5 text-right font-bold">{t("FIRs")}</th>
                      <th className="px-2 py-1.5 text-right font-bold">{t("Cleared")}</th>
                      <th className="px-2 py-1.5 text-right font-bold">{t("Pending")}</th>
                      <th className="px-2 py-1.5 text-left font-bold">{t("Clearance")}</th>
                      <th className="px-2 py-1.5 text-left font-bold">{t("vs median")}</th>
                      <th className="px-2 py-1.5 text-left font-bold">{t("Top crime")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {!loading && pageRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-2 py-8 text-center text-muted-foreground">
                          {t("No data for this scope.")}
                        </td>
                      </tr>
                    )}
                    {pageRows.map((r, i) => {
                      const pct = r.clearance_percent;
                      const delta = r.vs_median_points;
                      return (
                        <tr key={r.station} className="hover:bg-muted/30">
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                            {page * ROWS_PER_PAGE + i + 1}
                          </td>
                          <td className="px-2 py-1.5 font-medium text-foreground">
                            {tData("station", r.station, lang)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                            {fmt(r.firs)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmt(r.cleared)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmt(r.pending)}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-9 shrink-0 text-xs font-bold tabular-nums text-foreground">
                                {pct}%
                              </span>
                              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                                <span
                                  className={`block h-full rounded-full ${delta < 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                                  style={{ width: `${Math.min(100, pct * 2.5)}%` }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            {sc?.median ? <Delta value={delta} unit="pt" /> : <Dash />}
                          </td>
                          <td className="px-2 py-1.5">
                            {r.top_crime ? (
                              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-foreground">
                                {tData("crime_type", r.top_crime, lang)}
                              </span>
                            ) : (
                              <Dash />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {pageCount > 1 && (
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {page * ROWS_PER_PAGE + 1}–
                      {Math.min(sortedStations.length, (page + 1) * ROWS_PER_PAGE)} {t("of")}{" "}
                      {sortedStations.length}
                    </span>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(pageCount, 8) }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setPage(i)}
                          className={`h-6 w-6 rounded text-[10px] font-bold transition ${
                            page === i
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  {t("Live from Postgres, scoped to your jurisdiction by row-level security.")}
                </p>
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <CaseDrawer
        open={drawerCaseId != null}
        caseId={drawerCaseId ?? undefined}
        onClose={() => setDrawerCaseId(null)}
      />
    </Shell>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Panel({
  title,
  subtitle,
  icon: Icon,
  right,
  note,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof Sparkles;
  right?: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3.5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
            <h2 className="truncate text-[11px] font-bold uppercase tracking-wider text-foreground">
              {title}
            </h2>
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      {children}
      {note && (
        <p className="mt-2.5 flex items-start gap-1.5 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />
          {note}
        </p>
      )}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

function Empty({ t }: { t: (k: string) => string }) {
  return (
    <p className="py-6 text-center text-xs text-muted-foreground">{t("No data for this scope.")}</p>
  );
}

function Metric({
  label,
  value,
  sub,
  big,
}: {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 font-extrabold tabular-nums text-foreground ${big ? "text-2xl" : "text-xl"}`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Signed change, coloured by direction. For crime volume, down is good. */
function Delta({ value, unit = "%" }: { value: number | null; unit?: string }) {
  if (value == null) return <Dash />;
  const down = value < 0;
  const Icon = down ? ArrowDown : ArrowUp;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${
        down ? "text-emerald-600" : "text-rose-600"
      }`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(value)}
      {unit}
    </span>
  );
}

function YearBars({
  rows,
  selected,
  onSelect,
  t,
}: {
  rows: { year: number; count: number; clearance_percent: number; yoy_percent: number | null }[];
  selected: number | null;
  onSelect: (y: number) => void;
  t: (k: string) => string;
}) {
  if (!rows.length) return <Empty t={t} />;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="flex items-end gap-2">
      {rows.map((r) => {
        const active = selected === r.year;
        return (
          <button
            key={r.year}
            onClick={() => onSelect(r.year)}
            className={`group flex flex-1 flex-col items-center gap-1 rounded p-1 transition ${
              active ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted/50"
            }`}
          >
            <span className="text-[11px] font-extrabold tabular-nums text-foreground">
              {fmt(r.count)}
            </span>
            <span className="flex h-[92px] w-full items-end">
              <span
                className={`w-full rounded-t ${active ? "bg-primary" : "bg-blue-500/80 group-hover:bg-blue-500"}`}
                style={{ height: `${Math.max(4, (r.count / max) * 92)}px` }}
              />
            </span>
            <Delta value={r.yoy_percent} />
            <span className="text-[10px] font-bold text-muted-foreground">{r.year}</span>
            <span className="text-[9px] text-muted-foreground">{r.clearance_percent}%</span>
          </button>
        );
      })}
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  blue: "bg-blue-500",
  slate: "bg-slate-500",
};

function RankedBars({
  rows,
  total,
  accent,
  showYoy,
  lang,
  translateKey,
}: {
  rows: NamedCount[];
  total: number;
  accent: "blue" | "slate";
  showYoy?: boolean;
  lang?: string;
  translateKey?: string;
}) {
  if (!rows.length) return <p className="py-6 text-center text-xs text-muted-foreground">—</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const label = translateKey && lang ? tData(translateKey, r.name, lang) : r.name;
        return (
          <div key={r.name} className="flex items-center gap-2">
            <span
              className="w-[38%] shrink-0 truncate text-[11px] font-medium text-foreground"
              title={label}
            >
              {label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={`block h-full rounded-full ${ACCENTS[accent]}`}
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-foreground">
              {fmt(r.count)}
            </span>
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {total ? Math.round((r.count / total) * 100) : 0}%
            </span>
            {showYoy && (
              <span className="w-14 shrink-0 text-right">
                <Delta value={r.yoy_percent} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Box-plot style summary of the clearance distribution across stations. */
function Distribution({
  sc,
  t,
}: {
  sc: { worst: number; p25: number; median: number; p75: number; best: number };
  t: (k: string) => string;
}) {
  const lo = sc.worst;
  const hi = sc.best;
  const span = hi - lo || 1;
  const at = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div>
      <div className="relative h-10">
        {/* full range */}
        <div className="absolute top-4 h-1 w-full rounded-full bg-muted" />
        {/* interquartile band */}
        <div
          className="absolute top-3 h-3 rounded bg-blue-500/25"
          style={{ left: at(sc.p25), width: `${((sc.p75 - sc.p25) / span) * 100}%` }}
        />
        {/* median */}
        <div
          className="absolute top-2 h-5 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: at(sc.median) }}
        />
        {[
          { v: sc.worst, cls: "text-rose-600" },
          { v: sc.best, cls: "text-emerald-600" },
        ].map((m) => (
          <div
            key={m.v}
            className={`absolute top-0 -translate-x-1/2 text-[10px] font-bold tabular-nums ${m.cls}`}
            style={{ left: at(m.v) }}
          >
            {m.v}%
          </div>
        ))}
        <div
          className="absolute top-7 -translate-x-1/2 text-[10px] font-bold tabular-nums text-foreground"
          style={{ left: at(sc.median) }}
        >
          {t("median")} {sc.median}%
        </div>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t("Best station clears")}{" "}
        <span className="font-bold text-foreground">
          {sc.median ? Math.round((sc.best / Math.max(0.1, sc.worst)) * 10) / 10 : 0}×
        </span>{" "}
        {t("the rate of the weakest, against a flat state-wide average.")}
      </p>
    </div>
  );
}

function TailList({
  title,
  rows,
  lang,
  tone,
  onPick,
}: {
  title: string;
  rows: DistrictRow[];
  lang: string;
  tone: "rose" | "emerald";
  onPick: (name: string) => void;
}) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <button
            key={r.name}
            onClick={() => onPick(r.name)}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-muted/60"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "rose" ? "bg-rose-500" : "bg-emerald-500"}`}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
              {tData("station", r.name, lang)}
            </span>
            <span className="shrink-0 text-[11px] font-bold tabular-nums text-foreground">
              {r.clearance_percent}%
            </span>
            <span className="w-11 shrink-0 text-right">
              <Delta value={r.vs_median_points} unit="pt" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DistrictTable({
  rows,
  lang,
  t,
  onPick,
}: {
  rows: DistrictRow[];
  lang: string;
  t: (k: string) => string;
  onPick: (name: string) => void;
}) {
  if (!rows.length) return <Empty t={t} />;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
        <tr className="border-b border-border">
          <th className="px-1 py-1.5 text-left font-bold">{t("District")}</th>
          <th className="px-1 py-1.5 text-right font-bold">{t("FIRs")}</th>
          <th className="px-1 py-1.5 text-left font-bold">{t("Share")}</th>
          <th className="px-1 py-1.5 text-right font-bold">{t("Clearance")}</th>
          <th className="px-1 py-1.5 text-right font-bold">{t("vs median")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr
            key={r.name}
            onClick={() => onPick(r.name)}
            className="cursor-pointer hover:bg-muted/30"
          >
            <td className="px-1 py-1.5 font-medium text-foreground">
              {tData("district", r.name, lang)}
            </td>
            <td className="px-1 py-1.5 text-right tabular-nums text-foreground">{fmt(r.count)}</td>
            <td className="px-1 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-blue-500"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{r.percent}%</span>
              </div>
            </td>
            <td className="px-1 py-1.5 text-right text-xs font-bold tabular-nums text-foreground">
              {r.clearance_percent}%
            </td>
            <td className="px-1 py-1.5 text-right">
              <Delta value={r.vs_median_points} unit="pt" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Coverage({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span
        className={`shrink-0 inline-flex items-center gap-1 font-bold tabular-nums ${warn ? "text-amber-600" : "text-foreground"}`}
      >
        {warn && <TrendingDown className="h-3 w-3" />}
        {value}
      </span>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  allLabel,
  render,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  render?: (v: string) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[170px] rounded-md border border-input bg-card px-2 py-1 text-[11px] font-semibold text-foreground"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {render ? render(o) : o}
        </option>
      ))}
    </select>
  );
}
