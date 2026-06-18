"""ORM models — matches 002_schema_v2.sql (satyam_synthetic_dataset).

Tables: stations, officers, cases, persons, case_persons, narratives,
        rank_access, users, audit_log, v_officer_session (view).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Float, ForeignKey,
    Integer, Numeric, SmallInteger, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

try:
    from pgvector.sqlalchemy import Vector
    _EMBED = Vector(1024)
except Exception:
    _EMBED = Text  # type: ignore[assignment]


class Base(DeclarativeBase):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------------------
# Reference / org tables
# ---------------------------------------------------------------------------

class Station(Base):
    __tablename__ = "stations"
    station_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    station_name: Mapped[str] = mapped_column(Text)
    district: Mapped[str] = mapped_column(Text)
    range_name: Mapped[str] = mapped_column("range", Text)  # quoted keyword
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    longitude: Mapped[Optional[float]] = mapped_column(Float)


class Officer(Base):
    __tablename__ = "officers"
    officer_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    rank: Mapped[str] = mapped_column(Text)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.station_id"))


# ---------------------------------------------------------------------------
# Core crime tables
# ---------------------------------------------------------------------------

class Case(Base):
    __tablename__ = "cases"
    case_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fir_number: Mapped[str] = mapped_column(Text)  # not globally unique (repeats per station/year)
    fir_year: Mapped[int] = mapped_column(Integer)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.station_id"))
    station_name: Mapped[str] = mapped_column(Text)
    district: Mapped[str] = mapped_column(Text, index=True)
    range_name: Mapped[str] = mapped_column("range", Text, index=True)
    crime_type: Mapped[str] = mapped_column(Text, index=True)
    crime_category: Mapped[str] = mapped_column(Text)  # IPC | SLL
    legal_code: Mapped[str] = mapped_column(Text)       # IPC | BNS
    sections: Mapped[Optional[str]] = mapped_column(Text)  # pipe-joined
    fir_type: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, index=True)
    complaint_mode: Mapped[Optional[str]] = mapped_column(Text)
    motive: Mapped[Optional[str]] = mapped_column(Text)
    incident_date: Mapped[Optional[dt.date]] = mapped_column(Date)
    incident_time: Mapped[Optional[str]] = mapped_column(Text)
    report_date: Mapped[dt.date] = mapped_column(Date)
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    longitude: Mapped[Optional[float]] = mapped_column(Float)
    place_of_offence: Mapped[Optional[str]] = mapped_column(Text)
    io_officer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("officers.officer_id"))
    io_name: Mapped[Optional[str]] = mapped_column(Text)
    victim_count: Mapped[int] = mapped_column(Integer, default=0)
    accused_count: Mapped[int] = mapped_column(Integer, default=0)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    arrested_count: Mapped[int] = mapped_column(Integer, default=0)
    charge_sheeted: Mapped[bool] = mapped_column(Boolean, default=False)
    convicted: Mapped[bool] = mapped_column(Boolean, default=False)
    # sections_arr is GENERATED ALWAYS — not mapped (read via raw SQL if needed)

    persons: Mapped[list["CasePerson"]] = relationship(back_populates="case")
    narratives: Mapped[list["Narrative"]] = relationship(back_populates="case")


class Person(Base):
    __tablename__ = "persons"
    person_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    gender: Mapped[Optional[str]] = mapped_column(Text)
    age: Mapped[Optional[int]] = mapped_column(Integer)
    district: Mapped[Optional[str]] = mapped_column(Text)


class CasePerson(Base):
    __tablename__ = "case_persons"
    __table_args__ = (UniqueConstraint("case_id", "person_id", "role"),)
    # No surrogate PK in schema; use composite
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.case_id", ondelete="CASCADE"), primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("persons.person_id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(Text, primary_key=True)

    case: Mapped[Case] = relationship(back_populates="persons")
    person: Mapped[Person] = relationship()


class Narrative(Base):
    __tablename__ = "narratives"
    narrative_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.case_id", ondelete="CASCADE"))
    language: Mapped[str] = mapped_column(Text)    # 'en' | 'kn'
    body: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(_EMBED, nullable=True)
    # body_tsv is GENERATED ALWAYS — not mapped

    case: Mapped[Case] = relationship(back_populates="narratives")


# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------

class RankAccess(Base):
    __tablename__ = "rank_access"
    rank: Mapped[str] = mapped_column(Text, primary_key=True)
    scope_level: Mapped[str] = mapped_column(Text)  # state|range|district|station
    clearance: Mapped[int] = mapped_column(SmallInteger)
    gazetted: Mapped[bool] = mapped_column(Boolean)
    description: Mapped[Optional[str]] = mapped_column(Text)


class User(Base):
    __tablename__ = "users"
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(Text, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    full_name: Mapped[Optional[str]] = mapped_column(Text)          # display name
    email: Mapped[Optional[str]] = mapped_column(Text)              # optional e-mail
    photo_b64: Mapped[Optional[str]] = mapped_column(Text)          # base-64 profile photo
    officer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("officers.officer_id"))
    assigned_rank: Mapped[Optional[str]] = mapped_column(ForeignKey("rank_access.rank"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------------------------------------------------------------------------
# Hash-chained audit log
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_log"
    audit_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.user_id"))
    action: Mapped[str] = mapped_column(Text)
    case_id: Mapped[Optional[int]] = mapped_column(Integer)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    query_text: Mapped[Optional[str]] = mapped_column(Text)
    generated_sql: Mapped[Optional[str]] = mapped_column(Text)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    prev_hash: Mapped[Optional[str]] = mapped_column(Text)
    row_hash: Mapped[str] = mapped_column(Text)


# ---------------------------------------------------------------------------
# PS4 — Socio-economic indicators (aggregate / planning only)
# IMPORTANT: never use for individual offender risk scoring
# ---------------------------------------------------------------------------

class DistrictSocioEconomicIndicator(Base):
    __tablename__ = "district_socio_economic_indicators"

    district:              Mapped[str]            = mapped_column(Text, primary_key=True)
    population:            Mapped[Optional[int]]   = mapped_column(Integer)
    literacy_rate:         Mapped[Optional[float]] = mapped_column(Float)
    urbanization_percent:  Mapped[Optional[float]] = mapped_column(Float)
    income_index:          Mapped[Optional[float]] = mapped_column(Float)
    unemployment_proxy:    Mapped[Optional[float]] = mapped_column(Float)


# ---------------------------------------------------------------------------
# PS7 — Financial accounts (synthetic, for money-trail analysis)
# ---------------------------------------------------------------------------

class FinancialAccount(Base):
    __tablename__ = "financial_accounts"

    account_id:     Mapped[int]            = mapped_column(BigInteger, primary_key=True)
    person_id:      Mapped[int]            = mapped_column(ForeignKey("persons.person_id", ondelete="CASCADE"))
    account_type:   Mapped[str]            = mapped_column(Text)
    bank_name:      Mapped[str]            = mapped_column(Text)
    district:       Mapped[Optional[str]]  = mapped_column(Text)
    opened_date:    Mapped[Optional[dt.date]] = mapped_column(Date)
    kyc_risk_level: Mapped[Optional[str]]  = mapped_column(Text)  # Low | Medium | High


# ---------------------------------------------------------------------------
# PS7 — Financial transactions (synthetic, pattern-flagged)
# pattern_flag values: high_value | near_incident_date | rapid_repeated | circular_flow
# These are investigative leads, NOT proof of guilt.
# ---------------------------------------------------------------------------

class FinancialTransaction(Base):
    __tablename__ = "financial_transactions"

    transaction_id:   Mapped[int]             = mapped_column(BigInteger, primary_key=True)
    from_account_id:  Mapped[int]             = mapped_column(ForeignKey("financial_accounts.account_id", ondelete="CASCADE"))
    to_account_id:    Mapped[int]             = mapped_column(ForeignKey("financial_accounts.account_id", ondelete="CASCADE"))
    amount            = mapped_column(Numeric(14, 2), nullable=False)
    transaction_time: Mapped[dt.datetime]     = mapped_column(DateTime(timezone=True))
    channel:          Mapped[str]             = mapped_column(Text)
    case_id:          Mapped[Optional[int]]   = mapped_column(ForeignKey("cases.case_id", ondelete="SET NULL"))
    pattern_flag:     Mapped[Optional[str]]   = mapped_column(Text)
    is_suspicious:    Mapped[bool]            = mapped_column(Boolean, default=False)
