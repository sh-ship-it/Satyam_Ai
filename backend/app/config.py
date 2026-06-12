"""Application settings, loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "Satyam"
    app_env: Literal["development", "staging", "production"] = "development"

    # Infra
    database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_alg: str = "HS256"
    jwt_expire_minutes: int = 480

    # CORS (comma-separated)
    cors_origins: str = "http://localhost:3000"

    # Model adapter layer
    model_backend: Literal["api", "local"] = "api"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    bhashini_api_key: str = ""
    bhashini_user_id: str = ""
    embedding_dim: int = 1024

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
