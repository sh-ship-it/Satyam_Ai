"""Geospatial hotspot endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.map import (
    HotspotRequest, HotspotResponse,
    StationBreakdownRequest, StationBreakdownResponse,
    OffenderTrailRequest, OffenderTrailResponse, TrailPoint
)
from app.services import map_service
from app.pipeline.tools import analytics

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


@router.post("/station-breakdown", response_model=StationBreakdownResponse)
async def station_breakdown(
    req: StationBreakdownRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> StationBreakdownResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    return await map_service.station_breakdown(session, req)


@router.post("/offender-trail", response_model=OffenderTrailResponse)
async def offender_trail(
    req: OffenderTrailRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> OffenderTrailResponse:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    seed = req.person_id or req.entity_name or ""
    label, pts = await analytics.offender_trail(session, person_id=seed)
    return OffenderTrailResponse(
        person_id=str(seed),
        label=label,
        points=[TrailPoint(**p) for p in pts],
    )

