"""End-to-end check for the Document Translation screen.

Exercises the real running server: builds a real PDF with pypdf, uploads it,
translates it via Sarvam, seals its digest to the audit chain, verifies it, proves a
tampered copy fails verification, and confirms the removed /encrypt endpoint is gone.

    cd backend
    .\.venv\Scripts\python.exe scratch/verify_documents.py
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000"

TEXT = (
    "FIR 101 of 2025. A theft was reported at Cubbon Park Police Station "
    "on the fourteenth of March. The complainant stated that a motorcycle "
    "was taken from outside the market.\n\n"
    "Two suspects were seen leaving the area. The case remains under "
    "investigation and the recovery of the vehicle is pending."
)


def call(path, body=None, token=None, raw=None, ctype=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if raw is not None:
        data, headers["Content-Type"] = raw, ctype
    else:
        data = json.dumps(body).encode() if body is not None else None
        headers["Content-Type"] = "application/json"
    return urllib.request.urlopen(
        urllib.request.Request(BASE + path, data=data, headers=headers), timeout=180
    )


def multipart(fields: dict, filename: str, filebytes: bytes, mime: str):
    """Hand-rolled multipart body — no requests/httpx dependency needed here."""
    b = "----satyamdoc7391"
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    out.write(
        f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
    )
    out.write(filebytes)
    out.write(f"\r\n--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"


def build_pdf_pypdf(text: str) -> bytes:
    """Minimal single-page PDF written by hand (no reportlab dependency)."""
    lines = [ln for ln in text.replace("\n\n", "\n").split("\n") if ln.strip()]
    body = "BT /F1 11 Tf 40 760 Td 14 TL\n"
    for ln in lines:
        safe = ln.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        body += f"({safe}) Tj T*\n"
    body += "ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(body)} >>\nstream\n{body}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = "%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(pdf))
        pdf += f"{i} 0 obj\n{o}\nendobj\n"
    xref_at = len(pdf)
    pdf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n"
    for off in offsets:
        pdf += f"{off:010d} 00000 n \n"
    pdf += (
        f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    )
    return pdf.encode("latin-1")


def main() -> int:
    tok = json.loads(call("/auth/login", {"username": "demo", "password": ""}).read())["token"]
    fails: list[str] = []

    def check(label, ok, extra=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' — ' + extra) if extra else ''}")
        if not ok:
            fails.append(label)

    # A nonce per run, because the digest is content-addressed: re-running with
    # identical bytes finds the seal from the PREVIOUS run and the
    # "unsealed reports not found" check fails. That is the feature behaving
    # correctly, not a bug, but it makes the script non-repeatable without this.
    import uuid

    nonce = uuid.uuid4().hex[:12]
    pdf = build_pdf_pypdf(f"{TEXT}\n\nRun reference {nonce}.")
    print(f"built test PDF: {len(pdf)} bytes (run {nonce})")

    # ── 1. translate ────────────────────────────────────────────────────────
    print("\n[1] translate PDF -> Kannada")
    data, ctype = multipart({"source_lang": "en", "target_lang": "kn"}, "fir101.pdf", pdf, "application/pdf")
    r = json.loads(call("/api/documents/translate", token=tok, raw=data, ctype=ctype).read())
    check("text extracted", len(r["source_text"]) > 50, f"{len(r['source_text'])} chars, {r['pages']}p")
    check("not flagged as scan", r["needs_ocr"] is False)
    check("digest is sha256", len(r["sha256"]) == 64)
    kn = r["translated_text"]
    has_kannada = any("\u0c80" <= c <= "\u0cff" for c in kn)
    check("translation is Kannada script", has_kannada, f"{len(kn)} chars via {r['provider']}")
    digest = r["sha256"]

    # ── 2. verify BEFORE sealing → must not be found ────────────────────────
    print("\n[2] verify before sealing")
    v = json.loads(call("/api/documents/verify", {"sha256": digest}, tok).read())
    check("unsealed document reports not found", v["found"] is False)

    # ── 3. seal ─────────────────────────────────────────────────────────────
    print("\n[3] seal to audit chain")
    s = json.loads(
        call("/api/documents/seal", {"sha256": digest, "filename": "fir101.pdf", "note": "e2e"}, tok).read()
    )
    check("sealed", s["audit_id"] > 0, f"audit #{s['audit_id']} short={s['short']}")
    check("row_hash present", len(s["row_hash"]) == 64)
    check("prev_hash present", len(s["prev_hash"]) > 0)

    # ── 4. verify AFTER sealing → found + intact ────────────────────────────
    print("\n[4] verify after sealing")
    v2 = json.loads(call("/api/documents/verify", {"sha256": digest}, tok).read())
    check("sealed document is found", v2["found"] is True)
    check("chain link recomputes", v2["link_intact"] is True, v2["detail"][:60])

    # ── 5. tampered copy must NOT verify ────────────────────────────────────
    print("\n[5] tampered document")
    tampered = pdf.replace(b"fourteenth", b"fifteenth!")
    d2, c2 = multipart({"source_lang": "en", "target_lang": "kn"}, "fir101.pdf", tampered, "application/pdf")
    r2 = json.loads(call("/api/documents/translate", token=tok, raw=d2, ctype=c2).read())
    check("one word changed -> different digest", r2["sha256"] != digest)
    v3 = json.loads(call("/api/documents/verify", {"sha256": r2["sha256"]}, tok).read())
    check("tampered copy fails verification", v3["found"] is False)

    # ── 6. the removed endpoint must be gone, not merely unlinked from the UI ──
    print("\n[6] AES-256 encrypt is removed")
    d3, c3 = multipart({"password": "satyam-demo-2026"}, "fir101.pdf", pdf, "application/pdf")
    try:
        call("/api/documents/encrypt", token=tok, raw=d3, ctype=c3)
        check("endpoint no longer exists", False, "it still answered")
    except urllib.error.HTTPError as e:
        check("endpoint no longer exists", e.code == 404, f"{e.code}")

    # ── 7. upload guards ────────────────────────────────────────────────────
    print("\n[7] upload guards")
    for label, name, mime, payload, expect in [
        ("fake PDF rejected", "evil.pdf", "application/pdf", b"MZ\x90\x00 PE binary", 400),
        ("zip rejected", "a.zip", "application/zip", b"PK\x03\x04", 400),
        ("empty rejected", "e.pdf", "application/pdf", b"", 400),
    ]:
        dd, cc = multipart({"source_lang": "en", "target_lang": "kn"}, name, payload, mime)
        try:
            call("/api/documents/translate", token=tok, raw=dd, ctype=cc)
            check(label, False, "was accepted")
        except urllib.error.HTTPError as e:
            detail = json.loads(e.read()).get("detail", "")
            check(label, e.code == expect, f"{e.code}: {detail[:52]}")

    print("\n" + ("ALL PASSED" if not fails else f"{len(fails)} FAILED: {fails}"))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
