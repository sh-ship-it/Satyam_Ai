import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect, useCallback } from "react";
import { Filter, Sparkles, Layers, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { CrimeMap } from "@/components/CrimeMap";
import { api, type HotspotPoint, type StationRow } from "@/lib/api/client";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Map · Hotspot Explorer · Satyam" },
      { name: "description", content: "Geospatial crime hotspot exploration across Karnataka." },
    ],
  }),
  component: MapScreen,
});

function MapScreen() {
  const t = useT();
  const [layer, setLayer] = useState<"heat" | "pins" | "grid">("heat");
  const [view, setView] = useState<"crime" | "offender">("crime");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [taskMsg, setTaskMsg] = useState<string | null>(null);

  // Filter state
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Live data
  const [points, setPoints] = useState<HotspotPoint[]>([]);
  const [topStation, setTopStation] = useState<StationRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Voice command handler
  useEffect(() => {
    const onTask = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.route !== "/map") return;
      const q = String(d.query || "").toLowerCase();
      if (/\bpins?\b/.test(q)) setLayer("pins");
      else if (/\bgrid\b/.test(q)) setLayer("grid");
      else if (/heat/.test(q)) setLayer("heat");
      if (/offender/.test(q)) setView("offender");
      else if (/crime/.test(q)) setView("crime");
      setTaskMsg(d.task || d.query || null);
    };
    window.addEventListener("satyam:run-task", onTask);
    return () => window.removeEventListener("satyam:run-task", onTask);
  }, []);

  // Fetch live data whenever filters change
  const fetchData = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const body: Record<string, unknown> = {
      mode: view === "offender" ? "by_offender" : "by_crime",
    };
    if (crimeType) body.crime_type = crimeType;
    if (district) body.district = district;
    if (dateFrom) body.date_from = dateFrom;
    if (dateTo) body.date_to = dateTo;
    try {
      const [hot, brk] = await Promise.all([
        api.mapHotspots(body),
        api.stationBreakdown({ ...body, limit: 1 }),
      ]);
      setPoints(hot.points || []);
      setTopStation(brk.rows?.[0] ?? null);
    } catch {
      setErr(t("Backend unreachable — check login and API status."));
      setPoints([]);
      setTopStation(null);
    } finally {
      setLoading(false);
    }
  }, [view, crimeType, district, dateFrom, dateTo, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const mapPoints = points.map((p) => ({
    lat: p.lat, lng: p.lng, weight: p.weight, label: p.label ?? undefined,
  }));

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)]">
        {/* Filters panel */}
        {filtersOpen && (
          <aside className="w-72 shrink-0 border-r border-border bg-card overflow-auto">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Filter className="h-4 w-4" /> {t("Filters")}
              </div>
              <button onClick={() => setFiltersOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
                {t("Hide")}
              </button>
            </div>
            <div className="space-y-5 p-4">
              <FilterGroup label={t("Crime type")}>
                <select
                  value={crimeType}
                  onChange={(e) => setCrimeType(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">{t("All")}</option>
                  {["Theft", "Burglary", "Assault", "Cyber Crime", "Narcotics", "Murder"].map((c) => (
                    <option key={c} value={c}>{t(c)}</option>
                  ))}
                </select>
              </FilterGroup>
              <FilterGroup label={t("District")}>
                <select
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">{t("All districts")}</option>
                  {[
                    "Bengaluru City", "Bengaluru Dist", "Mysuru City",
                    "Mangaluru City", "Hubballi Dharwad City",
                    "Belagavi City", "Dakshina Kannada", "Shivamogga",
                  ].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </FilterGroup>
              <FilterGroup label={t("Date range")}>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm mt-1.5"
                />
              </FilterGroup>
              <button
                onClick={fetchData}
                className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition"
              >
                {loading ? t("Loading…") : t("Apply filters")}
              </button>
              {err && <p className="text-xs text-destructive">{err}</p>}
            </div>
          </aside>
        )}

        {/* Map area */}
        <section className="flex-1 min-w-0 flex flex-col">
          {taskMsg && (
            <div className="flex items-center gap-2 border-b border-border bg-primary/10 px-5 py-2 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("Voice task")}: {taskMsg}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
            <div className="flex items-center gap-2">
              {!filtersOpen && (
                <button onClick={() => setFiltersOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                  <Filter className="h-3.5 w-3.5" /> {t("Filters")}
                </button>
              )}
              <Segmented
                value={view}
                onChange={(v) => setView(v as typeof view)}
                options={[{ v: "crime", l: t("By crime type") }, { v: "offender", l: t("By offender") }]}
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 p-1">
              <Layers className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" />
              {(["heat", "pins", "grid"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLayer(l)}
                  className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition ${
                    layer === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(l)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden">
            <CrimeMap points={mapPoints} mode={layer} />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
              <div className="mb-1 font-medium text-foreground">{t("Intensity")}</div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 rounded-full" style={{ background: "linear-gradient(90deg, #3b82f6, #fbbf24, #f97316, #ef4444)" }} />
                <span className="text-muted-foreground">{t("low → high")}</span>
              </div>
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                {loading ? t("Loading…") : `${points.length} ${t("hotspot cells")}`}
              </div>
            </div>

            {/* Selected area / top hotspot card */}
            <div className="absolute right-6 top-6 z-[400] w-80 rounded-xl border border-border bg-card/95 backdrop-blur p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {topStation ? t("Top hotspot") : t("Overview")}
                </div>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                  {loading ? t("loading…") : t("live")}
                </span>
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {topStation?.station ?? (loading ? "…" : t("No data"))}
              </h3>
              {topStation && (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Mini label={t("FIRs")} value={String(topStation.firs)} />
                    <Mini label={t("Cleared")} value={String(topStation.cleared)} />
                    <Mini label={t("Top crime")} value={topStation.top_legal_code ?? "—"} />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t("7-day trend")}</div>
                    <Spark data={topStation.trend} />
                  </div>
                </>
              )}
              <button
                onClick={() => {
                  const q = topStation
                    ? `Summarize crime patterns in ${topStation.station}`
                    : "Summarize crime hotspots in Karnataka";
                  try { sessionStorage.setItem("satyam:pending-voice", JSON.stringify({ text: q, speak: false })); } catch {}
                  window.location.href = "/console";
                }}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition"
              >
                <Sparkles className="h-3.5 w-3.5" /> {t("Ask AI about this area")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`rounded px-3 py-1.5 text-xs font-medium transition ${
          value === o.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        }`}>{o.l}</button>
      ))}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}
