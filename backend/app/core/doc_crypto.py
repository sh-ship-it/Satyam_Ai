"""Document integrity primitives: hashing, and PDF text extraction.

WHAT THIS GIVES, AND WHAT IT DOES NOT
`sha256_hex()` gives INTEGRITY. One-way, no key. Proves a document has not been
altered since it was sealed. This is what "blockchain" actually provides, and
Satyam already has the ledger for it — `core/audit.py` maintains a SHA-256 hash
chain (`row_hash = SHA-256(prev_hash + payload)`) serialised by a Postgres advisory
lock. Sealing a document means appending its digest to that existing chain, not
building a second chain beside it.

It does NOT give confidentiality. There is no encryption here: an AES-256 PDF
password feature was built and then removed at the user's request. Integrity was
always the stronger claim for a document that may reach a court — "byte-identical
to what was sealed at 14:32, and here is the chain proving it" beats "this file has
a password" — and it needs no extra dependency. If confidentiality is wanted later,
it belongs in a new function here, not folded into these.

ponytail: `sha256_hex` reads the whole file into memory in one go rather than
streaming. Deliberate at the 20 MB upload cap enforced in the documents route —
the file is already fully in memory from `UploadFile.read()` by the time it gets
here, so streaming would add a copy without saving any peak. Upgrade path is a
chunked hash if the cap is ever raised past a few hundred MB.
"""
from __future__ import annotations

import hashlib
import io
import logging

log = logging.getLogger(__name__)


class PdfToolingMissing(RuntimeError):
    """Raised when an operation needs `pypdf` and it is not installed.

    A distinct type so the route can answer 503 with an actionable message
    instead of a generic 500 — "install pypdf" is a fix, "internal error" is not.
    """


def sha256_hex(data: bytes) -> str:
    """Lowercase hex SHA-256 of `data`. The document's identity for sealing."""
    return hashlib.sha256(data).hexdigest()


def short_digest(digest: str, groups: int = 4, size: int = 4) -> str:
    """Human-checkable prefix, e.g. `a1b2 c3d4 e5f6 7890`.

    An officer comparing a seal on screen against one on paper will not read 64
    hex characters correctly. Grouped quads are what people can actually verify
    out loud, and the full digest is still what the chain stores and checks.
    """
    head = (digest or "")[: groups * size]
    return " ".join(head[i : i + size] for i in range(0, len(head), size))


def _require_pypdf():
    """Import pypdf lazily so a missing PDF library cannot stop the app booting.

    Everything except PDF text extraction works without it — plain-text upload,
    translation, hashing and sealing all do. Importing at module scope would take
    the whole documents feature (and the router, and therefore startup) down over
    an optional capability.
    """
    try:
        import pypdf  # type: ignore

        return pypdf
    except ImportError as exc:  # noqa: BLE001
        raise PdfToolingMissing(
            "PDF support needs the `pypdf` package. Install it with "
            "`pip install pypdf==5.1.0`, then restart the backend."
        ) from exc


def extract_pdf_text(data: bytes, max_pages: int = 60) -> tuple[str, int]:
    """Return `(text, pages_read)` from a digital PDF.

    Returns an EMPTY string for a scanned PDF — image-only pages carry no text
    layer, and pypdf cannot invent one. The caller must treat empty text as "this
    needs OCR" and say so, rather than reporting a successful extraction of
    nothing, which would silently produce an empty translation.

    `max_pages` bounds the work: a 900-page attachment would otherwise block a
    worker for minutes on what is meant to be an interactive screen.
    """
    pypdf = _require_pypdf()
    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"could not read this PDF: {exc}") from exc

    if getattr(reader, "is_encrypted", False):
        # A password-protected input cannot be read without the password, and we
        # deliberately do not prompt for one — accepting passwords for arbitrary
        # uploads turns this screen into a credential collector.
        raise ValueError(
            "this PDF is password-protected; remove the password before uploading"
        )

    pages = reader.pages[:max_pages]
    chunks: list[str] = []
    for page in pages:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001  (one broken page must not lose the rest)
            continue
    return "\n\n".join(c.strip() for c in chunks if c.strip()).strip(), len(pages)



