"""ORM models for the Satyam crime database.

Schema mirrors the locked spec (~6 core tables). `narratives.embedding` is a
pgvector column used for grounded retrieval (BGE-M3, 1024-dim).
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

try:  # pgvector is optional at import time (e.g. unit tests without the ext)
    from pgvector.sqlalchemy import Vector

    _EMBED = Vector(1024)
except Exception:  # pragma: no cover
    _EMBED = Text  # type: ignore[assignment]


class Base(DeclarativeBase):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(32), default="viewer")
    station_id: Mapped[str | None] = mapped_column(ForeignKey("stations.station_id"))
    jurisdiction_id: Mapped[str | None] = mapped_column(String(64))
    clearance: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Station(Base):
    __tablename__ = "stations"
    station_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    zone: Mapped[str | None] = mapped_column(String(120))
    district: Mapped[str | None] = mapped_column(String(120))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)


class Officer(Base):
    __tablename__ = "officers"
    officer_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    rank: Mapped[str | None] = mapped_column(String(80))
    station_id: Mapped[str | None] = mapped_column(ForeignKey("stations.station_id"))


class Case(Base):
    __tablename__ = "cases"
    fir_no: Mapped[str] = mapped_column(String(64), primary_key=True)
    date: Mapped[dt.date | None] = mapped_column(Date)  # SQL column is DATE
    ipc_sections: Mapped[str | None] = mapped_column(String(300))
    crime_type: Mapped[str | None] = mapped_column(String(120), index=True)
    status: Mapped[str | None] = mapped_column(String(60), index=True)
    station_id: Mapped[str | None] = mapped_column(ForeignKey("stations.station_id"))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    district: Mapped[str | None] = mapped_column(String(120), index=True)
    zone: Mapped[str | None] = mapped_column(String(120))
    sensitivity_flag: Mapped[int] = mapped_column(Integer, default=0)
    jurisdiction_id: Mapped[str | None] = mapped_column(String(64), index=True)

    persons: Mapped[list["CasePerson"]] = relationship(back_populates="case")
    narrative: Mapped["Narrative | None"] = relationship(back_populates="case", uselist=False)


class Person(Base):
    __tablename__ = "persons"
    person_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    age: Mapped[int | None] = mapped_column(Integer)
    gender: Mapped[str | None] = mapped_column(String(20))
    role_type: Mapped[str | None] = mapped_column(String(40))  # accused/victim/witness


class CasePerson(Base):
    __tablename__ = "case_persons"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.fir_no"))
    person_id: Mapped[str] = mapped_column(ForeignKey("persons.person_id"))
    role: Mapped[str | None] = mapped_column(String(40))

    case: Mapped[Case] = relationship(back_populates="persons")
    person: Mapped[Person] = relationship()


class Narrative(Base):
    __tablename__ = "narratives"
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.fir_no"), primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(_EMBED, nullable=True)

    case: Mapped[Case] = relationship(back_populates="narrative")


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    actor: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(80))
    resource: Mapped[str | None] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(Text)
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
