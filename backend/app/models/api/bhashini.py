"""Bhashini (Govt. of India) clients — PRIMARY Indic layer (Kannada STT/TTS/MT).

These are thin wrappers around the Bhashini pipeline API. Without credentials
they return deterministic demo values so the stack runs end-to-end offline.
Replace `_call` with the real Bhashini compute payload when you have keys.
"""
from __future__ import annotations

from app.config import get_settings


class _BhashiniBase:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.bhashini_api_key
        self._user = s.bhashini_user_id
        self._demo = not (self._key and self._user)


class BhashiniSTT(_BhashiniBase):
    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str:
        if self._demo:
            return "[demo:stt] \u0c95\u0ca8\u0ccd\u0ca8\u0ca1 \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8\u0cc6"  # 'Kannada question'
        raise NotImplementedError("Wire Bhashini ASR compute call here.")


class BhashiniTTS(_BhashiniBase):
    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes:
        if self._demo:
            return b"RIFF....demo-wav"
        raise NotImplementedError("Wire Bhashini TTS compute call here.")


class BhashiniTranslator(_BhashiniBase):
    async def translate(self, text: str, *, src: str, tgt: str) -> str:
        if self._demo:
            return f"[demo:mt {src}->{tgt}] {text}"
        raise NotImplementedError("Wire Bhashini NMT compute call here.")
