"""Service layer for the Person 360 demo dossier feature.

Queries ONLY demo_dossier_* tables. Never references persons, cases,
case_persons, narratives, financial_accounts, or financial_transactions.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.demo_dossier_models import (
    DossierPerson,
    DossierBankAccount,
    DossierCrime,
    DossierFamily,
    DossierContact,
)
from app.schemas.dossier import DossierDetail, DossierListItem


async def list_dossiers(session: AsyncSession) -> list[DossierListItem]:
    """Return lightweight list of all dossier subjects."""
    stmt = select(DossierPerson).order_by(DossierPerson.demo_id)
    result = await session.execute(stmt)
    rows = result.scalars().all()
    return [
        DossierListItem(
            demo_id=p.demo_id,
            slug=p.slug,
            full_name=p.full_name,
            age=p.age,
            district=p.district,
            risk_level=p.risk_level,
            wanted_status=p.wanted_status,
            photo_front=p.photo_front,
        )
        for p in rows
    ]


async def get_dossier(session: AsyncSession, demo_id: int) -> DossierDetail | None:
    """Return full 360 dossier for a given demo_id, or None if not found."""
    stmt = (
        select(DossierPerson)
        .where(DossierPerson.demo_id == demo_id)
        .options(
            selectinload(DossierPerson.family),
            selectinload(DossierPerson.banks),
            selectinload(DossierPerson.crimes),
            selectinload(DossierPerson.contacts),
        )
    )
    result = await session.execute(stmt)
    person = result.scalar_one_or_none()
    if person is None:
        return None

    # Compute aggregates from already-loaded relationships
    bank_account_count = len(person.banks)
    total_balance_inr = sum(
        (b.balance_inr or Decimal("0.00")) for b in person.banks
    )
    open_case_count = sum(
        1 for c in person.crimes
        if (c.status or "").lower() not in ("closed", "convicted", "acquitted", "discharged")
    )

    return DossierDetail(
        demo_id=person.demo_id,
        slug=person.slug,
        full_name=person.full_name,
        aliases=person.aliases,
        gender=person.gender,
        dob=person.dob,
        age=person.age,
        height_cm=person.height_cm,
        build=person.build,
        complexion=person.complexion,
        identifying_marks=person.identifying_marks,
        blood_group=person.blood_group,
        nationality=person.nationality,
        risk_level=person.risk_level,
        wanted_status=person.wanted_status,
        primary_phone=person.primary_phone,
        secondary_phone=person.secondary_phone,
        email=person.email,
        home_address=person.home_address,
        district=person.district,
        pincode=person.pincode,
        photo_front=person.photo_front,
        photo_left=person.photo_left,
        photo_right=person.photo_right,
        summary=person.summary,
        created_at=person.created_at,
        family=person.family,
        banks=person.banks,
        crimes=person.crimes,
        contacts=person.contacts,
        bank_account_count=bank_account_count,
        total_balance_inr=Decimal(str(total_balance_inr)),
        open_case_count=open_case_count,
    )
