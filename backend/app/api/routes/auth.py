"""Authentication routes.

DEMO login: in development the role switcher mints a JWT for any username so
judges can hop between clearances. In production this endpoint is disabled and
identity/claims must come from the real OIDC provider (the JWT shape is the
same, so nothing downstream changes).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_principal
from app.config import get_settings
from app.core.rbac import Principal
from app.core.security import create_access_token
from app.schemas.auth import LoginRequest, LoginResponse, SessionUser

router = APIRouter()

# Demo clearance + jurisdiction mapping (production reads these from OIDC claims).
_CLEARANCE = {"admin": 3, "investigator": 2, "analyst": 2, "viewer": 1}
_DEFAULT_JURISDICTION = "KA-BLR"
_DEFAULT_STATION = "PS01"


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    settings = get_settings()
    if settings.app_env == "production":
        raise HTTPException(status_code=403, detail="demo login is disabled in production")
    role = req.role or "investigator"
    clearance = _CLEARANCE.get(role, 1)
    uid = req.username.strip() or f"demo-{role}"
    user = SessionUser(
        id=uid,
        name=req.username.strip() or role.title(),
        role=role,
        station_id=_DEFAULT_STATION,
        jurisdiction_id=_DEFAULT_JURISDICTION,
        clearance=clearance,
    )
    token = create_access_token(
        subject=user.id, role=role, name=user.name,
        station_id=user.station_id, jurisdiction_id=user.jurisdiction_id,
        clearance=clearance,
    )
    return LoginResponse(token=token, user=user)


@router.get("/me", response_model=SessionUser)
async def me(principal: Principal = Depends(get_principal)) -> SessionUser:
    return SessionUser(
        id=principal.id,
        name=principal.name,
        role=principal.role.value,  # type: ignore[arg-type]
        station_id=principal.station_id,
        jurisdiction_id=principal.jurisdiction_id,
        clearance=principal.clearance,
    )
