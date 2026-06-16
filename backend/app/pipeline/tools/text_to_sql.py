"""NL -> guarded SQL -> rows, with PII masking for low-clearance callers.

The SQL lane now masks PII columns before rows leave this layer (BUG-R3).
RLS only scopes WHICH rows are visible; it does NOT mask columns.
Masking here mirrors the same tiers used by case_service / masking.py:
  - L3+ (DySP / PI and above): names visible.
  - L1/L2 (PC / HC / ASI / SI / PSI): PII columns bullet-masked.
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.registry import get_sql_llm
from app.pipeline.prompts import SQL_SCHEMA, SQL_SYSTEM
from app.pipeline.tools.sql_guard import UnsafeSQL, sanitize

if TYPE_CHECKING:
    from app.core.rbac import Principal


# Columns that may carry personal identifying information in query results.
_PII_COLUMNS: frozenset[str] = frozenset({
    "name", "full_name", "victim_name", "accused_name",
    "complainant", "io_name", "place_of_offence",
})


def _mask_rows(rows: list[dict], principal: "Principal") -> list[dict]:
    """Bullet-mask PII columns for callers below clearance L3."""
    if principal.clearance >= 3:
        return rows  # L3/L4 see everything from the SQL lane
    from app.core.masking import _mask_str
    out = []
    for r in rows:
        rr = dict(r)
        for col in list(rr):
            if col.lower() in _PII_COLUMNS and rr[col] is not None:
                rr[col] = _mask_str(rr[col])
        out.append(rr)
    return out


async def generate_sql(
    question: str,
    slots: dict | None = None,
    *,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> str:
    llm = get_sql_llm(sql_engine)
    prompt = question if not slots else f"{question}\n\nKnown filters: {json.dumps(slots)}"
    try:
        raw = await llm.complete(prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA)
    except Exception:
        # Gemini 429 / timeout → fall back to Groq for SQL generation
        from app.models.registry import get_fallback_llm
        raw = await get_fallback_llm().complete(
            prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA
        )
    try:
        candidate = json.loads(raw).get("sql", "")
    except Exception:
        candidate = raw
    return sanitize(candidate)


async def run_sql(session: AsyncSession, sql: str) -> list[dict]:
    result = await session.execute(text(sql))
    rows = result.mappings().all()
    return [dict(r) for r in rows]


async def answer_with_sql(
    session: AsyncSession,
    question: str,
    slots: dict | None = None,
    *,
    principal: "Principal",
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> tuple[str, list[dict]]:
    """Return (safe_sql, masked_rows). Raises UnsafeSQL if the model produced bad SQL."""
    sql = await generate_sql(question, slots, sql_engine=sql_engine)
    rows = await run_sql(session, sql)
    return sql, _mask_rows(rows, principal)


__all__ = ["answer_with_sql", "generate_sql", "run_sql", "UnsafeSQL"]
