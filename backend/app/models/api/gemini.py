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


# ── Model catalogue ─────────────────────────────────────────────────────────
# An ALLOW-LIST, not a hint: the id arrives from the Settings panel, so an
# unvalidated value would be interpolated straight into the request URL.
#
# Latencies measured on this project's free key (2026-08-26, prompt = the single
# word "hi"). They are in the labels because the spread is three orders of
# magnitude, which is not something an officer should discover mid-demo:
#   gemini-3.5-flash-lite   0.7 s   (thoughts=0)
#   gemini-3.6-flash        3.1 s
#   gemini-3.5-flash       ~2 s, but answered 503 "high demand" on a retry
#   gemini-3.7-flash      131.8 s at thinkingLevel=low, else 503 / timeout
#
# There is deliberately no "3.7 non-thinking" entry: no gemini-3.7-flash-lite
# exists in the model list, and thinking cannot be disabled — thinkingLevel="off"
# and thinkingBudget=0 are both rejected (400 / 503 respectively).
GEMINI_MODELS: dict[str, str] = {
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite — fastest (~0.7s) · default",
    "gemini-3.6-flash": "Gemini 3.6 Flash — balanced (~3s)",
    "gemini-3.5-flash": "Gemini 3.5 Flash — occasional 503 under load",
    "gemini-3.7-flash": "Gemini 3.7 Flash — newest, very slow (may time out)",
}

# The API enum, verified: "off" and "none" return HTTP 400 "Invalid value at
# generation_config.thinking_config.thinking_level". Reasoning can be turned
# down, never off.
THINKING_LEVELS = ("low", "medium", "high")

# Runtime overrides from the Settings panel, mirroring the `_db_source`
# process-wide pattern in app/db/session.py. None = fall back to the env value.
_model_override: str | None = None
_thinking_override: str | None = None


def supports_thinking(model: str) -> bool:
    """True for the Gemini 3 family, which accepts thinkingConfig.thinkingLevel.

    Verified against model metadata: gemini-3.6-flash and gemini-3.7-flash both
    report `thinking: true`, and a call carrying thinkingLevel is accepted.
    """
    return model.startswith("gemini-3")


def active_gemini_model() -> str:
    """Settings override, else GEMINI_MODEL, else the first allow-listed id."""
    if _model_override:
        return _model_override
    env = get_settings().gemini_model
    return env if env in GEMINI_MODELS else next(iter(GEMINI_MODELS))


def active_thinking_level() -> str:
    if _thinking_override:
        return _thinking_override
    level = get_settings().gemini_thinking_level
    return level if level in THINKING_LEVELS else "low"


def set_gemini_model(model: str | None) -> None:
    """Set the process-wide Gemini model. Rejects anything off the allow-list."""
    global _model_override
    if model is not None and model not in GEMINI_MODELS:
        raise ValueError(f"unknown Gemini model: {model!r}")
    _model_override = model


def set_thinking_level(level: str | None) -> None:
    global _thinking_override
    if level is not None and level not in THINKING_LEVELS:
        raise ValueError(f"unknown reasoning level: {level!r}")
    _thinking_override = level


class GeminiLLM:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.gemini_api_key
        self._demo = not self._key
        self._log = get_logger()

    # Model and reasoning depth are read PER CALL, not cached in __init__, because
    # registry.get_llm is @lru_cache'd: one GeminiLLM instance outlives every
    # Settings change, so an instance that snapshotted the model at construction
    # would ignore the picker until the process restarted.
    @property
    def _model(self) -> str:
        return active_gemini_model()

    def _payload(self, prompt: str, system: str | None, temperature: float,
                 json_schema: dict | None) -> dict:
        gen: dict = {"temperature": temperature}
        if json_schema:
            gen["responseMimeType"] = "application/json"
            gen["responseSchema"] = json_schema
        level = active_thinking_level()
        if level and supports_thinking(self._model):
            # Gemini 3 takes thinkingConfig.thinkingLevel; the 2.5 family used a
            # numeric thinkingBudget instead, so this is deliberately gated on
            # the model family rather than sent unconditionally.
            gen["thinkingConfig"] = {"thinkingLevel": level}
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
        # Send the API key in a header (x-goog-api-key), NEVER in the URL query
        # string — otherwise the key leaks into request logs, error messages,
        # and any proxy/access logs that record URLs.
        url = f"{_BASE}/models/{self._model}:generateContent"
        headers = {"x-goog-api-key": self._key, "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=get_settings().gemini_timeout_seconds) as client:
            r = await client.post(
                url, headers=headers,
                json=self._payload(prompt, system, temperature, json_schema),
            )
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
