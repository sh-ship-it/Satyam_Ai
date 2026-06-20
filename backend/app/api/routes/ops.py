"""Response-Ops router. Mounted at /api/ops only when ENABLE_RESPONSE_OPS=true."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.core.security import decode_token
from app.db.ops_models import IncidentDispatch, PatrolSuggestion, PatrolUnit, RiskZone, TrafficSignal
from app.schemas.ops import (
    DispatchOut, DispatchRequest, PatrolOut,
    RiskZoneOut, RiskZonesResponse, SuggestionOut, SuggestionsResponse,
)
from app.services.ops import corridor_service, risk_service, routing_service, sim_service
from app.services.ops.ws_manager import manager

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


@router.get("/patrols", response_model=list[PatrolOut])
async def patrols(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[PatrolOut]:
    _guard(principal)
    rows = (await session.execute(select(PatrolUnit))).scalars().all()
    return [PatrolOut(id=p.id, callsign=p.callsign, status=p.status, lat=p.lat, lng=p.lng, district=p.district) for p in rows]


@router.post("/dispatch", response_model=DispatchOut)
async def dispatch(
    req: DispatchRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> DispatchOut:
    _guard(principal)
    # pick patrol
    if req.patrol_id:
        patrol = (await session.execute(select(PatrolUnit).where(PatrolUnit.id == req.patrol_id))).scalar_one_or_none()
    else:
        idle = (await session.execute(select(PatrolUnit).where(PatrolUnit.status == "IDLE"))).scalars().all()
        patrol = min(
            (p for p in idle if p.lat is not None),
            key=lambda p: routing_service.haversine_km(p.lat, p.lng, req.scene_lat, req.scene_lng),
            default=None,
        )
    if not patrol:
        raise HTTPException(status_code=409, detail="no available patrol unit")

    route = await routing_service.get_route(
        from_lat=patrol.lat, from_lng=patrol.lng, to_lat=req.scene_lat, to_lng=req.scene_lng,
    )
    disp = IncidentDispatch(
        case_id=req.case_id, patrol_id=patrol.id, scene_lat=req.scene_lat, scene_lng=req.scene_lng,
        status="ACCEPTED", route_geometry={"type": "LineString", "coordinates": route["coords"]},
        distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
    )
    session.add(disp)
    await session.flush()
    return DispatchOut(
        id=disp.id, patrol_id=patrol.id, patrol_callsign=patrol.callsign, case_id=req.case_id,
        scene_lat=req.scene_lat, scene_lng=req.scene_lng, status=disp.status,
        distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
        route=route["coords"],
    )


@router.post("/dispatch/{dispatch_id}/simulate")
async def simulate(
    dispatch_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    disp = (await session.execute(select(IncidentDispatch).where(IncidentDispatch.id == dispatch_id))).scalar_one_or_none()
    if not disp or not disp.route_geometry:
        raise HTTPException(status_code=404, detail="dispatch or route not found")
    coords = disp.route_geometry["coordinates"]
    sim_service.start(
        dispatch_id, disp.patrol_id, coords, disp.duration_sec or 60,
        on_move=corridor_service.activate_near,
    )
    return {"ok": True, "dispatchId": dispatch_id, "points": len(coords)}


@router.get("/dispatch/{dispatch_id}/state")
async def dispatch_state(
    dispatch_id: int,
    principal: Principal = Depends(get_principal),
) -> dict:
    """Polling fallback for clients that can't hold a WebSocket."""
    _guard(principal)
    return sim_service.latest_state(dispatch_id) or {"status": "UNKNOWN"}


@router.websocket("/ws")
async def ops_ws(ws: WebSocket, token: str | None = None) -> None:
    """Live event stream. Auth via ?token=<jwt> query param (WS can't send headers)."""
    if not token:
        await ws.close(code=4401)
        return
    try:
        decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; client may send pings
    except WebSocketDisconnect:
        await manager.disconnect(ws)


@router.get("/signals")
async def signals(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[dict]:
    _guard(principal)
    rows = (await session.execute(select(TrafficSignal))).scalars().all()
    return [{"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state} for s in rows]
