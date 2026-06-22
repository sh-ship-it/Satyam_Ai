"""Admin Access Control routes.

GET  /admin/users                    — list all users with creator info
PATCH /admin/users/{user_id}/policy  — update rank / clearance / scope / is_active

Both endpoints require Permission.ADMIN (clearance L4). A plain sessionmaker
(not RLS-scoped) is used so admins can see and modify every user row.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import get_principal
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require, resolve_clearance, resolve_scope
from app.db.models import User
from app.db.session import get_sessionmaker
from app.schemas.admin import AdminUserList, AdminUserRow, PolicyUpdateRequest

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _require_admin(principal: Principal = Depends(get_principal)) -> Principal:
    try:
        require(principal, Permission.ADMIN)
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return principal


# ---------------------------------------------------------------------------
# GET /admin/users
# ---------------------------------------------------------------------------

@router.get("/users", response_model=AdminUserList)
async def list_users(
    principal: Principal = Depends(_require_admin),
) -> AdminUserList:
    """Return all users with their effective clearance/scope and creator info."""
    sessionmaker = get_sessionmaker()

    Creator = aliased(User, name="creator")

    async with sessionmaker() as session:
        stmt = (
            select(User, Creator)
            .outerjoin(Creator, User.created_by == Creator.user_id)
            .order_by(User.user_id)
        )
        rows = (await session.execute(stmt)).all()

    result: list[AdminUserRow] = []
    for user_row, creator_row in rows:
        rank = user_row.assigned_rank or "viewer"
        # Effective clearance: override wins, then rank lookup
        effective_clearance = (
            user_row.clearance_override
            if user_row.clearance_override is not None
            else resolve_clearance(rank)
        )
        # Effective scope: override wins, then rank lookup
        effective_scope = user_row.scope_override or resolve_scope(rank)

        result.append(
            AdminUserRow(
                user_id=user_row.user_id,
                username=user_row.username,
                full_name=user_row.full_name or "",
                email=user_row.email,
                assigned_rank=user_row.assigned_rank,
                clearance=effective_clearance,
                scope=effective_scope,
                is_active=user_row.is_active,
                created_at=(
                    user_row.created_at.isoformat() if user_row.created_at else None
                ),
                created_by_id=creator_row.user_id if creator_row else None,
                created_by_name=(
                    (creator_row.full_name or creator_row.username) if creator_row else None
                ),
                has_override=(
                    user_row.clearance_override is not None
                    or user_row.scope_override is not None
                ),
            )
        )

    return AdminUserList(rows=result, total=len(result))


# ---------------------------------------------------------------------------
# PATCH /admin/users/{user_id}/policy
# ---------------------------------------------------------------------------

@router.patch("/users/{user_id}/policy")
async def update_policy(
    user_id: int,
    req: PolicyUpdateRequest,
    principal: Principal = Depends(_require_admin),
) -> dict:
    """Update rank, clearance override, scope override, or active status."""
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        async with session.begin():
            stmt = select(User).where(User.user_id == user_id)
            target = (await session.execute(stmt)).scalar_one_or_none()

            if target is None:
                raise HTTPException(status_code=404, detail=f"User {user_id} not found.")

            # ── Anti-lockout: admin cannot demote / disable themselves ─────
            if str(user_id) == str(principal.id) or target.username == principal.id:
                if req.is_active is False:
                    raise HTTPException(
                        status_code=400,
                        detail="Administrators cannot disable their own account.",
                    )
                if req.clearance is not None and req.clearance < 4:
                    raise HTTPException(
                        status_code=400,
                        detail="Administrators cannot lower their own clearance below L4.",
                    )

            # ── Apply changes ──────────────────────────────────────────────
            changes: dict[str, object] = {}

            if req.rank is not None:
                target.assigned_rank = req.rank
                changes["assigned_rank"] = req.rank

            if req.clearance is not None:
                target.clearance_override = req.clearance
                changes["clearance_override"] = req.clearance
            elif req.clear_overrides:
                target.clearance_override = None
                changes["clearance_override"] = None

            if req.scope is not None:
                target.scope_override = req.scope
                changes["scope_override"] = req.scope
            elif req.clear_overrides:
                target.scope_override = None
                changes["scope_override"] = None

            if req.is_active is not None:
                target.is_active = req.is_active
                changes["is_active"] = req.is_active

            # Record admin's user_id for audit
            # principal.id is the username string; look up the user_id integer
            admin_stmt = select(User).where(User.username == principal.id)
            admin_user = (await session.execute(admin_stmt)).scalar_one_or_none()
            admin_user_id = admin_user.user_id if admin_user else None

            # ── Audit ──────────────────────────────────────────────────────
            await write_audit(
                session,
                action="ADMIN_POLICY_CHANGE",
                user_id=admin_user_id,
                reason=req.reason or f"Policy update for user {user_id}",
                query_text=(
                    f"target_user_id={user_id} changes={changes}"
                ),
            )

    return {"ok": True, "user_id": user_id, "changes": changes}
