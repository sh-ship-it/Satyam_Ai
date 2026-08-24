from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

# WHY THESE ARE `date` AND NOT `str`
# `cases.report_date` is a DATE column and these values are bound into raw
# `text()` SQL, which carries no type information for SQLAlchemy to coerce. asyncpg
# is strict, so a plain string reached the driver and every request that supplied a
# date range failed with:
#   invalid input for query argument $1: '2025-01-01'
#   ('str' object has no attribute 'toordinal')
# Declaring the field as `date` makes Pydantic parse it at the edge, so the driver
# receives a real date and malformed input returns 422 instead of 500.


class HotspotRequest(BaseModel):
    mode: Literal["by_crime", "by_offender"] = "by_crime"
    crime_type: Optional[str] = None
    district: Optional[str] = None
    # NOTE: accepted but currently ignored — `analytics.hotspots()` takes no date
    # range, so the map is not date-filtered. Kept for API compatibility.
    date_from: Optional[date] = None
    date_to: Optional[date] = None


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
    date_from: Optional[date] = None
    date_to: Optional[date] = None
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

