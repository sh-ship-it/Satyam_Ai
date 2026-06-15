"""JWT issuing / verification."""
from __future__ import annotations

import datetime as dt
from typing import Optional

import jwt

from app.config import get_settings


def create_access_token(
    *,
    subject: str,
    name: str,
    rank: str,
    scope: str,
    clearance: int,
    station_id: Optional[int] = None,
    district: str = "",
    range_name: str = "",
    officer_id: Optional[int] = None,
) -> str:
    settings = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub":        subject,
        "name":       name,
        "rank":       rank,
        "scope":      scope,
        "clearance":  clearance,
        "station_id": station_id,
        "district":   district,
        "range":      range_name,
        "officer_id": officer_id,
        "iat":        now,
        "exp":        now + dt.timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_alg)


def decode_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])
