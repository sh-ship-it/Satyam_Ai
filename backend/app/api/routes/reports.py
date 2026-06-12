"""Report builder endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.report import ReportRequest, ReportResponse
from app.services import report_service

router = APIRouter()


@router.post("/build", response_model=ReportResponse)
async def build(
    req: ReportRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> ReportResponse:
    try:
        require(principal, Permission.BUILD_REPORT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return await report_service.build(session, principal, req)
