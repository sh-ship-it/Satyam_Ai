from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class RiskZoneOut(BaseModel):
    id: int
    grid_key: str
    center_lat: float
    center_lng: float
    risk_score: float
    risk_label: str
    incident_count: int
    peak_hour: Optional[int] = None
    reasons: list[str] = []


class RiskZonesResponse(BaseModel):
    zones: list[RiskZoneOut] = []
    recomputed: bool = False
    total: int = 0


class SuggestionOut(BaseModel):
    id: int
    risk_zone_id: int
    patrol_id: Optional[int] = None
    patrol_callsign: Optional[str] = None
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    to_lat: float
    to_lng: float
    distance_km: Optional[float] = None
    response_improve_sec: Optional[int] = None
    status: str
    reasons: list[str] = []


class SuggestionsResponse(BaseModel):
    suggestions: list[SuggestionOut] = []
    total: int = 0
