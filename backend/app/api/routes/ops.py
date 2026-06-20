"""Response-Ops router. Mounted at /api/ops only when ENABLE_RESPONSE_OPS=true."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_principal
from app.core.rbac import Principal

router = APIRouter()


@router.get("/health")
async def ops_health(principal: Principal = Depends(get_principal)) -> dict:
    """Cheap liveness probe for the Response-Ops module."""
    return {"ok": True, "module": "response-ops", "rank": principal.rank}
