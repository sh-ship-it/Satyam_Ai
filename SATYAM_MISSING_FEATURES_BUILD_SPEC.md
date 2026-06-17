# Satyam — Build Spec & Copy-Paste Code for the Missing Features

> Companion to `SATYAM_BUG_SCAN_AND_FIXES.md`, `SATYAM_CHAT_NO_DATA_FIX.md`, and `SATYAM_DEEP_BUG_SCAN.md`.
> Scope of this document: implement the three features that the scan found **missing or incomplete**:
>
> 1. **Financial crime analysis** — money-trail query API + "Financial links" sub-tab on the Network screen.
> 2. **Behavioral pattern** — already present as Modus Operandi (MO); optional hardening included.
> 3. **Per-person offender profile** — an "all offenders" list endpoint + a dropdown/browse affordance wired into the existing profile dossier.
>
> Every block below is drop-in. File paths are exact. New files say **NEW FILE**; edits show the anchor to insert at.

---

## Current status (verified by source scan)

| Feature | Data layer | Backend API | Frontend | Verdict |
|---|:--:|:--:|:--:|---|
| Financial transaction table | YES | — | — | Schema only (`financial_accounts`, `financial_transactions`) |
| Money-trail visualization | YES | NO | NO | **Build A1-A6** |
| Financial links sub-tab (Network) | YES | NO | NO | **Build A7** |
| Behavioral pattern (MO) | YES | YES (`/api/mo/clusters`, MO fingerprint) | YES (Trends, Profile) | Already implemented; optional B1 |
| Per-person offender profile dossier | YES | YES (`/api/persons/{id}/profile`) | YES (`profile.$personId.tsx`) | Implemented (search-driven) |
| "All offenders" browse/dropdown | YES | NO | NO | **Build C1-C3** |

The financial tables already have FKs, indexes, a `pattern_flag` column (`high_value | near_incident_date | rapid_repeated | circular_flow`), an `is_suspicious` flag, and a seed loader (`seed/load_neon_60pct.py`, ~107k rows). They are simply never read. Everything below wires them up.

> **Seeding reminder:** confirm the financial tables actually have rows in the DB the API uses:
> ```bash
> psql "$DATABASE_URL" -c "SELECT count(*) FROM financial_transactions;"
> ```
> If 0, run the seed loader (`python -m seed.load_neon_60pct` or your project's seed entrypoint) before testing.

---

# FEATURE A — Financial crime analysis (money trails + Network sub-tab)

## A1. NEW FILE — `backend/app/schemas/financial.py`

```python
"""PS7 — Financial money-trail schemas.

All data is synthetic and produced for investigative leads only; it is never
proof of guilt. Sensitive (clearance >= 2), audit-logged at the route layer.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, model_validator


class MoneyTrailRequest(BaseModel):
    # Seed the trail by a person (id or name), or by a case id.
    person_id: Optional[str] = None
    entity_name: Optional[str] = None
    case_id: Optional[int] = None
    min_amount: float = 0.0
    suspicious_only: bool = False
    depth: int = 2  # account hops to expand (clamped 1..3)

    @model_validator(mode="after")
    def _require_seed(self) -> "MoneyTrailRequest":
        if not self.person_id and not self.entity_name and self.case_id is None:
            raise ValueError("Supply person_id, entity_name, or case_id")
        if not self.person_id and self.entity_name:
            self.person_id = self.entity_name
        return self


class MoneyNode(BaseModel):
    id: str                       # "acct:<account_id>"
    label: str                    # masked account ref + bank
    kind: str = "account"
    person_id: Optional[int] = None
    person_label: Optional[str] = None
    bank_name: Optional[str] = None
    account_type: Optional[str] = None
    district: Optional[str] = None
    kyc_risk_level: Optional[str] = None
    total_in: float = 0.0
    total_out: float = 0.0
    degree: int = 0
    is_seed: bool = False


class MoneyEdge(BaseModel):
    source: str                   # "acct:<from_account_id>"
    target: str                   # "acct:<to_account_id>"
    amount: float
    txn_count: int = 1
    channel: Optional[str] = None
    pattern_flag: Optional[str] = None
    is_suspicious: bool = False
    case_id: Optional[int] = None


class MoneyTrailResponse(BaseModel):
    seed: str
    nodes: list[MoneyNode] = []
    edges: list[MoneyEdge] = []
    flagged_count: int = 0
    total_amount: float = 0.0
    notice: str = (
        "Synthetic financial leads - investigative use only, not proof of guilt."
    )
```

## A2. NEW FILE — `backend/app/services/financial_service.py`

Mirrors the existing `network_service.ego` pattern: resolve a seed, expand a graph with raw SQL over the RLS-stamped session, return a typed response. Uses SQLAlchemy `expanding` bindparams so the `IN :ids` clauses are driver-portable (asyncpg/psycopg).

```python
"""PS7 - Financial money-trail analysis service.

Builds an account -> account money-flow graph seeded by a person, an account
owner, or a case. Runs on the caller's RLS-stamped session. Synthetic data;
investigative leads only.
"""
from __future__ import annotations

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.financial import (
    MoneyEdge, MoneyNode, MoneyTrailRequest, MoneyTrailResponse,
)

_MAX_DEPTH = 3
_EDGE_LIMIT = 500


async def _resolve_person_id(session: AsyncSession, seed: str) -> int | None:
    try:
        return int(seed)
    except (TypeError, ValueError):
        row = await session.execute(
            text("SELECT person_id FROM persons WHERE name ILIKE :n "
                 "ORDER BY person_id LIMIT 1"),
            {"n": str(seed)},
        )
        return row.scalar_one_or_none()


async def money_trail(session: AsyncSession, req: MoneyTrailRequest) -> MoneyTrailResponse:
    # 1) Resolve seed accounts -------------------------------------------------
    if req.case_id is not None:
        seed_label = f"case:{req.case_id}"
        seed_ids = (await session.execute(
            text(
                """
                SELECT DISTINCT acc FROM (
                    SELECT from_account_id AS acc FROM financial_transactions WHERE case_id = :cid
                    UNION
                    SELECT to_account_id   AS acc FROM financial_transactions WHERE case_id = :cid
                ) s
                """
            ),
            {"cid": req.case_id},
        )).scalars().all()
    else:
        seed_label = str(req.person_id)
        pid = await _resolve_person_id(session, req.person_id or "")
        if pid is None:
            return MoneyTrailResponse(seed=seed_label)
        seed_ids = (await session.execute(
            text("SELECT account_id FROM financial_accounts WHERE person_id = :pid"),
            {"pid": pid},
        )).scalars().all()

    seed_ids = [int(x) for x in seed_ids]
    if not seed_ids:
        return MoneyTrailResponse(seed=seed_label)

    # 2) BFS-expand transactions up to req.depth hops --------------------------
    txn_sql = text(
        """
        SELECT from_account_id, to_account_id,
               SUM(amount)            AS amount,
               COUNT(*)               AS txn_count,
               MAX(channel)           AS channel,
               MAX(pattern_flag)      AS pattern_flag,
               BOOL_OR(is_suspicious) AS is_suspicious,
               MAX(case_id)           AS case_id
        FROM financial_transactions
        WHERE (from_account_id IN :ids OR to_account_id IN :ids)
          AND amount >= :min_amount
          AND (:susp = FALSE OR is_suspicious = TRUE)
        GROUP BY from_account_id, to_account_id
        LIMIT :edge_limit
        """
    ).bindparams(bindparam("ids", expanding=True))

    frontier: set[int] = set(seed_ids)
    seen_accounts: set[int] = set(seed_ids)
    edge_rows: list[dict] = []
    seen_edges: set[tuple[int, int]] = set()

    for _ in range(max(1, min(req.depth, _MAX_DEPTH))):
        if not frontier:
            break
        rows = (await session.execute(txn_sql, {
            "ids": list(frontier),
            "min_amount": req.min_amount,
            "susp": req.suspicious_only,
            "edge_limit": _EDGE_LIMIT,
        })).mappings().all()

        next_frontier: set[int] = set()
        for r in rows:
            frm, to = int(r["from_account_id"]), int(r["to_account_id"])
            if (frm, to) not in seen_edges:
                seen_edges.add((frm, to))
                edge_rows.append(dict(r))
            for acc in (frm, to):
                if acc not in seen_accounts:
                    next_frontier.add(acc)
                    seen_accounts.add(acc)
        frontier = next_frontier

    # 3) Account metadata (+ owner name) --------------------------------------
    acc_meta: dict[int, dict] = {}
    if seen_accounts:
        acc_sql = text(
            """
            SELECT a.account_id, a.account_type, a.bank_name, a.district,
                   a.kyc_risk_level, a.person_id, p.name AS person_name
            FROM financial_accounts a
            LEFT JOIN persons p ON p.person_id = a.person_id
            WHERE a.account_id IN :ids
            """
        ).bindparams(bindparam("ids", expanding=True))
        acc_meta = {
            int(r["account_id"]): dict(r)
            for r in (await session.execute(acc_sql, {"ids": list(seen_accounts)})).mappings().all()
        }

    # 4) Build response --------------------------------------------------------
    totals_in: dict[int, float] = {}
    totals_out: dict[int, float] = {}
    degree: dict[int, int] = {}
    flagged = 0
    grand_total = 0.0
    edges: list[MoneyEdge] = []

    for r in edge_rows:
        frm, to = int(r["from_account_id"]), int(r["to_account_id"])
        amt = float(r["amount"] or 0)
        grand_total += amt
        totals_out[frm] = totals_out.get(frm, 0.0) + amt
        totals_in[to] = totals_in.get(to, 0.0) + amt
        degree[frm] = degree.get(frm, 0) + 1
        degree[to] = degree.get(to, 0) + 1
        if r.get("is_suspicious"):
            flagged += 1
        edges.append(MoneyEdge(
            source=f"acct:{frm}", target=f"acct:{to}",
            amount=round(amt, 2), txn_count=int(r["txn_count"] or 1),
            channel=r.get("channel"), pattern_flag=r.get("pattern_flag"),
            is_suspicious=bool(r.get("is_suspicious")), case_id=r.get("case_id"),
        ))

    seed_set = set(seed_ids)
    nodes: list[MoneyNode] = []
    for acc_id in seen_accounts:
        m = acc_meta.get(acc_id, {})
        bank = m.get("bank_name") or "Account"
        nodes.append(MoneyNode(
            id=f"acct:{acc_id}",
            label=f"{bank} ****{str(acc_id)[-4:]}",
            person_id=m.get("person_id"),
            person_label=m.get("person_name"),
            bank_name=m.get("bank_name"),
            account_type=m.get("account_type"),
            district=m.get("district"),
            kyc_risk_level=m.get("kyc_risk_level"),
            total_in=round(totals_in.get(acc_id, 0.0), 2),
            total_out=round(totals_out.get(acc_id, 0.0), 2),
            degree=degree.get(acc_id, 0),
            is_seed=acc_id in seed_set,
        ))

    return MoneyTrailResponse(
        seed=seed_label, nodes=nodes, edges=edges,
        flagged_count=flagged, total_amount=round(grand_total, 2),
    )
```

## A3. NEW FILE — `backend/app/api/routes/financial.py`

Follows the `map.py` route pattern + the `intelligence.py` clearance/audit guard. Sensitive: clearance >= 2, audit-logged.

```python
"""PS7 - Financial money-trail endpoints. Clearance >= 2, audit-logged."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.financial import MoneyTrailRequest, MoneyTrailResponse
from app.services import financial_service

router = APIRouter()


@router.post("/money-trail", response_model=MoneyTrailResponse)
async def money_trail(
    req: MoneyTrailRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> MoneyTrailResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    if principal.clearance < 2:
        raise HTTPException(status_code=403, detail="Requires clearance L2+")
    await write_audit(
        session, action="financial.money_trail", user_id=principal.officer_id,
        query_text=f"seed={req.person_id or req.case_id}",
    )
    return await financial_service.money_trail(session, req)
```

## A4. EDIT — `backend/app/main.py` (mount the router)

**(a)** Add `financial` to the routes import (the line that currently reads `from app.api.routes import network, reports, settings as settings_routes, voice`):

```python
from app.api.routes import network, reports, settings as settings_routes, voice
from app.api.routes import financial  # PS7 money-trail
```

**(b)** Mount it next to the other `include_router` calls (e.g. just after the `network` mount):

```python
    app.include_router(financial.router, prefix="/financial", tags=["financial"])
```

## A5. (Optional but recommended) RLS / GRANT sanity

The v2 migration already runs `GRANT SELECT ON financial_accounts/financial_transactions TO satyam_app`. These synthetic tables have no per-row RLS policy, which is fine for demo data. If your deployment enables `FORCE ROW LEVEL SECURITY` globally, add permissive read policies so the scoped session can read them:

```sql
-- Only needed if RLS is force-enabled cluster-wide.
ALTER TABLE financial_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_acc_read ON financial_accounts     FOR SELECT USING (true);
CREATE POLICY fin_txn_read ON financial_transactions FOR SELECT USING (true);
```

## A6. NEW FILE — `frontend/src/lib/api/financial.ts` (typed client)

Reuses the same authenticated `apiFetch` style as `intelligence.ts`.

```ts
import { API_BASE, getAuthToken, ApiError } from "./client";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export type MoneyNode = {
  id: string; label: string; kind: string;
  person_id: number | null; person_label: string | null;
  bank_name: string | null; account_type: string | null;
  district: string | null; kyc_risk_level: string | null;
  total_in: number; total_out: number; degree: number; is_seed: boolean;
};
export type MoneyEdge = {
  source: string; target: string; amount: number; txn_count: number;
  channel: string | null; pattern_flag: string | null;
  is_suspicious: boolean; case_id: number | null;
};
export type MoneyTrailResponse = {
  seed: string; nodes: MoneyNode[]; edges: MoneyEdge[];
  flagged_count: number; total_amount: number; notice: string;
};

export type MoneyTrailRequest = {
  person_id?: string; entity_name?: string; case_id?: number;
  min_amount?: number; suspicious_only?: boolean; depth?: number;
};

export const financial = {
  moneyTrail: (req: MoneyTrailRequest) =>
    apiFetch<MoneyTrailResponse>("/financial/money-trail", {
      method: "POST",
      body: JSON.stringify(req),
    }),
};
```

## A7. NEW FILE — `frontend/src/components/FinancialLinksPanel.tsx` (the sub-tab content)

Self-contained: a simple SVG node-link diagram (circular layout) plus a flagged-flows table. It does not depend on the large custom graph engine inside `network.tsx`, so it is safe to drop in.

```tsx
import { useEffect, useMemo, useState } from "react";
import { financial, type MoneyTrailResponse, type MoneyNode } from "../lib/api/financial";

const FLAG_COLOR: Record<string, string> = {
  high_value: "#dc2626",
  near_incident_date: "#ea580c",
  rapid_repeated: "#d97706",
  circular_flow: "#7c3aed",
};

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function FinancialLinksPanel({ seed }: { seed: string }) {
  const [data, setData] = useState<MoneyTrailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);

  useEffect(() => {
    if (!seed?.trim()) { setData(null); return; }
    let alive = true;
    setLoading(true); setError(null);
    financial
      .moneyTrail({ entity_name: seed.trim(), depth: 2, suspicious_only: suspiciousOnly })
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setError("Could not load financial links for this seed."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [seed, suspiciousOnly]);

  // Circular layout for nodes.
  const layout = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const cx = 360, cy = 230, R = 180;
    const pos: Record<string, { x: number; y: number; n: MoneyNode }> = {};
    nodes.forEach((n, i) => {
      if (n.is_seed && nodes.length > 1) { pos[n.id] = { x: cx, y: cy, n }; return; }
      const others = nodes.filter((m) => !m.is_seed);
      const idx = others.findIndex((m) => m.id === n.id);
      const k = others.length || 1;
      const a = (2 * Math.PI * idx) / k;
      pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), n };
    });
    return pos;
  }, [data]);

  if (!seed?.trim()) return <div className="p-6 text-sm text-muted-foreground">Enter a seed person above to view their financial links.</div>;
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading financial links…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (!data || data.nodes.length === 0) return <div className="p-6 text-sm text-muted-foreground">No financial accounts or transactions linked to this seed.</div>;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="font-semibold">{data.nodes.length} accounts</span>
        <span className="font-semibold">{data.edges.length} flows</span>
        <span className="font-semibold text-destructive">{data.flagged_count} flagged</span>
        <span className="font-semibold">Total: {inr(data.total_amount)}</span>
        <label className="ml-auto flex items-center gap-1.5">
          <input type="checkbox" checked={suspiciousOnly} onChange={(e) => setSuspiciousOnly(e.target.checked)} />
          Suspicious only
        </label>
      </div>

      <svg viewBox="0 0 720 460" className="w-full rounded-lg border bg-card">
        {data.edges.map((e, i) => {
          const a = layout[e.source], b = layout[e.target];
          if (!a || !b) return null;
          const color = e.pattern_flag ? (FLAG_COLOR[e.pattern_flag] ?? "#64748b") : "#94a3b8";
          const w = e.is_suspicious ? 2.5 : 1.2;
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={w} strokeOpacity={0.7} markerEnd="url(#arrow)" />
            </g>
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#64748b" />
          </marker>
        </defs>
        {Object.values(layout).map(({ x, y, n }) => (
          <g key={n.id} transform={`translate(${x},${y})`}>
            <circle r={n.is_seed ? 14 : 9}
              fill={n.is_seed ? "#2563eb" : n.kyc_risk_level === "High" ? "#dc2626" : "#0ea5e9"}
              stroke="#fff" strokeWidth={1.5} />
            <text y={n.is_seed ? -20 : -14} textAnchor="middle" fontSize={9} fill="currentColor">{n.label}</text>
          </g>
        ))}
      </svg>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1 pr-3">From</th><th className="py-1 pr-3">To</th><th className="py-1 pr-3">Amount</th><th className="py-1 pr-3">Channel</th><th className="py-1 pr-3">Flag</th><th className="py-1">Case</th></tr>
          </thead>
          <tbody>
            {data.edges
              .slice()
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 25)
              .map((e, i) => {
                const from = layout[e.source]?.n;
                const to = layout[e.target]?.n;
                return (
                  <tr key={i} className={e.is_suspicious ? "text-destructive" : ""}>
                    <td className="py-1 pr-3">{from?.label ?? e.source}</td>
                    <td className="py-1 pr-3">{to?.label ?? e.target}</td>
                    <td className="py-1 pr-3 font-semibold">{inr(e.amount)}</td>
                    <td className="py-1 pr-3">{e.channel ?? "-"}</td>
                    <td className="py-1 pr-3">{e.pattern_flag ?? "-"}</td>
                    <td className="py-1">{e.case_id ?? "-"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{data.notice}</p>
    </div>
  );
}
```

## A8. EDIT — `frontend/src/routes/network.tsx` (add the sub-tab toggle)

The network screen already tracks the current seed in `seedInput`. Add a People/Financial toggle and render the new panel when "Financial" is active.

**(a)** Add the import near the other component imports at the top:

```tsx
import { FinancialLinksPanel } from "../components/FinancialLinksPanel";
```

**(b)** Add a sub-tab state alongside the other `useState` hooks (e.g. right after `const [seedInput, setSeedInput] = useState("");`):

```tsx
const [linkMode, setLinkMode] = useState<"people" | "financial">("people");
```

**(c)** Render the toggle in the screen toolbar (place it just above the graph container / `Seed Entity Link Graph` heading):

```tsx
<div className="mb-3 inline-flex rounded-lg border bg-card p-0.5 text-xs font-semibold">
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
</div>
```

**(d)** Wrap the existing graph render so it only shows in "people" mode, and render the financial panel in "financial" mode. The simplest non-invasive way: find the JSX block that renders the SVG graph (the element containing the `Seed Entity Link Graph` heading and the graph `<svg>`), and gate it:

```tsx
{linkMode === "people" ? (
  /* ----- existing graph JSX stays here, unchanged ----- */
  <>{/* ...existing graph container... */}</>
) : (
  <FinancialLinksPanel seed={seedInput} />
)}
```

> If you prefer zero edits to the existing graph JSX, instead render `{linkMode === "financial" && <FinancialLinksPanel seed={seedInput} />}` directly below the graph container and add `linkMode === "people"` to the graph container's own conditional. Either approach reuses the same `seedInput` the user already typed.

---

# FEATURE B — Behavioral pattern (already implemented; optional hardening)

Behavioral analysis already ships in two places:
- **MO clusters** — `intelligence_service.get_mo_clusters()` -> `MOClustersResponse`, exposed at `GET /api/mo/clusters`, rendered on the **Trends** screen.
- **Per-person MO fingerprint** — `MOFingerprint` (top sections / crime types / motives / time-of-day) inside the offender profile, rendered on the **MO Fingerprint** tab of `profile.$personId.tsx`.

**No new build required.** Optional enhancement: add a day-of-week signal to the MO fingerprint so the behavioral pattern is richer. In `intelligence_service.get_offender_profile`, where `mo_fingerprint=MOFingerprint(...)` is constructed, you can add a `peak_day` by querying:

```sql
SELECT TRIM(TO_CHAR(c.incident_date, 'Day')) AS dow, COUNT(*) AS n
FROM case_persons cp
JOIN cases c ON c.case_id = cp.case_id
WHERE cp.person_id = :pid AND cp.role ILIKE '%accused%' AND c.incident_date IS NOT NULL
GROUP BY dow ORDER BY n DESC LIMIT 1;
```

(If you add it, also add `peak_day: str | None = None` to the `MOFingerprint` schema and the frontend `MOFingerprint` type.)

---

# FEATURE C — Offender browse: "all offenders" list + dropdown

The per-person dossier already exists (`profile.$personId.tsx` + `GET /api/persons/{id}/profile`). What is missing is a way to **browse/choose** an offender (the screen is search-only). This adds a list endpoint and a dropdown that drives the same dossier route - no duplicate screen needed.

## C1. EDIT — `backend/app/schemas/intelligence.py` (add list types)

Add next to the other Offender Profile schemas:

```python
class OffenderListItem(BaseModel):
    person_id: int
    display_name: str
    district: str | None = None
    offense_count: int
    top_crime_type: str | None = None
    risk_label: str

class OffenderListResponse(BaseModel):
    offenders: list[OffenderListItem] = []
```

## C2. EDIT — `backend/app/services/intelligence_service.py` (add the query)

Reuses the existing `_risk_label()` helper and `text()` import already in this file. Add this function (e.g. just above `get_offender_profile`):

```python
async def list_offenders(
    session: AsyncSession,
    *,
    q: str | None = None,
    district: str | None = None,
    crime_type: str | None = None,
    min_offenses: int = 1,
    limit: int = 100,
) -> "OffenderListResponse":
    where = ["cp.role ILIKE '%accused%'"]
    params: dict = {"min_off": min_offenses, "lim": limit}
    if q:
        where.append("p.name ILIKE :q"); params["q"] = f"%{q}%"
    if district:
        where.append("c.district ILIKE :district"); params["district"] = f"%{district}%"
    if crime_type:
        where.append("c.crime_type ILIKE :crime"); params["crime"] = f"%{crime_type}%"

    sql = text(f"""
        SELECT p.person_id, p.name, p.district,
               COUNT(DISTINCT cp.case_id) AS offense_count,
               MODE() WITHIN GROUP (ORDER BY c.crime_type) AS top_crime_type
        FROM persons p
        JOIN case_persons cp ON cp.person_id = p.person_id
        JOIN cases c         ON c.case_id   = cp.case_id
        WHERE {" AND ".join(where)}
        GROUP BY p.person_id, p.name, p.district
        HAVING COUNT(DISTINCT cp.case_id) >= :min_off
        ORDER BY offense_count DESC
        LIMIT :lim
    """)
    rows = (await session.execute(sql, params)).mappings().all()
    return OffenderListResponse(offenders=[
        OffenderListItem(
            person_id=int(r["person_id"]),
            display_name=r["name"] or f"Person #{r['person_id']}",
            district=r["district"],
            offense_count=int(r["offense_count"]),
            top_crime_type=r["top_crime_type"],
            risk_label=_risk_label(min(99, int(r["offense_count"]) * 15)),
        )
        for r in rows
    ])
```

Add `OffenderListItem, OffenderListResponse` to the existing `from app.schemas.intelligence import (...)` block at the top of the service file.

## C3. EDIT — `backend/app/api/routes/intelligence.py` (add the endpoint)

Add `OffenderListResponse` to the schema import block, then add this route next to `offender_profile` (clearance >= 2, consistent with the dossier):

```python
@router.get("/offenders", response_model=OffenderListResponse, tags=["intelligence"])
async def list_offenders(
    q: str | None = None,
    district: str | None = None,
    crime_type: str | None = None,
    min_offenses: int = Query(1, ge=1),
    limit: int = Query(100, le=500),
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> OffenderListResponse:
    _guard(principal, min_clearance=2)
    return await svc.list_offenders(
        session, q=q, district=district, crime_type=crime_type,
        min_offenses=min_offenses, limit=limit,
    )
```

## C4. EDIT — `frontend/src/lib/api/intelligence.ts` (add client types + call)

Add the types near the other Offender types:

```ts
export type OffenderListItem = { person_id: number; display_name: string; district: string | null; offense_count: number; top_crime_type: string | null; risk_label: string };
export type OffenderListResponse = { offenders: OffenderListItem[] };
```

Add the call inside the `intelligence = { ... }` object (e.g. right after `getPersonProfile`):

```ts
  // PS5 - browse all offenders (for the profile dropdown)
  listOffenders: (params?: URLSearchParams) =>
    apiFetch<OffenderListResponse>(`/api/offenders${params ? "?" + params : ""}`),
```

## C5. EDIT — `frontend/src/routes/profile.$personId.tsx` (add the dropdown)

The screen already imports `useState`/`useEffect`, `useNavigate`, and `intelligence`. Add a compact picker component near the top of the file (after the imports, before `PersonSearch`):

```tsx
import type { OffenderListItem } from "../lib/api/intelligence";

function OffenderPicker({ value, onPick }: { value: number; onPick: (id: number) => void }) {
  const [list, setList] = useState<OffenderListItem[]>([]);
  useEffect(() => {
    const p = new URLSearchParams({ limit: "200", min_offenses: "1" });
    intelligence.listOffenders(p).then((r) => setList(r.offenders)).catch(() => setList([]));
  }, []);
  return (
    <select
      value={value > 0 ? String(value) : ""}
      onChange={(e) => e.target.value && onPick(Number(e.target.value))}
      className="h-9 rounded-lg border bg-card px-2 text-sm"
    >
      <option value="">Browse offenders…</option>
      {list.map((o) => (
        <option key={o.person_id} value={o.person_id}>
          {o.display_name} - {o.offense_count} case(s){o.district ? ` - ${o.district}` : ""} [{o.risk_label}]
        </option>
      ))}
    </select>
  );
}
```

Then render it next to the existing `<PersonSearch ... />` in the header. The screen already defines `navigate` and reads `pid`; wire the dropdown to the same route the search uses:

```tsx
<OffenderPicker
  value={pid}
  onPick={(id) => navigate({ to: "/profile/$personId", params: { personId: String(id) } })}
/>
```

Result: officers can either **search** (existing) or **pick from the dropdown of all offenders** (new) - both load the same dossier (risk + MO fingerprint + timeline + associates) that already exists. No duplicate screen.

---

# Wiring checklist

Backend
- [ ] `backend/app/schemas/financial.py` (A1)
- [ ] `backend/app/services/financial_service.py` (A2)
- [ ] `backend/app/api/routes/financial.py` (A3)
- [ ] `backend/app/main.py` import + `include_router(... prefix="/financial")` (A4)
- [ ] (cond.) RLS read policies for financial tables (A5)
- [ ] `schemas/intelligence.py` -> `OffenderListItem`, `OffenderListResponse` (C1)
- [ ] `services/intelligence_service.py` -> `list_offenders()` + import (C2)
- [ ] `api/routes/intelligence.py` -> `GET /offenders` + import (C3)

Frontend
- [ ] `frontend/src/lib/api/financial.ts` (A6)
- [ ] `frontend/src/components/FinancialLinksPanel.tsx` (A7)
- [ ] `frontend/src/routes/network.tsx` toggle + render (A8)
- [ ] `frontend/src/lib/api/intelligence.ts` types + `listOffenders` (C4)
- [ ] `frontend/src/routes/profile.$personId.tsx` `OffenderPicker` (C5)

Data
- [ ] `SELECT count(*) FROM financial_transactions;` > 0 (seed if needed)

---

# Smoke tests

```bash
# 0) get a token (clearance L2+ user)
TOKEN=$(curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' \
  -d '{"username":"demo","rank":"DGP"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 1) money trail by person name
curl -s -X POST localhost:8000/financial/money-trail \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"entity_name":"<a seeded offender name>","depth":2}' | python -m json.tool | head -40

# 2) money trail by case id
curl -s -X POST localhost:8000/financial/money-trail \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"case_id":1,"suspicious_only":true}' | python -m json.tool | head -40

# 3) offender list
curl -s "localhost:8000/api/offenders?limit=10&min_offenses=2" \
  -H "authorization: Bearer $TOKEN" | python -m json.tool | head -40
```

Expected: (1)/(2) return `nodes`/`edges` with non-zero `total_amount` and a `flagged_count`; (3) returns offenders sorted by `offense_count` with a `risk_label`. A `403` means the test user is below clearance L2; a `200` with empty `nodes` means the financial tables are not seeded (run the seed loader).


---

# FEATURE D — PDF export of conversation history (Saved transcripts screen)

**Goal (key feature #4 from the challenge brief).** Every chat the officer has with the AI in the Console chatbox must:
1. **Auto-load** onto the *Saved transcripts* screen (the screen in the screenshot) — with **date, time, the officer who made it, and the full message thread** (both questions and AI answers).
2. Be **downloadable as a branded PDF** (per conversation and all-at-once).
3. Sit on a **redesigned, judge-ready UI** with two tabs: **Conversations** (new) and **Voice transcripts** (the existing list, preserved).

**How it fits the current code (verified):**
- The Console already persists every chat to `localStorage` under `satyam-chat-history` as `Conversation[] = { id, title, messages: ChatMessage[], createdAt, updatedAt }` where `ChatMessage = { role: "user" | "ai"; text; citations? }` (see `console.tsx`). **We reuse that exact store** — so conversations "automatically" appear on the transcripts screen with zero backend work.
- The signed-in officer is a `SessionUser = { id, name, rank, scope, clearance, station_id?, district?, range_name? }` (see `client.ts`). We snapshot this onto each conversation so the PDF shows *who* ran it.
- PDF generation is **client-side print-to-PDF** (a branded print window -> the browser's "Save as PDF"). Zero new dependencies, works offline, prints Kannada + English correctly via system fonts. (An optional one-click `jsPDF` path is noted at the end.)

> Design note (expert review): we deliberately do **not** invent a second source of truth. The transcripts screen reads the same `satyam-chat-history` the Console writes, so the two screens can never drift. Officer attribution is captured at conversation-creation time and also falls back to `api.me()` for older saved conversations.

## D1. EDIT — `frontend/src/lib/api/client.ts` (cache the signed-in officer)

So the transcripts screen and the PDF can attribute each conversation even offline. In `api.login` and `api.register`, right after `setAuthToken(out.token);`, add:

```ts
    try { localStorage.setItem("satyam-user", JSON.stringify(out.user)); } catch {}
```

And in `api.logout`, clear it:

```ts
  logout() {
    setAuthToken(null);
    try { localStorage.removeItem("satyam-user"); } catch {}
  },
```

Add this exported helper near `getAuthToken` (used by the transcripts screen as a synchronous fallback):

```ts
export function getCachedUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("satyam-user");
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}
```

## D2. NEW FILE — `frontend/src/lib/conversationStore.ts` (shared reader)

A single typed reader for the conversation history both the Console and the transcripts screen use.

```ts
// Shared access to the Console's chat history (localStorage: "satyam-chat-history").
// The transcripts screen reads from here so the two screens never drift.

export type ChatRole = "user" | "ai";

export type ChatMessage = {
  role: ChatRole;
  text: string;
  citations?: string[];
};

export type Officer = {
  id?: string;
  name: string;
  rank: string;
  scope?: string;
  district?: string;
  range_name?: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  officer?: Officer;
};

export const CHAT_STORAGE_KEY = "satyam-chat-history";

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Newest first, and drop empty conversations (no messages).
    return (parsed as Conversation[])
      .filter((c) => Array.isArray(c.messages) && c.messages.length > 0)
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export function officerLabel(o?: Officer): string {
  if (!o) return "Unknown officer";
  return [o.name, o.rank, o.district || o.range_name].filter(Boolean).join(" \u2022 ");
}
```

## D3. EDIT — `frontend/src/routes/console.tsx` (stamp the officer onto conversations)

So each saved conversation records *who* ran it. Two tiny changes.

**(a)** Extend the `Conversation` type (top of the file) to carry an optional officer snapshot:

```ts
type Officer = { id?: string; name: string; rank: string; scope?: string; district?: string; range_name?: string };

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  officer?: Officer;   // <-- added
};
```

**(b)** Add an import and a helper near the other imports / helpers:

```ts
import { getCachedUser } from "@/lib/api/client";

function currentOfficer(): Officer | undefined {
  const u = getCachedUser();
  if (!u) return undefined;
  return { id: u.id, name: u.name, rank: u.rank, scope: u.scope, district: u.district, range_name: u.range_name };
}
```

**(c)** Attach it wherever a `Conversation` is constructed. In the bootstrap `defaultConv` (and any "New conversation" handler), add `officer: currentOfficer()`:

```ts
      const defaultConv: Conversation = {
        id: generateId(),
        title: t("New conversation"),
        messages: getDefaultMessages(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        officer: currentOfficer(),   // <-- added
      };
```

> That is all the Console needs. Persistence already happens via `saveConversations(...)`, so the transcripts screen will see new conversations immediately.

## D4. NEW FILE — `frontend/src/lib/pdf/conversationPdf.ts` (branded PDF export)

Client-side, dependency-free. Opens a print window with a KSP-branded layout and triggers the browser's "Save as PDF". Renders date/time, officer, and the full thread; Kannada text prints correctly.

```ts
import type { Conversation, Officer } from "../conversationStore";
import { officerLabel } from "../conversationStore";

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(dt: string): string {
  try {
    return new Date(dt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return dt;
  }
}

function renderThread(messages: Conversation["messages"]): string {
  return messages
    .map((m) => {
      const who = m.role === "user" ? "Officer" : "Satyam AI";
      const cls = m.role === "user" ? "msg user" : "msg ai";
      const cites = m.citations && m.citations.length
        ? `<div class="cites">Sources: ${m.citations.map(esc).join(", ")}</div>`
        : "";
      const body = esc(m.text).replace(/\n/g, "<br>");
      return `<div class="${cls}"><div class="who">${who}</div><div class="bubble">${body}${cites}</div></div>`;
    })
    .join("");
}

function buildHtml(title: string, convs: Conversation[], exporter?: Officer): string {
  const now = new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" });
  const sections = convs
    .map(
      (c) => `
      <section class="conv">
        <h2>${esc(c.title || "Conversation")}</h2>
        <div class="meta">
          <span><b>Officer:</b> ${esc(officerLabel(c.officer || exporter))}</span>
          <span><b>Started:</b> ${fmt(c.createdAt)}</span>
          <span><b>Last activity:</b> ${fmt(c.updatedAt)}</span>
          <span><b>Messages:</b> ${c.messages.length}</span>
        </div>
        <div class="thread">${renderThread(c.messages)}</div>
      </section>`,
    )
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans", "Noto Sans Kannada", system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 32px; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a8a; padding-bottom: 14px; margin-bottom: 20px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .logo { width: 46px; height: 46px; border-radius: 8px; background: #1e3a8a; color: #fff; font-weight: 800; font-size: 12px; display: grid; place-items: center; letter-spacing: 1px; }
  .t1 { font-weight: 800; font-size: 15px; }
  .t2 { color: #475569; font-size: 12px; }
  .gen { text-align: right; font-size: 11px; color: #475569; line-height: 1.5; }
  .conv { break-inside: avoid; margin-bottom: 26px; }
  .conv h2 { font-size: 16px; margin: 0 0 6px; color: #1e293b; }
  .meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
  .thread { display: flex; flex-direction: column; gap: 10px; }
  .msg { display: flex; flex-direction: column; max-width: 86%; }
  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.ai { align-self: flex-start; align-items: flex-start; }
  .who { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #64748b; margin-bottom: 2px; }
  .bubble { font-size: 12.5px; line-height: 1.55; padding: 9px 12px; border-radius: 10px; border: 1px solid #e2e8f0; }
  .msg.user .bubble { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }
  .msg.ai .bubble { background: #f8fafc; color: #0f172a; }
  .cites { margin-top: 6px; font-size: 10px; color: #94a3b8; }
  footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print { body { margin: 14mm; } .doc-head { position: running(head); } }
</style></head>
<body>
  <header class="doc-head">
    <div class="brand">
      <div class="logo">SATYAM</div>
      <div>
        <div class="t1">Karnataka State Police \u2014 Crime Intelligence</div>
        <div class="t2">Conversation History Export</div>
      </div>
    </div>
    <div class="gen">Generated: ${now}<br>Exported by: ${esc(officerLabel(exporter))}</div>
  </header>
  ${sections}
  <footer>Confidential \u2014 synthetic data, investigative use only. Generated by Satyam AI.</footer>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`;
}

export function exportConversationsPdf(
  convs: Conversation[],
  exporter?: Officer,
  title = "Satyam Conversation History",
): void {
  if (!convs.length) return;
  const html = buildHtml(title, convs, exporter);
  const w = window.open("", "_blank", "width=900,height=720");
  if (!w) {
    alert("Please allow pop-ups for this site to download the PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function exportConversationPdf(conv: Conversation, exporter?: Officer): void {
  exportConversationsPdf([conv], exporter, conv.title || "Satyam Conversation");
}
```

## D5. REPLACE — `frontend/src/routes/transcripts.tsx` (redesigned, two-tab screen)

Full replacement. Tab 1 **Conversations** auto-loads the chat history (date/time/officer/full thread, expandable, per-card + bulk **Download PDF**, jump to Console). Tab 2 **Voice transcripts** keeps the original behaviour. UI is upgraded: summary stat strip, cleaner cards, message bubbles, search across both.

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState, useEffect, useMemo } from "react";
import {
  ClipboardList, Trash2, Copy, Check, Mic, Send, Download, Sparkles, Plus,
  MessageSquare, FileDown, ChevronDown, ChevronRight, User as UserIcon, Bot,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  loadConversations, saveConversations, officerLabel,
  type Conversation, type Officer,
} from "@/lib/conversationStore";
import { exportConversationsPdf, exportConversationPdf } from "@/lib/pdf/conversationPdf";
import { api, getCachedUser, type SessionUser } from "@/lib/api/client";

export const Route = createFileRoute("/transcripts")({
  head: () => ({
    meta: [
      { title: "Transcripts \u00b7 Satyam" },
      { name: "description", content: "Conversation history & saved voice transcripts." },
    ],
  }),
  component: Transcripts,
});

// ── Voice transcripts (existing feature, preserved) ──────────────────────────
type VoiceTranscript = { id: string; text: string; lang: string; createdAt: string };
const VOICE_KEY = "satyam-transcripts";

function loadVoice(): VoiceTranscript[] {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveVoice(list: VoiceTranscript[]) {
  try { localStorage.setItem(VOICE_KEY, JSON.stringify(list)); } catch {}
}

function Transcripts() {
  const t = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"chats" | "voice">("chats");
  const [search, setSearch] = useState("");

  // Officer (for PDF attribution + header). Cached first, then refreshed.
  const [officer, setOfficer] = useState<Officer | undefined>(() => {
    const u = getCachedUser();
    return u ? { id: u.id, name: u.name, rank: u.rank, scope: u.scope, district: u.district, range_name: u.range_name } : undefined;
  });
  useEffect(() => {
    api.me().then((u: SessionUser) =>
      setOfficer({ id: u.id, name: u.name, rank: u.rank, scope: u.scope, district: u.district, range_name: u.range_name }),
    ).catch(() => {});
  }, []);

  // ── Conversation history (auto-loaded from the Console store) ──────────────
  const [convs, setConvs] = useState<Conversation[]>(loadConversations);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Re-read when the tab regains focus or storage changes (live sync w/ Console).
  useEffect(() => {
    const refresh = () => setConvs(loadConversations());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const filteredConvs = useMemo(() => {
    if (!search.trim()) return convs;
    const q = search.toLowerCase();
    return convs.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.text.toLowerCase().includes(q)),
    );
  }, [convs, search]);

  const totalMessages = useMemo(
    () => convs.reduce((n, c) => n + c.messages.length, 0), [convs],
  );

  const toggle = (id: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const deleteConv = (id: string) => {
    const next = convs.filter((c) => c.id !== id);
    setConvs(next);
    saveConversations(next);
  };

  const openInConsole = (id: string) => {
    try { sessionStorage.setItem("satyam:open-conversation", id); } catch {}
    navigate({ to: "/console" });
  };

  // ── Voice transcripts state (preserved) ───────────────────────────────────
  const [voice, setVoice] = useState<VoiceTranscript[]>(loadVoice);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => { saveVoice(voice); }, [voice]);

  const filteredVoice = voice.filter((v) => !search || v.text.toLowerCase().includes(search.toLowerCase()));
  const langLabel = (l: string) => (l?.toLowerCase().startsWith("kn") ? "\u0c95\u0ca8\u0ccd\u0ca8\u0ca1" : "EN");

  const copyVoice = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); } catch {}
  };
  const sendVoiceToConsole = (v: VoiceTranscript) => {
    try { sessionStorage.setItem("satyam:pending-voice", JSON.stringify({ text: v.text, lang: v.lang, speak: true })); } catch {}
    navigate({ to: "/console" });
  };

  const fmt = (dt: string) => { try { return new Date(dt).toLocaleString(); } catch { return dt; } };

  return (
    <Shell>
      <div className="flex h-[calc(100vh-3.5rem-26px)] min-h-0 flex-col bg-background">

        {/* Header */}
        <div className="border-b-2 border-foreground bg-header px-6 py-4 text-header-foreground">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-0.5">
                {t("Conversation history")}
              </div>
              <h2 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                {tab === "chats" ? t("Saved conversations") : t("Saved transcripts")}
                <span className="text-sm font-normal opacity-60">
                  \u00b7 {tab === "chats" ? convs.length : voice.length}
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {officer && (
                <span className="hidden sm:flex items-center gap-1.5 rounded-[5px] border border-header-foreground/30 px-2.5 py-1.5 text-[11px] font-semibold">
                  <UserIcon className="h-3.5 w-3.5" /> {officerLabel(officer)}
                </span>
              )}
              {tab === "chats" && convs.length > 0 && (
                <button
                  onClick={() => exportConversationsPdf(convs, officer)}
                  className="flex items-center gap-1.5 rounded-[5px] border-2 border-header-foreground bg-primary/20 px-3 py-1.5 text-xs font-bold hover:bg-primary/30 transition"
                >
                  <FileDown className="h-3.5 w-3.5" /> {t("Download all (PDF)")}
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-3 inline-flex rounded-[6px] border-2 border-header-foreground/40 p-0.5 text-xs font-bold">
            {(["chats", "voice"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 transition ${
                  tab === k ? "bg-primary text-primary-foreground" : "opacity-70 hover:opacity-100"
                }`}
              >
                {k === "chats" ? <MessageSquare className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                {k === "chats" ? t("Conversations") : t("Voice transcripts")}
              </button>
            ))}
          </div>
        </div>

        {/* Stat strip (conversations tab) */}
        {tab === "chats" && convs.length > 0 && (
          <div className="flex flex-wrap gap-3 border-b border-border bg-card/60 px-6 py-2.5 text-xs">
            <span><b>{convs.length}</b> {t("conversations")}</span>
            <span><b>{totalMessages}</b> {t("messages")}</span>
            <span className="text-muted-foreground">{t("Auto-synced from the Console chat")}</span>
          </div>
        )}

        {/* Search */}
        <div className="border-b border-border bg-card/60 px-6 py-2.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "chats" ? t("Search conversations\u2026") : t("Search transcripts\u2026")}
            className="w-full max-w-md rounded-[5px] border-2 border-foreground bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {tab === "chats" ? (
            convs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
                <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-foreground bg-muted nb-shadow-sm">
                  <MessageSquare className="h-8 w-8 opacity-50" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-bold text-foreground">{t("No conversations yet")}</p>
                  <p className="text-xs max-w-xs">
                    {t("Start chatting with the AI in the Console. Your conversations appear here automatically, ready to download as PDF.")}
                  </p>
                </div>
                <button
                  onClick={() => navigate({ to: "/console" })}
                  className="mt-2 flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-4 py-2 text-xs font-bold text-primary-foreground nb-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] transition"
                >
                  <Sparkles className="h-3.5 w-3.5" /> {t("Open Console")}
                </button>
              </div>
            ) : filteredConvs.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                {t("No conversations match")} "{search}"
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-3">
                {filteredConvs.map((c) => {
                  const open = expanded.has(c.id);
                  return (
                    <div key={c.id} className="rounded-[5px] border-2 border-foreground bg-card nb-shadow-sm">
                      {/* Card header */}
                      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                        <button onClick={() => toggle(c.id)} className="flex items-start gap-2 text-left flex-1 min-w-0">
                          {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-bold text-sm truncate">{c.title || t("Conversation")}</div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground mt-0.5">
                              <span className="flex items-center gap-1"><UserIcon className="h-3 w-3" /> {officerLabel(c.officer || officer)}</span>
                              <span>\u00b7 {fmt(c.createdAt)}</span>
                              <span>\u00b7 {c.messages.length} {t("messages")}</span>
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => exportConversationPdf(c, officer)}
                            title={t("Download PDF")}
                            className="flex items-center gap-1 rounded-[3px] border-2 border-foreground bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground hover:bg-primary/90 transition nb-shadow-sm"
                          >
                            <FileDown className="h-3 w-3" /> PDF
                          </button>
                          <button
                            onClick={() => openInConsole(c.id)}
                            title={t("Open in Console")}
                            className="flex items-center gap-1 rounded-[3px] border border-border bg-secondary-background px-2 py-1 text-[10px] font-bold hover:bg-muted transition"
                          >
                            <Send className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => deleteConv(c.id)}
                            title={t("Delete")}
                            className="rounded-[3px] border border-border bg-secondary-background p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Thread */}
                      {open && (
                        <div className="flex flex-col gap-2.5 px-4 py-3">
                          {c.messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[85%] rounded-[8px] border px-3 py-2 text-sm leading-relaxed ${
                                m.role === "user"
                                  ? "border-foreground bg-primary text-primary-foreground"
                                  : "border-border bg-secondary-background text-foreground"
                              }`}>
                                <div className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide opacity-70">
                                  {m.role === "user" ? <UserIcon className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                                  {m.role === "user" ? t("Officer") : "Satyam AI"}
                                </div>
                                <div className="whitespace-pre-wrap">{m.text}</div>
                                {m.citations && m.citations.length > 0 && (
                                  <div className="mt-1 text-[10px] opacity-70">{t("Sources")}: {m.citations.join(", ")}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            // ── Voice transcripts tab (preserved) ─────────────────────────────
            voice.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <Mic className="h-8 w-8 opacity-40" />
                <p className="text-sm font-bold text-foreground">{t("No saved transcripts yet")}</p>
                <p className="text-xs max-w-xs text-center">{t("Open the mic panel, speak a command, then tap Save to store it here.")}</p>
              </div>
            ) : filteredVoice.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                {t("No transcripts match")} "{search}"
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-3">
                {filteredVoice.map((v) => (
                  <div key={v.id} className="rounded-[5px] border-2 border-foreground bg-card nb-shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Mic className="h-3 w-3" />
                        <span className="rounded-[3px] bg-muted px-1.5 py-0.5 font-bold text-[9px] uppercase">{langLabel(v.lang)}</span>
                        <span>\u00b7 {fmt(v.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => copyVoice(v.id, v.text)} className="flex items-center gap-1 rounded-[3px] border border-border bg-secondary-background px-2 py-1 text-[10px] font-bold hover:bg-muted transition">
                          {copiedId === v.id ? <><Check className="h-3 w-3 text-success" /> {t("Copied")}</> : <><Copy className="h-3 w-3" /> {t("Copy")}</>}
                        </button>
                        <button onClick={() => sendVoiceToConsole(v)} className="flex items-center gap-1 rounded-[3px] border-2 border-foreground bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground hover:bg-primary/90 transition nb-shadow-sm">
                          <Send className="h-3 w-3" /> {t("Send to console")}
                        </button>
                        <button onClick={() => setVoice((arr) => arr.filter((x) => x.id !== v.id))} className="rounded-[3px] border border-border bg-secondary-background p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <p className="px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{v.text}</p>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </Shell>
  );
}
```

## D6. (Optional) EDIT — `frontend/src/routes/console.tsx` (open a specific conversation from transcripts)

The "Open in Console" button writes `satyam:open-conversation`. To honour it, add this effect near the other bootstrap effects in `console.tsx`:

```tsx
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("satyam:open-conversation");
      if (!id) return;
      sessionStorage.removeItem("satyam:open-conversation");
      const target = loadConversations().find((c) => c.id === id);
      if (target) { setActiveId(target.id); setMessages(target.messages); }
    } catch {}
  }, []);
```

(If `loadConversations` isn't imported in `console.tsx`, import it from `@/lib/conversationStore`, or reuse the file's existing local `loadConversations`.)

## D7. (Optional, expert-grade) Server-side audit of exports

For a court-defensible audit trail, log each PDF export. Add a tiny endpoint and call it from `exportConversationsPdf`:

```python
# backend/app/api/routes/audit.py  (add to the existing audit router)
from pydantic import BaseModel

class ExportLog(BaseModel):
    kind: str                 # "conversation_pdf"
    conversation_ids: list[str] = []
    count: int = 0

@router.post("/export-log")
async def export_log(
    body: ExportLog,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
):
    await write_audit(session, action=f"export.{body.kind}", user_id=principal.officer_id,
                      query_text=f"count={body.count} ids={','.join(body.conversation_ids)[:500]}")
    return {"ok": True}
```

```ts
// fire-and-forget at the top of exportConversationsPdf(...)
import { getAuthToken, API_BASE } from "../api/client";
fetch(`${API_BASE}/audit/export-log`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(getAuthToken() ? { authorization: `Bearer ${getAuthToken()}` } : {}) },
  body: JSON.stringify({ kind: "conversation_pdf", conversation_ids: convs.map((c) => c.id), count: convs.length }),
}).catch(() => {});
```

## D8. (Optional) True one-click `.pdf` (no print dialog)

The print-window approach uses the browser's "Save as PDF", which is robust and dependency-free. If you want a direct file download instead, add `jspdf` + `html2canvas` and render the same HTML to a canvas:

```bash
npm i jspdf html2canvas
```

Keep the print version as the default fallback (some embedded browsers block pop-ups but allow `jsPDF`).

---

## Wiring checklist (Feature D)

Frontend
- [ ] `client.ts` — cache `satyam-user` on login/register, clear on logout, add `getCachedUser()` (D1)
- [ ] `lib/conversationStore.ts` — NEW shared reader/types (D2)
- [ ] `console.tsx` — add `officer` to `Conversation`, `currentOfficer()`, stamp on creation (D3)
- [ ] `lib/pdf/conversationPdf.ts` — NEW branded PDF export (D4)
- [ ] `routes/transcripts.tsx` — REPLACE with two-tab redesign (D5)
- [ ] `console.tsx` — (optional) honour `satyam:open-conversation` (D6)

Backend (optional)
- [ ] `audit.py` — `POST /audit/export-log` + client call (D7)

## Smoke test (Feature D)

1. Open **Console**, ask 2–3 questions (English + Kannada). Confirm replies render.
2. Go to **Saved transcripts -> Conversations**: the conversation(s) appear with title, **officer name + rank**, **date/time**, and message count.
3. Expand a card: full question/answer thread shows as bubbles (citations included).
4. Click **PDF** on a card -> a branded print window opens -> "Save as PDF" produces a clean KSP-headed document with officer + timestamp + full thread.
5. Click **Download all (PDF)** -> every conversation in one document.
6. Switch to **Voice transcripts** tab -> original save/copy/send behaviour still works.

---

## Agent prompt (copy-paste for your AI coding agent)

> **Task:** Implement "PDF export of conversation history" in the Satyam project (React + TanStack Router frontend). Conversations from the Console chatbox must auto-appear on the Saved transcripts screen with date, time, the officer who ran them, and the full message thread, and be downloadable as a branded PDF (per conversation and all at once). Redesign that screen with two tabs (Conversations, Voice transcripts).
>
> **Do exactly this, using the code in `SATYAM_MISSING_FEATURES_BUILD_SPEC.md` -> "FEATURE D":**
> 1. Edit `frontend/src/lib/api/client.ts`: cache the signed-in user to `localStorage["satyam-user"]` in `api.login` and `api.register` (right after `setAuthToken`), clear it in `api.logout`, and add the exported `getCachedUser()` helper (spec D1).
> 2. Create `frontend/src/lib/conversationStore.ts` exactly as in spec D2 (shared types + `loadConversations`/`saveConversations`/`officerLabel`, reading `localStorage["satyam-chat-history"]`).
> 3. Edit `frontend/src/routes/console.tsx`: add an optional `officer` field to the `Conversation` type, add the `currentOfficer()` helper (import `getCachedUser`), and set `officer: currentOfficer()` everywhere a `Conversation` object is created (spec D3). Optionally add the `satyam:open-conversation` effect (spec D6).
> 4. Create `frontend/src/lib/pdf/conversationPdf.ts` exactly as in spec D4 (branded, dependency-free print-to-PDF; exports `exportConversationsPdf` and `exportConversationPdf`).
> 5. Replace `frontend/src/routes/transcripts.tsx` with the two-tab redesign in spec D5 (Conversations tab auto-loads chat history with officer/date/time/expandable thread, per-card + bulk PDF download, Open-in-Console; Voice transcripts tab preserves the original behaviour; upgraded UI with stat strip and search).
> 6. Do NOT introduce new runtime dependencies (use the print-to-PDF approach). Keep all existing imports valid; reuse `@/lib/i18n` `useT` for labels. Preserve the existing `satyam-transcripts` voice store.
>
> **Acceptance:** After chatting in the Console, the conversation shows on Saved transcripts with the officer's name+rank and timestamp; expanding shows the full Q&A thread; clicking PDF produces a KSP-headed document; the Voice transcripts tab still saves/copies/sends. No TypeScript/build errors.
