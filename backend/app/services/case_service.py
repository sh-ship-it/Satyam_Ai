"""Case read service — new schema, RLS-scoped + server-side masking."""
from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.masking import mask_case
from app.core.rbac import Principal
from app.db.models import Case, CasePerson, Narrative, Person


async def list_cases(
    session: AsyncSession, *,
    crime_type: str | None = None,
    district: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict]:
    stmt = select(Case)
    if crime_type:
        stmt = stmt.where(Case.crime_type.ilike(f"%{crime_type}%"))
    if district:
        stmt = stmt.where(Case.district.ilike(f"%{district}%"))
    if status:
        stmt = stmt.where(Case.status.ilike(f"%{status}%"))
    stmt = stmt.order_by(Case.report_date.desc()).limit(min(limit, 200))
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "case_id":       c.case_id,
            "fir_number":    c.fir_number,
            "crime_type":    c.crime_type,
            "crime_category": c.crime_category,
            "legal_code":    c.legal_code,
            "status":        c.status,
            "district":      c.district,
            "range_name":    c.range_name,
            "report_date":   c.report_date.isoformat() if c.report_date else None,
            "fir_year":      c.fir_year,
        }
        for c in rows
    ]


async def get_case(
    session: AsyncSession, principal: Principal, case_id: int
) -> dict | None:
    c = (
        await session.execute(select(Case).where(Case.case_id == case_id))
    ).scalar_one_or_none()
    if c is None:
        return None

    # Load persons via join
    people = (
        await session.execute(
            select(Person, CasePerson.role)
            .join(CasePerson, CasePerson.person_id == Person.person_id)
            .where(CasePerson.case_id == case_id)
        )
    ).all()

    # Load first English narrative (if any)
    narrative = (
        await session.execute(
            select(Narrative)
            .where(Narrative.case_id == case_id, Narrative.language == "en")
            .limit(1)
        )
    ).scalar_one_or_none()

    detail = {
        "case_id":        c.case_id,
        "fir_number":     c.fir_number,
        "fir_year":       c.fir_year,
        "crime_type":     c.crime_type,
        "crime_category": c.crime_category,
        "legal_code":     c.legal_code,
        "sections":       c.sections,
        "fir_type":       c.fir_type,
        "status":         c.status,
        "complaint_mode": c.complaint_mode,
        "motive":         c.motive,
        "district":       c.district,
        "range_name":     c.range_name,
        "station_name":   c.station_name,
        "report_date":    c.report_date.isoformat() if c.report_date else None,
        "incident_date":  c.incident_date.isoformat() if c.incident_date else None,
        "place_of_offence": c.place_of_offence,
        "latitude":       c.latitude,
        "longitude":      c.longitude,
        "victim_count":   c.victim_count,
        "accused_count":  c.accused_count,
        "arrested_count": c.arrested_count,
        "charge_sheeted": c.charge_sheeted,
        "convicted":      c.convicted,
        "persons": [
            {
                "person_id": p.person_id,
                "name":      p.name,
                "role":      role,
                "gender":    p.gender,
                "age":       p.age,
            }
            for p, role in people
        ],
        "narrative": narrative.body if narrative else None,
    }
    masked = mask_case(detail, principal)
    masked["masked"] = masked.pop("_masked", False)
    return masked
