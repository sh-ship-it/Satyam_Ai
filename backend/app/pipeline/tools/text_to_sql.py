"""NL -> guarded SQL -> rows. Runs inside the caller's RLS-scoped session."""
from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.registry import get_llm
from app.pipeline.prompts import SQL_SCHEMA, SQL_SYSTEM
from app.pipeline.tools.sql_guard import UnsafeSQL, sanitize


async def generate_sql(question: str, slots: dict | None = None) -> str:
    llm = get_llm()
    prompt = question if not slots else f"{question}\n\nKnown filters: {json.dumps(slots)}"
    raw = await llm.complete(prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA)
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
    session: AsyncSession, question: str, slots: dict | None = None
) -> tuple[str, list[dict]]:
    """Return (safe_sql, rows). Raises UnsafeSQL if the model produced bad SQL."""
    sql = await generate_sql(question, slots)
    rows = await run_sql(session, sql)
    return sql, rows


__all__ = ["answer_with_sql", "generate_sql", "run_sql", "UnsafeSQL"]
