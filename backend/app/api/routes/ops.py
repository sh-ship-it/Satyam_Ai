"""Response-Ops router. Mounted at /api/ops only when ENABLE_RESPONSE_OPS=true."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.db.ops_models import PatrolSuggestion, PatrolUnit, RiskZone
from app.schemas.ops import (
    RiskZoneOut, RiskZonesResponse, SuggestionOut, SuggestionsResponse,
)
from app.services.ops import risk_service

router = APIRouter()


def _guard(principal: Principal) -> None:
    try:
        require(principal, Permission.RUN_ANALYTICS)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/health")
async def ops_health(principal: Principal = Depends(get_principal)) -> dict:
    """Cheap liveness probe for the Response-Ops module."""
    return {"ok": True, "module": "response-ops", "rank": principal.rank}


@router.get("/risk-zones", response_model=RiskZonesResponse)
async def risk_zones(
    refresh: bool = False,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> RiskZonesResponse:
    _guard(principal)
    recomputed = await risk_service.recompute_if_stale(session, force=refresh)
    zones = (await session.execute(
        select(RiskZone).order_by(RiskZone.risk_score.desc())
    )).scalars().all()
    return RiskZonesResponse(
        zones=[RiskZoneOut(
            id=z.id, grid_key=z.grid_key, center_lat=z.center_lat, center_lng=z.center_lng,
            risk_score=z.risk_score, risk_label=z.risk_label, incident_count=z.incident_count,
            peak_hour=z.peak_hour, reasons=z.reasons or [],
        ) for z in zones],
        recomputed=recomputed, total=len(zones),
    )


@router.get("/suggestions", response_model=SuggestionsResponse)
async def suggestions(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SuggestionsResponse:
    _guard(principal)
    rows = (await session.execute(
        select(PatrolSuggestion, PatrolUnit.callsign)
        .join(PatrolUnit, PatrolUnit.id == PatrolSuggestion.patrol_id, isouter=True)
        .where(PatrolSuggestion.status == "PENDING")
        .order_by(PatrolSuggestion.response_improve_sec.desc())
    )).all()
    return SuggestionsResponse(
        suggestions=[SuggestionOut(
            id=s.id, risk_zone_id=s.risk_zone_id, patrol_id=s.patrol_id, patrol_callsign=cs,
            from_lat=s.from_lat, from_lng=s.from_lng, to_lat=s.to_lat, to_lng=s.to_lng,
            distance_km=s.distance_km, response_improve_sec=s.response_improve_sec,
            status=s.status, reasons=s.reasons or [],
        ) for s, cs in rows],
        total=len(rows),
    )


@router.post("/suggestions/{sug_id}/{action}")
async def act_on_suggestion(
    sug_id: int, action: str,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    if action not in ("accept", "dismiss"):
        raise HTTPException(status_code=400, detail="action must be accept|dismiss")
    new_status = "ACCEPTED" if action == "accept" else "DISMISSED"
    await session.execute(
        update(PatrolSuggestion).where(PatrolSuggestion.id == sug_id).values(status=new_status)
    )
    # Accepting pre-positions the patrol (status stays IDLE, just relocates on the map).
    if action == "accept":
        sug = (await session.execute(
            select(PatrolSuggestion).where(PatrolSuggestion.id == sug_id)
        )).scalar_one_or_none()
        if sug and sug.patrol_id:
            await session.execute(
                update(PatrolUnit).where(PatrolUnit.id == sug.patrol_id)
                .values(lat=sug.to_lat, lng=sug.to_lng)
            )
    return {"ok": True, "id": sug_id, "status": new_status}