"""Probe the thing that actually broke the browser: which address:origin pairs work.

The encrypt request was correct all along. What failed was reaching the server at
all — `localhost` resolves to ::1 first on Windows, and `uvicorn --host 0.0.0.0`
binds IPv4 only, so the browser intermittently could not connect and fetch() threw a
bare "Failed to fetch" indistinguishable from a CORS fault.

Results -> scratch/_reach_out.txt
"""
from __future__ import annotations

import http.client
import json
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_documents import build_pdf_pypdf, call, multipart  # noqa: E402

lines: list[str] = []

# 1. Which loopback families accept a connection at all?
for label, family, addr in [
    ("127.0.0.1 (IPv4)", socket.AF_INET, ("127.0.0.1", 8000)),
    ("::1       (IPv6)", socket.AF_INET6, ("::1", 8000)),
]:
    s = socket.socket(family, socket.SOCK_STREAM)
    s.settimeout(4)
    try:
        s.connect(addr)
        lines.append(f"{label}  CONNECTS")
    except OSError as exc:
        lines.append(f"{label}  REFUSED  ({exc.__class__.__name__})")
    finally:
        s.close()

# 2. What every name the browser might use resolves to, in the order it is tried.
for name in ["localhost", "127.0.0.1"]:
    got = socket.getaddrinfo(name, 8000, proto=socket.IPPROTO_TCP)
    order = " then ".join(dict.fromkeys(g[4][0] for g in got))
    lines.append(f"resolve {name:9} -> {order}")

# 3. A real upload, from each allowed Origin, over IPv4.
tok = json.loads(call("/auth/login", {"username": "demo", "password": ""}).read())["token"]
data, ctype = multipart(
    {"source_lang": "en", "target_lang": "kn"},
    "fir101.pdf",
    build_pdf_pypdf("A theft FIR on the fourteenth."),
    "application/pdf",
)

ok = True
for origin in ["http://localhost:3000", "http://127.0.0.1:3000", "http://evil.test"]:
    conn = http.client.HTTPConnection("127.0.0.1", 8000, timeout=180)
    conn.request(
        "POST",
        "/api/documents/translate",
        body=data,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": ctype, "Origin": origin},
    )
    r = conn.getresponse()
    body = r.read()
    acao = r.getheader("access-control-allow-origin")
    allowed = origin != "http://evil.test"
    # An unlisted origin still gets a 200 from the server; it is the MISSING
    # allow-origin header that makes the browser discard it. Both are asserted.
    good = r.status == 200 and b"translated_text" in body and (acao == origin) == allowed
    ok = ok and good
    lines.append(
        f"translate from {origin:24} {r.status} bytes={len(body):<6} "
        f"acao={acao or 'none'} {'OK' if good else 'BAD'}"
    )
    conn.close()

ipv4_only = "REFUSED" in "\n".join(lines[:2])
lines.append(f"NOTE=server is IPv4-only: {ipv4_only} (so clients must use 127.0.0.1)")
lines.append(f"RESULT={'PASS' if ok else 'FAIL'}")
Path("scratch/_reach_out.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
