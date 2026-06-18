"""JWT issuing / verification + password hashing."""
from __future__ import annotations

import datetime as dt
from typing import Optional

import jwt

from app.config import get_settings


def _bcrypt():
    """Lazy import so the module loads without bcrypt if it's not installed."""
    try:
        import bcrypt as _bc
        return _bc
    except ImportError:
        return None


def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*. Falls back to a placeholder if bcrypt is unavailable."""
    bc = _bcrypt()
    if bc is None:
        # bcrypt not installed — store a sentinel so verify can still work
        return f"__plain__{plain}__"
    return bc.hashpw(plain.encode(), bc.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches *hashed*. Handles both bcrypt and the plain sentinel."""
    if hashed.startswith("__plain__"):
        return hashed == f"__plain__{plain}__"
    bc = _bcrypt()
    if bc is None:
        return False
    try:
        return bc.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


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
