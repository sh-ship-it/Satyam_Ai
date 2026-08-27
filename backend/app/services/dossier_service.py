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


import json
from pathlib import Path
import datetime as dt

_SEED_FILE = Path(__file__).parent.parent.parent / "seed" / "demo_dossier.json"


async def _auto_seed(session: AsyncSession) -> None:
    """Auto-seed the 10 demo dossier subjects if table is empty."""
    if not _SEED_FILE.exists():
        return
    try:
        data = json.loads(_SEED_FILE.read_text(encoding="utf-8"))
        for p in data:
            dob_val = dt.date.fromisoformat(p["dob"]) if p.get("dob") else None
            person = DossierPerson(
                slug=p["slug"],
                full_name=p["full_name"],
                aliases=p.get("aliases", []),
                gender=p.get("gender"),
                dob=dob_val,
                age=p.get("age"),
                height_cm=p.get("height_cm"),
                build=p.get("build"),
                complexion=p.get("complexion"),
                identifying_marks=p.get("identifying_marks"),
                blood_group=p.get("blood_group"),
                nationality=p.get("nationality", "Indian"),
                risk_level=p.get("risk_level"),
                wanted_status=p.get("wanted_status"),
                primary_phone=p.get("primary_phone"),
                secondary_phone=p.get("secondary_phone"),
                email=p.get("email"),
                home_address=p.get("home_address"),
                district=p.get("district"),
                pincode=p.get("pincode"),
                photo_front=p.get("photo_front"),
                photo_left=p.get("photo_left"),
                photo_right=p.get("photo_right"),
                summary=p.get("summary"),
            )
            session.add(person)
            await session.flush()
            for f in p.get("family", []):
                session.add(DossierFamily(
                    demo_id=person.demo_id,
                    name=f["name"],
                    relation=f["relation"],
                    age=f.get("age"),
                    phone=f.get("phone"),
                    occupation=f.get("occupation"),
                    address=f.get("address"),
                    notes=f.get("notes"),
                ))
            for b in p.get("banks", []):
                opened_val = dt.date.fromisoformat(b["opened_on"]) if b.get("opened_on") else None
                session.add(DossierBankAccount(
                    demo_id=person.demo_id,
                    bank_name=b["bank_name"],
                    account_no=b["account_no"],
                    ifsc=b.get("ifsc"),
                    branch=b.get("branch"),
                    account_type=b.get("account_type"),
                    balance_inr=Decimal(str(b["balance_inr"])) if b.get("balance_inr") is not None else None,
                    status=b.get("status", "Active"),
                    opened_on=opened_val,
                    flagged=b.get("flagged", False),
                    flag_reason=b.get("flag_reason"),
                ))
            for c in p.get("crimes", []):
                occ_val = dt.date.fromisoformat(c["occurred_on"]) if c.get("occurred_on") else None
                session.add(DossierCrime(
                    demo_id=person.demo_id,
                    case_ref=c["case_ref"],
                    crime_type=c["crime_type"],
                    sections=c.get("sections"),
                    role=c.get("role"),
                    status=c.get("status"),
                    occurred_on=occ_val,
                    station=c.get("station"),
                    district=c.get("district"),
                    sentence=c.get("sentence"),
                    narrative=c.get("narrative"),
                ))
            for ct in p.get("contacts", []):
                session.add(DossierContact(
                    demo_id=person.demo_id,
                    label=ct.get("label"),
                    name=ct.get("name"),
                    relation=ct.get("relation"),
                    phone=ct.get("phone"),
                    notes=ct.get("notes"),
                ))
        await session.commit()
    except Exception:
        await session.rollback()


async def list_dossiers(session: AsyncSession) -> list[DossierListItem]:
    """Return lightweight list of all dossier subjects."""
    stmt = select(DossierPerson).order_by(DossierPerson.demo_id)
    result = await session.execute(stmt)
    rows = result.scalars().all()
    if not rows:
        await _auto_seed(session)
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
