"""Audit-log endpoint with hash-chain verification (admin/L3+ only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import verify_chain
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.db.models import AuditLog, User, Officer

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
            select(AuditLog).order_by(AuditLog.audit_id.desc()).limit(min(limit, 500))
        )
    ).scalars().all()

    # Total row count (for the hash-chain verification card / footer)
    total: int = (
        await session.execute(select(func.count()).select_from(AuditLog))
    ).scalar_one()

    # Fetch officer info for users in the audit log
    user_ids = [r.user_id for r in rows if r.user_id is not None]
    officers = {}
    if user_ids:
        orows = (
            await session.execute(
                select(User.user_id, Officer.name, Officer.rank)
                .join(Officer, User.officer_id == Officer.officer_id)
                .where(User.user_id.in_(set(user_ids)))
            )
        ).all()
        officers = {o.user_id: (o.name, o.rank) for o in orows}

    def _entry(r):
        name, rank = officers.get(r.user_id, (None, None))
        action = (r.action or "").upper()
        return {
            "id": r.audit_id,
            "ts": r.at.isoformat() if r.at else None,
            "user": name or (f"officer #{r.user_id}" if r.user_id is not None else "system"),
            "role": rank or "—",
            "action": "DENY" if "DENY" in action or "BLOCK" in action else "ALLOW",
            "query": r.query_text or r.generated_sql or r.action or "",
            "result": r.reason or (f"case #{r.case_id}" if r.case_id is not None else "—"),
            "src": r.action or "audit_log",
            "hash": r.row_hash,
        }

    chain_valid = await verify_chain(session)
    return {
        "chain_valid": chain_valid,
        "total": total,
        "count": len(rows),
        "entries": [_entry(r) for r in rows],
    }

