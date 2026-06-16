"""Request/response schemas for the voice pipeline (STT / TTS / MT)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    lang: str = "en"          # "en" | "kn" (anything starting with "kn" => Kannada)
    # "webspeech" is handled in the browser and is intentionally not accepted here.
    backend: Literal["sarvam", "google", "bhashini"] | None = None


class TTSResponse(BaseModel):
    audio_base64: str
    mime: str = "audio/wav"
    provider: str


class STTResponse(BaseModel):
    transcript: str
    provider: str


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    src: str = "en"
    tgt: str = "kn"


class TranslateResponse(BaseModel):
    text: str
    provider: str
