# Satyam — Fix Verification, Architecture Gaps & Backend↔Frontend Wiring Audit

> **Scope of this pass (Request 11).** A fresh `Satyam_Ai-main.zip` was re‑extracted and audited file‑by‑file. This document answers four questions:
> 1. Are **all** previously‑documented bug fixes actually applied in this build? (deep verification)
> 2. Are there **any other / new bugs**?
> 3. What is described in **`docs/ARCHITECTURE.md`** but **not implemented / not wired** yet?
> 4. What is **coded in the backend** but **not pointed to the frontend** yet?
>
> Companion docs already delivered: `SATYAM_BUG_SCAN_AND_FIXES.md`, `SATYAM_CHAT_NO_DATA_FIX.md`, `SATYAM_DEEP_BUG_SCAN.md`, `SATYAM_MISSING_FEATURES_BUILD_SPEC.md`. This file is the **verification + gap‑closure** layer and contains the new drop‑in code.

---

## 0. Executive Verdict

| Area | Item | Status in this build |
|---|---|---|
| Chat "no data" | Deterministic `rule_sql.py` + demo‑mode grounded render | ✅ **APPLIED & CORRECT** |
| Deep scan | D1 — Socio demographics filters | ✅ APPLIED |
| Deep scan | D2 — Socio correlation uses real table + Pearson | ✅ APPLIED |
| Deep scan | D3 — Trends real QoQ / YoY deltas | ✅ APPLIED |
| Deep scan | D4 — Seasonal true lift vs baseline | ✅ APPLIED |
| Deep scan | D5 — Demo‑mode echo bypass (all lanes) | ✅ APPLIED |
| Deep scan | D6 — Console graceful backend‑unreachable msg | ✅ APPLIED |
| Deep scan | D7 — Audit `user_id` from officer claim | ✅ APPLIED |
| Deep scan | D8 — Forecast patrol window uses `incident_time` | ✅ APPLIED |
| Deep scan | D9 — Similar‑cases empty‑on‑no‑match | ✅ APPLIED |
| Feature A | Financial money‑trail (backend + UI sub‑tab) | ✅ APPLIED & WIRED |
| Feature C | Offender browse `/offenders` + picker | ✅ APPLIED & WIRED |
| Feature D | **PDF export of conversation history** | ❌ **NOT APPLIED** (code in §5.4) |
| Architecture gap | PS2 **ring detection** UI | ❌ backend coded, **no UI** (§5.1) |
| Architecture gap | `/api/cases/similar/search` (search by description) | ❌ coded, **no UI** (§5.2) |
| Architecture gap | `/api/network/case/{id}` & `/api/network/person/{id}` | ⚠️ coded, **not wired** (§4) |
| Doc/impl mismatch | PS7 "financial via Text‑to‑SQL" | ⚠️ **false** — `financial_*` not allow‑listed (§5.3) |
| New bug | `/voice/translate` coded, **never called** | ⚠️ dead endpoint (§3.1) |
| New bug | `RingNode.community_id` populated but never surfaced | ⚠️ minor (§3.2) |

**Bottom line:** every previously‑written fix (chat + D1–D9 + Features A & C) is present and correct in this build. The remaining work is **closing the gap between a feature‑rich backend and the screens that should expose it** — plus the one not‑yet‑applied feature (PDF export of conversation history).

---

## 1. Verification — Prior Fixes ARE Applied (evidence)

Each fix was confirmed by reading the actual source in the fresh zip, not by trusting filenames.

### 1.1 Chat "Found no matching records" fix — ✅ applied & correct
- `backend/app/pipeline/tools/rule_sql.py` exists (156 lines) and is imported + used in `text_to_sql.py` (`build_rule_sql`) at three points: pre‑LLM in demo mode, on `UnsafeSQL` recovery, and on 0‑row recovery.
- `orchestrator._compose()` short‑circuits to `_render_grounded()` when `get_settings().demo_mode` is true.
- **`demo_mode` default is `True`**: `config.py` → `demo_mode = not (gemini_api_key or groq_api_key)` and `.env.example` ships both keys empty. So the deterministic path **is** the one a judge hits on a clean checkout.
- **Column correctness confirmed:** `rule_sql.py` selects `crime_type, status, station_name, district, "range", crime_category` directly from `cases`. The `Case` model (`db/models.py`) is **denormalized** and really has all of these columns — so the generated SQL will not throw a "column does not exist" error. ✅

> ⚠️ **Residual data caveat (not a code bug):** if the connected DB (Neon cloud is the default `database_url`) is **not seeded**, the deterministic query runs fine but returns 0 rows → the user still sees *"Found no matching records."* Verify seeding with the row‑count check in §3.3 before judging. The `financial_*`, `cases`, etc. seeders exist (`backend/seed/load_neon_60pct.py`, `load_new_tables.py`).

### 1.2 Deep‑scan D1–D9 — ✅ all applied
- **D1** `intelligence_service.get_socio_demographics()` now joins `persons → case_persons → cases` and applies `crime_type` / `district` filters (marked `# D1 FIX`).
- **D2** `get_socio_correlation()` joins the real `district_socio_economic_indicators` table and computes a real Pearson `_pearson()` (marked `# D2 FIX`).
- **D3** `get_trends()` collapses to one count per period then computes real `qoq_percent` / `yoy_percent` (marked `# D3 FIX`).
- **D4** `get_seasonal()` computes `lift_pct` vs a per‑combo `AVG` CTE (marked `# D4 FIX`).
- **D5** demo‑mode echo bypass present in both `text_to_sql.generate_sql()` and `orchestrator._compose()`.
- **D6** `console.tsx` shows `"I couldn't reach the backend just now…"` instead of crashing.
- **D7** `core/audit.write_audit(user_id=…)` is called everywhere with `principal.officer_id`.
- **D8** `get_forecast_alerts()` derives `avg_hour` from `incident_time` via `split_part(...)::int` (marked `# D8 FIX`).
- **D9** `get_similar_cases()` returns `matches=[]` when the source case id is missing (no more "similar to case #1").

### 1.3 Feature A — Financial money‑trail — ✅ applied & wired
- Backend: `schemas/financial.py`, `services/financial_service.py` (BFS over `financial_transactions` with **correct `expanding=True` bindparams**), `api/routes/financial.py` (`POST /financial/money-trail`, clearance L2+, audit‑logged), mounted in `main.py` at `prefix="/financial"`.
- Frontend: `lib/api/financial.ts` client + `components/FinancialLinksPanel.tsx` + a **People / Financial** sub‑tab in `routes/network.tsx`.

### 1.4 Feature C — Offender browse — ✅ applied & wired
- Backend: `GET /api/offenders` (`list_offenders`, clearance L2+) + `OffenderListResponse` schema.
- Frontend: `intelligence.listOffenders()` + `OffenderPicker` dropdown in `routes/profile.$personId.tsx`.

---

## 2. Backend↔Frontend Wiring Matrix

Every backend route was cross‑checked against actual frontend call‑sites (including template‑literal paths).

| Backend endpoint | Frontend caller | Wired? |
|---|---|---|
| `POST /chat/stream` | `client.streamChat` ← `console.tsx` | ✅ |
| `GET /cases`, `GET /cases/{id}`, `GET /cases/search` | `client.ts` / `searchPersonsAndCases` | ✅ |
| `POST /map/hotspots` `/station-breakdown` `/offender-trail` | console / map | ✅ |
| `POST /network/ego` | `network.tsx` | ✅ |
| `POST /financial/money-trail` | `FinancialLinksPanel` | ✅ |
| `GET /api/offenders` | `OffenderPicker` | ✅ |
| `GET /api/persons/{id}/profile` `/timeline` | profile screen | ✅ |
| `GET /api/cases/{id}/similar` `/timeline` | CaseDrawer | ✅ |
| `GET /api/trends` `/trends/seasonal` `/mo/clusters` | trends screen | ✅ |
| `GET /api/socio/*` | socio screen | ✅ |
| `GET /api/forecast/*` | forecast screen | ✅ |
| `POST /reports/build`, `GET /audit`, `POST /settings/db-source` | reports / audit / settings | ✅ |
| `POST /voice/tts`, `POST /voice/stt` | voice recorder / Shell | ✅ |
| **`GET /api/network/rings`** | client fn exists, **0 call‑sites** | ❌ |
| **`GET /api/network/case/{id}`** | client fn exists, **0 call‑sites** | ❌ |
| **`GET /api/network/person/{id}`** | client fn exists, **0 call‑sites** | ❌ |
| **`POST /api/cases/similar/search`** | client fn exists, **0 call‑sites** | ❌ |
| **`POST /voice/translate`** | **no client fn, 0 call‑sites** | ❌ |

> The four `intelligence.*` client functions (`getNetworkRings`, `getCaseNetwork`, `getPersonNetwork`, `searchSimilarCases`) are declared in `lib/api/intelligence.ts` but have **zero usages** anywhere in `frontend/src`.

---

## 3. New / Other Bugs Found This Pass

### 3.1 `/voice/translate` is a dead endpoint (LOW)
`backend/app/api/routes/voice.py` exposes `POST /voice/translate`, but no frontend code calls it (the only `translate` matches in `frontend/src` are Tailwind `translate-x`/`translate-y` classes). Either wire it into the bilingual flow (§5.5) or remove it to avoid an unaudited surface.

### 3.2 `RingNode.community_id` / kingpin metadata never surfaced (LOW)
The rings backend computes `community_id`, `is_kingpin`, `severity_score`, `recency_score`, `why_flagged` — rich, demo‑worthy signals — but because the rings UI doesn't exist (§5.1) none of it reaches a judge's screen. Fixed by §5.1.

### 3.3 No fast "is the DB actually seeded?" probe (LOW, demo‑risk)
The single most common reason a judge sees *"Found no matching records"* is an **empty DB**, not a code bug. `health.py` exposes `/health` and `/health/models` but **not** a row‑count probe. Add the tiny endpoint in §5.6 so the cause is obvious in 1 request.

### 3.4 PS7 doc/impl contradiction (MEDIUM — see §5.3)
`docs/ARCHITECTURE.md` §9 PS7 states financial data is *"query surface available via Text‑to‑SQL lane"*. This is **false**: `sql_guard.ALLOWED_TABLES = {cases, persons, case_persons, stations, officers, narratives}` — `financial_accounts` / `financial_transactions` are **not** allow‑listed, so any LLM/rule SQL touching them is rejected by `sanitize()`. The money‑trail feature works only because it bypasses the SQL lane with a dedicated service. Resolve by either updating the doc or (carefully) extending the allow‑list (§5.3).

---

## 4. `architectural.md` — Documented but Not Implemented / Not Wired

| ARCHITECTURE.md reference | Reality in build | Action |
|---|---|---|
| **PS2** "`/network/rings` … Ring detection flags groups of co‑accused in ≥3 shared cases" | endpoint + service exist; **no screen** calls it | §5.1 — add Rings sub‑tab |
| **PS2** "Click node → navigate to `/profile/{person_id}`; Click *Open Case* → CaseDrawer" + node inspector shows `community_id` | `network.tsx` uses `/network/ego` only; rings/community metadata unused | §5.1 |
| **PS6** "search similar by description" (`POST /cases/similar/search`) | endpoint exists; CaseDrawer only uses `getSimilarCases(caseId)` | §5.2 — add description search box |
| **PS7** "query surface available via Text‑to‑SQL lane" | contradicted by `sql_guard` allow‑list | §5.3 |
| **Hackathon feature #4** "PDF export of conversation" + Route map `/transcripts` | transcripts screen still voice‑only; no conversation history/PDF | §5.4 |
| **PS2** doc mentions `POST /network/entity` | actual route is `POST /network/ego` | doc typo — align doc to `/network/ego` |

---

## 5. Drop‑in Code (copy‑paste ready)

> Paths are repo‑relative to `Satyam_Ai-main/`. New files use full file contents; edits use exact `OLD →  NEW` blocks.

### 5.1 Close PS2 gap — Criminal **Ring Detection** UI (wires `GET /api/network/rings`)

**5.1.a — NEW file `frontend/src/components/RingsPanel.tsx`** (self‑contained; no chart lib):

```tsx
import { useEffect, useState } from "react";
import { intelligence, type RingsResponse, type RingSummary } from "@/lib/api/intelligence";
import { useNavigate } from "@tanstack/react-router";

function sevColor(score: number): string {
  if (score >= 75) return "bg-red-600";
  if (score >= 50) return "bg-orange-500";
  if (score >= 25) return "bg-yellow-500";
  return "bg-emerald-600";
}

export function RingsPanel({ crimeType, district }: { crimeType?: string; district?: string }) {
  const [data, setData] = useState<RingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    intelligence
      .getNetworkRings(12, crimeType, district)
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setError("Could not load ring detection results."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [crimeType, district]);

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Detecting organized‑crime rings…</p>;
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!data || data.rings.length === 0)
    return <p className="p-6 text-sm text-muted-foreground">No co‑accused rings (≥3 shared cases) detected for this filter.</p>;

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.rings.length} ring(s) — groups of co‑accused appearing together across multiple FIRs. Investigative leads only.
      </p>
      {data.rings.map((ring: RingSummary) => (
        <div key={ring.ring_id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-sm">{ring.label}</h3>
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold text-white ${sevColor(ring.severity_score)}`}>
              severity {ring.severity_score}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{ring.member_count} members</span>
            <span>{ring.case_count} shared cases</span>
            <span>recency {ring.recency_score}</span>
          </div>
          {ring.top_crime_types.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ring.top_crime_types.map((c) => (
                <span key={c} className="rounded bg-muted px-2 py-0.5 text-[11px]">{c}</span>
              ))}
            </div>
          )}
          {ring.why_flagged.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[11px] text-muted-foreground">
              {ring.why_flagged.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {ring.kingpin_person_id != null && (
            <button
              onClick={() => navigate({ to: "/profile/$personId", params: { personId: String(ring.kingpin_person_id) } })}
              className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              View kingpin profile →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

**5.1.b — Edit `frontend/src/lib/api/intelligence.ts`** — make sure the rings types are exported so the panel can import them. If `RingsResponse` / `RingSummary` are not already exported from this module, add:

```ts
// Ensure these are exported (add if missing).
export type RingSummary = {
  ring_id: string;
  label: string;
  member_count: number;
  case_count: number;
  severity_score: number;
  recency_score: number;
  kingpin_person_id: number | null;
  top_crime_types: string[];
  districts: string[];
  why_flagged: string[];
};
export type RingsResponse = { rings: RingSummary[] };
```

**5.1.c — Edit `frontend/src/routes/network.tsx`** — add a third sub‑tab "Rings".

Edit 1 — import (near the FinancialLinksPanel import at the top):
```tsx
// OLD
import { FinancialLinksPanel } from "@/components/FinancialLinksPanel";
// NEW
import { FinancialLinksPanel } from "@/components/FinancialLinksPanel";
import { RingsPanel } from "@/components/RingsPanel";
```

Edit 2 — widen the link‑mode union:
```tsx
// OLD
  const [linkMode, setLinkMode] = useState<"people" | "financial">("people");
// NEW
  const [linkMode, setLinkMode] = useState<"people" | "financial" | "rings">("people");
```

Edit 3 — add the toggle button + label (the `["people","financial"]` map):
```tsx
// OLD
              {(["people", "financial"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLinkMode(m)}
                  className={`rounded-md px-3 py-1.5 transition ${
                    linkMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "people" ? t("People & Cases") : t("Financial links")}
                </button>
              ))}
// NEW
              {(["people", "financial", "rings"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setLinkMode(m)}
                  className={`rounded-md px-3 py-1.5 transition ${
                    linkMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "people" ? t("People & Cases") : m === "financial" ? t("Financial links") : t("Rings")}
                </button>
              ))}
```

Edit 4 — render the panel (the `linkMode === "financial"` ternary):
```tsx
// OLD
          {linkMode === "financial" ? (
            <div className="flex-1 overflow-hidden">
              <FinancialLinksPanel seed={seedInput} />
            </div>
          ) : (
// NEW
          {linkMode === "financial" ? (
            <div className="flex-1 overflow-hidden">
              <FinancialLinksPanel seed={seedInput} />
            </div>
          ) : linkMode === "rings" ? (
            <div className="flex-1 overflow-hidden">
              <RingsPanel />
            </div>
          ) : (
```
The existing closing `)} {/* end linkMode === "financial" ternary */}` stays as‑is — it still closes the final `else` branch correctly.

---

### 5.2 Close PS6 gap — Search **Similar Cases by description** (wires `POST /api/cases/similar/search`)

**NEW file `frontend/src/components/SimilarCaseSearch.tsx`** — drop into the Console results canvas or a Reports/Cases screen:

```tsx
import { useState } from "react";
import { intelligence, type SimilarCasesResponse } from "@/lib/api/intelligence";

export function SimilarCaseSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SimilarCasesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setRes(await intelligence.searchSimilarCases(q.trim(), 8));
    } catch {
      setError("Search failed. Check clearance and that the API is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold mb-2">Find similar cases by description</h3>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="e.g. chain snatching near bus stand at night"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button onClick={run} disabled={loading}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading ? "…" : "Search"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {res && res.matches.length === 0 && <p className="mt-3 text-xs text-muted-foreground">No similar cases found.</p>}
      {res && res.matches.length > 0 && (
        <ul className="mt-3 space-y-2">
          {res.matches.map((m) => (
            <li key={m.case_id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{m.fir_number ?? `Case #${m.case_id}`}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-bold">{m.similarity_percent}%</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{m.crime_type} · {m.district}</div>
              {m.why_similar.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.why_similar.map((w, i) => <span key={i} className="rounded bg-muted px-2 py-0.5 text-[10px]">{w}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```
Mount it anywhere, e.g. in `console.tsx` results canvas: `import { SimilarCaseSearch } from "@/components/SimilarCaseSearch";` then render `<SimilarCaseSearch />`. (Ensure `SimilarCasesResponse` is exported from `lib/api/intelligence.ts`.)

---

### 5.3 Resolve PS7 doc/impl contradiction (financial via Text‑to‑SQL)

**Recommended (safe) — fix the doc**, since money‑trail already has a dedicated, masked, audit‑logged service. In `docs/ARCHITECTURE.md` §9 PS7 replace:
```
**Status:** Schema + data loaded on local DB; query surface available via Text-to-SQL lane
```
with:
```
**Status:** Schema + data loaded. Financial tables are intentionally NOT in the Text-to-SQL allow-list; they are queried only via the dedicated, clearance-gated, audit-logged POST /financial/money-trail service (see FinancialLinksPanel).
```

**Alternative (only if you truly want NL financial queries)** — extend the allow‑list. This widens the LLM SQL surface, so do it **only** together with PII masking of account/owner columns. In `backend/app/pipeline/tools/sql_guard.py`:
```python
# OLD
ALLOWED_TABLES = {
    "cases", "persons", "case_persons", "stations", "officers", "narratives",
}
# NEW
ALLOWED_TABLES = {
    "cases", "persons", "case_persons", "stations", "officers", "narratives",
    "financial_accounts", "financial_transactions",
}
```
and extend `_PII_COLUMNS` in `text_to_sql.py` to mask account holders for L1/L2:
```python
# OLD
_PII_COLUMNS: frozenset[str] = frozenset({
    "name", "full_name", "victim_name", "accused_name",
    "complainant", "io_name", "place_of_offence",
})
# NEW
_PII_COLUMNS: frozenset[str] = frozenset({
    "name", "full_name", "victim_name", "accused_name",
    "complainant", "io_name", "place_of_offence",
    "account_number", "account_holder", "ifsc", "bank_name",
})
```
> Prefer the doc fix unless NL financial querying is explicitly required for the demo.

---

### 5.4 Apply Feature D — **PDF export of conversation history** (NOT yet in this build)

This is the one previously‑specified feature **not present** in the zip (`frontend/src/lib/conversationStore.ts`, `frontend/src/lib/pdf/conversationPdf.ts`, and the transcripts redesign are all absent). The two **core, self‑contained** files are reproduced below; the full two‑tab `transcripts.tsx` rewrite + optional extras (D6–D8) are in `SATYAM_MISSING_FEATURES_BUILD_SPEC.md` (Feature D, §D5–D8) — apply those verbatim.

**5.4.a — NEW file `frontend/src/lib/conversationStore.ts`:**
```ts
// Reads the Console's persisted chat history so other screens (Transcripts)
// can display + export it. Single source of truth = localStorage["satyam-chat-history"].
export type StoredChatMessage = { role: "user" | "ai"; text: string; citations?: any[] };
export type StoredConversation = {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  createdAt: number;
  updatedAt: number;
  officer?: string;
};

const KEY = "satyam-chat-history";

export function loadConversations(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && Array.isArray(c.messages))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch {
    return [];
  }
}

export function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}
```

**5.4.b — NEW file `frontend/src/lib/pdf/conversationPdf.ts`** (dependency‑free, branded print‑to‑PDF):
```ts
import type { StoredConversation } from "@/lib/conversationStore";
import { fmtTime } from "@/lib/conversationStore";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderConvHtml(c: StoredConversation): string {
  const rows = c.messages.map((m) => {
    const who = m.role === "user" ? (c.officer || "Officer") : "Satyam AI";
    const bg = m.role === "user" ? "#eef2ff" : "#f1f5f9";
    return `<div style="margin:10px 0;padding:10px 12px;border-radius:8px;background:${bg}">
      <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:4px">${esc(who)}</div>
      <div style="font-size:13px;color:#0f172a;white-space:pre-wrap">${esc(m.text)}</div></div>`;
  }).join("");
  return `<section style="page-break-after:always">
    <h2 style="font-size:16px;margin:0 0 2px">${esc(c.title || "Conversation")}</h2>
    <div style="font-size:11px;color:#64748b;margin-bottom:8px">
      ${esc(c.officer || "Unknown officer")} · ${esc(fmtTime(c.createdAt))}
    </div>${rows}</section>`;
}

function openPrint(title: string, inner: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to export PDF."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
    <body style="font-family:Inter,Arial,sans-serif;max-width:760px;margin:24px auto;padding:0 16px">
    <div style="border-bottom:2px solid #4f46e5;padding-bottom:8px;margin-bottom:16px">
      <div style="font-size:20px;font-weight:800;color:#4f46e5">Satyam — KSP Crime Intelligence</div>
      <div style="font-size:11px;color:#64748b">Conversation transcript · generated ${esc(fmtTime(Date.now()))}</div>
    </div>${inner}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function exportConversationPdf(c: StoredConversation) {
  openPrint(c.title || "Conversation", renderConvHtml(c));
}
export function exportConversationsPdf(list: StoredConversation[]) {
  openPrint("All conversations", list.map(renderConvHtml).join(""));
}
```

**5.4.c — Console must stamp the officer + persist** (so Transcripts can show who spoke). In `frontend/src/routes/console.tsx`, when a conversation is created/persisted, include the current officer name from the cached session user. Minimal change:
```ts
// where a Conversation object is created/persisted, add:
officer: (api.getCachedUser?.()?.name) ?? undefined,
```
If `getCachedUser` does not exist yet, add the cache in `client.ts` (Feature D, §D1 of `SATYAM_MISSING_FEATURES_BUILD_SPEC.md`): cache the `SessionUser` under `localStorage["satyam-user"]` on login/`me`, and expose `getCachedUser()`.

**5.4.d — Transcripts screen** — replace `frontend/src/routes/transcripts.tsx` with the two‑tab version (Conversations + Voice transcripts) from `SATYAM_MISSING_FEATURES_BUILD_SPEC.md` §D5. It auto‑loads `loadConversations()`, shows officer + date/time + expandable thread, and offers per‑card and bulk **Download PDF** via the helpers above.

---

### 5.5 (Optional) Wire `/voice/translate` into the bilingual flow

Add a client fn in `frontend/src/lib/api/client.ts`:
```ts
export async function translateText(text: string, target: "en" | "kn"): Promise<string> {
  const res = await fetch(`${API_BASE}/voice/translate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(getAuthToken() ? { authorization: `Bearer ${getAuthToken()}` } : {}),
    },
    body: JSON.stringify({ text, target_lang: target }),
  });
  if (!res.ok) throw new Error(`translate failed: ${res.status}`);
  const data = await res.json();
  return data.translated_text ?? data.text ?? text;
}
```
> Confirm the request/response field names against `backend/app/api/routes/voice.py` `TranslateRequest` / `TranslateResponse` before shipping. If translate is not needed for the demo, delete the route instead.

---

### 5.6 (Optional) Add a `/health/data` seeding probe (kills the #1 "no data" false alarm)

In `backend/app/api/routes/health.py`:
```python
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from app.api.deps import get_scoped_session

@router.get("/health/data")
async def health_data(session: AsyncSession = Depends(get_scoped_session)) -> dict:
    out: dict[str, int] = {}
    for tbl in ("cases", "persons", "case_persons", "narratives",
                "financial_accounts", "financial_transactions",
                "district_socio_economic_indicators"):
        try:
            out[tbl] = int((await session.execute(text(f'SELECT COUNT(*) FROM "{tbl}"'))).scalar() or 0)
        except Exception:
            out[tbl] = -1  # table missing / not migrated
    return {"row_counts": out, "seeded": out.get("cases", 0) > 0}
```
Then `GET /health/data` instantly tells a judge whether the DB is seeded.

---

## 6. Apply Order (for the automation agent)

1. **§5.1** Rings UI — highest demo value (surfaces a fully‑built but invisible backend feature). New file `RingsPanel.tsx`; 4 edits in `network.tsx`; ensure rings types exported.
2. **§5.4** Feature D PDF export — the only not‑applied required feature. Two new lib files here + transcripts rewrite from `SATYAM_MISSING_FEATURES_BUILD_SPEC.md` §D5.
3. **§5.2** Similar‑by‑description search box.
4. **§5.3** Resolve PS7 doc contradiction (prefer the doc fix).
5. **§5.6** `/health/data` probe (de‑risks the live demo).
6. **§5.5 / §3.1** Decide: wire or remove `/voice/translate`.

## 7. Smoke Test After Applying

```bash
# Backend
cd backend && uvicorn app.main:app --reload
curl -s localhost:8000/health/data | jq         # expect seeded:true, cases>0

# Frontend
cd frontend && npm run dev
# /network → switch to "Rings" tab → rings render; kingpin button → /profile/:id
# /console → ask "top crime types in Bengaluru" → grounded table (no "no records")
# /console → Similar-case search box → results with similarity %
# chat a bit, then /transcripts → Conversations tab → Download PDF works
```

*All code in this document is drop‑in for the file paths shown. Every previously‑documented fix was verified present in the fresh build; the items above are the remaining gap‑closures.*
