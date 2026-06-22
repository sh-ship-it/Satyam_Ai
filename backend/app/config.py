"""Application settings, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "Satyam"
    app_env: Literal["development", "staging", "production"] = "development"

    # Response-Ops module (EMERGE-derived). Off by default — fully isolated.
    enable_response_ops: bool = False

    # Infra
    database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    # Seed/migration URL — owner/superuser role, used ONLY by migrations + seed script.
    seed_database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    # Local Postgres URL — used when the Settings panel switches to "local" source.
    # Falls back to database_url if not set.
    local_database_url: str = "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam"
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_alg: str = "HS256"
    jwt_expire_minutes: int = 480

    # CORS (comma-separated)
    cors_origins: str = "http://localhost:3000"

    # Base URL the backend reaches itself on — used by spawned subprocesses
    # (e.g. the YOLO detector) to call back into /api/ops/detect/notify.
    self_base_url: str = "http://localhost:8000"

    # ── Model adapter layer ───────────────────────────────────────────────────
    # MODEL_BACKEND: selects the overall compute plane (api | local).
    model_backend: Literal["api", "local"] = "api"

    # BRAIN_ENGINE: which LLM drives chat / slots / routing (api lane).
    #   gemini  → Gemini 2.5 Flash (default, best accuracy)
    #   groq    → Groq low-latency / outage fallback
    brain_engine: Literal["gemini", "groq", "openai"] = "gemini"

    # SQL_ENGINE: which LLM generates Text-to-SQL (api lane).
    #   gemini           → Gemini 2.5 Flash (default)
    #   qwen3-coder-next → Ollama Cloud (qwen3-coder-next, 80B MoE / 3B active)
    sql_engine: Literal["gemini", "qwen3-coder-next"] = "gemini"

    # VOICE_BACKEND: server-side default voice provider for STT / TTS.
    #   sarvam   → Sarvam (Bulbul v3 TTS, Saaras v3 STT) — primary / default
    #   google   → Google Cloud Text-to-Speech / Speech-to-Text
    #   bhashini → Bhashini (govt, free, fallback)
    # NOTE: "webspeech" is a browser-only provider and is intentionally NOT a
    # server value — the frontend handles it client-side and never calls /voice.
    voice_backend: Literal["sarvam", "google", "bhashini"] = "sarvam"

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Groq
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # OpenAI (ChatGPT)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_base_url: str = "https://api.openai.com/v1"

    # Sarvam (primary voice — Bulbul v3 TTS, Saaras v3 STT, Sarvam Translate MT)
    sarvam_api_key: str = ""

    # Google Cloud voice (Text-to-Speech + Speech-to-Text REST, API-key auth)
    google_tts_api_key: str = ""
    google_tts_voice: str = ""  # optional e.g. "en-IN-Neural2-A"; blank = language-default

    # Bhashini (fallback voice — govt, free, no credit cap)
    bhashini_api_key: str = ""
    bhashini_user_id: str = ""

    # Ollama Cloud (qwen3-coder-next Text-to-SQL option)
    ollama_cloud_url: str = "https://api.ollama.com"
    ollama_cloud_api_key: str = ""
    ollama_cloud_sql_model: str = "qwen3-coder-next:cloud"

    # Embeddings (always BGE-M3 local — not configurable)
    embedding_dim: int = 1024
    # vector_type: "vector" for local (fp32), "halfvec" for Neon free tier (fp16)
    vector_type: Literal["vector", "halfvec"] = "vector"

    # ── Local model weights (downloaded via huggingface-cli) ──────────────────
    # Paths are relative to the backend/ working directory.
    embedding_model_path: str = "models/bge-m3"
    reranker_model_path: str = "models/bge-reranker-v2-m3"
    # Device for local inference: "cuda" (RTX 4070) or "cpu"
    model_device: Literal["cuda", "cpu"] = "cuda"
    # Load models in FP16 (halves VRAM; cosine quality unchanged)
    model_fp16: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def demo_mode(self) -> bool:
        """No external model keys => run with deterministic stubs + fixtures."""
        if self.model_backend == "local":
            return False
        return not (self.gemini_api_key or self.groq_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
