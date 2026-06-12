"""Row-Level Security helpers.

Every request runs as the Postgres role `satyam_app`. Before issuing any query
we stamp the connection with the caller's identity via `SET LOCAL`, and the RLS
policies in migrations/001_init.sql use those settings to scope rows by
jurisdiction / station / clearance. This keeps the security boundary in the
database, not just the app — see risk R-RLS in the spec (RLS on all lanes).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def apply_rls_context(
    session: AsyncSession,
    *,
    user_id: str,
    role: str,
    jurisdiction_id: str | None,
    clearance: int,
) -> None:
    """Stamp the current transaction with the caller's security context."""
    await session.execute(
        text(
            "SELECT set_config('satyam.user_id', :uid, true),"
            "       set_config('satyam.role', :role, true),"
            "       set_config('satyam.jurisdiction_id', :jur, true),"
            "       set_config('satyam.clearance', :clr, true),"
            # Clamp every statement on this connection so a runaway Text-to-SQL
            # query (e.g. an accidental cross join) cannot pin a DB connection.
            "       set_config('statement_timeout', :stmt_timeout, true)"
        ),
        {
            "uid": user_id,
            "role": role,
            "jur": jurisdiction_id or "",
            "clr": str(clearance),
            "stmt_timeout": "5000",
        },
    )
