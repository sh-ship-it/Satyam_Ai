"""Google Cloud voice adapters (API-key auth, REST).

TextToSpeech  → https://texttospeech.googleapis.com/v1/text:synthesize  → MP3 bytes
SpeechToText  → https://speech.googleapis.com/v1/speech:recognize       → transcript

Both use simple ?key=API_KEY auth (no OAuth/service-account needed), which is
the lightest way to wire Cloud TTS for a single-tenant app. Falls back to a
demo stub when GOOGLE_TTS_API_KEY is unset so the pipeline never hard-crashes.
"""
from __future__ import annotations

import base64

import httpx

from app.config import get_settings

_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"
_STT_URL = "https://speech.googleapis.com/v1/speech:recognize"
_TIMEOUT = 30.0


def _lang_code(lang: str) -> str:
    return "kn-IN" if (lang or "").lower().startswith("kn") else "en-IN"


class GoogleTTS:
    """Google Cloud Text-to-Speech. Returns MP3 audio bytes."""

    mime = "audio/mpeg"

    def __init__(self) -> None:
        self._key = get_settings().google_tts_api_key
        self._voice = get_settings().google_tts_voice

    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes:
        if not self._key:
            return b""  # demo mode: no key → backend returns 502 → frontend uses browser fallback
        code = _lang_code(lang)
        voice: dict = {"languageCode": code, "ssmlGender": "FEMALE"}
        if self._voice:
            voice["name"] = self._voice
        payload = {
            "input": {"text": text},
            "voice": voice,
            "audioConfig": {"audioEncoding": "MP3"},
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(f"{_TTS_URL}?key={self._key}", json=payload)
            r.raise_for_status()
            b64 = r.json().get("audioContent", "")
        return base64.b64decode(b64) if b64 else b""


class GoogleSTT:
    """Google Cloud Speech-to-Text. Expects WEBM/Opus audio (MediaRecorder default)."""

    def __init__(self) -> None:
        self._key = get_settings().google_tts_api_key

    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        if not self._key or not audio:
            return ""
        payload = {
            "config": {
                "encoding": "WEBM_OPUS",
                "sampleRateHertz": 48000,
                "languageCode": _lang_code(lang),
            },
            "audio": {"content": base64.b64encode(audio).decode("ascii")},
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(f"{_STT_URL}?key={self._key}", json=payload)
            r.raise_for_status()
            data = r.json()
        results = data.get("results") or []
        if not results:
            return ""
        alts = results[0].get("alternatives") or []
        return (alts[0].get("transcript", "") if alts else "").strip()
