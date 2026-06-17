"""PS7 - Financial money-trail endpoints. Clearance >= 2, audit-logged."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.financial import MoneyTrailRequest, MoneyTrailResponse
from app.services import financial_service

router = APIRouter()


@router.post("/money-trail", response_model=MoneyTrailResponse)
async def money_trail(
    req: MoneyTrailRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> MoneyTrailResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    if principal.clearance < 2:
        raise HTTPException(status_code=403, detail="Requires clearance L2+")
    await write_audit(
        session, action="financial.money_trail", user_id=principal.officer_id,
        query_text=f"seed={req.person_id or req.case_id}",
    )
    return await financial_service.money_trail(session, req)
