from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""              # verified against bcrypt hash in DB
    role: Optional[str] = None      # legacy alias for rank
    rank: Optional[str] = None      # preferred: KSP rank string


class SessionUser(BaseModel):
    id: str
    name: str
    rank: str
    scope: str
    clearance: int
    station_id: Optional[int] = None
    district: str = ""
    range_name: str = ""


class LoginResponse(BaseModel):
    token: str
    user: SessionUser


class RegisterRequest(BaseModel):
    name: str = ""
    email: str = ""
    role: Optional[str] = None
    rank: Optional[str] = None
    password: str = ""
    photo_b64: Optional[str] = None
