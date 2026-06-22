"""ORM models for demo_dossier_* tables.

FULLY ISOLATED from the synthetic dataset — no FKs to persons/cases/etc.
No RLS. Read-only via the admin dossier endpoint (clearance 4+).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Text, func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models import Base


class DossierPerson(Base):
    __tablename__ = "demo_dossier_persons"

    demo_id:          Mapped[int]            = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug:             Mapped[str]            = mapped_column(Text, unique=True, nullable=False)
    full_name:        Mapped[str]            = mapped_column(Text, nullable=False)
    aliases:          Mapped[Optional[list]] = mapped_column(ARRAY(Text), default=list)
    gender:           Mapped[Optional[str]]  = mapped_column(Text)
    dob:              Mapped[Optional[dt.date]] = mapped_column(Date)
    age:              Mapped[Optional[int]]  = mapped_column(Integer)
    height_cm:        Mapped[Optional[int]]  = mapped_column(Integer)
    build:            Mapped[Optional[str]]  = mapped_column(Text)
    complexion:       Mapped[Optional[str]]  = mapped_column(Text)
    identifying_marks: Mapped[Optional[str]] = mapped_column(Text)
    blood_group:      Mapped[Optional[str]]  = mapped_column(Text)
    nationality:      Mapped[Optional[str]]  = mapped_column(Text, default="Indian")
    risk_level:       Mapped[Optional[str]]  = mapped_column(Text)
    wanted_status:    Mapped[Optional[str]]  = mapped_column(Text)
    primary_phone:    Mapped[Optional[str]]  = mapped_column(Text)
    secondary_phone:  Mapped[Optional[str]]  = mapped_column(Text)
    email:            Mapped[Optional[str]]  = mapped_column(Text)
    home_address:     Mapped[Optional[str]]  = mapped_column(Text)
    district:         Mapped[Optional[str]]  = mapped_column(Text)
    pincode:          Mapped[Optional[str]]  = mapped_column(Text)
    photo_front:      Mapped[Optional[str]]  = mapped_column(Text)
    photo_left:       Mapped[Optional[str]]  = mapped_column(Text)
    photo_right:      Mapped[Optional[str]]  = mapped_column(Text)
    summary:          Mapped[Optional[str]]  = mapped_column(Text)
    created_at:       Mapped[Optional[dt.datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    family:   Mapped[list["DossierFamily"]]      = relationship(back_populates="person", lazy="selectin")
    banks:    Mapped[list["DossierBankAccount"]]  = relationship(back_populates="person", lazy="selectin")
    crimes:   Mapped[list["DossierCrime"]]        = relationship(back_populates="person", lazy="selectin")
    contacts: Mapped[list["DossierContact"]]      = relationship(back_populates="person", lazy="selectin")


class DossierFamily(Base):
    __tablename__ = "demo_dossier_family"

    id:         Mapped[int]           = mapped_column(Integer, primary_key=True, autoincrement=True)
    demo_id:    Mapped[int]           = mapped_column(ForeignKey("demo_dossier_persons.demo_id", ondelete="CASCADE"))
    name:       Mapped[str]           = mapped_column(Text, nullable=False)
    relation:   Mapped[str]           = mapped_column(Text, nullable=False)
    age:        Mapped[Optional[int]] = mapped_column(Integer)
    phone:      Mapped[Optional[str]] = mapped_column(Text)
    occupation: Mapped[Optional[str]] = mapped_column(Text)
    address:    Mapped[Optional[str]] = mapped_column(Text)
    notes:      Mapped[Optional[str]] = mapped_column(Text)

    person: Mapped["DossierPerson"] = relationship(back_populates="family")


class DossierBankAccount(Base):
    __tablename__ = "demo_dossier_bank_accounts"

    id:           Mapped[int]            = mapped_column(Integer, primary_key=True, autoincrement=True)
    demo_id:      Mapped[int]            = mapped_column(ForeignKey("demo_dossier_persons.demo_id", ondelete="CASCADE"))
    bank_name:    Mapped[str]            = mapped_column(Text, nullable=False)
    account_no:   Mapped[str]            = mapped_column(Text, nullable=False)
    ifsc:         Mapped[Optional[str]]  = mapped_column(Text)
    branch:       Mapped[Optional[str]]  = mapped_column(Text)
    account_type: Mapped[Optional[str]]  = mapped_column(Text)
    balance_inr   = mapped_column(Numeric(14, 2), nullable=True)
    status:       Mapped[Optional[str]]  = mapped_column(Text, default="Active")
    opened_on:    Mapped[Optional[dt.date]] = mapped_column(Date)
    flagged:      Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    flag_reason:  Mapped[Optional[str]]  = mapped_column(Text)

    person: Mapped["DossierPerson"] = relationship(back_populates="banks")


class DossierCrime(Base):
    __tablename__ = "demo_dossier_crimes"

    id:          Mapped[int]            = mapped_column(Integer, primary_key=True, autoincrement=True)
    demo_id:     Mapped[int]            = mapped_column(ForeignKey("demo_dossier_persons.demo_id", ondelete="CASCADE"))
    case_ref:    Mapped[str]            = mapped_column(Text, nullable=False)
    crime_type:  Mapped[str]            = mapped_column(Text, nullable=False)
    sections:    Mapped[Optional[str]]  = mapped_column(Text)
    role:        Mapped[Optional[str]]  = mapped_column(Text)
    status:      Mapped[Optional[str]]  = mapped_column(Text)
    occurred_on: Mapped[Optional[dt.date]] = mapped_column(Date)
    station:     Mapped[Optional[str]]  = mapped_column(Text)
    district:    Mapped[Optional[str]]  = mapped_column(Text)
    sentence:    Mapped[Optional[str]]  = mapped_column(Text)
    narrative:   Mapped[Optional[str]]  = mapped_column(Text)

    person: Mapped["DossierPerson"] = relationship(back_populates="crimes")


class DossierContact(Base):
    __tablename__ = "demo_dossier_contacts"

    id:       Mapped[int]           = mapped_column(Integer, primary_key=True, autoincrement=True)
    demo_id:  Mapped[int]           = mapped_column(ForeignKey("demo_dossier_persons.demo_id", ondelete="CASCADE"))
    label:    Mapped[Optional[str]] = mapped_column(Text)
    name:     Mapped[Optional[str]] = mapped_column(Text)
    relation: Mapped[Optional[str]] = mapped_column(Text)
    phone:    Mapped[Optional[str]] = mapped_column(Text)
    notes:    Mapped[Optional[str]] = mapped_column(Text)

    person: Mapped["DossierPerson"] = relationship(back_populates="contacts")
