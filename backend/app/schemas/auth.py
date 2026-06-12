from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

Role = Literal["admin", "investigator", "analyst", "viewer"]


class LoginRequest(BaseModel):
    username: str
    # Demo role switcher (dev only). In production this comes from the IdP/OIDC claims.
    role: Optional[Role] = None


class SessionUser(BaseModel):
    id: str
    name: str
    role: Role
    station_id: Optional[str] = None
    jurisdiction_id: Optional[str] = None
    clearance: int = 1


class LoginResponse(BaseModel):
    token: str
    user: SessionUser
