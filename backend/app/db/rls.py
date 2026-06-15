"""Row-Level Security helpers — v2 schema.

The new schema uses `app.*` GUCs (app.scope, app.range, app.district,
app.station_id, app.clearance, app.officer_id) instead of the old `satyam.*`
namespace.  `fn_scope_ok()` in the DB reads these to enforce jurisdiction scope.

Scope levels (from rank_access):
  state    → all rows
  range    → cases where "range" = officer's range
  district → cases where district = officer's district
  station  → cases where station_id = officer's station_id
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def apply_rls_context(
    session: AsyncSession,
    *,
    scope: str,          # state | range | district | station
    range_name: str,
    district: str,
    station_id: int | None,
    clearance: int,
    officer_id: int | None = None,
) -> None:
    """Stamp the current transaction with the caller's jurisdiction context."""
    await session.execute(
        text(
            "SELECT"
            "  set_config('app.scope',      :scope,      true),"
            "  set_config('app.range',      :range,      true),"
            "  set_config('app.district',   :district,   true),"
            "  set_config('app.station_id', :station_id, true),"
            "  set_config('app.clearance',  :clearance,  true),"
            "  set_config('app.officer_id', :officer_id, true),"
            # Hard cap on runaway Text-to-SQL queries (5 s)
            "  set_config('statement_timeout', '5000',  true)"
        ),
        {
            "scope":      scope,
            "range":      range_name or "",
            "district":   district or "",
            "station_id": str(station_id) if station_id is not None else "",
            "clearance":  str(clearance),
            "officer_id": str(officer_id) if officer_id is not None else "",
        },
    )
