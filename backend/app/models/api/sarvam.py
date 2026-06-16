"""Sarvam AI clients — PRIMARY voice layer (Kannada + English STT/TTS/MT).

Services used:
  - Saaras v3 (STT)        → POST /speech-to-text   (multipart/form-data!)
  - Bulbul v2 (TTS)        → POST /text-to-speech    (JSON)
  - Mayura v1 (Translate)  → POST /translate         (JSON)

If SARVAM_API_KEY is unset the client runs in demo mode (deterministic stubs);
TTS demo returns b"" so the route 502s and the frontend uses its browser fallback.

VALID speaker/model pairs (speakers are NOT interchangeable across versions):
  - bulbul:v2  → anushka, manisha, vidya, arya (F) / abhilash, karun, hitesh (M)
  - bulbul:v3  → ritu, priya, neha, pooja, shreya, ... (different catalog)
We use bulbul:v2 + anushka (documented, stable, supports kn-IN & en-IN).
v2 caps a single input at ~500 chars, so we trim on a sentence boundary.
"""
from __future__ import annotations

import base64

import httpx

from app.config import get_settings

_BASE = "https://api.sarvam.ai"
_TTS_MAX_CHARS = 480  # safety margin under Bulbul v2's ~500-char per-input limit


def _bcp(lang: str) -> str:
    return "kn-IN" if str(lang or "").lower().startswith("kn") else "en-IN"


def _trim_for_tts(text: str, limit: int = _TTS_MAX_CHARS) -> str:
    """Trim to <= limit chars, preferring the last sentence boundary."""
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    head = t[:limit]
    cut = max(
        head.rfind(". "),
        head.rfind("? "),
        head.rfind("! "),
        head.rfind("\u0964"),  # Devanagari/Kannada danda
    )
    return (head[: cut + 1] if cut > 80 else head).strip()


class _SarvamBase:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.sarvam_api_key
        self._demo = not self._key

    def _auth(self) -> dict[str, str]:
        # ONLY the subscription key header. Do NOT set Content-Type here:
        #  - httpx sets application/json automatically for `json=`
        #  - httpx sets the multipart boundary automatically for `files=`
        return {"api-subscription-key": self._key}


class SarvamSTT(_SarvamBase):
    """Saaras v3 speech-to-text. /speech-to-text is multipart/form-data.

    Sends language_code="unknown" to enable Saaras v3 auto-detection.
    Returns (transcript, detected_lang) where detected_lang is the BCP-47
    code returned by the API (e.g. "kn-IN", "en-IN").
    """

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        """Kept for Protocol compatibility — use transcribe_with_lang for auto-detect."""
        transcript, _ = await self.transcribe_with_lang(audio, lang=lang)
        return transcript

    async def transcribe_with_lang(
        self, audio: bytes, *, lang: str = "auto"
    ) -> tuple[str, str | None]:
        """Transcribe and return (transcript, detected_lang_bcp47).

        lang="auto" or lang="unknown" → Saaras v3 auto-detects the language.
        """
        if self._demo:
            return "[demo:sarvam-stt] ಕನ್ನಡ ಪ್ರಶ್ನೆ", "kn-IN"
        # Use "unknown" to let Saaras v3 auto-detect the spoken language.
        lang_code = "unknown" if lang in ("auto", "unknown") else _bcp(lang)
        # Sniff the container from magic bytes to set the right MIME type.
        # Saaras v3 accepts webm/opus (MediaRecorder default) and WAV.
        mime = "audio/wav"
        if len(audio) >= 4:
            if audio[:4] in (b"\x1a\x45\xdf\xa3",) or audio[:4] == b"webm":
                mime = "audio/webm"
            elif audio[:4] == b"OggS":
                mime = "audio/ogg"
        filename = (
            "audio.webm" if "webm" in mime else
            "audio.ogg"  if "ogg"  in mime else
            "audio.wav"
        )
        files = {"file": (filename, audio, mime)}
        data = {"model": "saaras:v3", "language_code": lang_code}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/speech-to-text",
                headers=self._auth(),   # NO Content-Type → multipart boundary preserved
                files=files,
                data=data,
            )
            r.raise_for_status()
        body = r.json() or {}
        transcript = body.get("transcript", "")
        # Saaras v3 returns the detected language_code in the response.
        detected = body.get("language_code") or body.get("detected_language_code") or None
        return transcript, detected


class SarvamTTS(_SarvamBase):
    """Bulbul v2 text-to-speech for Kannada and English. Returns WAV bytes."""

    mime = "audio/wav"

    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes:
        if self._demo:
            return b""  # no key → 502 → frontend browser fallback
        spoken = _trim_for_tts(text)
        if not spoken:
            return b""
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{_BASE}/text-to-speech",
                headers={"Content-Type": "application/json", **self._auth()},
                json={
                    "inputs": [spoken],
                    "target_language_code": _bcp(lang),
                    "speaker": "anushka",       # valid bulbul:v2 female voice (kn-IN + en-IN)
                    "model": "bulbul:v2",       # was the invalid bulbul:v3 + meera pair
                    "speech_sample_rate": 22050,
                    "enable_preprocessing": True,
                },
            )
            r.raise_for_status()
        audio_b64 = (r.json() or {}).get("audios", [""])[0]
        return base64.b64decode(audio_b64) if audio_b64 else b""


class SarvamTranslator(_SarvamBase):
    """Mayura v1 — neural MT between Kannada and English."""

    async def translate(self, text: str, *, src: str, tgt: str) -> str:
        if self._demo:
            return f"[demo:sarvam-mt {src}->{tgt}] {text}"
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{_BASE}/translate",
                headers={"Content-Type": "application/json", **self._auth()},
                json={
                    "input": text,
                    "source_language_code": _bcp(src),
                    "target_language_code": _bcp(tgt),
                    "speaker_gender": "Female",
                    "mode": "formal",
                    "model": "mayura:v1",
                    "enable_preprocessing": False,
                },
            )
            r.raise_for_status()
        return (r.json() or {}).get("translated_text", text)
