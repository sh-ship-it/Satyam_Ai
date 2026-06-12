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
