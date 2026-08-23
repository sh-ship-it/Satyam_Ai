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

    # Vision tactical map (/vision + /api/vision). Off by default and fully
    # additive, so flipping this to false is the kill switch: the route and its
    # whole API surface disappear without touching any other screen.
    enable_vision: bool = False

    # Infra
    database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    # Seed/migration URL — owner/superuser role, used ONLY by migrations + seed script.
    seed_database_url: str = "postgresql+asyncpg://satyam:satyam@localhost:5432/satyam"
    # Local Postgres URL — used when the Settings panel switches to "local" source.
    # Falls back to database_url if not set.
    local_database_url: str = "postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam"
    # Which URL the app starts on: "cloud" -> database_url, "local" -> local_database_url.
    # This exists because db/session.py previously hardcoded "cloud", leaving
    # local_database_url and set_db_source() unreachable. The distinction is not
    # cosmetic: database_url connects as the table OWNER, which bypasses every RLS
    # policy when the tables are not FORCE-enabled, whereas local_database_url
    # connects as the least-privilege satyam_app role and RLS actually applies.
    db_source: Literal["cloud", "local"] = "cloud"
    redis_url: str = "redis://localhost:6379/0"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_alg: str = "HS256"
    jwt_expire_minutes: int = 480

    # CORS (comma-separated)
    cors_origins: str = "http://localhost:3000,https://satyam-50043446981.development.catalystappsail.in"

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
    # Groq retires models regularly and answers an unknown model id with HTTP 404
    # on /chat/completions, which is easy to misread as a bad key or bad URL. The
    # previous default, llama-3.3-70b-versatile, no longer exists. Check with:
    #   curl -H "Authorization: Bearer $GROQ_API_KEY" \
    #        https://api.groq.com/openai/v1/models
    # A 200 there means the key is fine and only the model id is stale. Avoid
    # reasoning models such as qwen3 for routing: they wrap the JSON in <think>
    # prose and fail schema parsing.
    groq_model: str = "openai/gpt-oss-120b"

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
    # pgvector column type, per source. The two databases genuinely differ, so a
    # single global cannot serve both: the Neon free tier caps a project at
    # 512 MB, where fp32 vectors plus an HNSW index do not fit, while local
    # Postgres has no such cap and keeps full fp32 precision.
    #   vector  = fp32, 4 bytes/dim
    #   halfvec = fp16, 2 bytes/dim, roughly half the storage and index size
    # Use db.session.active_vector_type() to resolve the one in force, never
    # these fields directly: the Settings panel can switch source at runtime, and
    # casting a query vector to the wrong type makes the pgvector operator fail.
    vector_type: Literal["vector", "halfvec"] = "vector"
    cloud_vector_type: Literal["vector", "halfvec"] = "halfvec"

    # ── Storage budget (cloud / Neon free plan) ───────────────────────────────
    # The cloud database sits on a hard storage quota. Neon's documentation states
    # the Free plan allows "0.5 GB of storage per project", and that exceeding it
    # makes writes which increase storage FAIL until space is freed. That is an
    # availability limit, not a billing one, so it is treated as a budget here.
    #
    # WHY 536_870_912 (512 MiB) AND NOT 500_000_000:
    #   Neon's public docs say "0.5 GB per project", which is ambiguous: read as
    #   decimal it is 500,000,000 bytes, read as 512 MiB it is 536,870,912 — a
    #   36.9 MB difference, larger than the growth budget it governs. The figure
    #   was CONFIRMED as 512 MB for this project, so the binary reading is used.
    #   The code briefly defaulted to the smaller value while it was unconfirmed,
    #   on the principle that an under-estimated cap can only be conservative.
    #
    # CAVEAT worth knowing before trusting these numbers: Neon meters *its* notion
    # of project storage, which includes instant-restore history, while the guard
    # measures pg_database_size(). The guard can therefore under-report relative
    # to the console, which is one reason the reserve floor is not decoration.
    # If the console ever disagrees with /health/data, believe the console.
    neon_storage_cap_bytes: int = 536_870_912

    # Three controls derived from the cap. Percentages are fixed so that changing
    # the cap alone keeps the shape of the budget:
    #   peak   93.75%  a single migration may exceed steady state briefly, because
    #                  rebuilding an index requires the replacement to exist
    #                  alongside the original before the original is dropped.
    #   steady 87.50%  what the database may occupy at rest.
    #   floor  12.50%  free space that must never be consumed. Sized as an
    #                  availability control: WAL, temp sort files, vacuum working
    #                  space, and runway for audit_log, which grows on every query.
    # Stored and compared in BYTES. Megabytes are for rendered messages only — a
    # check that rounds to MB will eventually disagree with a document that rounds
    # differently, and the disagreement gets resolved in favour of the prettier one.
    storage_peak_ceiling_pct: float = 93.75
    storage_steady_ceiling_pct: float = 87.5
    storage_reserve_floor_pct: float = 12.5

    @property
    def storage_peak_ceiling_bytes(self) -> int:
        return int(self.neon_storage_cap_bytes * self.storage_peak_ceiling_pct / 100)

    @property
    def storage_steady_ceiling_bytes(self) -> int:
        return int(self.neon_storage_cap_bytes * self.storage_steady_ceiling_pct / 100)

    @property
    def storage_reserve_floor_bytes(self) -> int:
        return int(self.neon_storage_cap_bytes * self.storage_reserve_floor_pct / 100)

    # ── Local model weights (downloaded via huggingface-cli) ──────────────────
    # Paths are relative to the backend/ working directory.
    embedding_model_path: str = "models/bge-m3"
    reranker_model_path: str = "models/bge-reranker-v2-m3"
    # Device for local inference: "cuda" (RTX 4070) or "cpu"
    model_device: Literal["cuda", "cpu"] = "cuda"
    # Load models in FP16 (halves VRAM; cosine quality unchanged)
    model_fp16: bool = True

    # ── Remote model service (HF Spaces / RunPod / any hosted endpoint) ───────
    # When set, the backend calls this URL for /embed and /rerank instead of
    # loading the multi-GB sentence-transformers weights locally.
    # Leave blank to use local inference (existing behaviour).
    model_service_url: str = ""
    model_service_api_key: str = ""

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
