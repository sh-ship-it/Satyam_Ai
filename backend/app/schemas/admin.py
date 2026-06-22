from __future__ import annotations
from typing import Optional, Literal
from pydantic import BaseModel, Field


class AdminUserRow(BaseModel):
    user_id: int
    username: str
    full_name: str = ""
    email: Optional[str] = None
    assigned_rank: Optional[str] = None
    clearance: int
    scope: str
    is_active: bool
    created_at: Optional[str] = None
    created_by_id: Optional[int] = None
    created_by_name: Optional[str] = None
    has_override: bool = False


class AdminUserList(BaseModel):
    rows: list[AdminUserRow]
    total: int


class PolicyUpdateRequest(BaseModel):
    rank: Optional[str] = None
    clearance: Optional[int] = Field(default=None, ge=1, le=4)
    scope: Optional[Literal["state", "range", "district", "station"]] = None
    is_active: Optional[bool] = None
    reason: str = ""
    clear_overrides: bool = False
