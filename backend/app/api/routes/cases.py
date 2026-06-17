"""Case read endpoints (RLS-scoped + server-side masked)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
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


@router.get("/search")
async def search_persons_and_cases(
    q: str = Query("", min_length=1),
    limit: int = Query(12, le=30),
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[dict]:
    """
    Unified search: returns persons (by name) + cases (by FIR number / crime type).
    Used by the profile search autocomplete.
    """
    try:
        require(principal, Permission.READ_CASE)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    pat = f"%{q}%"

    # Person search
    person_sql = text("""
        SELECT p.person_id, p.name, p.gender, p.age, p.district,
               COUNT(cp.case_id) AS case_count,
               STRING_AGG(DISTINCT c.crime_type, ', ' ORDER BY c.crime_type) AS crime_types
        FROM persons p
        LEFT JOIN case_persons cp ON cp.person_id = p.person_id
        LEFT JOIN cases c ON c.case_id = cp.case_id
        WHERE p.name ILIKE :pat
        GROUP BY p.person_id, p.name, p.gender, p.age, p.district
        ORDER BY case_count DESC
        LIMIT :lim
    """)
    persons = (await session.execute(person_sql, {"pat": pat, "lim": limit // 2})).mappings().all()

    # Case / FIR search
    case_sql = text("""
        SELECT case_id, fir_number, crime_type, district, status, report_date
        FROM cases
        WHERE fir_number ILIKE :pat
           OR crime_type ILIKE :pat
           OR place_of_offence ILIKE :pat
        ORDER BY report_date DESC NULLS LAST
        LIMIT :lim
    """)
    cases = (await session.execute(case_sql, {"pat": pat, "lim": limit // 2})).mappings().all()

    results = []
    for p in persons:
        results.append({
            "type": "person",
            "id": p["person_id"],
            "label": p["name"] or f"Person #{p['person_id']}",
            "sub": f"{p['gender'] or '—'} · Age {p['age'] or '?'} · {p['district'] or '—'} · {p['case_count']} cases",
            "crime_types": p["crime_types"] or "",
            "gender": p["gender"],
            "age": p["age"],
            "district": p["district"],
            "case_count": int(p["case_count"] or 0),
        })
    for c in cases:
        results.append({
            "type": "case",
            "id": c["case_id"],
            "label": c["fir_number"] or f"Case #{c['case_id']}",
            "sub": f"{c['crime_type']} · {c['district']} · {str(c['report_date'] or '')[:10]}",
            "status": c["status"],
            "crime_type": c["crime_type"],
            "district": c["district"],
        })
    return results


@router.get("/{case_id}")
async def get_case(
    case_id: int,
    lang: str = "en",
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    try:
        require(principal, Permission.READ_CASE)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    case = await case_service.get_case(session, principal, case_id, lang=lang)
    if case is None:
        raise HTTPException(status_code=404, detail="case not found")
    return case
