"""JWT issuing / verification."""
from __future__ import annotations

import datetime as dt

import jwt

from app.config import get_settings


def create_access_token(
    *, subject: str, role: str, name: str,
    station_id: str | None = None, jurisdiction_id: str | None = None,
    clearance: int = 1,
) -> str:
    settings = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": subject,
        "name": name,
        "role": role,
        "station_id": station_id,
        "jurisdiction_id": jurisdiction_id,
        "clearance": clearance,
        "iat": now,
        "exp": now + dt.timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_alg)


def decode_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_alg])
