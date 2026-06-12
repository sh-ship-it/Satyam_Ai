from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ReportRequest(BaseModel):
    title: str
    case_ids: list[str] = []
    include_map: bool = True
    include_network: bool = False
    format: Literal["json", "pdf"] = "json"


class ReportResponse(BaseModel):
    report_id: str
    title: str
    sections: list[dict]
    generated_at: str
