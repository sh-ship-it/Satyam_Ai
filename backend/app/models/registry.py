"""Factory that resolves the configured backend to concrete model instances.

Cached per-process. Embeddings are ALWAYS BGE-M3 (local, sole embedder) per the
locked spec — there is no hosted embedding lane.

Configuration flags (from app.config / env):
  MODEL_BACKEND   api | local         — overall compute plane
  BRAIN_ENGINE    gemini | groq        — LLM for chat / slots / routing
  SQL_ENGINE      gemini | qwen3-coder-next  — LLM for Text-to-SQL
  VOICE_BACKEND   sarvam | bhashini   — voice provider for STT/TTS/MT

Per-request overrides can be passed explicitly (e.g. from the Settings panel)
by calling the override variants `get_llm_for`, `get_sql_llm_for`, etc.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Literal

from app.config import get_settings

log = logging.getLogger(__name__)
from app.models.base import (
    LLM, Embedder, Reranker, SpeechToText, TextToSpeech, Translator,
)


# ── Brain LLM (chat / slots / routing) ───────────────────────────────────────

@lru_cache
def get_llm(engine: Literal["gemini", "groq", "local"] | None = None) -> LLM:
    """Return the brain LLM.

    Resolution order:
      1. Explicit `engine` arg (per-request override from Settings panel).
      2. `BRAIN_ENGINE` env var.
      3. `MODEL_BACKEND=local` → LocalLLM.
      Fallback: GeminiLLM.
    """
    s = get_settings()
    resolved = engine or (None if s.model_backend != "local" else "local") or s.brain_engine
    if resolved == "local":
        from app.models.local.llm_local import LocalLLM
        return LocalLLM()
    if resolved == "groq":
        from app.models.api.groq import GroqLLM
        return GroqLLM()
    # default: gemini
    from app.models.api.gemini import GeminiLLM
    return GeminiLLM()


@lru_cache
def get_fallback_llm() -> LLM:
    """Low-latency fallback lane (always Groq) used on timeout / 429 from primary."""
    from app.models.api.groq import GroqLLM
    return GroqLLM()


@lru_cache
def get_classifier_llm() -> LLM:
    """Cheap lane for intent routing and screen planning.

    Classifying an utterance into a closed enum, or picking one of ~17 screens, is
    not reasoning work, and a single spoken command already costs screen_agent +
    router + compose. Keeping the classifiers on the cheapest, fastest lane is what
    stops one command from spending three good calls.

    Groq first (measured 0.36s), Gemini if Groq is unavailable.
    """
    s = get_settings()
    if s.groq_api_key:
        from app.models.api.groq import GroqLLM
        return GroqLLM()
    from app.models.api.gemini import GeminiLLM
    return GeminiLLM()


def _is_demo(text: str) -> bool:
    """A `[demo:...]` echo means the adapter had no API key.

    Same convention as `screen_agent._is_demo_echo`: treat it as a miss so the
    cascade keeps looking instead of shipping a placeholder as an answer.
    """
    return not text or text.lstrip().startswith("[demo:")


async def complete_with_brain(
    prompt: str,
    *,
    system: str | None = None,
    temperature: float = 0.0,
    json_schema: dict | None = None,
    engine: str | None = None,
) -> tuple[str, str]:
    """Brain call for answer composition. Returns `(text, engine_actually_used)`.

    Cascade: the requested engine → Gemini → Groq. Routing and screen planning use
    `get_classifier_llm()` instead, and Text-to-SQL has its own `get_sql_llm()`
    lane, so this is only ever the answer-quality path.

    Every downgrade is logged with its own event name. That discipline is copied
    from `pipeline/router.py`, where it exists because a silent fallback once made
    a dead Gemini key look like bad routing.
    """
    s = get_settings()
    resolved = engine or (None if s.model_backend != "local" else "local") or s.brain_engine
    attempted: list[str] = []

    async def _run(name: str) -> str | None:
        attempted.append(name)
        try:
            out = await get_llm(name).complete(  # type: ignore[arg-type]
                prompt, system=system, temperature=temperature, json_schema=json_schema
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("brain.lane_failed engine=%s err=%s", name, exc)
            return None
        if _is_demo(out):
            log.warning("brain.demo_echo engine=%s - no API key, falling through", name)
            return None
        return out

    # Lane order: whatever was explicitly requested, then Gemini, then Groq.
    #
    # OpenAI used to sit at the end of this list and has been removed entirely:
    # gpt-4o measured ~19s for a one-word prompt and its rate limit answered 429
    # only after 12.8s of waiting, against 0.36s for Groq and ~0.7s for Gemini
    # Flash Lite. On a voice product that difference is paid in dead air, and a
    # 50-request daily cap is not something a demo can rely on either.
    for name in [resolved, "gemini", "groq"]:
        if not name or name in attempted:
            continue
        out = await _run(name)
        if out is None:
            continue
        if attempted[:-1]:
            log.info("brain.failover_to_%s after=%s", name, ",".join(attempted[:-1]))
        return out, name

    raise RuntimeError(
        f"every brain lane failed or was unconfigured (tried: {', '.join(attempted) or 'none'})"
    )


# ── Text-to-SQL LLM ──────────────────────────────────────────────────────────

@lru_cache
def get_sql_llm(engine: Literal["gemini", "qwen3-coder-next", "local"] | None = None) -> LLM:
    """Return the Text-to-SQL LLM.

    Resolution order:
      1. Explicit `engine` arg (per-request override from Settings panel).
      2. `SQL_ENGINE` env var.
      3. `MODEL_BACKEND=local` → LocalLLM.
      Fallback: GeminiLLM.

    The sqlglot guard applies identically regardless of which engine is chosen.
    """
    s = get_settings()
    resolved = engine or (None if s.model_backend != "local" else "local") or s.sql_engine
    if resolved == "local":
        from app.models.local.llm_local import LocalLLM
        return LocalLLM()
    if resolved == "qwen3-coder-next":
        from app.models.api.ollama_cloud import OllamaCloudLLM
        return OllamaCloudLLM()
    # default: gemini
    from app.models.api.gemini import GeminiLLM
    return GeminiLLM()


# ── Embedder (always BGE-M3 local — not swappable) ───────────────────────────

@lru_cache
def get_embedder() -> Embedder:
    from app.models.local.embedder_bge import BgeM3Embedder
    return BgeM3Embedder(dim=get_settings().embedding_dim)


# ── Reranker ─────────────────────────────────────────────────────────────────

@lru_cache
def get_reranker() -> Reranker:
    from app.models.local.reranker_bge import BgeReranker
    return BgeReranker()


# ── Voice (STT / TTS / MT) ───────────────────────────────────────────────────

@lru_cache
def get_stt(backend: Literal["sarvam", "google", "bhashini", "local"] | None = None) -> SpeechToText:
    """Sarvam (primary) → Google → Bhashini (fallback) → local Whisper.

    Resolution order:
      1. Explicit `backend` arg (per-request override).
      2. `MODEL_BACKEND=local` → WhisperSTT.
      3. `VOICE_BACKEND` env var.
      Fallback: SarvamSTT.
    """
    s = get_settings()
    resolved = backend or (None if s.model_backend != "local" else "local") or s.voice_backend
    if resolved == "local":
        from app.models.local.stt_whisper import WhisperSTT
        return WhisperSTT()
    if resolved == "google":
        from app.models.api.google_voice import GoogleSTT
        return GoogleSTT()
    if resolved == "bhashini":
        from app.models.api.bhashini import BhashiniSTT
        return BhashiniSTT()
    # default: sarvam
    from app.models.api.sarvam import SarvamSTT
    return SarvamSTT()


@lru_cache
def get_tts(backend: Literal["sarvam", "google", "bhashini", "local"] | None = None) -> TextToSpeech:
    """Sarvam Bulbul v3 (primary) → Google → Bhashini (fallback) → local Parler-TTS.

    Resolution order same as get_stt.
    """
    s = get_settings()
    resolved = backend or (None if s.model_backend != "local" else "local") or s.voice_backend
    if resolved == "local":
        from app.models.local.tts_parler import ParlerTTS
        return ParlerTTS()
    if resolved == "google":
        from app.models.api.google_voice import GoogleTTS
        return GoogleTTS()
    if resolved == "bhashini":
        from app.models.api.bhashini import BhashiniTTS
        return BhashiniTTS()
    # default: sarvam
    from app.models.api.sarvam import SarvamTTS
    return SarvamTTS()


@lru_cache
def get_translator(backend: Literal["sarvam", "bhashini"] | None = None) -> Translator:
    """Sarvam Translate (primary) → Bhashini NMT (fallback).
    Falls back to Bhashini stub in local/no-key mode (no local translator class).
    """
    s = get_settings()
    # In fully-local mode with no voice keys, fall back to Bhashini stub
    # (no dedicated local translator — closest thing is Bhashini demo).
    if s.model_backend == "local" and not s.sarvam_api_key:
        from app.models.api.bhashini import BhashiniTranslator
        return BhashiniTranslator()
    resolved = backend or s.voice_backend
    if resolved == "bhashini":
        from app.models.api.bhashini import BhashiniTranslator
        return BhashiniTranslator()
    # default: sarvam
    from app.models.api.sarvam import SarvamTranslator
    return SarvamTranslator()
