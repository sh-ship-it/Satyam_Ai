"""Gemini 2.5 Flash client (primary chat / Text-to-SQL lane).

Notes baked in from the locked spec:
  - Safety thresholds: use BLOCK_ONLY_HIGH / OFF. BLOCK_NONE is a RESTRICTED
    setting (allowlist or invoiced billing) — do NOT rely on it on a free key.
  - Child-safety filters are always-on and cannot be disabled; callers must
    catch a blockReason and fall back to a templated DB answer.
  - Disable Google Search grounding; use responseSchema + temperature 0 for
    Text-to-SQL and slot extraction.
  - Keep the API key server-side only; back off on 429.
If GEMINI_API_KEY is unset the client runs in demo mode (deterministic echo).
"""
from __future__ import annotations

from typing import AsyncIterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings
from app.logging_config import get_logger

_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Safety: high-block only; child-safety stays always-on server-side.
_SAFETY = [
    {"category": c, "threshold": "BLOCK_ONLY_HIGH"}
    for c in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]


class BlockedByModel(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class GeminiLLM:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.gemini_api_key
        self._model = s.gemini_model
        self._demo = not self._key
        self._log = get_logger()

    def _payload(self, prompt: str, system: str | None, temperature: float,
                 json_schema: dict | None) -> dict:
        gen: dict = {"temperature": temperature}
        if json_schema:
            gen["responseMimeType"] = "application/json"
            gen["responseSchema"] = json_schema
        body: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "safetySettings": _SAFETY,
            "generationConfig": gen,
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        return body

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8), reraise=True)
    async def complete(self, prompt: str, *, system: str | None = None,
                       temperature: float = 0.0, json_schema: dict | None = None) -> str:
        self._log.debug("[brain] GeminiLLM model=%s", self._model)
        if self._demo:
            return f"[demo:gemini] {prompt[:240]}"
        url = f"{_BASE}/models/{self._model}:generateContent?key={self._key}"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json=self._payload(prompt, system, temperature, json_schema))
            r.raise_for_status()
            data = r.json()
        if not data.get("candidates"):
            reason = (data.get("promptFeedback") or {}).get("blockReason", "SAFETY")
            raise BlockedByModel(reason)
        cand = data["candidates"][0]
        if cand.get("finishReason") in {"SAFETY", "PROHIBITED_CONTENT"}:
            raise BlockedByModel(cand.get("finishReason"))
        return "".join(p.get("text", "") for p in cand["content"]["parts"])

    async def stream(self, prompt: str, *, system: str | None = None,
                     temperature: float = 0.0) -> AsyncIterator[str]:
        # Simple chunker over a single completion; swap for streamGenerateContent
        # when you wire real SSE from Gemini.
        text = await self.complete(prompt, system=system, temperature=temperature)
        for word in text.split(" "):
            yield word + " "
