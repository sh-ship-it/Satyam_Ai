"""Case read service (RLS + app-side masking)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.masking import mask_case
from app.core.rbac import Principal
from app.db.models import Case, CasePerson, Narrative, Person


async def list_cases(
    session: AsyncSession, *, crime_type: str | None = None,
    district: str | None = None, limit: int = 50,
) -> list[dict]:
    stmt = select(Case)
    if crime_type:
        stmt = stmt.where(Case.crime_type == crime_type)
    if district:
        stmt = stmt.where(Case.district == district)
    stmt = stmt.limit(min(limit, 200))
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "fir_no": c.fir_no, "crime_type": c.crime_type, "status": c.status,
            "district": c.district, "date": c.date.isoformat() if c.date else None,
            "sensitivity_flag": c.sensitivity_flag,
        }
        for c in rows
    ]


async def get_case(
    session: AsyncSession, principal: Principal, fir_no: str
) -> dict | None:
    c = (await session.execute(select(Case).where(Case.fir_no == fir_no))).scalar_one_or_none()
    if c is None:
        return None
    people = (
        await session.execute(
            select(Person, CasePerson.role)
            .join(CasePerson, CasePerson.person_id == Person.person_id)
            .where(CasePerson.case_id == fir_no)
        )
    ).all()
    narrative = (
        await session.execute(select(Narrative).where(Narrative.case_id == fir_no))
    ).scalar_one_or_none()

    detail = {
        "fir_no": c.fir_no, "crime_type": c.crime_type, "status": c.status,
        "district": c.district, "date": c.date.isoformat() if c.date else None,
        "ipc_sections": c.ipc_sections, "station_id": c.station_id,
        "lat": c.lat, "lng": c.lng, "sensitivity_flag": c.sensitivity_flag,
        "jurisdiction_id": c.jurisdiction_id,
        "persons": [
            {"person_id": p.person_id, "name": p.name, "role": role,
             "age": p.age, "gender": p.gender}
            for p, role in people
        ],
        "narrative": narrative.text if narrative else None,
    }
    masked = mask_case(detail, principal)
    masked["masked"] = masked.pop("_masked", False)
    return masked
