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

from functools import lru_cache
from typing import Literal

from app.config import get_settings
from app.models.base import (
    LLM, Embedder, Reranker, SpeechToText, TextToSpeech, Translator,
)


# ── Brain LLM (chat / slots / routing) ───────────────────────────────────────

@lru_cache
def get_llm(engine: Literal["gemini", "groq", "openai", "local"] | None = None) -> LLM:
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
    if resolved == "openai":
        from app.models.api.openai_llm import OpenAILLM
        return OpenAILLM()
    # default: gemini
    from app.models.api.gemini import GeminiLLM
    return GeminiLLM()


@lru_cache
def get_fallback_llm() -> LLM:
    """Low-latency fallback lane (always Groq) used on timeout / 429 from primary."""
    from app.models.api.groq import GroqLLM
    return GroqLLM()


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
