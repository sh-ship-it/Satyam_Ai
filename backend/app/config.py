"""Application settings, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "Satyam"
    app_env: Literal["development", "staging", "production"] = "development"

    # Infra
    database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    # Seed/migration URL — owner/superuser role, used ONLY by migrations + seed script.
    seed_database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_alg: str = "HS256"
    jwt_expire_minutes: int = 480

    # CORS (comma-separated)
    cors_origins: str = "http://localhost:3000"

    # ── Model adapter layer ───────────────────────────────────────────────────
    # MODEL_BACKEND: selects the overall compute plane (api | local).
    model_backend: Literal["api", "local"] = "api"

    # BRAIN_ENGINE: which LLM drives chat / slots / routing (api lane).
    #   gemini  → Gemini 2.5 Flash (default, best accuracy)
    #   groq    → Groq low-latency / outage fallback
    brain_engine: Literal["gemini", "groq"] = "gemini"

    # SQL_ENGINE: which LLM generates Text-to-SQL (api lane).
    #   gemini           → Gemini 2.5 Flash (default)
    #   qwen3-coder-next → Ollama Cloud (qwen3-coder-next, 80B MoE / 3B active)
    sql_engine: Literal["gemini", "qwen3-coder-next"] = "gemini"

    # VOICE_BACKEND: which voice provider handles STT / TTS.
    #   sarvam   → Sarvam (Bulbul v3 TTS, Saaras v3 STT) — primary
    #   bhashini → Bhashini (govt, free, fallback)
    voice_backend: Literal["sarvam", "bhashini"] = "sarvam"

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Groq
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Sarvam (primary voice — Bulbul v3 TTS, Saaras v3 STT, Sarvam Translate MT)
    sarvam_api_key: str = ""

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
    # Set VECTOR_TYPE=halfvec in Neon env to match the altered column type.
    vector_type: Literal["vector", "halfvec"] = "vector"

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
