"""Tamper-evident, hash-chained audit log.

Each entry stores sha256(prev_hash + canonical(entry)). Any retroactive edit
breaks the chain, which the Audit screen verifies with a single pass.

Schema change from v1: `audit_log` now uses `audit_id` (not `id`), `at` (not
`ts`), and carries `case_id` + `reason` fields for PROTECTED-crime access logging.
"""
from __future__ import annotations

import hashlib
import json
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog

# Constant key for the transaction-level advisory lock that serializes every
# audit-chain append. All writers contend on this single key, so the
# read-prev-hash → insert sequence is atomic across concurrent requests and the
# hash chain can never fork. The lock auto-releases at transaction end.
_AUDIT_CHAIN_LOCK_KEY = 728_311_042


def _digest(prev_hash: str, payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()


async def write_audit(
    session: AsyncSession,
    *,
    action: str,
    user_id: Optional[int] = None,
    case_id: Optional[int] = None,
    reason: Optional[str] = None,
    query_text: Optional[str] = None,
    generated_sql: Optional[str] = None,
    # legacy compat aliases kept so callers don't break immediately
    actor: Optional[str] = None,
    role: Optional[str] = None,
    resource: Optional[str] = None,
    detail: Optional[str] = None,
) -> AuditLog:
    # Serialize the read-prev-hash → insert against all other audit writers in
    # this DB. pg_advisory_xact_lock blocks until held, auto-releases on commit/
    # rollback. Without this, two concurrent transactions read the same
    # prev_hash and fork the chain (verify_chain would then report tamper).
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:k)"), {"k": _AUDIT_CHAIN_LOCK_KEY}
    )
    last = (
        await session.execute(
            select(AuditLog).order_by(AuditLog.audit_id.desc()).limit(1)
        )
    ).scalar_one_or_none()
    prev_hash = last.row_hash if last else "GENESIS"

    # Build canonical payload (deterministic field order)
    payload = {
        "action":       action,
        "user_id":      user_id,
        "case_id":      case_id,
        "reason":       reason,
        "query_text":   query_text or detail,
        "generated_sql": generated_sql,
    }
    entry = AuditLog(
        user_id=user_id,
        action=action,
        case_id=case_id,
        reason=reason or detail,
        query_text=query_text or detail,
        generated_sql=generated_sql,
        prev_hash=prev_hash,
        row_hash=_digest(prev_hash, payload),
    )
    session.add(entry)
    await session.flush()
    return entry


async def verify_chain(session: AsyncSession) -> bool:
    rows = (
        await session.execute(
            select(AuditLog).order_by(AuditLog.audit_id.asc())
        )
    ).scalars().all()
    prev = "GENESIS"
    for r in rows:
        payload = {
            "action":       r.action,
            "user_id":      r.user_id,
            "case_id":      r.case_id,
            "reason":       r.reason,
            "query_text":   r.query_text,
            "generated_sql": r.generated_sql,
        }
        if r.prev_hash != prev or r.row_hash != _digest(prev, payload):
            return False
        prev = r.row_hash
    return True
