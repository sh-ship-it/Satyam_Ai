from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class PersonRef(BaseModel):
    person_id: str
    name: str
    role: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None


class CaseSummary(BaseModel):
    fir_no: str
    crime_type: Optional[str] = None
    status: Optional[str] = None
    district: Optional[str] = None
    date: Optional[str] = None
    sensitivity_flag: int = 0


class CaseDetail(CaseSummary):
    ipc_sections: Optional[str] = None
    station_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    persons: list[PersonRef] = []
    narrative: Optional[str] = None
    masked: bool = False
