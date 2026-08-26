"""End-to-end voice pipeline check: type -> brain -> [SPEAK] -> Sarvam audio.

Exercises the real running server on both databases and both languages, and proves
the TTS cache is actually serving hits. Writes a WAV per case so the audio can be
played and confirmed to be Sarvam's voice rather than a browser fallback.

    cd backend
    .\.venv\Scripts\python.exe scratch/verify_voice_pipeline.py
"""
from __future__ import annotations

import base64
import json
import pathlib
import time
import urllib.error
import urllib.request

BASE = "http://localhost:8000"
OUT_DIR = pathlib.Path(__file__).parent / "voice_out"


def call(path: str, body=None, token: str | None = None, timeout: int = 300):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def chat_turn(question: str, lang: str, token: str) -> tuple[str | None, str, float]:
    """Returns (speak_text, display_text, seconds)."""
    t0 = time.time()
    resp = call("/chat/stream", {"message": question, "lang": lang}, token)
    tokens: list[str] = []
    speak = None
    for raw in resp:
        line = raw.decode("utf-8", "replace").strip()
        if not line.startswith("data:"):
            continue
        try:
            ev = json.loads(line[5:])
        except Exception:
            continue
        kind = ev.get("type")
        if kind == "token":
            tokens.append(ev.get("text", ""))
        elif kind == "speak":
            speak = ev.get("text")
        elif kind == "done":
            break
    return speak, "".join(tokens), time.time() - t0


def synth(text: str, lang: str, token: str) -> tuple[int, str, float, str]:
    """Returns (audio_bytes_len, mime, seconds, note)."""
    t0 = time.time()
    try:
        body = json.loads(call("/voice/tts", {"text": text, "lang": lang, "backend": "sarvam"}, token).read())
    except urllib.error.HTTPError as e:
        return 0, "", time.time() - t0, f"HTTP {e.code} {e.read().decode()[:80]}"
    audio = base64.b64decode(body.get("audio_base64") or "")
    return len(audio), body.get("mime", ""), time.time() - t0, body.get("provider", "")


def main() -> int:
    OUT_DIR.mkdir(exist_ok=True)
    token = json.loads(call("/auth/login", {"username": "demo", "password": ""}).read())["token"]

    providers = json.loads(
        call("/settings/db-source/models", token=token).read()
    )
    print(f"brain={providers['default_brain_engine']} gemini={providers['gemini_model']}")
    assert "openai" not in json.dumps(providers).lower(), "OpenAI still present in API"

    question = "Which districts have the lowest clearance rate?"
    failures: list[str] = []

    for db in ("cloud", "local"):
        call("/settings/db-source", {"source": db}, token)
        print(f"\n===== DB = {db} =====")
        for lang in ("en", "kn"):
            speak, display, chat_s = chat_turn(question, lang, token)
            tag_leak = "SPEAK" in display.upper()
            spoken = speak or display

            n1, mime, t1, note1 = synth(spoken, lang, token)   # cold
            n2, _, t2, _ = synth(spoken, lang, token)          # should be a cache hit

            if n1:
                (OUT_DIR / f"{db}_{lang}.wav").write_bytes(
                    base64.b64decode(
                        json.loads(
                            call("/voice/tts", {"text": spoken, "lang": lang, "backend": "sarvam"}, token).read()
                        )["audio_base64"]
                    )
                )

            ok = bool(speak) and not tag_leak and n1 > 1000 and n2 == n1
            print(
                f"  {lang}: chat={chat_s:5.1f}s speak={'YES' if speak else 'NO ':3} "
                f"tag_leak={tag_leak!s:5} audio={n1:>8}B {mime} "
                f"cold={t1:5.2f}s cached={t2:5.2f}s {'OK' if ok else 'FAIL ' + note1}"
            )
            if not ok:
                failures.append(f"{db}/{lang}: {note1 or 'see above'}")

    call("/settings/db-source", {"source": "cloud"}, token)
    print(f"\nWAV files written to {OUT_DIR}")
    if failures:
        print("FAILURES:")
        for f in failures:
            print("  " + f)
        return 1
    print("ALL CASES PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
