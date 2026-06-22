"""Runtime settings endpoint.

Allows the frontend Settings panel to flip the active database source (cloud
Neon vs local PostgreSQL) without restarting the server. The selection is stored
process-wide in `_db_source` and is picked up by `db/session.py` on the next
request. Protected by the CHAT permission — any authenticated officer can switch
their session's data source.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_principal
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.db.session import set_db_source, get_db_source

router = APIRouter()


class DbSourceRequest(BaseModel):
    source: Literal["cloud", "local"]


class DbSourceResponse(BaseModel):
    db_source: str
    url_host: str


class ModelProviderStatus(BaseModel):
    default_brain_engine: str
    gemini_configured: bool
    openai_configured: bool
    groq_configured: bool
    local_available: bool


@router.get("/models", response_model=ModelProviderStatus)
async def model_providers(
    principal: Principal = Depends(get_principal),
) -> ModelProviderStatus:
    """Return which AI providers are configured (booleans only — never the keys)."""
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    from app.config import get_settings
    s = get_settings()
    return ModelProviderStatus(
        default_brain_engine=s.brain_engine,
        gemini_configured=bool(s.gemini_api_key),
        openai_configured=bool(s.openai_api_key),
        groq_configured=bool(s.groq_api_key),
        local_available=(s.model_backend == "local"),
    )


class DbSourceRequest(BaseModel):
    source: Literal["cloud", "local"]


class DbSourceResponse(BaseModel):
    db_source: str
    url_host: str  # host only — never expose credentials


@router.post("", response_model=DbSourceResponse)
async def switch_db_source(
    req: DbSourceRequest,
    principal: Principal = Depends(get_principal),
) -> DbSourceResponse:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    set_db_source(req.source)
    host = get_db_source_host()
    return DbSourceResponse(db_source=req.source, url_host=host)


@router.get("", response_model=DbSourceResponse)
async def current_db_source(
    principal: Principal = Depends(get_principal),
) -> DbSourceResponse:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    source = get_db_source()
    return DbSourceResponse(db_source=source, url_host=get_db_source_host())


def get_db_source_host() -> str:
    """Return host:port only — never expose credentials in the response."""
    from app.db.session import active_url
    url = active_url()
    try:
        return url.split("@")[-1].split("/")[0]
    except Exception:
        return "unknown"
