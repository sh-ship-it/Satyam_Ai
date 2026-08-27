"""Document extraction, translation and seal verification.

PIPELINE
    upload -> validate -> extract text -> translate (Sarvam Mayura) -> seal

The translation step reuses `get_translator()`, the same Sarvam adapter the voice
lane already uses, so this screen inherits a provider that is configured, tested
and known to handle Kannada. No new model integration.

WHY EXTRACTION IS ITS OWN FUNCTION
`extract_text()` is the swap point for Sarvam Vision (OCR, handwriting, 23
languages). Today it handles digital PDFs via pypdf and plain text; a scan comes
back as `needs_ocr` rather than as a failure. When Vision is wired in, only this
function changes and the route, screen and seal logic are untouched.
"""
from __future__ import annotations

import logging

from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.doc_crypto import extract_pdf_text
from app.models.registry import get_translator

log = logging.getLogger(__name__)

# Sarvam Mayura rejects an over-long single input, and a 60-page FIR bundle is far
# past it. Translation is chunked on PARAGRAPH boundaries so a sentence is never
# split across two requests — a half-sentence translates badly and the seam shows.
_CHUNK_CHARS = 1400

# Upload ceiling. Chosen because the whole file is held in memory (see the
# ponytail note in core/doc_crypto.py) and this is an interactive screen, not a
# batch importer.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# Allow-list, not a block-list. This endpoint is the only place in Satyam that
# accepts arbitrary binary, so the set of things it will even look at is closed.
ALLOWED_MIMES = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
}

_PDF_MAGIC = b"%PDF-"


def validate_upload(filename: str, mime: str, data: bytes) -> str:
    """Return the resolved kind ("pdf" | "txt"), or raise ValueError.

    Checks MAGIC BYTES, not just the declared content type. A browser will happily
    send `application/pdf` for anything a user renamed to .pdf, and the declared
    type is attacker-controlled on a hand-rolled request. The first bytes are the
    only statement the file makes about itself.
    """
    if not data:
        raise ValueError("the uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"file is larger than the {mb} MB limit")

    declared = (mime or "").split(";")[0].strip().lower()
    if declared not in ALLOWED_MIMES:
        raise ValueError(
            f"unsupported file type '{declared or 'unknown'}' — upload a PDF or a .txt file"
        )

    if declared == "application/pdf":
        if not data.startswith(_PDF_MAGIC):
            raise ValueError("this file is not a real PDF (missing %PDF header)")
        return "pdf"

    # text/plain: reject anything with NUL bytes. A binary payload renamed .txt
    # would otherwise be handed to a decoder and then to a translation provider.
    if b"\x00" in data[:4096]:
        raise ValueError("this file is not plain text")
    return "txt"


def extract_text(kind: str, data: bytes) -> tuple[str, int]:
    """Return `(text, pages)`. Empty text means "scan, needs OCR"."""
    if kind == "pdf":
        return extract_pdf_text(data)
    # Plain text. errors="replace" rather than strict: a stray bad byte in an
    # otherwise readable statement should not lose the whole document.
    return data.decode("utf-8", errors="replace").strip(), 0


def _chunk(text: str, limit: int = _CHUNK_CHARS) -> list[str]:
    """Split on blank lines, packing paragraphs up to `limit` characters.

    A single paragraph longer than the limit is emitted alone and left to the
    provider rather than being cut mid-sentence — a hard split reads worse than a
    long request.
    """
    paras = [p.strip() for p in (text or "").split("\n\n") if p.strip()]
    out: list[str] = []
    buf = ""
    for p in paras:
        if not buf:
            buf = p
        elif len(buf) + len(p) + 2 <= limit:
            buf = f"{buf}\n\n{p}"
        else:
            out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    return out


async def translate_document(text: str, src: str = "en", tgt: str = "kn") -> tuple[str, str]:
    """Translate `text` chunk by chunk. Returns `(translated, provider)`.

    A failed chunk keeps its ORIGINAL text instead of aborting the document or
    silently dropping a section. Losing a paragraph from a police record without
    saying so is worse than showing one paragraph still in English, which an
    officer can see and act on.
    """
    engine = get_translator()
    provider = type(engine).__name__
    chunks = _chunk(text)
    if not chunks:
        return "", provider

    done: list[str] = []
    failed = 0
    for i, c in enumerate(chunks):
        try:
            done.append(await engine.translate(c, src=src, tgt=tgt))
        except Exception as exc:  # noqa: BLE001
            failed += 1
            log.warning("document.chunk_translate_failed idx=%d/%d err=%s", i, len(chunks), exc)
            done.append(c)
    if failed:
        log.warning("document.partial_translation failed=%d of %d", failed, len(chunks))
    return "\n\n".join(done), provider


async def find_seal(session: AsyncSession, digest: str) -> dict | None:
    """Find the audit row that sealed `digest`, and check its own chain link.

    Deliberately verifies ONLY this row against its predecessor rather than
    calling `verify_chain()` over the whole ledger. The shared demo database
    already holds forked rows from earlier work, so a global check returns False
    for reasons that have nothing to do with this document — which would report a
    perfectly good seal as tampered.
    """
    from app.core.audit import _digest as audit_digest

    row = (
        await session.execute(
            sql_text(
                """
                SELECT audit_id, user_id, action, reason, query_text,
                       generated_sql, case_id, prev_hash, row_hash, at
                FROM audit_log
                WHERE action = 'document.seal' AND query_text LIKE :needle
                ORDER BY audit_id DESC
                LIMIT 1
                """
            ),
            {"needle": f"%{digest}%"},
        )
    ).mappings().first()
    if not row:
        return None

    payload = {
        "action": row["action"],
        "user_id": row["user_id"],
        "case_id": row["case_id"],
        "reason": row["reason"],
        "query_text": row["query_text"],
        "generated_sql": row["generated_sql"],
    }
    expected = audit_digest(row["prev_hash"] or "GENESIS", payload)
    intact = expected == row["row_hash"]

    # The predecessor's row_hash must equal this row's prev_hash, or a row was
    # removed or reordered between them.
    if intact and row["prev_hash"] != "GENESIS":
        prev_ok = (
            await session.execute(
                sql_text(
                    "SELECT 1 FROM audit_log WHERE row_hash = :h AND audit_id < :i LIMIT 1"
                ),
                {"h": row["prev_hash"], "i": row["audit_id"]},
            )
        ).first()
        intact = prev_ok is not None

    return {
        "audit_id": int(row["audit_id"]),
        "user_id": row["user_id"],
        "reason": row["reason"] or "",
        "query_text": row["query_text"] or "",
        "prev_hash": row["prev_hash"] or "",
        "row_hash": row["row_hash"] or "",
        "at": row["at"].isoformat() if row["at"] else None,
        "link_intact": bool(intact),
    }
