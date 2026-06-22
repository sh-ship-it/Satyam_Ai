"""Person 360 dossier endpoints — admin-gated (clearance 4+ or senior rank).

GET /api/dossier/list        → list all dossier subjects
GET /api/dossier/{demo_id}   → full dossier + audit log entry
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import Principal
from app.schemas.dossier import DossierDetail, DossierListItem
from app.services import dossier_service as svc

router = APIRouter()

# Ranks permitted regardless of numeric clearance level
_ADMIN_RANKS = frozenset({"admin", "DGP", "ADGP", "IGP", "SP"})


def _require_admin(principal: Principal) -> None:
    """Raise 403 unless the caller has clearance >= 4 or a permitted rank."""
    if principal.clearance >= 4 or principal.rank in _ADMIN_RANKS:
        return
    raise HTTPException(
        status_code=403,
        detail=(
            f"Dossier access requires clearance L4+ or rank in "
            f"{sorted(_ADMIN_RANKS)}. "
            f"Your rank: {principal.rank!r} (clearance L{principal.clearance})."
        ),
    )


@router.get("/list", response_model=list[DossierListItem])
async def list_dossiers(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[DossierListItem]:
    _require_admin(principal)
    return await svc.list_dossiers(session)


@router.get("/{demo_id}", response_model=DossierDetail)
async def get_dossier(
    demo_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> DossierDetail:
    _require_admin(principal)
    await write_audit(
        session,
        action="dossier.view",
        user_id=principal.officer_id,
        query_text=f"demo_id={demo_id}",
    )
    result = await svc.get_dossier(session, demo_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Dossier {demo_id} not found.")
    return result
