"""Document translation, sealing and verification.

Three endpoints, each independently useful:

  POST /translate  multipart  -> extract text, translate to Kannada, return both
  POST /seal       json       -> append the file's SHA-256 to the audit chain
  POST /verify     json       -> has this exact file been sealed, and is it intact

SECURITY NOTES FOR THIS FILE SPECIFICALLY
This is the only place in Satyam that accepts arbitrary binary from a client, so
the guards are here rather than assumed elsewhere:

  * L2+ (`Permission.BUILD_REPORT`) — document production, same bar as report
    building. Not L1: uploading files is a heavier capability than asking a
    question.
  * Size cap and MAGIC-BYTE validation in `document_service.validate_upload`,
    because a declared content type is attacker-controlled.
  * Nothing is written to disk or to the database. Bytes live in the request and
    are returned to the caller. The audit chain stores only the DIGEST, filename
    and note — never the document. That keeps real case content out of a
    synthetic-data repository and off the Neon storage budget, which is at ~427 MB
    of a 512 MB cap.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.doc_crypto import PdfToolingMissing, sha256_hex, short_digest
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.documents import (
    SealRequest,
    SealResponse,
    TranslateDocResponse,
    VerifyRequest,
    VerifyResponse,
)
from app.services import document_service as svc

log = logging.getLogger(__name__)

router = APIRouter()


def _guard(principal: Principal) -> None:
    """L2+. Uploading and sealing documents is production work, not read-only."""
    try:
        require(principal, Permission.BUILD_REPORT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))


def _norm_lang(lang: str | None) -> str:
    return "kn" if str(lang or "").lower().startswith("kn") else "en"


def _safe_name(name: str | None) -> str:
    """Strip any path from a client-supplied filename.

    The name is only ever echoed back and written into an audit reason, never used
    to open a file — but `../../etc/passwd` in an audit log is still misleading,
    and stripping it here means a future change that DOES touch the filesystem
    cannot inherit a traversal.
    """
    base = (name or "document").replace("\\", "/").split("/")[-1]
    return base[:260] or "document"


@router.post("/translate", response_model=TranslateDocResponse)
async def translate_document(
    file: UploadFile = File(...),
    source_lang: str = Form("en"),
    target_lang: str = Form("kn"),
    principal: Principal = Depends(get_principal),
) -> TranslateDocResponse:
    _guard(principal)
    data = await file.read()
    name = _safe_name(file.filename)

    try:
        kind = svc.validate_upload(name, file.content_type or "", data)
    except ValueError as e:
        # 400, not 500: the officer can fix this by choosing another file, and the
        # message is written to be shown verbatim in the UI.
        raise HTTPException(status_code=400, detail=str(e))

    # Hash the ORIGINAL bytes, before any processing, so the digest identifies
    # exactly what was handed over rather than some derived artefact.
    digest = sha256_hex(data)

    try:
        source_text, pages = svc.extract_text(kind, data)
    except PdfToolingMissing as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    src, tgt = _norm_lang(source_lang), _norm_lang(target_lang)

    # A scan has no text layer. Report that as its own state instead of returning
    # a successful translation of an empty string.
    if not source_text:
        return TranslateDocResponse(
            filename=name, mime=file.content_type or "", size_bytes=len(data),
            pages=pages, sha256=digest, source_lang=src, target_lang=tgt,
            source_text="", translated_text="", provider="",
            needs_ocr=True, chars_translated=0,
        )

    if src == tgt:
        # Nothing to do, and calling a translation provider to map a language onto
        # itself wastes a request and can paraphrase the original.
        return TranslateDocResponse(
            filename=name, mime=file.content_type or "", size_bytes=len(data),
            pages=pages, sha256=digest, source_lang=src, target_lang=tgt,
            source_text=source_text, translated_text=source_text,
            provider="none (same language)", chars_translated=0,
        )

    try:
        translated, provider = await svc.translate_document(source_text, src=src, tgt=tgt)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"translation provider error: {e}")

    return TranslateDocResponse(
        filename=name, mime=file.content_type or "", size_bytes=len(data),
        pages=pages, sha256=digest, source_lang=src, target_lang=tgt,
        source_text=source_text, translated_text=translated, provider=provider,
        chars_translated=len(source_text),
    )


@router.post("/seal", response_model=SealResponse)
async def seal_document(
    body: SealRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SealResponse:
    """Append the document's digest to the existing tamper-evident audit chain.

    This is the "blockchain" half of the request, done with the ledger Satyam
    already has rather than a second one: `write_audit` takes the advisory lock,
    reads the previous `row_hash`, and stores `SHA-256(prev_hash + payload)`. The
    document digest goes in `query_text`, which is what `/verify` searches.
    """
    _guard(principal)
    name = _safe_name(body.filename)
    entry = await write_audit(
        session,
        action="document.seal",
        user_id=getattr(principal, "officer_id", None),
        reason=(body.note or f"sealed {name}")[:500],
        # Format matters: /verify does a LIKE on this column for the digest, and
        # find_seal() rebuilds the payload from the stored columns to re-verify.
        query_text=f"document.seal sha256={body.sha256} file={name}",
    )
    return SealResponse(
        audit_id=int(entry.audit_id),
        sha256=body.sha256,
        short=short_digest(body.sha256),
        prev_hash=entry.prev_hash or "",
        row_hash=entry.row_hash or "",
        sealed_at=entry.at.isoformat() if getattr(entry, "at", None) else "",
    )


@router.post("/verify", response_model=VerifyResponse)
async def verify_document(
    body: VerifyRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> VerifyResponse:
    """Re-hash-and-compare: was this exact file sealed, and is its link intact?"""
    _guard(principal)
    hit = await svc.find_seal(session, body.sha256)
    if not hit:
        return VerifyResponse(
            found=False, sha256=body.sha256, short=short_digest(body.sha256),
            detail="No seal found for this file. It was never sealed, or its "
                   "contents changed after sealing — a single altered byte "
                   "produces a completely different digest.",
        )

    fname = ""
    marker = " file="
    if marker in hit["query_text"]:
        fname = hit["query_text"].split(marker, 1)[1].strip()

    return VerifyResponse(
        found=True, sha256=body.sha256, short=short_digest(body.sha256),
        audit_id=hit["audit_id"], sealed_at=hit["at"], sealed_by=hit["user_id"],
        filename=fname or None, link_intact=hit["link_intact"],
        detail=(
            "Seal found and its hash-chain link recomputes correctly."
            if hit["link_intact"]
            else "Seal found, but its chain link does not recompute — the audit "
                 "row itself may have been altered."
        ),
    )



