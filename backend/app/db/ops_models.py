"""Response-Ops tables (predictive deployment, dispatch, green corridor, camera review).

Isolated module: imported only by the ops router/services and the init_ops seed.
Existing tables are never altered. `case_id` is a nullable FK used read-only
(except an INSERT of a brand-new case when an officer confirms a camera incident).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Integer, JSON, SmallInteger, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base  # shared metadata — no existing table touched


class PatrolUnit(Base):
    __tablename__ = "ops_patrol_units"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    callsign: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="IDLE")  # IDLE|EN_ROUTE|ON_SCENE|OFFLINE
    lat: Mapped[Optional[float]] = mapped_column(Float)
    lng: Mapped[Optional[float]] = mapped_column(Float)
    station_id: Mapped[Optional[int]] = mapped_column(Integer)  # soft ref to stations
    district: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrafficSignal(Base):
    __tablename__ = "ops_traffic_signals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    junction_id: Mapped[str] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    state: Mapped[str] = mapped_column(Text, default="NORMAL")  # NORMAL|GREEN


class IncidentDispatch(Base):
    __tablename__ = "ops_incident_dispatches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cases.case_id"), nullable=True)
    patrol_id: Mapped[int] = mapped_column(ForeignKey("ops_patrol_units.id"))
    scene_lat: Mapped[float] = mapped_column(Float)
    scene_lng: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(Text, default="ACCEPTED")  # ACCEPTED|EN_ROUTE|ON_SCENE|COMPLETED|CANCELLED
    route_geometry: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)  # GeoJSON LineString
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer)
    eta_sec: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RiskZone(Base):
    __tablename__ = "ops_risk_zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    grid_key: Mapped[str] = mapped_column(Text, unique=True, index=True)
    center_lat: Mapped[float] = mapped_column(Float)
    center_lng: Mapped[float] = mapped_column(Float)
    risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    incident_score: Mapped[float] = mapped_column(Float, default=0.0)
    time_score: Mapped[float] = mapped_column(Float, default=0.0)
    incident_count: Mapped[int] = mapped_column(Integer, default=0)
    peak_hour: Mapped[Optional[int]] = mapped_column(SmallInteger)
    risk_label: Mapped[str] = mapped_column(Text, default="Low")
    reasons: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PatrolSuggestion(Base):
    __tablename__ = "ops_patrol_suggestions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    risk_zone_id: Mapped[int] = mapped_column(ForeignKey("ops_risk_zones.id"))
    patrol_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ops_patrol_units.id"))
    from_lat: Mapped[Optional[float]] = mapped_column(Float)
    from_lng: Mapped[Optional[float]] = mapped_column(Float)
    to_lat: Mapped[float] = mapped_column(Float)
    to_lng: Mapped[float] = mapped_column(Float)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    response_improve_sec: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, default="PENDING")  # PENDING|ACCEPTED|DISMISSED|EXPIRED
    reasons: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Camera(Base):
    __tablename__ = "ops_cameras"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    location: Mapped[Optional[str]] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    video_path: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class IncidentReview(Base):
    __tablename__ = "ops_incident_review_queue"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(Text)
    candidate_type: Mapped[str] = mapped_column(Text)        # e.g. "vehicle_anomaly", "crowd"
    confidence: Mapped[float] = mapped_column(Float)
    clip_path: Mapped[Optional[str]] = mapped_column(Text)
    frame_path: Mapped[Optional[str]] = mapped_column(Text)
    lat: Mapped[Optional[float]] = mapped_column(Float)
    lng: Mapped[Optional[float]] = mapped_column(Float)
    status: Mapped[str] = mapped_column(Text, default="PENDING")  # PENDING|CONFIRMED|REJECTED
    reviewed_by: Mapped[Optional[str]] = mapped_column(Text)
    case_id: Mapped[Optional[int]] = mapped_column(ForeignKey("cases.case_id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Convenience list used by the init_ops seed to create ONLY these tables.
OPS_TABLES = [
    PatrolUnit.__table__, TrafficSignal.__table__, IncidentDispatch.__table__,
    RiskZone.__table__, PatrolSuggestion.__table__, Camera.__table__, IncidentReview.__table__,
]
