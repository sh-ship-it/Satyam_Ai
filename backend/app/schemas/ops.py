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


class PatrolOut(BaseModel):
    id: int
    callsign: str
    status: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    district: Optional[str] = None


class DispatchRequest(BaseModel):
    scene_lat: float
    scene_lng: float
    case_id: Optional[int] = None
    patrol_id: Optional[int] = None  # if omitted, the nearest IDLE unit is chosen


class DispatchOut(BaseModel):
    id: int
    patrol_id: int
    patrol_callsign: Optional[str] = None
    case_id: Optional[int] = None
    scene_lat: float
    scene_lng: float
    status: str
    distance_km: Optional[float] = None
    duration_sec: Optional[int] = None
    eta_sec: Optional[int] = None
    route: list[list[float]] = []  # [[lng,lat],...]


class DetectNotify(BaseModel):
    camera_id: str
    candidate_type: str = "vehicle_anomaly"
    confidence: float
    lat: Optional[float] = None
    lng: Optional[float] = None
    clip_path: Optional[str] = None
    frame_path: Optional[str] = None


class ReviewItemOut(BaseModel):
    id: int
    camera_id: str
    candidate_type: str
    confidence: float
    lat: Optional[float] = None
    lng: Optional[float] = None
    clip_path: Optional[str] = None
    frame_path: Optional[str] = None
    status: str
    created_at: Optional[str] = None


class CameraOut(BaseModel):
    id: int
    camera_id: str
    name: str
    location: Optional[str] = None
    lat: float
    lng: float
    is_active: bool
