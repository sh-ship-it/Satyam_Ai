"""Audit-log endpoint with hash-chain verification badge (admin-only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import verify_chain
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.db.models import AuditLog

router = APIRouter()


@router.get("")
async def list_audit(
    limit: int = 100,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    try:
        require(principal, Permission.READ_AUDIT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    rows = (
        await session.execute(
            select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 500))
        )
    ).scalars().all()
    chain_valid = await verify_chain(session)
    return {
        "chain_valid": chain_valid,
        "count": len(rows),
        "entries": [
            {
                "id": r.id,
                "ts": r.ts.isoformat() if r.ts else None,
                "actor": r.actor,
                "role": r.role,
                "action": r.action,
                "resource": r.resource,
                "detail": r.detail,
                "hash": r.hash,
            }
            for r in rows
        ],
    }
