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
    detected_lang: str | None = None  # language detected by the provider (e.g. "en-IN", "kn-IN")
    provider: str


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    src: str = "en"
    tgt: str = "kn"


class TranslateResponse(BaseModel):
    text: str
    provider: str


# ── Voice Screen Agent ──────────────────────────────────────────────────────

class AgentRequest(BaseModel):
    """A spoken command + the screen the officer is currently on."""
    command: str = Field(min_length=1, max_length=1000)
    current_route: str | None = None
    lang: str = "en"
    brain_engine: str | None = None


class ScreenAction(BaseModel):
    screen: str
    action: str
    params: dict = {}


class AgentPlan(BaseModel):
    route: str | None = None        # screen to navigate to (None = stay/answer)
    answer: bool = False            # True = pure data question, defer to chat brain
    speak: str = ""                 # spoken confirmation
    actions: list[ScreenAction] = []
