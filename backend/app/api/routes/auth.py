"""Authentication routes.

Demo login: mints a JWT for any username/rank combo so judges can hop between
clearance levels without a real LDAP/OIDC setup.  In production this endpoint
is disabled; identity/claims come from the KSP OIDC provider.

The JWT shape is identical between demo and production so nothing downstream
changes at the flip of APP_ENV.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_principal
from app.config import get_settings
from app.core.rbac import Principal, resolve_clearance, resolve_scope
from app.core.security import create_access_token
from app.schemas.auth import LoginRequest, LoginResponse, SessionUser

router = APIRouter()

# ── Demo station/district/range defaults ──────────────────────────────────
# IMPORTANT: district and range must match real values in the synthetic dataset.
# "Bengaluru City" and "Commissionerates" exist in the seeded data; the old
# "Bengaluru Urban" / "Bengaluru Range" did NOT — causing RLS to filter out
# all rows for district/station-scoped demo users (Issue 0).
_BLR = {"district": "Bengaluru City", "range": "Commissionerates"}

_DEMO_STATIONS: dict[str, dict] = {
    "PC":    {"station_id": 1,    **_BLR},
    "HC":    {"station_id": 1,    **_BLR},
    "ASI":   {"station_id": 1,    **_BLR},
    "SI":    {"station_id": 1,    **_BLR},
    "PSI":   {"station_id": 1,    **_BLR},
    "PI":    {"station_id": 1,    **_BLR},
    "CI":    {"station_id": 1,    **_BLR},
    "DySP":  {"station_id": None, **_BLR},
    "SP":    {"station_id": None, **_BLR},
    "DIG":   {"station_id": None, "district": "", "range": "Commissionerates"},
    "IGP":   {"station_id": None, "district": "", "range": ""},
    "DGP":   {"station_id": None, "district": "", "range": ""},
    # Legacy app-role aliases
    "admin":        {"station_id": None, "district": "", "range": ""},
    "investigator": {"station_id": 1,    **_BLR},
    "analyst":      {"station_id": None, "district": "", "range": ""},  # state scope → sees all
    "viewer":       {"station_id": 1,    **_BLR},
}


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    settings = get_settings()
    if settings.app_env == "production":
        raise HTTPException(status_code=403, detail="demo login is disabled in production")

    rank = req.role or req.rank or "investigator"
    clearance = resolve_clearance(rank)
    scope = resolve_scope(rank)
    geo = _DEMO_STATIONS.get(rank, _DEMO_STATIONS["investigator"])

    uid = req.username.strip() or f"demo-{rank}"
    user = SessionUser(
        id=uid,
        name=req.username.strip() or rank.title(),
        rank=rank,
        scope=scope,
        clearance=clearance,
        station_id=geo["station_id"],
        district=geo["district"],
        range_name=geo["range"],
    )
    token = create_access_token(
        subject=user.id,
        name=user.name,
        rank=rank,
        scope=scope,
        clearance=clearance,
        station_id=geo["station_id"],
        district=geo["district"],
        range_name=geo["range"],
    )
    return LoginResponse(token=token, user=user)


@router.get("/me", response_model=SessionUser)
async def me(principal: Principal = Depends(get_principal)) -> SessionUser:
    return SessionUser(
        id=principal.id,
        name=principal.name,
        rank=principal.rank,
        scope=principal.scope,
        clearance=principal.clearance,
        station_id=principal.station_id,
        district=principal.district,
        range_name=principal.range_name,
    )
