"""Case read endpoints (RLS-scoped + server-side masked)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.services import case_service

router = APIRouter()


@router.get("")
async def list_cases(
    crime_type: str | None = None,
    district: str | None = None,
    status: str | None = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[dict]:
    try:
        require(principal, Permission.READ_CASE)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return await case_service.list_cases(
        session, crime_type=crime_type, district=district, status=status, limit=limit
    )


@router.get("/{case_id}")
async def get_case(
    case_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    try:
        require(principal, Permission.READ_CASE)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    case = await case_service.get_case(session, principal, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="case not found")
    return case
