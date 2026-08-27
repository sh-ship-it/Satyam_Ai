"""Wire types for the Document Translation screen."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class TranslateDocResponse(BaseModel):
    """Result of extract + translate. Text only — no file is returned here."""

    filename: str
    mime: str
    size_bytes: int
    pages: int = 0
    # Lowercase hex SHA-256 of the ORIGINAL uploaded bytes. Computed before any
    # processing so the digest identifies what the officer actually handed over.
    sha256: str
    source_lang: str
    target_lang: str
    source_text: str
    translated_text: str
    provider: str
    # True when the file parsed but carried no text layer, i.e. a scan needing
    # OCR. Distinct from an error: the upload was valid, there was just nothing to
    # translate, and the screen has to say which.
    needs_ocr: bool = False
    chars_translated: int = 0


class SealRequest(BaseModel):
    """Append a document digest to the tamper-evident audit chain."""

    filename: str = Field(min_length=1, max_length=260)
    sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")
    note: str = Field(default="", max_length=500)


class SealResponse(BaseModel):
    audit_id: int
    sha256: str
    short: str
    prev_hash: str
    row_hash: str
    sealed_at: str
    algorithm: Literal["SHA-256"] = "SHA-256"


class VerifyRequest(BaseModel):
    sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


class VerifyResponse(BaseModel):
    """Answer to "has this exact file been sealed, and is its link intact?"."""

    found: bool
    sha256: str
    short: str
    audit_id: Optional[int] = None
    sealed_at: Optional[str] = None
    sealed_by: Optional[int] = None
    filename: Optional[str] = None
    # Whether this row's own prev_hash/row_hash still recompute correctly. Scoped
    # to the sealed row and its predecessor rather than the whole ledger: the
    # shared demo database contains pre-existing forked rows from earlier work, so
    # a global verify_chain() would report tamper for reasons unrelated to this
    # document and make a working feature look broken.
    link_intact: bool = False
    detail: str = ""
