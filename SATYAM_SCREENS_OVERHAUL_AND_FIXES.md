# Satyam — Screens Overhaul & Cross-Cutting Fixes (Issues 1–7)

**Audience:** the coding agent that applies these patches to `Satyam_Ai-main`.
**Style:** every change is a drop-in edit with file path + exact anchors. Apply in the order given.
**Repo facts used (verified this pass):**
- `API_BASE` has **no** `/api` suffix (`frontend/src/lib/api/client.ts`).
- Routers: `cases.router` → `/cases`, `intelligence.router` → `/api` (`backend/app/main.py`).
- `EgoRequest` copies a numeric `entity_name` into `person_id`, so passing a numeric person id as the seed string resolves an ego graph (`backend/app/schemas/network.py`).
- `intelligence.getNetworkRings(limit, crime_type?, district?)` already exists (`frontend/src/lib/api/intelligence.ts:87`).
- Conversations persist only in `localStorage["satyam-chat-history"]` (frontend) and an in-memory/Redis store keyed by `owner_id` (backend) — **no shared DB table**.

---

## 0. Executive summary

| # | Issue | Root cause | Fix type |
|---|---|---|---|
| 1 | Forecast "Network" → chat dead-end ("I cannot generate a network…") | Button sends free text to chat; a district+crime isn't an entity the chat can graph | Reroute to Network screen → show **criminal rings** for that district/crime |
| 2 | Forecast screen looks static | Only final result cards shown | Add a **live model-inference visualization** |
| 3 | Trends screen dull | Basic charts | Overhaul layout + animated charts + crime×period heatmap |
| 4 | Reports search not loading names | Shared `searchPersonsAndCases` hits `/api/cases/search` = **404** | Same one-line path fix as Network search |
| 5 | Brief doc UI dull / thin | Few sections | Richer letterhead + crime breakdown + offenders + MO + recommendations |
| 6 | Reports upload box doesn't work | Upload UI never existed (placeholder only) | Build **dataset import** + **device upload** |
| 7 | Conversations not visible across accounts | localStorage + per-owner memory store; no shared table | Add **cloud `conversations` table + endpoints**, store author + clearance; rank-tier visibility |

---

# FIX 4 (do first — unblocks Issues 1 & 4) — Search 404

Both the Network seed search and the Reports search call the **same** function
`intelligence.searchPersonsAndCases`, which targets `/api/cases/search`. That route
does not exist (the handler is at `/cases/search`). Every keystroke 404s → no names.

**File:** `frontend/src/lib/api/intelligence.ts`

```ts
// BEFORE
  searchPersonsAndCases: (q: string, limit = 12) =>
    apiFetch<SearchResult[]>(`/api/cases/search?q=${encodeURIComponent(q)}&limit=${limit}`),

// AFTER
  searchPersonsAndCases: (q: string, limit = 12) =>
    apiFetch<SearchResult[]>(`/cases/search?q=${encodeURIComponent(q)}&limit=${limit}`),
```

> This single change fixes **Issue 4 (reports search)** AND the Network seed search.
> If you already applied `SATYAM_NETWORK_SEARCH_FIX.md`, this is done — skip.
> (Optional hardening for both autocompletes — stale-response guard — is in that file, §Fix 2.)

---

# ISSUE 1 — Forecast "Network" must open a real network, not the chat

## 1A. Stop sending free text to chat; carry context to the Network screen

**File:** `frontend/src/routes/forecast.tsx`

**(a)** Find the alert card's "Network" button:
```tsx
          <button
            onClick={() => onSendToChat(`${t("Show network")} ${a.district} ${tData("crime_type", a.crime_type, "EN")}`)}
            className="inline-flex items-center gap-1 rounded-md bg-muted/60 hover:bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
          >
            <ArrowUpRight className="h-3 w-3" />
            {t("Network")}
          </button>
```
Replace its `onClick` with a call to a new `onOpenNetwork` prop:
```tsx
          <button
            onClick={() => onOpenNetwork(a.district, a.crime_type)}
            className="inline-flex items-center gap-1 rounded-md bg-muted/60 hover:bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition"
          >
            <ArrowUpRight className="h-3 w-3" />
            {t("Network")}
          </button>
```

**(b)** Add `onOpenNetwork` to that card component's prop list (the same component
that already receives `onSendToChat`, `onToggle`, `expanded`, `a`). Add to its
TypeScript props:
```tsx
  onOpenNetwork: (district: string, crimeType: string) => void;
```
and pass it down wherever the card is rendered in `ForecastScreen` (next to the
existing `onSendToChat={handleSendToChat}` prop):
```tsx
            onOpenNetwork={handleOpenNetwork}
```

**(c)** Add the handler in `ForecastScreen` next to `handleSendToChat`:
```tsx
  const handleOpenNetwork = (district: string, crimeType: string) => {
    try {
      sessionStorage.setItem(
        "satyam:network-context",
        JSON.stringify({ district, crime_type: crimeType, ts: Date.now() }),
      );
    } catch {}
    navigate({ to: "/network" });
  };
```

> Keep `handleSendToChat` — the "Ask AI" button still uses it. Only the Network
> button changes.

## 1B. Network screen: consume the forecast context (reuse the EXISTING RingsPanel)

**File:** `frontend/src/routes/network.tsx`

> IMPORTANT (verified against the code): the Network screen ALREADY has a tab system
> `linkMode: "people" | "financial" | "rings"` (state setter `setLinkMode`, ~line 266)
> and ALREADY renders `<RingsPanel />` (~line 1060). `RingsPanel` (from
> `@/components/RingsPanel`) accepts `{ crimeType?, district? }` and internally calls
> `intelligence.getNetworkRings(12, crimeType, district)` and renders severity-ranked
> ring cards. So DO NOT build a second rings banner — just feed it the forecast context
> and switch to the Rings tab. No new lucide/type imports are needed.

**(a)** Inside `NetworkScreen`, add one piece of state near the other `useState`s:
```tsx
  const [ringCtx, setRingCtx] = useState<{ district?: string; crime_type?: string } | null>(null);
```

**(b)** Add an effect that reads the forecast context once on mount (place it next to
the existing `?seed=` effect). It switches to the Rings tab and stores the filter:
```tsx
  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("satyam:network-context"); } catch {}
    if (!raw) return;
    try { sessionStorage.removeItem("satyam:network-context"); } catch {}
    let ctx: { district?: string; crime_type?: string } = {};
    try { ctx = JSON.parse(raw); } catch { return; }
    if (!ctx.district && !ctx.crime_type) return;
    setRingCtx({ district: ctx.district || undefined, crime_type: ctx.crime_type || undefined });
    setLinkMode("rings"); // jump straight to the existing Rings tab
  }, []);
```

**(c)** Wire the context into the EXISTING RingsPanel render. Find the Rings tab body
(~line 1060) which currently reads `<RingsPanel />` and pass the two props:
```tsx
            <div className="flex-1 overflow-hidden">
              <RingsPanel crimeType={ringCtx?.crime_type} district={ringCtx?.district} />
            </div>
```
The surrounding `linkMode === "rings" ? ( ... ) : ...` ternary already exists — only the
`<RingsPanel />` call changes to pass `crimeType` / `district`.

**Why this works end-to-end:** the Forecast button stores `{ district, crime_type }` in
`sessionStorage["satyam:network-context"]` and navigates to `/network`. On mount the
Network screen reads it, switches `linkMode` to the **Rings** tab, and passes the filter
into the existing `RingsPanel`, which calls `intelligence.getNetworkRings(12, crime_type,
district)` and renders severity-ranked ring cards for exactly that pattern (clicking a
ring uses RingsPanel's own built-in navigation). This wires the previously-dormant
`/api/network/rings` and replaces the chat dead-end with the most judge-relevant view —
*who is driving the emerging pattern* — while reusing the already-built, tested panel
(no duplicate UI).

**Acceptance:** On Forecast, click "Network" on any alert → lands on the Network screen
with the **Rings** tab active, showing the rings detected for that district/crime (or
RingsPanel's clean "No rings detected" state). No chat redirect.

---

# ISSUE 2 — Live model-inference visualization on the Forecast screen

Goal: make judges *see the model working*, not just final cards. Add an animated
"inference theater" that streams through the pipeline stages and renders a live
risk surface built from the real `cells` data already loaded.

## 2A. New component file

**Create:** `frontend/src/components/ModelInferenceTheater.tsx`
```tsx
import { useEffect, useState } from "react";
import { Database, Cpu, Sigma, Radar, CheckCircle2 } from "lucide-react";
import type { ForecastCell, BacktestResponse } from "@/lib/api/intelligence";

type Stage = { key: string; label: string; icon: React.ComponentType<{ className?: string }>; detail: string };

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
    { key: "ingest",  label: t("Ingesting FIR signals"),    icon: Database, detail: t("Spatio-temporal events") },
    { key: "feature", label: t("Engineering features"),     icon: Sigma,    detail: t("KDE · recency · seasonality") },
    { key: "infer",   label: t("Running risk model"),       icon: Cpu,      detail: t("Self-exciting hotspot model") },
    { key: "surface", label: t("Projecting risk surface"),  icon: Radar,    detail: t("Grid cell scoring") },
  ];
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);

  // Cycle through stages while loading; settle on “done” when data is present.
  useEffect(() => {
    if (loading) { setDone(false); setActive(0); return; }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i >= stages.length) { clearInterval(id); setDone(true); setActive(stages.length); }
      else setActive(i);
    }, 420);
    return () => clearInterval(id);
  }, [loading, cells.length]);

  const pai = backtest ? Math.round(backtest.hit_rate_top_10_percent_cells * 100) : null;
  const top = [...cells].sort((a, b) => b.risk_score - a.risk_score).slice(0, 48);
  const max = top.length ? top[0].risk_score || 1 : 1;

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="text-xs font-bold text-foreground">{t("Model live inference")}</span>
          {asOf && <span className="text-[10px] text-muted-foreground">{t("as of")} {asOf}</span>}
        </div>
        {pai !== null && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{t("PAI hit rate")}</span>
            <span className="font-extrabold text-emerald-600">{pai}%</span>
          </div>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        {/* Pipeline stepper */}
        <div className="p-4 space-y-2 border-b md:border-b-0 md:border-r border-border/60">
          {stages.map((s, i) => {
            const state = done || i < active ? "done" : i === active ? "running" : "pending";
            const Icon = s.icon;
            return (
              <div key={s.key}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all ${
                  state === "running" ? "bg-primary/10 ring-1 ring-primary/30" :
                  state === "done" ? "bg-emerald-500/5" : "opacity-50"}`}>
                <div className={`grid h-8 w-8 place-items-center rounded-lg shrink-0 ${
                  state === "done" ? "bg-emerald-500/15 text-emerald-600" :
                  state === "running" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {state === "done" ? <CheckCircle2 className="h-4 w-4" />
                    : <Icon className={`h-4 w-4 ${state === "running" ? "animate-pulse" : ""}`} />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{s.detail}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live risk surface */}
        <div className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {t("Projected risk surface")}
          </div>
          <div className="grid grid-cols-8 gap-1">
            {top.map((c, i) => {
              const intensity = Math.max(0.08, (c.risk_score || 0) / max);
              return (
                <div key={c.cell_id || i}
                  title={`${c.crime_type} · ${Math.round((c.risk_score || 0) * 100)}%`}
                  className="aspect-square rounded-[4px] transition-all duration-500"
                  style={{
                    backgroundColor: `rgba(239, 68, 68, ${intensity})`,
                    transform: done ? "scale(1)" : "scale(0.6)",
                    transitionDelay: `${i * 12}ms`,
                  }} />
              );
            })}
            {top.length === 0 && (
              <div className="col-span-8 text-center text-xs text-muted-foreground py-6">{t("Awaiting grid…")}</div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{t("Low")}</span>
            <div className="h-2 flex-1 rounded-full" style= background: "linear-gradient(90deg, rgba(239,68,68,0.08), rgba(239,68,68,1))"  />
            <span>{t("High")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

## 2B. Mount it on the Forecast screen

**File:** `frontend/src/routes/forecast.tsx`
- Add import at top:
```tsx
import { ModelInferenceTheater } from "@/components/ModelInferenceTheater";
```
- Render it right below the header `</div>` and above the alerts/grid section
  (inside the main scroll container). Use the state already present:
```tsx
        <div className="px-6 pt-4">
          <ModelInferenceTheater cells={cells} backtest={backtest} loading={loading} asOf={alertsAsOf} t={t} />
        </div>
```

**Acceptance:** On load/refresh the stepper animates Ingest → Features → Model →
Surface, the risk grid "pops" in cell-by-cell from real `cells`, and the PAI hit
rate shows. Auto-refresh re-runs the animation, reinforcing "the model is working."

---

# ISSUE 3 — Trends & Patterns overhaul

Upgrade the existing screen (don't rewrite). Three changes: animated bars, a
crime×period heatmap, and a polished tabbed header.

## 3A. Animated, axis-labeled time-series bars

**File:** `frontend/src/routes/trends.tsx` — replace the `TrendChart` component body.
```tsx
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
          <div className="w-full rounded-t-md bg-gradient-to-t from-primary/60 to-primary transition-all duration-700 group-hover:from-primary group-hover:to-primary"
            style={{ height: `${(v / max) * 100}%`, transitionDelay: `${i * 18}ms` }} />
          <div className="text-[8px] text-muted-foreground truncate w-full text-center" title={period}>
            {period.length > 7 ? period.slice(2) : period}
          </div>
        </div>
      ))}
    </div>
  );
}
```

## 3B. New crime×period heatmap component

Add this component to `trends.tsx` (above `TrendsScreen`):
```tsx
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
          <div className="w-28 shrink-0" />
          {periods.map((p) => (
            <div key={p} className="flex-1 min-w-[28px] text-[8px] text-muted-foreground text-center -rotate-45 origin-left h-6">{p.slice(2)}</div>
          ))}
        </div>
        {crimes.map((c) => (
          <div key={c} className="flex items-center">
            <div className="w-28 shrink-0 text-[10px] font-medium text-foreground truncate pr-2" title={c}>{c}</div>
            {periods.map((p) => {
              const v = grid[`${c}|${p}`] || 0;
              const intensity = v / max;
              return (
                <div key={p} title={`${c} · ${p}: ${v}`}
                  className="flex-1 min-w-[28px] aspect-square m-[1px] rounded-[3px]"
                  style={{ backgroundColor: v ? `rgba(99,102,241,${Math.max(0.1, intensity)})` : "rgba(120,120,120,0.06)" }} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```
Render `CrimeHeatmap` inside the "overview" (or a new "Patterns") tab body:
```tsx
  {activeTab === "overview" && (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">{t("Crime × Period intensity")}</div>
      <CrimeHeatmap series={series} />
    </div>
  )}
```

## 3C. Polished delta cards (optional but recommended)
Wrap the QoQ/YoY delta numbers in colored pill cards with the existing `Sparkline`
and `TrendingUp/Down` icons (already imported) so the overview reads like a
dashboard, not a table. Use `deltas.qoq_percent` / `deltas.yoy_percent` and color
green when negative (crime down) / red when positive.

**Acceptance:** Trends overview shows animated bars, a crime×period heatmap, and
colored delta cards; tabs switch without layout shift.

---

# ISSUE 5 — Karnataka Crime Intelligence Brief: richer, denser doc

**File:** `frontend/src/routes/reports.tsx`

The brief already has Executive Summary + Station Distribution + Selected Items.
Add three high-value sections and a signature block. They use data you can fetch
with existing endpoints.

## 5A. Load supporting data
In `Reports()`, alongside the existing `api.stationBreakdown(...)` effect, add:
```tsx
  const [topOffenders, setTopOffenders] = useState<OffenderListItem[]>([]);
  const [trendDeltas, setTrendDeltas] = useState<{ qoq_percent: number | null; yoy_percent: number | null }>({ qoq_percent: null, yoy_percent: null });
  useEffect(() => {
    intelligence.listOffenders(new URLSearchParams({ limit: "8", min_offenses: "2" }))
      .then((r) => setTopOffenders(r.offenders)).catch(() => setTopOffenders([]));
    intelligence.getTrends(new URLSearchParams({ granularity: "quarter" }))
      .then((r) => setTrendDeltas(r.deltas)).catch(() => {});
  }, []);
```
Add the imports/types: `import { intelligence, type SearchResult, type OffenderListItem } from "@/lib/api/intelligence";`

## 5B. New sections (insert after Station Distribution `DocSection`, before Selected Items)
```tsx
              {/* ── Crime trend signal ─────────────────────────────── */}
              <DocSection num="3" title={t("Crime Trend Signal")} icon={<TrendingUp className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-3">
                  {([["Quarter-on-quarter", trendDeltas.qoq_percent], ["Year-on-year", trendDeltas.yoy_percent]] as [string, number | null][]).map(([lbl, val]) => (
                    <div key={lbl} className="rounded-xl border border-border p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(lbl)}</div>
                      <div className={`text-xl font-extrabold ${val == null ? "text-muted-foreground" : val > 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {val == null ? "—" : `${val > 0 ? "+" : ""}${val}%`}
                      </div>
                    </div>
                  ))}
                </div>
              </DocSection>

              {/* ── Notable offenders ──────────────────────────────── */}
              <DocSection num="4" title={t("Notable Repeat Offenders")} icon={<User className="h-4 w-4" />}>
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">{t("Name")}</th>
                        <th className="px-3 py-2 text-right">{t("Cases")}</th>
                        <th className="px-3 py-2 text-left">{t("Top Crime")}</th>
                        <th className="px-3 py-2 text-left">{t("District")}</th>
                        <th className="px-3 py-2 text-left">{t("Risk")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {topOffenders.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">{t("No data")}</td></tr>
                      ) : topOffenders.map((o) => (
                        <tr key={o.person_id}>
                          <td className="px-3 py-2 font-medium">{o.display_name}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold">{o.offense_count}</td>
                          <td className="px-3 py-2">{o.top_crime_type || "—"}</td>
                          <td className="px-3 py-2">{o.district || "—"}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              o.risk_label === "Critical" ? "bg-destructive/15 text-destructive" :
                              o.risk_label === "High" ? "bg-orange-500/15 text-orange-600" : "bg-muted text-muted-foreground"}`}>
                              {o.risk_label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DocSection>
```
> Renumber to keep the sequence clean (verified current order is 1 Executive Summary,
> 2 Distribution by Station, 3 Selected Items, 4 Compliance Notice; "Citations" is an
> UNnumbered `<div>`, leave it alone). After inserting the two new sections, set:
> existing "Selected Items" `num="3"` → `num="5"`, and existing "Compliance Notice"
> `num="4"` → `num="6"`.

## 5C. Signature / authorization block (append at the end of the doc body)
```tsx
              <div className="mt-10 pt-6 border-t border-border grid grid-cols-2 gap-8 text-[11px]">
                <div>
                  <div className="h-10 border-b border-foreground/40" />
                  <div className="mt-1 text-muted-foreground">{t("Prepared by")}: {officerName || "—"}</div>
                </div>
                <div>
                  <div className="h-10 border-b border-foreground/40" />
                  <div className="mt-1 text-muted-foreground">{t("Reviewed / Authorized")}</div>
                </div>
              </div>
              <div className="mt-4 text-center text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
                {t("Confidential · Karnataka State Police · Synthetic data only")}
              </div>
```

**Acceptance:** The brief now shows trend deltas, repeat-offender intelligence, and
a formal signature block in addition to the station table — visibly denser and
"investigation-grade."

---

# ISSUE 6 — Reports: working uploads (dataset import + device upload)

The left sidebar has only placeholders. Add a real two-source uploader. Report
items currently support `person | case | map`; add an `attachment` type for files.

## 6A. Extend the report item type
**File:** `frontend/src/routes/reports.tsx` (verified: the union is named `ItemType`, ~line 25,
and currently is `"table" | "map" | "case" | "person" | "alert"`). Add `"attachment"`:
```tsx
type ItemType = "table" | "map" | "case" | "person" | "alert" | "attachment";
```
**IMPORTANT:** there is an exhaustive `ItemIcon` helper typed as
`Record<ItemType, { icon; bg }>` (bottom of the file). You MUST add an `attachment`
entry there too or TypeScript will fail to compile, e.g.:
```tsx
    attachment: { icon: Upload, bg: "bg-violet-500/10 text-violet-600" },
```
The existing `items.map(...)` preview already renders any item by `title`/`meta`, and the
number-badge color falls back to muted for non-person/case types, so `attachment` rows
render correctly without a dedicated branch (see 6C for the optional size/filename line).

## 6B. Uploader component (add to reports.tsx)
```tsx
function UploadPanel({ onAdd }: { onAdd: (item: ReportItem) => void }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Source 1 — import cases from the project dataset (reuses the live search API)
  useEffect(() => {
    if (!picking || q.trim().length < 2) { setResults([]); return; }
    const id = setTimeout(() => {
      intelligence.searchPersonsAndCases(q.trim(), 12)
        .then((r) => setResults(r.filter((x) => x.type === "case")))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q, picking]);

  // Source 2 — upload a file from the device
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      onAdd({
        id: `attachment-${Date.now()}`,
        type: "attachment",
        title: f.name,
        meta: `${(f.size / 1024).toFixed(0)} KB · ${f.type || "file"}`,
        data: { name: f.name, size: f.size, mime: f.type, dataUrl: String(reader.result) } as any,
      });
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Attach evidence")}</div>

      {/* Device upload */}
      <button onClick={() => fileRef.current?.click()}
        className="w-full rounded-xl border-2 border-dashed border-border bg-muted/20 hover:border-primary hover:bg-primary/5 transition p-4 text-center">
        <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
        <div className="text-xs font-medium text-foreground">{t("Upload from device")}</div>
        <div className="text-[10px] text-muted-foreground">{t("PDF, image, CSV — max ~5 MB")}</div>
      </button>
      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.docx" className="hidden" onChange={onFile} />

      {/* Dataset import */}
      <button onClick={() => setPicking((v) => !v)}
        className="w-full rounded-xl border border-border bg-background hover:bg-muted/50 transition p-2.5 text-left flex items-center gap-2">
        <Database className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground">{t("Import from case dataset")}</span>
        <ChevronDown className={`h-3.5 w-3.5 ml-auto text-muted-foreground transition ${picking ? "rotate-180" : ""}`} />
      </button>
      {picking && (
        <div className="rounded-xl border border-border bg-card p-2 space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search FIR / crime type…")}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
            {results.map((r) => (
              <button key={`${r.type}-${r.id}`}
                onClick={() => onAdd({ id: `case-${r.id}-${Date.now()}`, type: "case", title: r.label, meta: r.sub, data: { id: r.id, type: r.type, label: r.label, sub: r.sub } as any })}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 text-left">
                <Hash className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{r.label}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.sub}</div>
                </div>
                <Plus className="h-3.5 w-3.5 ml-auto text-muted-foreground shrink-0" />
              </button>
            ))}
            {q.trim().length >= 2 && results.length === 0 && (
              <div className="text-[11px] text-muted-foreground text-center py-3">{t("No matching cases")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```
Add icons to the existing lucide import in reports.tsx: `Upload, Database, ChevronDown, Plus, Hash, User`.
Mount `<UploadPanel onAdd={addItem} />` in the left sidebar, under the "Quick add —
Top Stations" block (where the dashed placeholder is). Reuse the same `addItem`
used by `AddItemBar`.

## 6C. Include attachments in the preview
In the "Selected Items" section render, add a branch so `attachment` items show the
file name, size, and (for images) a thumbnail from `data.dataUrl`. They are local
to the report preview/print; the device file is **not** uploaded to the server
(privacy-safe for the demo). If you want server persistence later, POST `dataUrl`
to a new `/reports/attachments` endpoint — out of scope here.

**Acceptance:** Clicking "Upload from device" opens the OS file picker and the file
appears as a report item; "Import from case dataset" searches real FIRs and adds
them. Both show in the preview and print.

---

# ISSUE 7 — Cloud-persisted conversations (cross-account, with author)

Today conversations live in `localStorage` + an in-memory store keyed by `owner_id`
— no other account can see them. Add a shared DB table + endpoints, and have the
Console save there with the author stamped.

## 7A. Backend model
**File:** `backend/app/db/models.py` — add:
```python
class Conversation(Base):
    __tablename__ = "conversations"
    conversation_id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text, default="New conversation")
    owner_id: Mapped[str] = mapped_column(Text, index=True)
    owner_name: Mapped[str] = mapped_column(Text, default="")
    owner_rank: Mapped[Optional[str]] = mapped_column(Text)
    owner_clearance: Mapped[int] = mapped_column(Integer, default=1, index=True)  # 1..4 from resolve_clearance(rank)
    messages: Mapped[str] = mapped_column(Text, default="[]")  # JSON string
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
```
VERIFIED: `models.py` already imports `Integer`, `DateTime`, `Optional`, `Mapped`,
`mapped_column`, `Text` and `datetime as dt`, and already defines a module-level
`def _now() -> dt.datetime` helper — so use `default=_now` / `onupdate=_now` (the
codebase's existing pattern). Do NOT use `func.now()`; `func` is not imported.
Create the table: add a migration, or if the project auto-creates via `Base.metadata.create_all`, it will appear. Otherwise add to the seed/init SQL:
```sql
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  title TEXT DEFAULT 'New conversation',
  owner_id TEXT,
  owner_name TEXT DEFAULT '',
  owner_rank TEXT,
  owner_clearance INTEGER DEFAULT 1,
  messages TEXT DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_conversations_owner ON conversations(owner_id);
CREATE INDEX IF NOT EXISTS ix_conversations_clearance ON conversations(owner_clearance);
```

## 7B. Backend schema + routes
**Create:** `backend/app/api/routes/conversations.py`
```python
from __future__ import annotations
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import Principal, resolve_clearance
from app.db.models import Conversation

router = APIRouter()

class ChatMsg(BaseModel):
    role: str
    text: str
    citations: list[str] | None = None

class ConversationIn(BaseModel):
    conversation_id: str
    title: str = "New conversation"
    messages: list[ChatMsg] = []

class ConversationOut(BaseModel):
    conversation_id: str
    title: str
    owner_id: str
    owner_name: str
    owner_rank: str | None = None
    owner_clearance: int = 1
    messages: list[ChatMsg]
    created_at: str | None = None
    updated_at: str | None = None

def _to_out(c: Conversation) -> ConversationOut:
    try: msgs = [ChatMsg(**m) for m in json.loads(c.messages or "[]")]
    except Exception: msgs = []
    return ConversationOut(
        conversation_id=c.conversation_id, title=c.title, owner_id=c.owner_id,
        owner_name=c.owner_name or "", owner_rank=c.owner_rank,
        owner_clearance=c.owner_clearance or 1, messages=msgs,
        created_at=str(c.created_at) if c.created_at else None,
        updated_at=str(c.updated_at) if c.updated_at else None,
    )

@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[ConversationOut]:
    # Rank-tier visibility: you may see a conversation only when your clearance is
    # >= the author's. Highest tier (L4) sees everyone; medium (L3) sees medium + low;
    # low (L1–L2) sees low. Peers in the same tier see each other.
    rows = (await session.execute(
        select(Conversation)
        .where(Conversation.owner_clearance <= principal.clearance)
        .order_by(Conversation.updated_at.desc())
        .limit(200)
    )).scalars().all()
    return [_to_out(c) for c in rows]

@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> ConversationOut:
    c = (await session.execute(
        select(Conversation).where(Conversation.conversation_id == conversation_id)
    )).scalar_one_or_none()
    if not c: raise HTTPException(status_code=404, detail="not found")
    if (c.owner_clearance or 1) > principal.clearance:
        raise HTTPException(status_code=403, detail="insufficient clearance")
    return _to_out(c)

@router.post("", response_model=ConversationOut)
async def upsert_conversation(
    body: ConversationIn,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> ConversationOut:
    c = (await session.execute(
        select(Conversation).where(Conversation.conversation_id == body.conversation_id)
    )).scalar_one_or_none()
    payload = json.dumps([m.model_dump() for m in body.messages])
    if c is None:
        c = Conversation(
            conversation_id=body.conversation_id, title=body.title,
            owner_id=principal.id, owner_name=principal.name, owner_rank=principal.rank,
            owner_clearance=getattr(principal, "clearance", None) or resolve_clearance(principal.rank),
            messages=payload,
        )
        session.add(c)
    else:
        # Only the author may overwrite; others can read.
        if c.owner_id == principal.id:
            c.title = body.title
            c.messages = payload
    await session.flush()  # NOT session.commit(): get_scoped_session already wraps the
    # request in `async with session.begin():`, which commits on return. Every existing
    # route relies on this — calling commit()/refresh() here would operate on the
    # managed transaction and raise. flush() sends the INSERT/UPDATE now, and the
    # Python-side `default=_now` populates created_at/updated_at so _to_out(c) is valid.
    return _to_out(c)
```
> VERIFIED against the codebase: `get_scoped_session` (deps.py) does
> `async with sessionmaker() as session: async with session.begin(): ... yield session`,
> and NONE of the existing routes (cases, chat, reports, intelligence, map, network, …)
> call `session.commit()`. Do not add one here.
**Register the router** in `backend/app/main.py` (next to the others):
```python
from app.api.routes import conversations as conversations_routes
app.include_router(conversations_routes.router, prefix="/conversations", tags=["conversations"])
```

## 7C. Frontend client
**File:** `frontend/src/lib/api/client.ts` — add to the `api` object:
```ts
  // --- conversations (cloud, cross-account) ---
  listConversations(): Promise<Array<{ conversation_id: string; title: string; owner_id: string; owner_name: string; owner_rank?: string | null; messages: { role: string; text: string; citations?: string[] }[]; created_at?: string; updated_at?: string }>> {
    return request("/conversations");
  },
  getConversation(id: string) { return request(`/conversations/${id}`); },
  saveConversation(body: { conversation_id: string; title: string; messages: { role: string; text: string; citations?: string[] }[] }) {
    return request("/conversations", { method: "POST", body: JSON.stringify(body) });
  },
```

## 7D. Console: mirror saves to the cloud
**File:** `frontend/src/routes/console.tsx` — in the existing `saveConversations(updated)`
path (and after a message round-trip completes), also push the active conversation:
```ts
  // after local saveConversations(...) for the active conversation:
  try {
    const conv = updated.find((c) => c.id === activeId);
    if (conv) {
      api.saveConversation({
        conversation_id: conv.id,
        title: conv.title,
        messages: conv.messages.map((m: any) => ({ role: m.role, text: m.text, citations: m.citations })),
      }).catch(() => {}); // non-blocking; local copy remains source of truth offline
    }
  } catch {}
```
Import `api` if not already: `import { api } from "@/lib/api/client";`

## 7E. Transcripts: show everyone's conversations with author
**File:** `frontend/src/routes/transcripts.tsx` — load from cloud and merge with local.
Replace the localStorage-only load with:
```tsx
  const [cloud, setCloud] = useState<any[]>([]);
  useEffect(() => {
    api.listConversations().then(setCloud).catch(() => setCloud([]));
  }, []);
  // Use `cloud` as the primary list; fall back to loadConversations() (local) when empty/offline.
```
In each conversation row, render the author so it's clear who made it:
```tsx
  <span className="text-[11px] text-muted-foreground">
    {t("by")} {c.owner_name || t("Unknown")}{c.owner_rank ? ` · ${c.owner_rank}` : ""}
  </span>
```

**Acceptance:** Send a message in Console as Officer A; sign in as Officer B on
another account. If B's clearance ≥ A's, Transcripts lists A's conversation labelled
“by <A's name> · <rank>” and B opens it read-only; if B's clearance is lower, A's
conversation is hidden and a direct fetch returns **403**. Peers in the same tier
(medium↔medium, low↔low) see each other. Author/clearance are stamped from the JWT
principal server-side and cannot be spoofed.

---

## Global apply order

1. **Fix 4** (search path) — unblocks Network + Reports search.
2. **Issue 1** (forecast → network rings).
3. **Issue 7** backend (model + routes + register) → then frontend client + console + transcripts.
4. **Issue 6** (uploads), **Issue 5** (brief sections) — both in reports.tsx.
5. **Issue 2** (ModelInferenceTheater) and **Issue 3** (trends) — independent.
6. Rebuild frontend + restart backend; run each section's Acceptance check.

## Notes / honesty
- Issue 1 deliberately shows **rings** rather than forcing a chat answer, because a
  district+crime-type is not a graphable entity — rings are the correct, judge-relevant
  artifact and they reuse a real, already-built endpoint.
- Issue 6 device files stay client-side (print/preview only) by design; server-side
  storage of uploaded evidence is a separate, larger task (noted in 6C).
- Issue 7 enforces **rank-tier visibility**: an officer sees a conversation only when
  their clearance ≥ the author's. Highest tier sees all; medium sees medium + low;
  low sees low; peers in a tier see each other. Enforced server-side in
  `list_conversations` / `get_conversation` via `principal.clearance`, so it can't be
  bypassed from the client. Clearance tiers map to the same DGP/IGP/DIG/SP (L4) ·
  DySP/CI/PI (L3) · PSI/ASI/HC/PC (L1–L2) grouping used in the login/signup screens.
