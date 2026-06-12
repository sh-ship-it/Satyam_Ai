from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    lang: Literal["en", "kn"] = "en"


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
