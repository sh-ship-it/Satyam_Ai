"""Client security-event endpoint (face-presence auto-lock telemetry).

Records UX-driven security events (auto-lock, presence changes, manual lock)
into the tamper-evident, hash-chained audit log. Event types are allow-listed
so the `security.*` audit namespace stays clean.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import Principal

router = APIRouter()

# Allow-listed client security events. Anything else is rejected so the audit
# action namespace (security.*) cannot be polluted by arbitrary client input.
_ALLOWED_EVENTS = {
    "auto_lock",
    "auto_unlock",
    "presence_lost",
    "presence_restored",
    "manual_lock",
}


class SecurityEvent(BaseModel):
    event_type: str
    detail: str = ""


@router.post("/event")
async def security_event(
    body: SecurityEvent,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    if body.event_type not in _ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail="unsupported security event_type")

    await write_audit(
        session,
        action=f"security.{body.event_type}",
        user_id=getattr(principal, "officer_id", None),
        reason=body.detail,
        query_text=f"client security event: {body.event_type}",
    )
    return {"ok": True}
