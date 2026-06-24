from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class HotspotRequest(BaseModel):
    mode: Literal["by_crime", "by_offender"] = "by_crime"
    crime_type: Optional[str] = None
    district: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class HotspotPoint(BaseModel):
    lat: float
    lng: float
    weight: float
    label: Optional[str] = None


class HotspotResponse(BaseModel):
    mode: str
    points: list[HotspotPoint] = []
    total: int = 0


class StationBreakdownRequest(BaseModel):
    mode: Literal["by_crime", "by_offender"] = "by_crime"
    crime_type: Optional[str] = None
    district: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    limit: int = 25


class StationRow(BaseModel):
    station: str
    firs: int
    cleared: int
    top_legal_code: Optional[str] = None
    trend: list[int] = []


class StationBreakdownResponse(BaseModel):
    rows: list[StationRow] = []
    total: int = 0          # number of rows returned (≤ limit)
    grand_total: int = 0    # real DB-wide case count matching the filters (ignores LIMIT)


class OffenderTrailRequest(BaseModel):
    person_id: Optional[str] = None
    entity_name: Optional[str] = None


class TrailPoint(BaseModel):
    lat: float
    lng: float
    date: Optional[str] = None
    fir_number: Optional[str] = None
    crime_type: Optional[str] = None
    station: Optional[str] = None


class OffenderTrailResponse(BaseModel):
    person_id: str
    label: str
    points: list[TrailPoint] = []

