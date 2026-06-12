"""Tamper-evident, hash-chained audit log.

Each entry stores sha256(prev_hash + canonical(entry)). Any retroactive edit
breaks the chain, which the Audit screen verifies with a single pass.
"""
from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog


def _digest(prev_hash: str, payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()


async def write_audit(
    session: AsyncSession,
    *, actor: str, role: str, action: str,
    resource: str | None = None, detail: str | None = None,
) -> AuditLog:
    last = (
        await session.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))
    ).scalar_one_or_none()
    prev_hash = last.hash if last else "GENESIS"
    payload = {"actor": actor, "role": role, "action": action, "resource": resource, "detail": detail}
    entry = AuditLog(
        actor=actor, role=role, action=action, resource=resource,
        detail=detail, prev_hash=prev_hash, hash=_digest(prev_hash, payload),
    )
    session.add(entry)
    await session.flush()
    return entry


async def verify_chain(session: AsyncSession) -> bool:
    rows = (await session.execute(select(AuditLog).order_by(AuditLog.id.asc()))).scalars().all()
    prev = "GENESIS"
    for r in rows:
        payload = {"actor": r.actor, "role": r.role, "action": r.action,
                   "resource": r.resource, "detail": r.detail}
        if r.prev_hash != prev or r.hash != _digest(prev, payload):
            return False
        prev = r.hash
    return True
