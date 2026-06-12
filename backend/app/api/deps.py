"""FastAPI dependencies: authenticated principal + RLS-scoped DB session.

The scoped session is the security spine of every data lane. It:
  1. opens ONE explicit transaction (so `SET LOCAL` GUCs persist for every
     subsequent query on the same connection),
  2. stamps the caller's identity (role / jurisdiction / clearance) used by the
     Postgres RLS policies,
  3. clamps a per-statement timeout so a runaway Text-to-SQL query can't pin a
     connection.
Because the app connects as the non-superuser `satyam_app` role, RLS is actually
enforced (a superuser would bypass it).
"""
from __future__ import annotations

from typing import AsyncIterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal, Role
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
    except Exception:  # noqa: BLE001 - any decode/expiry error is a 401
        raise HTTPException(status_code=401, detail="invalid or expired token")
    try:
        role = Role(claims.get("role", "viewer"))
    except ValueError:
        role = Role.VIEWER
    return Principal(
        id=str(claims.get("sub", "")),
        name=str(claims.get("name", "")),
        role=role,
        station_id=claims.get("station_id"),
        jurisdiction_id=claims.get("jurisdiction_id"),
        clearance=int(claims.get("clearance", 1) or 1),
    )


async def get_scoped_session(
    principal: Principal = Depends(get_principal),
) -> AsyncIterator[AsyncSession]:
    """Yield a transaction-scoped session stamped with the caller's RLS context."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Single explicit transaction so SET LOCAL settings stay in effect for
        # all reads/writes on this connection, then commit on clean exit.
        async with session.begin():
            await apply_rls_context(
                session,
                user_id=principal.id,
                role=principal.role.value,
                jurisdiction_id=principal.jurisdiction_id,
                clearance=principal.clearance,
            )
            yield session
