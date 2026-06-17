"""Intelligence feature endpoints — PS2/PS5/PS6/PS8/PS3/PS4.

All endpoints are guarded by Permission.CHAT (clearance >= 1).
Sensitive endpoints (profile, network, socio) require clearance >= 2 and are audit-logged.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.intelligence import (
    BacktestResponse, CaseTimelineResponse, ForecastAlertsResponse,
    ForecastHotspotsResponse, GraphResponse, MOClustersResponse,
    OffenderProfileResponse, PersonTimelineResponse, RingsResponse,
    SeasonalResponse, SimilarCasesResponse, SimilarSearchRequest,
    SocialRiskIndexResponse, SocioDemographicsResponse,
    SocioCorrelationResponse, TrendsResponse,
)
from app.services import intelligence_service as svc

router = APIRouter()


def _guard(principal: Principal, min_clearance: int = 1) -> None:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if principal.clearance < min_clearance:
        raise HTTPException(403, detail=f"Requires clearance L{min_clearance}+")


# ── PS2 — Network rings ───────────────────────────────────────────────────────

@router.get("/network/rings", response_model=RingsResponse, tags=["intelligence"])
async def network_rings(
    limit: int = Query(10, le=50),
    crime_type: str | None = None,
    district: str | None = None,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> RingsResponse:
    _guard(principal, min_clearance=2)
    await write_audit(session, action="intelligence.network_rings", user_id=principal.officer_id,
                      # NOTE: principal.officer_id currently carries users.user_id (see auth.login).
                      # audit_log.user_id is FK -> users.user_id, so this is correct.
                      query_text=f"rings limit={limit}")
    return await svc.get_rings(session, principal, limit=limit, crime_type=crime_type, district=district)


@router.get("/network/case/{case_id}", response_model=GraphResponse, tags=["intelligence"])
async def network_case(
    case_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> GraphResponse:
    _guard(principal)
    await write_audit(session, action="intelligence.network_case", user_id=principal.officer_id,
                      query_text=f"case={case_id}")
    return await svc.get_case_graph(session, principal, case_id)


@router.get("/network/person/{person_id}", response_model=GraphResponse, tags=["intelligence"])
async def network_person(
    person_id: int,
    depth: int = Query(1, ge=1, le=2),
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> GraphResponse:
    _guard(principal)
    await write_audit(session, action="intelligence.network_person", user_id=principal.officer_id,
                      query_text=f"person={person_id} depth={depth}")
    return await svc.get_person_graph(session, principal, person_id, depth=depth)


# ── PS6 — Similar cases + timelines ──────────────────────────────────────────

@router.get("/cases/{case_id}/similar", response_model=SimilarCasesResponse, tags=["intelligence"])
async def similar_cases(
    case_id: int,
    limit: int = Query(5, le=20),
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SimilarCasesResponse:
    _guard(principal)
    return await svc.get_similar_cases(session, case_id, limit=limit)


@router.post("/cases/similar/search", response_model=SimilarCasesResponse, tags=["intelligence"])
async def similar_cases_search(
    req: SimilarSearchRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SimilarCasesResponse:
    _guard(principal)
    # Text-based search: find cases matching crime type keyword
    from sqlalchemy import text
    sql = text("""
        SELECT case_id FROM cases
        WHERE crime_type ILIKE :q OR place_of_offence ILIKE :q
        ORDER BY (crime_type ILIKE :q) DESC, case_id DESC
        LIMIT 1
    """)
    r = (await session.execute(sql, {"q": f"%{req.query}%"})).mappings().first()
    # D9 FIX: return empty result instead of silently anchoring to case_id=1
    if not r:
        return SimilarCasesResponse(case_id=0, matches=[])
    return await svc.get_similar_cases(session, int(r["case_id"]), limit=req.limit)


@router.get("/cases/{case_id}/timeline", response_model=CaseTimelineResponse, tags=["intelligence"])
async def case_timeline(
    case_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> CaseTimelineResponse:
    _guard(principal)
    return await svc.get_case_timeline(session, case_id)


@router.get("/persons/{person_id}/timeline", response_model=PersonTimelineResponse, tags=["intelligence"])
async def person_timeline(
    person_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> PersonTimelineResponse:
    _guard(principal)
    return await svc.get_person_timeline(session, person_id)


# ── PS5 — Offender profile ────────────────────────────────────────────────────

@router.get("/persons/{person_id}/profile", response_model=OffenderProfileResponse, tags=["intelligence"])
async def offender_profile(
    person_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> OffenderProfileResponse:
    _guard(principal, min_clearance=2)
    await write_audit(session, action="intelligence.offender_profile", user_id=principal.officer_id,
                      query_text=f"person={person_id}")
    return await svc.get_offender_profile(session, principal, person_id)


# ── PS8 — Forecasting ─────────────────────────────────────────────────────────

@router.get("/forecast/hotspots", response_model=ForecastHotspotsResponse, tags=["intelligence"])
async def forecast_hotspots(
    crime_type: str | None = None,
    district: str | None = None,
    horizon_days: int = Query(7, ge=1, le=30),
    grid_size: float = Query(0.02, ge=0.005, le=0.1),
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> ForecastHotspotsResponse:
    _guard(principal, min_clearance=2)
    return await svc.get_forecast_hotspots(session, crime_type=crime_type, district=district,
                                            horizon_days=horizon_days, grid_size=grid_size)


@router.get("/forecast/alerts", response_model=ForecastAlertsResponse, tags=["intelligence"])
async def forecast_alerts(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> ForecastAlertsResponse:
    _guard(principal, min_clearance=2)
    await write_audit(session, action="intelligence.forecast_alerts", user_id=principal.officer_id,
                      query_text="forecast_alerts")
    return await svc.get_forecast_alerts(session)


@router.get("/forecast/backtest", response_model=BacktestResponse, tags=["intelligence"])
async def forecast_backtest(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> BacktestResponse:
    _guard(principal)
    return await svc.get_forecast_backtest(session)


# ── PS3 — Trends & MO ─────────────────────────────────────────────────────────

@router.get("/trends", response_model=TrendsResponse, tags=["intelligence"])
async def trends(
    crime_type: str | None = None,
    district: str | None = None,
    granularity: str = Query("month", regex="^(month|quarter|week)$"),
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> TrendsResponse:
    _guard(principal)
    return await svc.get_trends(session, crime_type=crime_type, district=district, granularity=granularity)


@router.get("/trends/seasonal", response_model=SeasonalResponse, tags=["intelligence"])
async def trends_seasonal(
    crime_type: str | None = None,
    district: str | None = None,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SeasonalResponse:
    _guard(principal)
    return await svc.get_seasonal(session, crime_type=crime_type, district=district)


@router.get("/mo/clusters", response_model=MOClustersResponse, tags=["intelligence"])
async def mo_clusters(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> MOClustersResponse:
    _guard(principal)
    return await svc.get_mo_clusters(session)


# ── PS4 — Socio dashboard ─────────────────────────────────────────────────────

@router.get("/socio/demographics", response_model=SocioDemographicsResponse, tags=["intelligence"])
async def socio_demographics(
    role: str = Query("Accused", regex="^(Accused|Victim|Complainant|Witness)$"),
    crime_type: str | None = None,
    district: str | None = None,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SocioDemographicsResponse:
    _guard(principal, min_clearance=3)
    await write_audit(session, action="intelligence.socio_demographics", user_id=principal.officer_id,
                      query_text=f"role={role}")
    return await svc.get_socio_demographics(session, role=role, crime_type=crime_type, district=district)


@router.get("/socio/correlation", response_model=SocioCorrelationResponse, tags=["intelligence"])
async def socio_correlation(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SocioCorrelationResponse:
    _guard(principal, min_clearance=3)
    return await svc.get_socio_correlation(session)


@router.get("/socio/risk-index", response_model=SocialRiskIndexResponse, tags=["intelligence"])
async def social_risk_index(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SocialRiskIndexResponse:
    _guard(principal, min_clearance=2)
    return await svc.get_social_risk_index(session)
