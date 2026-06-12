"""Geospatial hotspot endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.map import HotspotRequest, HotspotResponse
from app.services import map_service

router = APIRouter()


@router.post("/hotspots", response_model=HotspotResponse)
async def hotspots(
    req: HotspotRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> HotspotResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return await map_service.hotspots(session, req)
