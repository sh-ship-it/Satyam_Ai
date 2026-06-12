import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect } from "react";
import { Filter, Sparkles, Layers, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { CrimeMap } from "@/components/CrimeMap";

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

  // Voice command "open map and show theft hotspots" lands here: apply the
  // requested layer/view and surface the task.
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

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)]">
        {/* Filters */}
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
                {["Theft", "Burglary", "Assault", "Cyber fraud", "Narcotics"].map((c, i) => (
                  <Check key={c} label={t(c)} defaultChecked={i < 2} />
                ))}
              </FilterGroup>
              <FilterGroup label={t("Date range")}>
                <input type="date" defaultValue="2024-07-15" className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm" />
                <input type="date" defaultValue="2024-08-14" className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm" />
              </FilterGroup>
              <FilterGroup label={t("District / Zone")}>
                <Select options={["Bengaluru Urban", "Bengaluru Rural", "Mysuru", "Mangaluru"]} />
                <Select options={["Whitefield", "Koramangala", "Indiranagar", "Yelahanka"]} />
              </FilterGroup>
              <FilterGroup label={t("Offender")}>
                <input placeholder={t("Search by ID / alias")} className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm" />
              </FilterGroup>
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
            {/* Real interactive map with hotspots */}
            <CrimeMap mode={layer} />


            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
              <div className="mb-1 font-medium text-foreground">{t("Intensity")}</div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 rounded-full" style={{ background: "linear-gradient(90deg, #3b82f6, #fbbf24, #f97316, #ef4444)" }} />
                <span className="text-muted-foreground">{t("low → high")}</span>
              </div>
            </div>

            {/* Selected area card */}
            <div className="absolute right-6 top-6 z-[400] w-80 rounded-xl border border-border bg-card/95 backdrop-blur p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Selected area")}</div>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">{t("live")}</span>
              </div>
              <h3 className="text-base font-semibold text-foreground">{t("Whitefield zone")}</h3>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Mini label={t("FIRs")} value="142" />
                <Mini label={t("Δ 30d")} value="+12%" tone="up" />
                <Mini label={t("Cleared")} value="27%" />
              </div>
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t("Top crimes")}</div>
                <div className="space-y-1.5">
                  <Bar label={t("Theft")} pct={62} />
                  <Bar label={t("Burglary")} pct={28} />
                  <Bar label={t("Cyber fraud")} pct={18} />
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t("7-day trend")}</div>
                <div className="flex items-end gap-1 h-10">
                  {[3, 5, 4, 7, 6, 8, 9].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${h * 10}%` }} />
                  ))}
                </div>
              </div>
              <button className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition">
                <Sparkles className="h-3.5 w-3.5" /> {t("Ask AI about this area")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Hotspot({ x, y, size, intensity, label }: { x: string; y: string; size: number; intensity: number; label: string }) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
      <div
        className="rounded-full"
        style={{
          width: size, height: size,
          background: `radial-gradient(circle, oklch(0.6 0.22 25 / ${intensity}) 0%, oklch(0.7 0.18 50 / ${intensity * 0.6}) 35%, transparent 70%)`,
        }}
      />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background shadow">
        {label}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function Check({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
      <input type="checkbox" defaultChecked={defaultChecked} className="rounded border-input accent-[oklch(0.546_0.215_262)]" />
      {label}
    </label>
  );
}
function Select({ options }: { options: string[] }) {
  return (
    <div className="relative">
      <select className="w-full appearance-none rounded-md border border-input bg-card px-2 py-1.5 pr-7 text-sm">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
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
function Mini({ label, value, tone }: { label: string; value: string; tone?: "up" }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone === "up" ? "text-success" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
function Bar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]"><span className="text-foreground">{label}</span><span className="text-muted-foreground">{pct}%</span></div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
