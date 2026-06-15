from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class PersonRef(BaseModel):
    person_id: int
    name: str
    role: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    masked: bool = False


class CaseSummary(BaseModel):
    case_id: int
    fir_number: str
    crime_type: str
    crime_category: str
    legal_code: str
    status: str
    district: str
    range_name: str
    report_date: str
    fir_year: int


class CaseDetail(CaseSummary):
    sections: Optional[str] = None
    fir_type: Optional[str] = None
    complaint_mode: Optional[str] = None
    motive: Optional[str] = None
    incident_date: Optional[str] = None
    place_of_offence: Optional[str] = None
    station_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    victim_count: int = 0
    accused_count: int = 0
    arrested_count: int = 0
    charge_sheeted: bool = False
    convicted: bool = False
    persons: list[PersonRef] = []
    narrative: Optional[str] = None
    masked: bool = False
