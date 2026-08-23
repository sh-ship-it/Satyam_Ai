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
    # Embedding coverage. Without this, a completely non-functional semantic
    # retrieval lane is invisible from outside the database: the narratives row
    # count looks healthy while every embedding is NULL, so vector search
    # matches nothing. Surfacing the count makes that state observable.
    try:
        embedded = int(
            (
                await session.execute(
                    text("SELECT COUNT(*) FROM narratives WHERE embedding IS NOT NULL")
                )
            ).scalar()
            or 0
        )
    except Exception:
        embedded = -1  # column or table missing

    # Storage position against the budget. Without this, the distance to a hard
    # quota is invisible from outside the database, and the quota is not a billing
    # limit: past it, Neon fails writes that increase storage, which includes the
    # audit_log row written on every audited query.
    storage: dict = {}
    try:
        from app.core.storage import read_state

        st = await read_state(session)
        storage = {
            "db_bytes": st.db_bytes,
            "cap_bytes": st.cap_bytes,
            "steady_ceiling_bytes": st.steady_ceiling_bytes,
            "peak_ceiling_bytes": st.peak_ceiling_bytes,
            "reserve_floor_bytes": st.reserve_floor_bytes,
            "free_bytes": st.free_bytes,
            "cost_per_embedded_row_bytes": st.cost_per_embedded_row,
            "within_reserve": st.within_reserve,
            "within_steady_ceiling": st.within_steady_ceiling,
        }
    except Exception as exc:  # noqa: BLE001
        # Keep this endpoint's existing habit of degrading to a sentinel rather
        # than failing the probe: a health check that 500s during a demo is worse
        # than one reporting that a figure is unavailable.
        storage = {"error": str(exc)[:200]}

    storage_ok = bool(storage.get("within_reserve")) and bool(
        storage.get("within_steady_ceiling")
    )

    narratives_total = out.get("narratives", 0)
    return {
        "row_counts": out,
        "storage": storage,
        # False means the database is at or past its budget. Writes may still be
        # succeeding, but there is no longer a safety margin, and no backfill or
        # migration should be run until space is reclaimed.
        "storage_ok": storage_ok,
        "seeded": out.get("cases", 0) > 0,
        "financial_seeded": out.get("financial_transactions", 0) > 0,
        "socio_seeded": out.get("district_socio_economic_indicators", 0) > 0,
        "narratives_embedded": embedded,
        "embedding_coverage_percent": (
            round(embedded / narratives_total * 100, 1)
            if embedded >= 0 and narratives_total > 0
            else None
        ),
        # False means semantic retrieval cannot run; the lexical arm carries the
        # lane on its own until `python -m seed.embed_narratives` has been run.
        "vector_search_available": embedded > 0,
    }
