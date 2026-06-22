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
from app.config import get_settings
from app.pipeline.tools.rule_sql import build_sql as build_rule_sql, relaxation_note

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


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences that LLMs sometimes wrap JSON responses in.

    Gemini 2.5 Flash frequently returns:
        ```json
        { "sql": "SELECT ..." }
        ```
    instead of raw JSON, even when instructed not to.
    This strips the fences so json.loads() can parse the content.
    """
    t = text.strip()
    # Remove ```json ... ``` or ``` ... ``` fences
    if t.startswith("```"):
        lines = t.splitlines()
        # Drop the first line (``` or ```json) and the last ``` line
        inner_lines = []
        for i, line in enumerate(lines):
            if i == 0 and line.strip().startswith("```"):
                continue
            if i == len(lines) - 1 and line.strip() == "```":
                continue
            inner_lines.append(line)
        t = "\n".join(inner_lines).strip()
    return t


async def generate_sql(
    question: str,
    slots: dict | None = None,
    *,
    history: list[dict] | None = None,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> str:
    # D5.2 FIX: in demo/keyless mode the model stubs only echo — skip them
    # entirely and use the deterministic rule-based generator (still guarded).
    if get_settings().demo_mode:
        rule = build_rule_sql(question, slots)
        if rule:
            return rule

    llm = get_sql_llm(sql_engine)

    # Build a context-aware prompt: include recent conversation turns so the
    # model can resolve follow-ups ("what about last year", "and in Mysuru").
    parts = []
    if history:
        convo = "\n".join(
            f"{turn.get('role', 'user')}: {turn.get('text', '')}"
            for turn in history[-6:]
            if turn.get("text")
        )
        if convo:
            parts.append(f"Conversation so far:\n{convo}")
    if slots:
        parts.append(f"Known filters (carry forward unless changed): {json.dumps(slots)}")
    parts.append(f"Current question: {question}")
    prompt = "\n\n".join(parts)

    try:
        raw = await llm.complete(prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA)
    except Exception:
        # Gemini 429 / timeout → fall back to Groq for SQL generation
        from app.models.registry import get_fallback_llm
        raw = await get_fallback_llm().complete(
            prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA
        )

    # Strip any markdown code fences Gemini 2.5 Flash wraps around JSON responses
    cleaned = _strip_markdown_fences(raw)

    try:
        candidate = json.loads(cleaned).get("sql", "")
    except Exception:
        # Last resort: if the whole response is just a SQL string, use it directly
        candidate = cleaned

    try:
        return sanitize(candidate)
    except UnsafeSQL:
        # LLM produced junk or an echo — recover deterministically
        rule = build_rule_sql(question, slots)
        if rule:
            return rule
        raise


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
    history: list[dict] | None = None,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> tuple[str, list[dict], str | None]:
    """Return (safe_sql, masked_rows, recovery_note).

    recovery_note is a human-friendly string when the query had to be broadened
    to find results (e.g. dropping a year filter), else None. Raises UnsafeSQL
    if no usable SQL exists at all.
    """
    sql = await generate_sql(question, slots, history=history, sql_engine=sql_engine)
    rows = await run_sql(session, sql)
    note: str | None = None

    # ── State-of-the-art zero-result recovery ──────────────────────────────
    # If the primary query returns nothing, progressively broaden the search
    # instead of dead-ending with "no records". Each level relaxes one filter
    # and we surface a note so the officer knows what was widened.
    if not rows:
        # Level 0: deterministic rule SQL with full filters (catches LLM over-constraint)
        rule0 = build_rule_sql(question, slots, relax=0)
        if rule0 and rule0.strip() != sql.strip():
            r = await run_sql(session, rule0)
            if r:
                sql, rows = rule0, r

    if not rows:
        # Levels 1-3: drop time filter, then crime filter, then all filters.
        for level in (1, 2, 3):
            relaxed = build_rule_sql(question, slots, relax=level)
            if not relaxed:
                continue
            r = await run_sql(session, relaxed)
            if r:
                sql, rows = relaxed, r
                note = relaxation_note(question, slots, level)
                break

    return sql, _mask_rows(rows, principal), note


__all__ = ["answer_with_sql", "generate_sql", "run_sql", "UnsafeSQL"]
