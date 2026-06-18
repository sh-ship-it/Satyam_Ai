"""Liveness / readiness probe + model-routing diagnostics."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_scoped_session
from app.config import get_settings
from app.logging_config import get_logger

router = APIRouter()
log = get_logger()


@router.get("/health")
async def health() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "app": s.app_name,
        "env": s.app_env,
        "model_backend": s.model_backend,
        "demo_mode": s.demo_mode,
    }


@router.get("/health/models")
def models() -> dict:
    """Model-routing diagnostics — no auth, dev only.

    Returns the resolved implementation class names and the config values that
    drove the routing decision.  Use this to confirm at a glance that Gemini is
    the brain and Sarvam owns translation + voice output.

    Expected happy-path response:
        brain_llm  : "GeminiLLM"
        sql_llm    : "GeminiLLM"
        translator : "SarvamTranslator"
        tts        : "SarvamTTS"
        stt        : "SarvamSTT"
    """
    from app.models.registry import get_llm, get_sql_llm, get_tts, get_translator, get_stt
    s = get_settings()
    return {
        "config": {
            "model_backend":       s.model_backend,     # expect "api"
            "brain_engine":        s.brain_engine,      # expect "gemini"
            "sql_engine":          s.sql_engine,        # expect "gemini"
            "voice_backend":       s.voice_backend,     # expect "sarvam"
            "gemini_model":        s.gemini_model,      # expect "gemini-2.5-flash"
            "gemini_key_present":  bool(s.gemini_api_key),
            "sarvam_key_present":  bool(s.sarvam_api_key),
            "groq_key_present":    bool(s.groq_api_key),
        },
        "resolved": {
            "brain_llm":   type(get_llm()).__name__,          # expect "GeminiLLM"
            "sql_llm":     type(get_sql_llm()).__name__,      # expect "GeminiLLM"
            "translator":  type(get_translator()).__name__,   # expect "SarvamTranslator"
            "tts":         type(get_tts()).__name__,          # expect "SarvamTTS"
            "stt":         type(get_stt()).__name__,          # expect "SarvamSTT"
        },
    }


@router.get("/health/data")
async def health_data(session: AsyncSession = Depends(get_scoped_session)) -> dict:
    """Row-count probe — confirms the DB is seeded before a demo.
    Returns table row counts and a boolean `seeded` flag (true when cases > 0).
    No auth required; use for quick pre-demo validation.
    """
    out: dict[str, int] = {}
    for tbl in (
        "cases", "persons", "case_persons", "narratives",
        "financial_accounts", "financial_transactions",
        "district_socio_economic_indicators",
    ):
        try:
            out[tbl] = int(
                (await session.execute(text(f'SELECT COUNT(*) FROM "{tbl}"'))).scalar() or 0
            )
        except Exception:
            out[tbl] = -1  # table missing or not migrated
    return {
        "row_counts": out,
        "seeded": out.get("cases", 0) > 0,
        "financial_seeded": out.get("financial_transactions", 0) > 0,
        "socio_seeded": out.get("district_socio_economic_indicators", 0) > 0,
    }
