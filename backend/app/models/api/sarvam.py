"""Sarvam AI clients — PRIMARY voice layer (Kannada + English STT/TTS/MT).

Services used:
  - Saaras v3 (Sarvam's Whisper-based STT)   → POST /speech-to-text
  - Bulbul v3 TTS                             → POST /text-to-speech
  - Sarvam Translate                          → POST /translate

Free-tier credits are a one-time grant (do not auto-renew). Pre-cache scripted
demo TTS at demo time to conserve credits.

If SARVAM_API_KEY is unset the client runs in demo mode (deterministic stubs).
"""
from __future__ import annotations

import base64

import httpx

from app.config import get_settings

_BASE = "https://api.sarvam.ai"
_HEADERS = {"Content-Type": "application/json"}


class _SarvamBase:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.sarvam_api_key
        self._demo = not self._key

    def _auth(self) -> dict[str, str]:
        return {"api-subscription-key": self._key}


class SarvamSTT(_SarvamBase):
    """Sarvam Saaras v3 — speech-to-text for Kannada (kn-IN) and English (en-IN)."""

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        if self._demo:
            return "[demo:sarvam-stt] ಕನ್ನಡ ಪ್ರಶ್ನೆ"  # 'Kannada question'
        bcp_lang = "kn-IN" if lang == "kn" else "en-IN"
        audio_b64 = base64.b64encode(audio).decode()
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/speech-to-text",
                headers={**_HEADERS, **self._auth()},
                json={
                    "model": "saaras:v3",
                    "audio": audio_b64,
                    "language_code": bcp_lang,
                },
            )
            r.raise_for_status()
        return r.json().get("transcript", "")


class SarvamTTS(_SarvamBase):
    """Sarvam Bulbul v3 — text-to-speech for Kannada and English."""

    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes:
        if self._demo:
            return b"RIFF....demo-wav-sarvam"
        bcp_lang = "kn-IN" if lang == "kn" else "en-IN"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/text-to-speech",
                headers={**_HEADERS, **self._auth()},
                json={
                    "inputs": [text],
                    "target_language_code": bcp_lang,
                    "speaker": "meera",  # default Kannada/Indian-English voice
                    "model": "bulbul:v1",
                    "enable_preprocessing": True,
                },
            )
            r.raise_for_status()
        audio_b64 = r.json().get("audios", [""])[0]
        return base64.b64decode(audio_b64) if audio_b64 else b""


class SarvamTranslator(_SarvamBase):
    """Sarvam Translate — neural MT between Kannada and English."""

    async def translate(self, text: str, *, src: str, tgt: str) -> str:
        if self._demo:
            return f"[demo:sarvam-mt {src}->{tgt}] {text}"
        src_bcp = "kn-IN" if src == "kn" else "en-IN"
        tgt_bcp = "kn-IN" if tgt == "kn" else "en-IN"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{_BASE}/translate",
                headers={**_HEADERS, **self._auth()},
                json={
                    "input": text,
                    "source_language_code": src_bcp,
                    "target_language_code": tgt_bcp,
                    "speaker_gender": "Female",
                    "mode": "formal",
                    "model": "mayura:v1",
                    "enable_preprocessing": False,
                },
            )
            r.raise_for_status()
        return r.json().get("translated_text", text)
