"""Link-analysis (ego network) endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.network import EgoRequest, EgoResponse
from app.services import network_service

router = APIRouter()


@router.post("/ego", response_model=EgoResponse)
async def ego(
    req: EgoRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> EgoResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return await network_service.ego(session, req)
