"""FastAPI dependencies: authenticated principal + RLS-scoped DB session.

The JWT carries: sub (officer_id or demo-username), name, rank, station_id,
district, range, clearance.  The scoped session stamps Postgres GUCs before
any query so RLS policies in the DB enforce jurisdiction scope.
"""
from __future__ import annotations

from typing import AsyncIterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal, resolve_scope, resolve_clearance
from app.core.security import decode_token
from app.db.rls import apply_rls_context
from app.db.session import get_sessionmaker


def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    """Decode the bearer JWT into a Principal. Raises 401 on any problem."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid or expired token")

    rank = str(claims.get("rank") or claims.get("role") or "viewer")
    clearance = int(claims.get("clearance") or resolve_clearance(rank))
    scope = str(claims.get("scope") or resolve_scope(rank))

    return Principal(
        id=str(claims.get("sub", "")),
        name=str(claims.get("name", "")),
        rank=rank,
        scope=scope,
        clearance=clearance,
        officer_id=claims.get("officer_id"),
        station_id=claims.get("station_id"),
        district=str(claims.get("district") or ""),
        range_name=str(claims.get("range") or ""),
    )


async def stamp_rls(session: AsyncSession, principal: Principal) -> None:
    """Stamp `session`'s CURRENT TRANSACTION with the caller's jurisdiction.

    The single mapping from Principal to Postgres GUCs. Anything that opens its
    own session must call this, because apply_rls_context uses
    set_config(..., true), which is transaction-local: the settings vanish the
    moment that transaction ends, and every RLS policy then matches nothing.
    """
    await apply_rls_context(
        session,
        scope=principal.scope,
        range_name=principal.range_name,
        district=principal.district,
        station_id=principal.station_id,
        clearance=principal.clearance,
        officer_id=principal.officer_id,
    )


async def get_scoped_session(
    principal: Principal = Depends(get_principal),
) -> AsyncIterator[AsyncSession]:
    """Yield a transaction-scoped session stamped with the caller's RLS context.

    NOT usable from a StreamingResponse. FastAPI tears a yield-dependency down
    when the handler returns, which for a streaming route is *before* the
    response body is generated, so the transaction — and with it the
    transaction-local RLS context — is gone by the time the generator runs. A
    streaming route must open and stamp its own session inside the generator;
    see app/api/routes/chat.py.
    """
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        async with session.begin():
            await stamp_rls(session, principal)
            yield session
