"""Pydantic response schemas for the Person 360 dossier feature."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Nested child schemas
# ---------------------------------------------------------------------------

class DossierFamilyItem(BaseModel):
    id: int
    name: str
    relation: str
    age: Optional[int] = None
    phone: Optional[str] = None
    occupation: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class DossierBankAccountItem(BaseModel):
    id: int
    bank_name: str
    account_no: str
    ifsc: Optional[str] = None
    branch: Optional[str] = None
    account_type: Optional[str] = None
    balance_inr: Optional[Decimal] = None
    status: Optional[str] = None
    opened_on: Optional[dt.date] = None
    flagged: Optional[bool] = False
    flag_reason: Optional[str] = None

    model_config = {"from_attributes": True}


class DossierCrimeItem(BaseModel):
    id: int
    case_ref: str
    crime_type: str
    sections: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    occurred_on: Optional[dt.date] = None
    station: Optional[str] = None
    district: Optional[str] = None
    sentence: Optional[str] = None
    narrative: Optional[str] = None

    model_config = {"from_attributes": True}


class DossierContactItem(BaseModel):
    id: int
    label: Optional[str] = None
    name: Optional[str] = None
    relation: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# List-view item (lightweight, for the browse table)
# ---------------------------------------------------------------------------

class DossierListItem(BaseModel):
    demo_id: int
    slug: str
    full_name: str
    age: Optional[int] = None
    district: Optional[str] = None
    risk_level: Optional[str] = None
    wanted_status: Optional[str] = None
    photo_front: Optional[str] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Detail view (full 360 dossier)
# ---------------------------------------------------------------------------

class DossierDetail(BaseModel):
    # Core identity
    demo_id: int
    slug: str
    full_name: str
    aliases: Optional[list[str]] = None
    gender: Optional[str] = None
    dob: Optional[dt.date] = None
    age: Optional[int] = None
    height_cm: Optional[int] = None
    build: Optional[str] = None
    complexion: Optional[str] = None
    identifying_marks: Optional[str] = None
    blood_group: Optional[str] = None
    nationality: Optional[str] = None
    risk_level: Optional[str] = None
    wanted_status: Optional[str] = None

    # Contact / location
    primary_phone: Optional[str] = None
    secondary_phone: Optional[str] = None
    email: Optional[str] = None
    home_address: Optional[str] = None
    district: Optional[str] = None
    pincode: Optional[str] = None

    # Photos
    photo_front: Optional[str] = None
    photo_left: Optional[str] = None
    photo_right: Optional[str] = None

    # Narrative
    summary: Optional[str] = None
    created_at: Optional[dt.datetime] = None

    # Nested relations
    family: list[DossierFamilyItem] = []
    banks: list[DossierBankAccountItem] = []
    crimes: list[DossierCrimeItem] = []
    contacts: list[DossierContactItem] = []

    # Computed aggregates
    bank_account_count: int = 0
    total_balance_inr: Decimal = Decimal("0.00")
    open_case_count: int = 0

    model_config = {"from_attributes": True}
