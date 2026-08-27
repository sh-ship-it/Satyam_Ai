"""Document upload validation, chunking, and the integrity/confidentiality split.

WHY THIS FILE EXISTS
`/api/documents/*` is the ONLY place in Satyam that accepts arbitrary binary from a
client, so its guards are the ones worth pinning. Everything here fails silently or
dangerously if broken:

  * a declared content type is attacker-controlled, so validation has to read magic
    bytes — otherwise `evil.exe` renamed `report.pdf` reaches a PDF parser;
  * the size cap is the only thing between an upload and a worker holding the whole
    file in memory;
  * translation chunking must never split a sentence, or the seam shows in the
    Kannada output;
  * a failed chunk must keep its original text rather than vanish — silently losing
    a paragraph from a police record is worse than showing one still in English.
"""
from __future__ import annotations

import pytest

from app.core import doc_crypto
from app.services import document_service as svc

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\ntrailer<</Root 1 0 R>>\n%%EOF"


# ── upload validation: the trust boundary ────────────────────────────────────

def test_a_real_pdf_and_real_text_are_accepted():
    assert svc.validate_upload("a.pdf", "application/pdf", PDF) == "pdf"
    assert svc.validate_upload("a.txt", "text/plain", b"Five theft cases.") == "txt"


def test_content_type_alone_is_not_trusted():
    """The declared type is attacker-controlled. Magic bytes are the file's own
    statement about itself, and they are what decide."""
    with pytest.raises(ValueError, match="not a real PDF"):
        svc.validate_upload("evil.pdf", "application/pdf", b"MZ\x90\x00 this is a PE binary")


def test_a_binary_renamed_as_text_is_rejected():
    """NUL bytes mean this was never plain text. Without the check it would be
    decoded and shipped to a translation provider."""
    with pytest.raises(ValueError, match="not plain text"):
        svc.validate_upload("x.txt", "text/plain", b"ELF\x00\x01\x02\x00binary")


@pytest.mark.parametrize(
    "mime", ["application/zip", "image/png", "application/octet-stream", "", "text/html"]
)
def test_only_pdf_and_plain_text_are_allowed(mime):
    """An allow-list, not a block-list: anything not named is refused."""
    with pytest.raises(ValueError, match="unsupported file type"):
        svc.validate_upload("f", mime, b"whatever")


def test_an_empty_upload_is_rejected():
    with pytest.raises(ValueError, match="empty"):
        svc.validate_upload("a.pdf", "application/pdf", b"")


def test_the_size_cap_is_enforced():
    oversized = PDF + b"\x00" * (svc.MAX_UPLOAD_BYTES + 1)
    with pytest.raises(ValueError, match="larger than"):
        svc.validate_upload("big.pdf", "application/pdf", oversized)


def test_a_file_at_exactly_the_cap_is_allowed():
    """Off-by-one guard: the limit is inclusive, so a file of exactly the cap must
    not be rejected."""
    exact = PDF + b" " * (svc.MAX_UPLOAD_BYTES - len(PDF))
    assert len(exact) == svc.MAX_UPLOAD_BYTES
    assert svc.validate_upload("edge.pdf", "application/pdf", exact) == "pdf"


# ── extraction ───────────────────────────────────────────────────────────────

def test_plain_text_extraction_returns_the_text_and_no_pages():
    text, pages = svc.extract_text("txt", "Line one.\n\nLine two.".encode())
    assert "Line one." in text and "Line two." in text
    assert pages == 0


def test_undecodable_bytes_do_not_lose_the_document():
    """errors="replace", not strict: one bad byte in a readable statement should
    not throw away everything around it."""
    text, _ = svc.extract_text("txt", b"Valid start \xff\xfe still readable")
    assert "Valid start" in text and "still readable" in text


# ── chunking: the seam is what an officer notices ────────────────────────────

def test_short_text_is_a_single_chunk():
    assert svc._chunk("One paragraph only.") == ["One paragraph only."]


def test_chunks_never_exceed_the_limit_when_paragraphs_allow_it():
    para = "Sentence about a theft case. " * 12          # ~336 chars
    packed = svc._chunk("\n\n".join([para] * 20))
    assert len(packed) > 1, "20 paragraphs must not become one request"
    # Every chunk except a lone oversized paragraph stays inside the limit.
    assert all(len(c) <= svc._CHUNK_CHARS for c in packed)


def test_a_single_oversized_paragraph_is_kept_whole():
    """Emitted alone rather than cut mid-sentence — a hard split reads worse than a
    long request, and the provider trims if it must."""
    giant = "x" * (svc._CHUNK_CHARS + 500)
    assert svc._chunk(giant) == [giant]


def test_chunking_loses_no_paragraph():
    paras = [f"Paragraph number {i} about a case." for i in range(40)]
    packed = svc._chunk("\n\n".join(paras))
    rejoined = "\n\n".join(packed)
    for p in paras:
        assert p in rejoined, f"lost: {p}"


def test_empty_and_whitespace_text_chunk_to_nothing():
    assert svc._chunk("") == []
    assert svc._chunk("   \n\n  \n ") == []


# ── partial translation failure degrades visibly, not silently ───────────────

async def test_a_failed_chunk_keeps_its_original_text(monkeypatch):
    """Dropping a paragraph from a police record without saying so is the worst
    available outcome. Showing it still in English is recoverable."""

    class HalfBroken:
        async def translate(self, text, src="en", tgt="kn"):
            if "SECOND" in text:
                raise RuntimeError("provider 500")
            return "KN:" + text

    # Each paragraph must EXCEED the chunk limit so it lands in its own request.
    # Three short paragraphs pack into one chunk — correctly, that is the point of
    # packing — and then one failure takes all three down, which exercises the
    # packer rather than the per-chunk isolation this test is about.
    pad = "y" * (svc._CHUNK_CHARS + 50)
    monkeypatch.setattr(svc, "get_translator", lambda: HalfBroken())
    out, provider = await svc.translate_document(
        f"FIRST {pad}\n\nSECOND {pad}\n\nTHIRD {pad}"
    )
    assert "KN:FIRST" in out
    assert "SECOND" in out and "KN:SECOND" not in out, "the failed chunk survives untranslated"
    assert "KN:THIRD" in out, "a mid-document failure must not stop the rest"
    assert provider == "HalfBroken"


async def test_empty_text_makes_no_provider_call(monkeypatch):
    calls = {"n": 0}

    class Counting:
        async def translate(self, text, src="en", tgt="kn"):
            calls["n"] += 1
            return text

    monkeypatch.setattr(svc, "get_translator", lambda: Counting())
    out, _ = await svc.translate_document("   ")
    assert out == ""
    assert calls["n"] == 0


# ── integrity primitives ─────────────────────────────────────────────────────

def test_the_digest_is_sha256_and_changes_with_one_byte():
    """The whole seal rests on this: a single altered byte must produce a totally
    different digest, or "unaltered" means nothing."""
    a = doc_crypto.sha256_hex(b"FIR 101: theft reported at 14:32.")
    b = doc_crypto.sha256_hex(b"FIR 101: theft reported at 14:33.")
    assert len(a) == 64 and a != b
    assert a == doc_crypto.sha256_hex(b"FIR 101: theft reported at 14:32.")


def test_short_digest_is_groups_a_person_can_read_aloud():
    d = "a1b2c3d4e5f67890" + "0" * 48
    assert doc_crypto.short_digest(d) == "a1b2 c3d4 e5f6 7890"


def test_there_is_no_encryption_on_this_path():
    """The AES-256 password feature was removed at the user's request.

    Asserted rather than merely deleted: the removal spanned a route, a helper, a
    dialog and a dependency, and a half-reverted state would leave an endpoint the
    UI can no longer reach. If encryption is ever wanted again it should arrive as a
    deliberate addition, not as a leftover.
    """
    assert not hasattr(doc_crypto, "encrypt_pdf")
    assert not hasattr(doc_crypto, "AES_ALGORITHM")

    from app.api.routes import documents as doc_routes

    paths = {r.path for r in doc_routes.router.routes}
    assert "/encrypt" not in paths
    assert {"/translate", "/seal", "/verify"} <= paths, "the rest must still be wired"


def test_pdf_tooling_missing_is_its_own_error_type():
    """The route answers 503 with an install instruction for this type. A generic
    RuntimeError would surface as "internal error", which is not a fix."""
    assert issubclass(doc_crypto.PdfToolingMissing, RuntimeError)



# ── the manifest entry the voice agent routes on ─────────────────────────────

def test_the_documents_screen_is_voice_addressable():
    from app.pipeline.screen_agent import SCREEN_CAPABILITIES, _sanitize_actions

    spec = SCREEN_CAPABILITIES["/documents"]
    assert {"pick_file", "translate", "seal", "verify", "download"} <= set(spec["actions"])
    assert "encrypt" not in spec["actions"], "removed — the copilot must not offer it"
    # And its declared params survive the shared validator.
    plan = [{"screen": "/documents", "action": "set_target", "params": {"lang": "kn"}}]
    assert _sanitize_actions(plan) == plan
    assert _sanitize_actions(
        [{"screen": "/documents", "action": "set_target", "params": {"lang": "fr"}}]
    ) == [], "an unoffered language must be dropped"
