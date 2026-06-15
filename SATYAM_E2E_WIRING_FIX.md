# Satyam — End-to-End Wiring & Mock-Data Removal (Deep Scan)

**Scope of this pass:** verify the API ⇄ models workflow is connected end-to-end, remove the old hardcoded mock data from the frontend, and make the **real synthetic dataset** (100k FIRs in Postgres) actually surface in the UI.

**Date:** scan of `Satyam_Ai-main` (v4 zip).

---

## TL;DR verdict

| Layer | State | Action |
|---|---|---|
| **Backend API ⇄ models** | ✅ Cleanly wired end-to-end | None — see Part A |
| **Synthetic data → Postgres** | ✅ Loader is correct | None — just run it |
| **Demo identity vs dataset jurisdiction** | ❌ **CRITICAL** — mismatch returns **0 rows** | Issue 0 |
| **Frontend → API** | ❌ Mostly **hardcoded mock**; real endpoints exist but are unused | Issues 1–6 |

**The backend is not the problem.** The synthetic dataset never appears because (a) the demo login stamps a jurisdiction that does not exist in the data, so RLS filters everything out, and (b) the map / network / console-canvas / case-drawer / reports screens render *baked-in Bengaluru/Whitefield arrays* instead of calling the working API. Fix Issue 0 first, then wire each screen.

---

## Part A — End-to-end workflow (verified CONNECTED)

This path was traced and is correct; **do not change it**:

```
POST /chat/stream
  → chat_service.stream_chat
    → orchestrator.run
        → guardrails → router.route (intent)
            ├─ text_to_sql.answer_with_sql  → registry.get_llm (Gemini/Groq) + PII mask (clearance<3)
            ├─ rag.search_narratives        → registry.get_embedder (BGE-M3) + pgvector <=> + get_reranker (bge-reranker-v2-m3)
            └─ analytics.hotspots / ego_network (networkx)
        → _compose → registry.get_llm / get_fallback_llm  → SSE tokens/citations

GET  /cases,  GET /cases/{id}      → case_service     → RLS session + masking
POST /map/hotspots                 → map_service      → cases (lat/lng/crime_type)
POST /network/ego                  → network_service  → case_persons graph
POST /reports/build                → report_service   → reuses case_service.get_case
GET  /audit                        → AuditLog + verify_chain (hash chain)
POST /auth/login, GET /auth/me     → JWT (rank→scope+clearance)
```

Every read route is gated by `require(principal, Permission.*)` and runs under `get_scoped_session`, which stamps the RLS GUCs (`app.scope/range/district/station_id/clearance/officer_id`) + a 5s `statement_timeout`. Models load via `registry` and are warmed in `main.py` lifespan. **All good.**

---

## Issue 0 — CRITICAL: demo identity ≠ dataset jurisdiction → RLS returns zero rows

**This is the single biggest reason the synthetic dataset does not show.**

- The dataset's districts/ranges (from `generate_dataset.py` + `DATA_DICTIONARY.md`) are real KSP names:
  - districts: `Bengaluru City`, `Bengaluru Dist`, `Mysuru City`, `Dakshina Kannada`, `Belagavi City`, …
  - ranges: `Commissionerates`, `Central Range`, `Southern Range`, `Western Range`, …
- But `backend/app/api/routes/auth.py` `_DEMO_STATIONS` stamps **`district="Bengaluru Urban"`** and **`range="Bengaluru Range"`** — **neither string exists in the data.**
- `investigator` → `scope="district"` (rbac). RLS then filters `district = 'Bengaluru Urban'` → **0 cases**. `login.tsx` logs everyone in as `investigator`, so the default demo user sees an empty database even though 100k rows are loaded.

### Best prompt

> In `backend/app/api/routes/auth.py`, the `_DEMO_STATIONS` map uses jurisdiction strings (`"Bengaluru Urban"`, `"Bengaluru Range"`) that do not exist in the synthetic dataset, so RLS filters out every row for district/range/station-scoped demo users. Update the demo defaults to real values from the dataset: district `"Bengaluru City"`, range `"Commissionerates"`. Also pick a `station_id` that actually exists in `Bengaluru City`. Keep the rank→scope/clearance mapping unchanged so RBAC masking still demos correctly.

### Code (`backend/app/api/routes/auth.py`)

```python
# Real district/range names that EXIST in the synthetic dataset.
# (district-scoped officers filter on `district`; range-scoped on `range`.)
_BLR = {"district": "Bengaluru City", "range": "Commissionerates"}

_DEMO_STATIONS: dict[str, dict] = {
    "PC":    {"station_id": 1,    **_BLR},
    "HC":    {"station_id": 1,    **_BLR},
    "ASI":   {"station_id": 1,    **_BLR},
    "SI":    {"station_id": 1,    **_BLR},
    "PSI":   {"station_id": 1,    **_BLR},
    "PI":    {"station_id": 1,    **_BLR},
    "CI":    {"station_id": 1,    **_BLR},
    "DySP":  {"station_id": None, **_BLR},
    "SP":    {"station_id": None, **_BLR},
    "DIG":   {"station_id": None, "district": "", "range": "Commissionerates"},
    "IGP":   {"station_id": None, "district": "", "range": ""},
    "DGP":   {"station_id": None, "district": "", "range": ""},
    # Legacy app-role aliases
    "admin":        {"station_id": None, "district": "", "range": ""},
    "investigator": {"station_id": 1,    **_BLR},
    "analyst":      {"station_id": None, "district": "", "range": ""},  # state scope → sees all
    "viewer":       {"station_id": 1,    **_BLR},
}
```

> **Verify station 1 is in Bengaluru City** (station IDs start at 0 in the generator). Run once after seeding:
> ```sql
> SELECT station_id, station_name, district FROM stations
> WHERE district = 'Bengaluru City' ORDER BY station_id LIMIT 5;
> ```
> Use one of those IDs for the station-scoped demo ranks. If none returns, set `station_id` to the first id from that query.

**Demo tip:** for a "show me the whole dataset" walkthrough, log in as `analyst` or `DGP` (state scope) — full 100k visible, masking still enforced by clearance. Use `PI`/`PSI`/`HC` to demo narrowing + masking.

---

## Issue 1 — CRITICAL: Map shows a hardcoded array, not the dataset

`frontend/src/components/CrimeMap.tsx` renders a baked-in `BENGALURU_HOTSPOTS` constant (8 fake Bengaluru zones). It never calls `api.mapHotspots`, so the map ignores the 100k-row dataset and ignores the filters in `map.tsx`.

**Real endpoint:** `POST /map/hotspots` → `HotspotResponse { mode, points: [{ lat, lng, weight, label }], total }` where `weight` is the raw case count per coordinate cluster.

### Best prompt

> Rewrite `frontend/src/components/CrimeMap.tsx` so it fetches live hotspots from `api.mapHotspots({ mode, crime_type, district })` instead of the hardcoded `BENGALURU_HOTSPOTS` array. Accept `crimeType` and `district` props from `map.tsx`, normalize the returned `weight` (raw count) into a 0–1 intensity for the Leaflet heat layer, and re-fetch when the mode/filters change. Keep the `heat` / `pins` / `grid` rendering. Show an empty-state when the API returns no points. Delete the `BENGALURU_HOTSPOTS` constant entirely.

### Code (`frontend/src/components/CrimeMap.tsx`)

```tsx
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api/client";

export type Hotspot = { lat: number; lng: number; weight: number; label: string; count: number };
type Mode = "heat" | "pins" | "grid";

export function CrimeMap({
  mode = "heat",
  crimeType,
  district,
}: {
  mode?: Mode;
  crimeType?: string;
  district?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);

  // 1) Fetch real hotspots from the backend (grounded in the seeded dataset).
  useEffect(() => {
    let active = true;
    api
      .mapHotspots({
        mode: "by_crime",
        ...(crimeType ? { crime_type: crimeType } : {}),
        ...(district ? { district } : {}),
      })
      .then((res: any) => {
        if (!active || !res?.points) return;
        const max = Math.max(1, ...res.points.map((p: any) => p.weight ?? 0));
        setHotspots(
          res.points.map((p: any) => ({
            lat: p.lat,
            lng: p.lng,
            count: Math.round(p.weight ?? 0),
            weight: (p.weight ?? 0) / max, // normalize raw count → 0..1 intensity
            label: p.label ?? "",
          })),
        );
      })
      .catch(() => active && setHotspots([]));
    return () => {
      active = false;
    };
  }, [crimeType, district]);

  // 2) Init Leaflet once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, { center: [12.9716, 77.5946], zoom: 7 });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // 3) Redraw the active layer whenever data or mode changes.
  useEffect(() => {
    const map = mapRef.current, L = LRef.current;
    if (!map || !L || !ready) return;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    if (hotspots.length === 0) return;

    if (mode === "heat") {
      const heat = (L as any).heatLayer(
        hotspots.map((h) => [h.lat, h.lng, h.weight]),
        { radius: 35, blur: 25, maxZoom: 14, max: 1.0,
          gradient: { 0.2: "#3b82f6", 0.4: "#fbbf24", 0.7: "#f97316", 1.0: "#ef4444" } },
      );
      const labels = L.layerGroup();
      hotspots.forEach((h) =>
        L.marker([h.lat, h.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#0a0a0a;color:#fff;padding:2px 8px;border:2px solid #0a0a0a;border-radius:5px;font-size:11px;font-weight:700;white-space:nowrap;">${h.label} · ${h.count}</div>`,
            iconSize: [0, 0], iconAnchor: [0, 0],
          }),
        }).addTo(labels),
      );
      layerRef.current = L.layerGroup([heat, labels]).addTo(map);
    } else if (mode === "pins") {
      const group = L.layerGroup();
      hotspots.forEach((h) =>
        L.circleMarker([h.lat, h.lng], {
          radius: 5 + h.weight * 12, color: "#0a0a0a", weight: 2,
          fillColor: "#ef4444", fillOpacity: 0.85,
        }).bindPopup(`<strong>${h.label}</strong><br/>${h.count} incidents`).addTo(group),
      );
      layerRef.current = group.addTo(map);
    } else {
      const group = L.layerGroup();
      const cell = 0.02;
      hotspots.forEach((h) =>
        L.rectangle([[h.lat - cell, h.lng - cell], [h.lat + cell, h.lng + cell]], {
          color: "#0a0a0a", weight: 2,
          fillColor: h.weight > 0.7 ? "#ef4444" : h.weight > 0.4 ? "#f97316" : "#fbbf24",
          fillOpacity: 0.55,
        }).bindPopup(`<strong>${h.label}</strong><br/>${h.count} incidents`).addTo(group),
      );
      layerRef.current = group.addTo(map);
    }
  }, [mode, ready, hotspots]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
}
```

**Also in `frontend/src/routes/map.tsx`:** pass the active filters down (`<CrimeMap mode={layer} crimeType={selectedCrimeType} district={selectedDistrict} />`) and **delete the hardcoded "Selected area / Whitefield zone" card** (FIRs 142, +12%, the static bars and 7-day sparkline) — or drive those numbers from the `total`/points the API returns. The crime-type and district `<Select>` options should be populated from real values (see Issue 7 note) rather than `Whitefield/Koramangala` zones.

---

## Issue 2 — CRITICAL: Network graph is a hardcoded constant

`frontend/src/routes/network.tsx` defines `const NODES = [...]` and `const EDGES = [...]` (S. Manjunath + 8 fake nodes). It never calls `api.network`. The node inspector (centrality 0.81, degree 8, "linked cases" FIR-2024-08842…) is also static.

**Real endpoint:** `POST /network/ego` → `EgoResponse { root, nodes: [{ id, label, kind, degree }], edges: [{ source, target, label }] }`. Input: `{ person_id, depth }`.

### Best prompt

> In `frontend/src/routes/network.tsx`, replace the hardcoded `NODES`/`EDGES` constants with live data from `api.network({ person_id, depth })`. Load the graph into state, assign each node an initial x/y layout position and a `group` index derived from its `kind` (person vs case), and feed that into the existing force-simulation. Drive `person_id` and `depth` from the "Seed entity" / "Depth" controls. Derive the node-inspector fields (degree, linked cases) from the fetched node/edges instead of static text. Keep the SVG render, physics, presets, and PNG/JSON export.

### Code (data layer for `network.tsx`)

```tsx
import { api } from "@/lib/api/client";

type RenderNode = { id: string; x: number; y: number; r: number; group: number; label: string; role?: string; kind?: string; degree?: number };
type Edge = [string, string];
const GROUP_FOR_KIND = (kind?: string) => (kind === "case" ? 1 : 0);

function NetworkScreen() {
  const t = useT();
  const [seedPersonId, setSeedPersonId] = useState("1"); // bind to the "Seed entity" input
  const [depth, setDepth] = useState(2);
  const [nodes, setNodes] = useState<RenderNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .network({ person_id: seedPersonId, depth })
      .then((res: any) => {
        if (!active || !res?.nodes) return;
        const N = res.nodes.length || 1;
        const mapped: RenderNode[] = res.nodes.map((n: any, i: number) => {
          const isRoot = String(n.id) === String(res.root);
          const angle = (i / N) * Math.PI * 2;
          return {
            id: String(n.id),
            label: n.label ?? String(n.id),
            kind: n.kind,
            degree: n.degree ?? 0,
            role: isRoot ? "seed" : undefined,
            group: isRoot ? 0 : GROUP_FOR_KIND(n.kind),
            r: isRoot ? 22 : 9 + Math.min(10, (n.degree ?? 0)),
            x: isRoot ? 50 : 50 + Math.cos(angle) * 30,
            y: isRoot ? 50 : 50 + Math.sin(angle) * 30,
          };
        });
        setNodes(mapped);
        setEdges(res.edges.map((e: any) => [String(e.source), String(e.target)] as Edge));
      })
      .catch(() => { if (active) { setNodes([]); setEdges([]); } })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [seedPersonId, depth]);

  // ...keep the existing force-sim / SVG / export code, but read from `nodes`/`edges`
  //    state instead of the deleted `NODES`/`EDGES` constants.
  //    Initialize `pos` from `nodes` (re-run when `nodes` changes), and pin the
  //    root node (role === "seed") as before.
}
```

- Delete the module-level `const NODES` / `const EDGES`.
- Bind the **Seed entity** input to `setSeedPersonId` (accept a numeric `person_id`) and **Depth** select to `setDepth`.
- In the node inspector, replace static `Centrality 0.81 / Degree 8` and the hardcoded `"FIR-2024-…"` linked-cases list with `node.degree` and the case-kind neighbors of the selected node from `edges`.

---

## Issue 3 — HIGH: Console "Results Canvas" + canned demo are fabricated

`frontend/src/routes/console.tsx`:
- ✅ The chat itself **is** wired (`streamChat` → `/chat/stream`).
- ❌ `getDefaultMessages()` seeds a fake "142 theft FIRs in Whitefield" conversation on first visit.
- ❌ `cannedFallback()` injects the same fabricated answer + citations when the backend is unreachable.
- ❌ The entire right-hand **Results Canvas** is hardcoded: stat cards `142 / 4.7 / 38`, and a static `By Station` table (`Whitefield PS 47 …`).

### Best prompt

> In `frontend/src/routes/console.tsx`: (1) make `getDefaultMessages()` return `[]` so new conversations start empty; (2) change `cannedFallback()` to show a neutral "backend unreachable" notice instead of fabricated FIR numbers/citations; (3) replace the hardcoded "Results Canvas" (the `142 / 4.7 / 38` stat cards and the static By-Station table) with a live panel that loads recent cases via `api.cases({ limit: 25 })` and renders real rows (FIR number, crime type, district, status). Keep the streaming chat logic intact.

### Code (Results Canvas → live cases)

```tsx
import { api } from "@/lib/api/client";

function ResultsCanvas() {
  const t = useT();
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let active = true;
    api.cases({ limit: 25 })
      .then((r: any) => active && setRows(Array.isArray(r) ? r : []))
      .catch(() => active && setErr(true));
    return () => { active = false; };
  }, []);

  return (
    <section className="flex-1 min-w-0 overflow-auto bg-background">
      <div className="border-b border-border bg-card px-6 py-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Results Canvas")}</div>
        <h3 className="text-sm font-semibold text-foreground">{t("Recent cases")} · {rows.length}</h3>
      </div>
      <div className="px-6 pb-6 pt-4">
        {err && <div className="text-sm text-muted-foreground">{t("Backend unreachable.")}</div>}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">{t("FIR")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("Crime type")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("District")}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t("Status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.case_id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-foreground">{c.fir_number}</td>
                  <td className="px-4 py-2.5 text-foreground">{c.crime_type}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.district}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.status}</td>
                </tr>
              ))}
              {rows.length === 0 && !err && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">{t("No cases in your jurisdiction.")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
```

```tsx
// getDefaultMessages: stop seeding a fake conversation
function getDefaultMessages(_t: (s: string) => string): ChatMessage[] {
  return [];
}

// cannedFallback: neutral, non-fabricated notice
const cannedFallback = () => {
  const aiText = t("I couldn't reach the backend just now. Please retry once the API is running.");
  const finalMessages: ChatMessage[] = [...baseMessages, { role: "ai", text: aiText }];
  setMessages(finalMessages);
  persistMessages(finalMessages);
  setStreamingIdx(null);
};
```

Update the example chips (currently `Thefts in Whitefield…`) to dataset-real prompts, e.g. `t("Theft cases in Bengaluru City this year")`, `t("Top crime types in Mysuru City")`.

---

## Issue 4 — CRITICAL: No cases browser; CaseDrawer is 100% hardcoded

`api.cases()` and `api.caseById()` exist in the client but **no route uses them**, and `frontend/src/components/CaseDrawer.tsx` renders a fixed `FIR-2024-08842` (static fields, masked persons, narrative). So the dataset's actual cases are never browsable.

**Real endpoints:** `GET /cases?crime_type&district&status&limit` → `list[CaseDetail-lite]`; `GET /cases/{case_id}` → masked `CaseDetail` (`persons[]`, `narrative`, `masked`, etc.).

### Best prompt

> Add a real Cases browser and wire the case drawer to live data. (1) Create `frontend/src/routes/cases.tsx` that lists cases from `api.cases({ limit })` with crime-type/district/status filters, and opens a case on click. (2) Rewrite `frontend/src/components/CaseDrawer.tsx` to accept a `caseId: number` prop and fetch `api.caseById(caseId)`, rendering real fields, the `persons[]` array (respecting each person's `masked` flag and the case-level `masked` flag), and the `narrative`. Remove all hardcoded FIR/persons/narrative content. Show a loading state while fetching.

### Code — new `frontend/src/routes/cases.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/cases")({ component: Cases });

function Cases() {
  const t = useT();
  const [rows, setRows] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filters, setFilters] = useState<{ crime_type?: string; district?: string; status?: string }>({});

  useEffect(() => {
    let active = true;
    const params: Record<string, string | number> = { limit: 100 };
    if (filters.crime_type) params.crime_type = filters.crime_type;
    if (filters.district) params.district = filters.district;
    if (filters.status) params.status = filters.status;
    api.cases(params).then((r: any) => active && setRows(Array.isArray(r) ? r : [])).catch(() => active && setRows([]));
    return () => { active = false; };
  }, [filters]);

  return (
    <Shell>
      <div className="p-6">
        <h1 className="text-xl font-semibold text-foreground mb-4">{t("Cases")} · {rows.length}</h1>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left">{t("FIR")}</th>
                <th className="px-3 py-2.5 text-left">{t("Crime type")}</th>
                <th className="px-3 py-2.5 text-left">{t("District")}</th>
                <th className="px-3 py-2.5 text-left">{t("Status")}</th>
                <th className="px-3 py-2.5 text-left">{t("Date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.case_id} className="cursor-pointer hover:bg-muted/30" onClick={() => setOpenId(c.case_id)}>
                  <td className="px-3 py-2 font-mono text-foreground">{c.fir_number}</td>
                  <td className="px-3 py-2 text-foreground">{c.crime_type}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.district}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.report_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CaseDrawer open={openId != null} caseId={openId ?? undefined} onClose={() => setOpenId(null)} />
    </Shell>
  );
}
```

### Code — rewritten `frontend/src/components/CaseDrawer.tsx`

```tsx
import { X, Lock, FileDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";

export function CaseDrawer({
  open, onClose, caseId,
}: { open: boolean; onClose: () => void; caseId?: number }) {
  const t = useT();
  const [tab, setTab] = useState<"summary" | "persons" | "map">("summary");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || caseId == null) return;
    let active = true;
    setLoading(true); setData(null);
    api.caseById(String(caseId))
      .then((d: any) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open, caseId]);

  if (!open) return null;
  const persons: any[] = data?.persons ?? [];

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-card shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Case")}</div>
            <h2 className="text-lg font-semibold text-foreground">{data?.fir_number ?? (loading ? t("Loading…") : "—")}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex gap-1 border-b border-border bg-muted/40 px-3">
          {(["summary", "persons", "map"] as const).map((tb) => (
            <button key={tb} onClick={() => setTab(tb)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition ${tab === tb ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t(tb)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {loading && <div className="text-sm text-muted-foreground">{t("Loading…")}</div>}

          {!loading && data && tab === "summary" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Crime type")} value={data.crime_type} />
                <Field label={t("Date")} value={data.report_date} />
                <Field label={t("Status")} value={data.status} status="warning" />
                <Field label={t("Station")} value={data.station_name ?? "—"} />
                <Field label={t("District")} value={data.district} />
                <Field label={t("Legal code")} value={data.legal_code} />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Sections")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {String(data.sections ?? "").split("|").filter(Boolean).map((s: string) => (
                    <span key={s} className="rounded-md bg-accent px-2 py-1 text-xs font-mono font-semibold text-accent-foreground">§ {s}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("Narrative")}</div>
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{data.narrative ?? "—"}</p>
              </div>
              {data.masked && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <Lock className="h-4 w-4 text-warning" /> {t("Some fields masked for your clearance level.")}
                </div>
              )}
            </>
          )}

          {!loading && data && tab === "persons" && (
            <div className="space-y-2">
              {persons.map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                  <div>
                    <div className={`text-sm font-medium ${p.masked ? "font-mono text-foreground/60" : "text-foreground"}`}>{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{t(p.role ?? "")}{p.age ? ` · ${p.age}` : ""}</div>
                  </div>
                  {p.masked && <Lock className="h-4 w-4 text-warning" />}
                </div>
              ))}
              {persons.length === 0 && <div className="text-sm text-muted-foreground">{t("No person records.")}</div>}
            </div>
          )}

          {!loading && data && tab === "map" && (
            <div className="text-sm text-foreground/80">
              <div className="font-medium">{data.place_of_offence ?? "—"}</div>
              <div className="text-xs text-muted-foreground">
                {data.latitude != null && data.longitude != null ? `${data.latitude}° N, ${data.longitude}° E` : t("Coordinates unavailable")} · {data.district}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border bg-muted/40 px-5 py-3">
          <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Plus className="h-4 w-4" /> {t("Add to report")}</button>
          <button className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"><FileDown className="h-4 w-4" /> {t("Export")}</button>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, status }: { label: string; value?: string; status?: "warning" | "success" }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${status === "warning" ? "text-warning-foreground" : status === "success" ? "text-success" : "text-foreground"}`}>{value ?? "—"}</div>
    </div>
  );
}
```

> Callers that open the drawer (`console.tsx`, `network.tsx`) should pass a real `caseId` (number) instead of relying on the old default FIR string. Add a "Cases" link to `Shell`'s nav.

---

## Issue 5 — HIGH: Reports cart + preview are hardcoded

`frontend/src/routes/reports.tsx` ✅ calls `api.buildReport(...)` but seeds a fixed 3-item cart and renders a fully static "Intelligence Brief — Whitefield Zone" document. The real `ReportResponse { report_id, title, sections: dict[], generated_at }` is ignored (only `report_id` is used in a toast).

### Best prompt

> In `frontend/src/routes/reports.tsx`, render the live `ReportResponse` returned by `api.buildReport(...)` instead of the hardcoded "Intelligence Brief — Whitefield Zone" document. Store the response in state and map `response.sections` (array of `{ title, body / rows / ... }`) into the preview pane. Replace the seeded cart items with cases the user actually added (e.g., from a shared selection store or `api.cases`). Keep the offline fallback but mark it clearly as a placeholder.

### Code (render real sections)

```tsx
const [report, setReport] = useState<any | null>(null);

async function handleGenerate() {
  setGenerating(true); setGenMsg(null);
  try {
    const caseIds = items.filter((i) => i.type === "case")
      .map((i) => i.title.match(/[0-9]+/)?.[0] ?? i.title); // pass numeric case_id
    const res: any = await api.buildReport({
      title: "Intelligence Brief",
      case_ids: caseIds,
      include_map: items.some((i) => i.type === "map"),
      include_network: false,
    });
    setReport(res);
    setGenMsg(t("Report ready") + ` · ${res?.report_id ?? "ok"}`);
  } catch {
    setReport(null);
    setGenMsg(t("Backend unreachable — nothing generated."));
  } finally { setGenerating(false); }
}

// Preview pane:
{report ? (
  <div className="px-10 py-8 space-y-6 text-[13px] leading-relaxed">
    <h1 className="text-xl font-bold">{report.title}</h1>
    <div className="text-[10px] text-muted-foreground">{t("Generated")}: {report.generated_at}</div>
    {report.sections?.map((s: any, i: number) => (
      <div key={i}>
        <h2 className="mb-2 text-[13px] font-bold text-foreground">{s.title ?? `Section ${i + 1}`}</h2>
        {typeof s.body === "string" && <p className="text-foreground/85 whitespace-pre-wrap">{s.body}</p>}
        {Array.isArray(s.rows) && (
          <table className="w-full text-[11px] border border-border">
            <tbody>{s.rows.map((r: any, j: number) => (
              <tr key={j} className="divide-x divide-border">{(Array.isArray(r) ? r : Object.values(r)).map((c: any, k: number) => <td key={k} className="px-2 py-1.5">{String(c)}</td>)}</tr>
            ))}</tbody>
          </table>
        )}
      </div>
    ))}
  </div>
) : (
  <div className="px-10 py-8 text-sm text-muted-foreground">{t("Generate a report to preview it here.")}</div>
)}
```

> Confirm the exact `sections` item shape in `backend/app/services/report_service.py` and match the keys above (`title`, `body`, `rows`).

---

## Issue 6 — MEDIUM: Audit screen has hardcoded chain count + drops role

`frontend/src/routes/audit.tsx` ✅ already fetches `api.audit({ limit: 100 })` and falls back to `DEMO_ROWS` (good pattern). Two small fixes:
- The header hardcodes **"VERIFIED · 18,432 entries"** and the footer **"Showing 10 of 18,432 entries"** — use the real `res.count`.
- The mapping sets `role: "—"` and `src: e.action` — acceptable, but show `res.count` and keep `chain_valid`.

### Best prompt

> In `frontend/src/routes/audit.tsx`, replace the hardcoded `18,432` entry counts in the header badge and footer with the real `count` returned by `api.audit(...)`. Keep the `DEMO_ROWS` offline fallback but only use it when the API call fails (not when it returns an empty list).

### Code

```tsx
const [count, setCount] = useState<number | null>(null);
// inside .then:
if (typeof res.count === "number") setCount(res.count);
// header: {chainValid === false ? t("CHAIN BROKEN") : `${t("VERIFIED")} · ${(count ?? rows.length).toLocaleString()} ${t("entries")}`}
// footer: {t("Showing")} {filteredRows.length} {t("of")} {(count ?? rows.length).toLocaleString()} · {t("Read-only")}
```

---

## Issue 7 — NOTE: marketing landing & filter option lists

- `frontend/src/routes/index.tsx` (landing) and the `login.tsx` left panel contain **marketing copy** (stats `98.2% / 4.5M+`, testimonials, the "Active Case · CR-2026-0418 / Live Demo" panel). This is **not case data** — it's fine to keep for a landing page. Optionally relabel the fake "Active Case" panel as an illustration. Not required for dataset wiring.
- Filter dropdowns in `map.tsx`, `audit.tsx`, `network.tsx` list **zone names** (`Whitefield`, `Koramangala`) and crime types that don't match the dataset's KSP districts/crime heads. Populate these from real distinct values (add small backend helpers, e.g. `GET /meta/districts`, `GET /meta/crime-types`, or derive from an initial `api.cases` page). Low priority but improves correctness.
- `login.tsx` hardcoded demo credentials (`r.kumar@ksp.gov.in` / `demopass`) are an **intentional** demo convenience — keep.

---

## Issue 8 — NOTE: API base URL + CORS

- Frontend calls `import.meta.env.VITE_API_BASE_URL` (default `http://localhost:8000`). Add `frontend/.env`:
  ```
  VITE_API_BASE_URL=http://localhost:8000
  ```
- Backend CORS uses `settings.cors_origin_list`. Ensure it includes the Vite dev origin (e.g. `http://localhost:3000` / `5173`) or the app's requests will be blocked:
  ```
  CORS_ORIGINS=http://localhost:5173,http://localhost:3000
  ```

---

## Run & verify checklist

```bash
# 1) Schema + data
psql "$DATABASE_URL" -f backend/migrations/001_init.sql
psql "$DATABASE_URL" -f backend/migrations/002_schema_v2.sql
cd backend && python -m seed.load_seed            # or --local
python -m seed.embed_narratives --local           # fills BGE-M3 vectors (RAG)

# 2) Confirm the demo jurisdiction matches real data (Issue 0)
psql "$DATABASE_URL" -c "SELECT count(*) FROM cases WHERE district='Bengaluru City';"   # must be > 0
psql "$DATABASE_URL" -c "SELECT station_id FROM stations WHERE district='Bengaluru City' ORDER BY station_id LIMIT 1;"

# 3) Backend
cd backend && uvicorn app.main:app --reload --port 8000

# 4) Frontend
cd frontend && echo 'VITE_API_BASE_URL=http://localhost:8000' > .env && npm run dev
```

**End-to-end smoke test (with the app running):**
1. Log in (default investigator now maps to `Bengaluru City`) → **Cases** lists real FIRs (Issue 0 + 4).
2. **Map** → heat/pins/grid reflect `/map/hotspots` across Karnataka (Issue 1).
3. **Network** → enter a `person_id`, graph loads from `/network/ego` (Issue 2).
4. **Console** → ask "theft cases in Bengaluru City this year"; canvas shows live cases; chat streams from `/chat/stream` (Issue 3).
5. Click a case → drawer shows real fields/persons/narrative with masking per clearance (Issue 4).
6. **Reports** → Generate renders `/reports/build` sections (Issue 5).
7. **Audit** → real entries + real count (Issue 6).
8. Switch login rank (PI vs DGP) → confirm row count narrows and PII masks (proves RLS + masking).

---

## Priority order

1. **Issue 0** (auth jurisdiction) — without it everything else still shows empty.
2. **Issue 4** (cases browser + drawer) — primary way the dataset is "shown."
3. **Issue 1, 2** (map, network) — the other data screens.
4. **Issue 3, 5** (console canvas, reports) — remove remaining fabricated content.
5. **Issue 6, 7, 8** (audit counts, option lists, env/CORS) — polish.


---

# Part C — Issue 9: Merge the Map into the Console dashboard (remove the standalone Map screen)

**Requested change:** delete the separate `/map` screen and surface the same hotspot map *inside the Console* (the dashboard / Results Canvas), keeping the exact "By Station" table UI you pasted. Everything must be wired to the live backend (no mock arrays).

## What the Console becomes

The Console keeps its left conversation rail. The right **Results Canvas** gets a two-tab switch:

- **Data** tab → the exact `By Station` table from your screenshot (STATION · FIRS · CLEARED · TREND (30d) · TOP IPC) + the 3 stat cards, **now driven by live Postgres**.
- **Map** tab → the former Map screen (heat / pins / grid layers, crime/offender view, legend, live "top hotspot" card) rendered in the same canvas.

A shared filter bar (crime type + district) drives **both** the table and the map from one fetch.

## Files touched

| File | Change |
|---|---|
| `backend/app/schemas/map.py` | **add** `StationBreakdownRequest` / `StationRow` / `StationBreakdownResponse` |
| `backend/app/services/map_service.py` | **add** `station_breakdown()` (RLS-scoped aggregate that returns the exact table columns) |
| `backend/app/api/routes/map.py` | **add** `POST /map/station-breakdown` |
| `frontend/src/lib/api/client.ts` | **add** typed `HotspotResponse`, `StationRow`, `stationBreakdown()` |
| `frontend/src/components/CrimeMap.tsx` | **rewrite** — render live `points` prop, delete `BENGALURU_HOTSPOTS` mock |
| `frontend/src/routes/console.tsx` | **rewrite Results Canvas** into tabbed Data/Map, wired to the API |
| `frontend/src/components/Shell.tsx` | **remove** Map from the rail nav + repoint voice "map" intent to the Console |
| `frontend/src/routes/map.tsx` | **delete** |
| `frontend/src/routeTree.gen.ts` | regenerated (drop `/map`) |

---

## 9.0 — Best prompt (paste this to your coding agent)

> In the Satyam frontend, remove the standalone Map screen and move the hotspot map into the Console's Results Canvas, while keeping the exact "By Station" table UI. Requirements:
> 1. **Backend:** add `POST /map/station-breakdown` returning, per police station (RLS-scoped, ordered by FIR count desc, limit 25): `station`, `firs` (count), `cleared` (count where `charge_sheeted`), `top_legal_code` (statistical mode of `legal_code`), and `trend` (7-bucket sparkline of that station's FIRs across its date range). Reuse the same `crime_type`/`district` filters as `/map/hotspots` and gate it with `Permission.RUN_ANALYTICS`.
> 2. **API client:** add typed `HotspotResponse` and `StationBreakdownResponse`, plus `api.stationBreakdown(body)`.
> 3. **CrimeMap.tsx:** delete the hardcoded `BENGALURU_HOTSPOTS`; accept a `points: Hotspot[]` prop, normalize `weight` by the max for heat intensity, and `fitBounds` to the returned points (fallback to Karnataka center).
> 4. **console.tsx:** add a `Data`/`Map` tab switch in the Results Canvas. On mount and whenever the crime-type/district/view filters change, call `api.mapHotspots` + `api.stationBreakdown` in parallel and render the table + map from the responses. Derive the 3 stat cards (Total FIRs, Avg/day, Cleared %) from the station rows. Keep the exact table columns and styling from the screenshot. Clicking a station sends a grounded console query for that station.
> 5. **Shell.tsx:** remove the Map item from the left rail and repoint the voice "map/hotspot" intent to `/console` (open the Map tab via a sessionStorage flag).
> 6. Delete `src/routes/map.tsx` and let TanStack Router regenerate `routeTree.gen.ts`.
> Do not leave any hardcoded Bengaluru/Whitefield arrays. Verify `npm run build` passes and the map + table populate from the live API.

---

## 9.1 — Backend: schema (`backend/app/schemas/map.py`)

Append to the existing file:

```python
class StationBreakdownRequest(BaseModel):
    mode: Literal["by_crime", "by_offender"] = "by_crime"
    crime_type: Optional[str] = None
    district: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    limit: int = 25


class StationRow(BaseModel):
    station: str
    firs: int
    cleared: int
    top_legal_code: Optional[str] = None
    trend: list[int] = []


class StationBreakdownResponse(BaseModel):
    rows: list[StationRow] = []
    total: int = 0
```

## 9.2 — Backend: service (`backend/app/services/map_service.py`)

Add alongside the existing `hotspots()` (note the updated import line):

```python
from sqlalchemy import text
from app.schemas.map import (
    HotspotPoint, HotspotRequest, HotspotResponse,
    StationBreakdownRequest, StationRow, StationBreakdownResponse,
)


def _filters(req) -> tuple[str, dict]:
    """Shared WHERE fragment for crime_type / district / date range."""
    clauses, params = ["station_name IS NOT NULL"], {}
    if req.crime_type:
        clauses.append("crime_type ILIKE :ct"); params["ct"] = f"%{req.crime_type}%"
    if req.district:
        clauses.append("district ILIKE :d");     params["d"]  = f"%{req.district}%"
    if getattr(req, "date_from", None):
        clauses.append("report_date >= :df");     params["df"] = req.date_from
    if getattr(req, "date_to", None):
        clauses.append("report_date <= :dt");     params["dt"] = req.date_to
    return " AND ".join(clauses), params


async def station_breakdown(
    session: AsyncSession, req: StationBreakdownRequest
) -> StationBreakdownResponse:
    where, params = _filters(req)

    agg_sql = text(
        f"""
        SELECT station_name                                      AS station,
               count(*)                                          AS firs,
               count(*) FILTER (WHERE charge_sheeted)            AS cleared,
               mode() WITHIN GROUP (ORDER BY legal_code)          AS top_legal_code
        FROM cases
        WHERE {where}
        GROUP BY station_name
        ORDER BY firs DESC
        LIMIT :limit
        """
    )
    rows = [
        dict(r)
        for r in (await session.execute(agg_sql, {**params, "limit": req.limit}))
        .mappings().all()
    ]
    stations = [r["station"] for r in rows]

    # 7-bucket trend sparkline per station (spread across that station's date range)
    trend_map: dict[str, list[int]] = {s: [0] * 7 for s in stations}
    if stations:
        trend_sql = text(
            f"""
            WITH base AS (
                SELECT station_name, report_date,
                       min(report_date) OVER (PARTITION BY station_name) AS mn,
                       max(report_date) OVER (PARTITION BY station_name) AS mx
                FROM cases
                WHERE station_name = ANY(:stations)
                  AND report_date IS NOT NULL
                  AND {where}
            )
            SELECT station_name,
                   LEAST(6, GREATEST(0, floor(
                       CASE WHEN mx = mn THEN 0
                            ELSE 6.0 * (report_date - mn) / NULLIF(mx - mn, 0)
                       END)))::int                AS bucket,
                   count(*)                        AS n
            FROM base
            GROUP BY station_name, bucket
            """
        )
        for r in (
            await session.execute(trend_sql, {**params, "stations": stations})
        ).mappings().all():
            trend_map[r["station_name"]][int(r["bucket"])] = int(r["n"])

    out = [
        StationRow(
            station=r["station"],
            firs=int(r["firs"]),
            cleared=int(r["cleared"] or 0),
            top_legal_code=r["top_legal_code"],
            trend=trend_map.get(r["station"], [0] * 7),
        )
        for r in rows
    ]
    return StationBreakdownResponse(rows=out, total=len(out))
```

> **Why this powers the exact table:** `cleared` = `count(*) FILTER (WHERE charge_sheeted)`, `Top IPC` = `mode() WITHIN GROUP (ORDER BY legal_code)`, and the `trend` array feeds the sparkline column. RLS on the scoped session already limits which stations are visible — no extra masking needed for aggregates.

## 9.3 — Backend: route (`backend/app/api/routes/map.py`)

```python
from app.schemas.map import (
    HotspotRequest, HotspotResponse,
    StationBreakdownRequest, StationBreakdownResponse,
)


@router.post("/station-breakdown", response_model=StationBreakdownResponse)
async def station_breakdown(
    req: StationBreakdownRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> StationBreakdownResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return await map_service.station_breakdown(session, req)
```

> No `main.py` change needed — it lives under the already-registered `/map` router.

---

## 9.4 — Frontend: API client (`frontend/src/lib/api/client.ts`)

Add the types and method (and type the existing `mapHotspots` return):

```ts
export type HotspotPoint = { lat: number; lng: number; weight: number; label?: string | null };
export type HotspotResponse = { mode: string; points: HotspotPoint[]; total: number };

export type StationRow = {
  station: string;
  firs: number;
  cleared: number;
  top_legal_code: string | null;
  trend: number[];
};
export type StationBreakdownResponse = { rows: StationRow[]; total: number };
```

Inside the `api` object, replace `mapHotspots` and add `stationBreakdown`:

```ts
  mapHotspots(body: Record<string, unknown>): Promise<HotspotResponse> {
    return request("/map/hotspots", { method: "POST", body: JSON.stringify(body) });
  },
  stationBreakdown(body: Record<string, unknown>): Promise<StationBreakdownResponse> {
    return request("/map/station-breakdown", { method: "POST", body: JSON.stringify(body) });
  },
```

## 9.5 — Frontend: `frontend/src/components/CrimeMap.tsx` (FULL REWRITE — live data)

```tsx
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type Hotspot = {
  lat: number;
  lng: number;
  weight: number;      // raw count from the backend
  label?: string;
};

type Mode = "heat" | "pins" | "grid";

const KARNATAKA_CENTER: [number, number] = [14.5, 75.7];

export function CrimeMap({ points, mode = "heat" }: { points: Hotspot[]; mode?: Mode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // init once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, { center: KARNATAKA_CENTER, zoom: 7 });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "\u00a9 OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // (re)draw whenever points or mode change
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !ready) return;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    if (!points.length) return;

    const maxW = Math.max(...points.map((p) => p.weight), 1);
    const norm = (w: number) => Math.max(0.15, w / maxW);

    let group: any;
    if (mode === "heat") {
      const heat = (L as any).heatLayer(
        points.map((h) => [h.lat, h.lng, norm(h.weight)]),
        { radius: 35, blur: 28, maxZoom: 14, max: 1.0,
          gradient: { 0.2: "#3b82f6", 0.4: "#fbbf24", 0.7: "#f97316", 1.0: "#ef4444" } },
      );
      group = L.layerGroup([heat]);
    } else if (mode === "pins") {
      group = L.layerGroup();
      points.forEach((h) => {
        L.circleMarker([h.lat, h.lng], {
          radius: 5 + norm(h.weight) * 12,
          color: "#0a0a0a", weight: 2, fillColor: "#ef4444", fillOpacity: 0.85,
        }).bindPopup(`<strong>${h.label ?? "Area"}</strong><br/>${Math.round(h.weight)} incidents`).addTo(group);
      });
    } else {
      group = L.layerGroup();
      const cell = 0.02;
      points.forEach((h) => {
        const w = norm(h.weight);
        L.rectangle([[h.lat - cell, h.lng - cell], [h.lat + cell, h.lng + cell]], {
          color: "#0a0a0a", weight: 1,
          fillColor: w > 0.7 ? "#ef4444" : w > 0.4 ? "#f97316" : "#fbbf24",
          fillOpacity: 0.5,
        }).bindPopup(`<strong>${h.label ?? "Area"}</strong><br/>${Math.round(h.weight)} incidents`).addTo(group);
      });
    }
    group.addTo(map);
    layerRef.current = group;

    try {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    } catch { /* ignore */ }
  }, [points, mode, ready]);

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />;
}
```

## 9.6 — Frontend: `frontend/src/routes/console.tsx`

**(a) Imports** — add to the top:

```tsx
import { Map as MapIcon, Layers, Filter } from "lucide-react";
import { CrimeMap, type Hotspot } from "@/components/CrimeMap";
import { api, type StationRow } from "@/lib/api/client";
```

**(b) Remove the demo seed** (cross-ref Issue 3): make `getDefaultMessages` return `[]` and drop the `cannedFallback()` fabricated text, so the canvas reflects only live data.

**(c) Canvas state + fetch** — add near the other `useState` hooks inside `Console()`:

```tsx
  const [canvasTab, setCanvasTab] = useState<"data" | "map">("data");
  const [mapMode, setMapMode] = useState<"heat" | "pins" | "grid">("heat");
  const [mapView, setMapView] = useState<"crime" | "offender">("crime");
  const [crimeType, setCrimeType] = useState("");
  const [district, setDistrict] = useState("");
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasErr, setCanvasErr] = useState<string | null>(null);

  // Open the Map tab if a voice "show map" intent routed us here.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("satyam:open-canvas") === "map") {
        sessionStorage.removeItem("satyam:open-canvas");
        setCanvasTab("map");
      }
    } catch {}
  }, []);

  // Live canvas data: hotspots (map) + station breakdown (table) from one filter set.
  useEffect(() => {
    let cancelled = false;
    setCanvasLoading(true);
    setCanvasErr(null);
    const body: Record<string, unknown> = {
      mode: mapView === "offender" ? "by_offender" : "by_crime",
    };
    if (crimeType) body.crime_type = crimeType;
    if (district) body.district = district;
    (async () => {
      try {
        const [hot, brk] = await Promise.all([
          api.mapHotspots(body),
          api.stationBreakdown({ ...body, limit: 25 }),
        ]);
        if (cancelled) return;
        setHotspots((hot.points || []).map((p) => ({
          lat: p.lat, lng: p.lng, weight: p.weight, label: p.label ?? undefined,
        })));
        setStations(brk.rows || []);
      } catch {
        if (!cancelled) {
          setCanvasErr("Couldn't load live data — check that you're signed in and the API is reachable.");
          setHotspots([]); setStations([]);
        }
      } finally {
        if (!cancelled) setCanvasLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mapView, crimeType, district]);

  const totalFirs = stations.reduce((s, r) => s + r.firs, 0);
  const totalCleared = stations.reduce((s, r) => s + r.cleared, 0);
  const clearedPct = totalFirs ? Math.round((totalCleared / totalFirs) * 100) : 0;
  const avgPerDay = (totalFirs / 30).toFixed(1);
```

**(d) Replace the entire `Results Canvas` `<section> … </section>`** with:

```tsx
        {/* Results Canvas */}
        <section className="flex flex-1 min-w-0 flex-col overflow-hidden bg-background">
          <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Results Canvas")}</div>
              <h3 className="text-sm font-semibold text-foreground">
                {(crimeType || district)
                  ? `${crimeType || t("All crimes")} \u00b7 ${district || t("All districts")}`
                  : t("Crime overview \u00b7 live")}
              </h3>
            </div>
            <div className="flex rounded-md border border-border bg-muted/40 p-0.5">
              {([["data", t("Data")], ["map", t("Map")]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setCanvasTab(v as "data" | "map")}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition ${canvasTab === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {v === "map"
                    ? <span className="inline-flex items-center gap-1"><MapIcon className="h-3.5 w-3.5" />{l}</span>
                    : l}
                </button>
              ))}
            </div>
          </div>

          {/* Shared filter bar (drives table + map) */}
          <div className="flex items-center gap-2 border-b border-border bg-card/60 px-6 py-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select value={crimeType} onChange={(e) => setCrimeType(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 text-xs">
              <option value="">{t("All crime types")}</option>
              {["Theft", "Burglary", "Assault", "Cyber Crime", "Narcotics", "Murder"].map((c) => (
                <option key={c} value={c}>{t(c)}</option>
              ))}
            </select>
            <select value={district} onChange={(e) => setDistrict(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 text-xs">
              <option value="">{t("All districts")}</option>
              {["Bengaluru City", "Bengaluru Dist", "Mysuru City", "Mangaluru City", "Hubballi Dharwad City", "Belagavi City"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {canvasLoading && <span className="text-[11px] text-muted-foreground">{t("Loading\u2026")}</span>}
            {canvasErr && <span className="text-[11px] text-destructive">{canvasErr}</span>}
          </div>

          {canvasTab === "data" ? (
            <div className="flex-1 overflow-auto">
              <div className="grid grid-cols-3 gap-4 p-6">
                <Stat label={t("Total FIRs")} value={String(totalFirs)} delta={`${stations.length} ${t("stations")}`} trend="flat" />
                <Stat label={t("Avg / day")} value={avgPerDay} delta="" trend="flat" />
                <Stat label={t("Cleared")} value={String(totalCleared)} delta={`${clearedPct}%`} trend="flat" />
              </div>
              <div className="px-6 pb-6">
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs">
                    <div className="font-medium text-foreground">{t("By Station")}</div>
                    <div className="text-muted-foreground">{stations.length} {t("rows")}{canvasLoading ? " \u00b7 " + t("streaming\u2026") : ""}</div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Station")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("FIRs")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Cleared")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Trend (30d)")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("Top IPC")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {stations.length === 0 && !canvasLoading && (
                        <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t("No data for this scope.")}</td></tr>
                      )}
                      {stations.map((r) => (
                        <tr key={r.station} className="hover:bg-muted/30 cursor-pointer"
                          onClick={() => sendMessage(`${t("Show cases in")} ${r.station}`)}>
                          <td className="px-4 py-2.5 font-medium text-foreground">{r.station}</td>
                          <td className="px-4 py-2.5 text-foreground">{r.firs}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.cleared}</td>
                          <td className="px-4 py-2.5"><Spark data={r.trend} /></td>
                          <td className="px-4 py-2.5">
                            {r.top_legal_code
                              ? <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-mono font-semibold text-accent-foreground">\u00a7 {r.top_legal_code}</span>
                              : <span className="text-muted-foreground">\u2014</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {t("Live from Postgres (RLS-scoped). Click a station to drill into its FIRs.")}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 min-h-[420px]">
              {/* layer + view controls */}
              <div className="absolute left-4 top-4 z-[400] flex items-center gap-2">
                <div className="flex rounded-md border border-border bg-card/95 p-0.5 shadow">
                  {(["crime", "offender"] as const).map((v) => (
                    <button key={v} onClick={() => setMapView(v)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition ${mapView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      {v === "crime" ? t("By crime type") : t("By offender")}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow">
                  <Layers className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                  {(["heat", "pins", "grid"] as const).map((l) => (
                    <button key={l} onClick={() => setMapMode(l)}
                      className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition ${mapMode === l ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}>
                      {t(l)}
                    </button>
                  ))}
                </div>
              </div>

              <CrimeMap points={hotspots} mode={mapMode} />

              {/* legend */}
              <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 font-medium text-foreground">{t("Intensity")}</div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-32 rounded-full" style= background: "linear-gradient(90deg,#3b82f6,#fbbf24,#f97316,#ef4444)"  />
                  <span className="text-muted-foreground">{t("low \u2192 high")}</span>
                </div>
              </div>

              {/* live top-hotspot card */}
              {stations[0] && (
                <div className="absolute right-6 top-6 z-[400] w-80 rounded-xl border border-border bg-card/95 backdrop-blur p-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("Top hotspot")}</div>
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">{t("live")}</span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{stations[0].station}</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Mini label={t("FIRs")} value={String(stations[0].firs)} />
                    <Mini label={t("Cleared")} value={String(stations[0].cleared)} />
                    <Mini label={t("Top IPC")} value={stations[0].top_legal_code ? "\u00a7 " + stations[0].top_legal_code : "\u2014"} />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t("Trend")}</div>
                    <Spark data={stations[0].trend} />
                  </div>
                  <button onClick={() => sendMessage(`${t("Summarize crime around")} ${stations[0].station}`)}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition">
                    <Sparkles className="h-3.5 w-3.5" /> {t("Ask AI about this area")}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
```

**(e) Helper components** — add at the bottom of `console.tsx` (next to `Stat`):

```tsx
function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-0.5 h-5">
      {data.map((v, i) => (
        <div key={i} className="w-1.5 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
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
```

## 9.7 — Frontend: `frontend/src/components/Shell.tsx` (remove the Map screen)

**(a) Rail nav** — delete the Map entry from `NAV`:

```tsx
  const NAV = [
    { to: "/console", icon: MessageSquare, label: t("Console") },
    // removed: { to: "/map", icon: MapIcon, label: t("Map") },
    { to: "/network", icon: Network, label: t("Network") },
    { to: "/reports", icon: FileText, label: t("Reports") },
    { to: "/audit", icon: ShieldCheck, label: t("Audit") },
    { to: "/transcripts", icon: ClipboardList, label: t("Transcripts") },
  ] as const;
```

**(b) Voice routing** — repoint the map intent to the Console and open the Map tab. In `SCREEN_ROUTES`, change the `/map` line to target `/console`:

```tsx
  // was: { to: "/map", words: /(map|hotspot|heat ?map|geospatial)|\u0CA8\u0C95\u0CCD\u0CB7\u0CC6/i },
  { to: "/console", words: /(map|hotspot|heat ?map|geospatial)|\u0CA8\u0C95\u0CCD\u0CB7\u0CC6/i },
```

Then, in the voice `handle()` function, set the canvas flag when a map intent routes to the Console. Just before the `// 1) Pure navigation` block, add:

```tsx
      // Map intent now lives inside the Console: flag the canvas to open the Map tab.
      if (/(map|hotspot|heat ?map|geospatial)|\u0CA8\u0C95\u0CCD\u0CB7\u0CC6/i.test(cmd.query)) {
        try { sessionStorage.setItem("satyam:open-canvas", "map"); } catch {}
      }
```

The `/map` key in `NAV_LABEL` can be removed and the now-unused `Map as MapIcon` import dropped from `Shell.tsx` (it's used in the Console instead).

## 9.8 — Delete the route + regenerate

```bash
rm frontend/src/routes/map.tsx
cd frontend && npm run dev     # TanStack Router plugin regenerates routeTree.gen.ts
```

If you don't run the dev server / codegen, manually edit `frontend/src/routeTree.gen.ts` and remove every `Map`/`/map` reference: the `MapRouteImport` import, the `MapRoute` const, the `'/map'` entries in `FileRoutesByFullPath` / `FileRoutesByTo` / `FileRoutesById` / `fullPaths` / `to` / `id`, the `MapRoute` line in `RootRouteChildren` + `rootRouteChildren`, and the `'/map'` block in `declare module`.

---

## 9.9 — End-to-end wiring map (after this change)

```
Console (Results Canvas)
  ├─ filter bar (crime_type, district, crime/offender)
  │     │
  │     ├─ Data tab  → api.stationBreakdown → POST /map/station-breakdown
  │     │                → map_service.station_breakdown → RLS session → cases (agg + trend)
  │     │                → By Station table + Total/Avg/Cleared stat cards
  │     │
  │     └─ Map tab   → api.mapHotspots      → POST /map/hotspots
  │                      → map_service.hotspots → analytics.hotspots → cases (lat/lng agg)
  │                      → CrimeMap (heat/pins/grid) + legend + live top-hotspot card
  └─ click station / "Ask AI" → sendMessage() → existing /chat/stream pipeline
```

Both endpoints run through the same `get_scoped_session` (RLS) + `RUN_ANALYTICS` gate as the rest of the app — so the merged dashboard honors jurisdiction scope and clearance automatically. **Remember Issue 0:** a district-scoped demo identity must use a real dataset district (e.g. `Bengaluru City`) or these panels render empty even though they're wired correctly.

## 9.10 — Verify

```bash
# backend
cd backend && uvicorn app.main:app --reload
# new endpoint should return rows for a state-scope token:
# curl -s -X POST localhost:8000/map/station-breakdown -H "authorization: Bearer <token>" \
#   -H "content-type: application/json" -d '{"mode":"by_crime","limit":25}' | jq

# frontend
cd frontend && npm run build && npm run dev
# 1. Map item is gone from the left rail.
# 2. /map now 404s (route deleted); voice "open the map" lands on Console + Map tab.
# 3. Console Data tab shows the By Station table populated from Postgres.
# 4. Console Map tab shows heat/pins/grid hotspots; layers + filters update both tabs.
```
