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
            text("""
                SELECT DISTINCT acc FROM (
                    SELECT from_account_id AS acc FROM financial_transactions WHERE case_id = :cid
                    UNION
                    SELECT to_account_id   AS acc FROM financial_transactions WHERE case_id = :cid
                ) s
            """),
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
    txn_sql = text("""
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
    """).bindparams(bindparam("ids", expanding=True))

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
        acc_sql = text("""
            SELECT a.account_id, a.account_type, a.bank_name, a.district,
                   a.kyc_risk_level, a.person_id, p.name AS person_name
            FROM financial_accounts a
            LEFT JOIN persons p ON p.person_id = a.person_id
            WHERE a.account_id IN :ids
        """).bindparams(bindparam("ids", expanding=True))
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
