"""Factory that resolves the configured backend to concrete model instances.

Cached per-process. Embeddings are ALWAYS BGE-M3 (local, sole embedder) per the
locked spec — there is no hosted embedding lane.
"""
from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.models.base import (
    LLM, Embedder, Reranker, SpeechToText, TextToSpeech, Translator,
)


@lru_cache
def get_llm() -> LLM:
    s = get_settings()
    if s.model_backend == "local":
        from app.models.local.llm_local import LocalLLM
        return LocalLLM()
    from app.models.api.gemini import GeminiLLM
    return GeminiLLM()


@lru_cache
def get_fallback_llm() -> LLM:
    """Low-latency fallback lane (Groq) used on timeout / 429 from the primary."""
    from app.models.api.groq import GroqLLM
    return GroqLLM()


@lru_cache
def get_embedder() -> Embedder:
    from app.models.local.embedder_bge import BgeM3Embedder
    return BgeM3Embedder(dim=get_settings().embedding_dim)


@lru_cache
def get_reranker() -> Reranker:
    from app.models.local.reranker_bge import BgeReranker
    return BgeReranker()


@lru_cache
def get_stt() -> SpeechToText:
    s = get_settings()
    if s.model_backend == "local":
        from app.models.local.stt_whisper import WhisperSTT
        return WhisperSTT()
    from app.models.api.bhashini import BhashiniSTT
    return BhashiniSTT()


@lru_cache
def get_tts() -> TextToSpeech:
    s = get_settings()
    if s.model_backend == "local":
        from app.models.local.tts_parler import ParlerTTS
        return ParlerTTS()
    from app.models.api.bhashini import BhashiniTTS
    return BhashiniTTS()


@lru_cache
def get_translator() -> Translator:
    from app.models.api.bhashini import BhashiniTranslator
    return BhashiniTranslator()
