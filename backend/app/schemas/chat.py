from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    lang: Literal["en", "kn"] = "en"

    # Per-request engine overrides from the Settings panel.
    # When set they take precedence over the server-side env defaults for this
    # session only. None means "use the server default".
    brain_engine: Optional[Literal["gemini", "groq", "local"]] = None
    sql_engine: Optional[Literal["gemini", "qwen3-coder-next", "local"]] = None
    voice_backend: Optional[Literal["sarvam", "google", "bhashini"]] = None


class Citation(BaseModel):
    ref: str
    label: str


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    intent: str
    citations: list[Citation] = []
    sql: Optional[str] = None
    blocked: bool = False
    block_reason: Optional[str] = None
