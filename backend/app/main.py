"""FastAPI application factory for Satyam."""
from __future__ import annotations

# ── Windows/Python-3.10 import-chain fix ─────────────────────────────────────
# sentence_transformers → sklearn → pandas._libs.tslibs creates a deeply nested
# Cython import chain that exceeds the default recursion limit (1000) on Windows,
# producing a native stack overflow with no Python traceback.
# Pre-loading pandas and sklearn here (before any ML import) fills sys.modules
# so that later imports are instant cache-hits.  Must be the very first imports.
import sys as _sys
_sys.setrecursionlimit(5000)
import pandas as _pd   # noqa: F401  – pre-load for cache
import sklearn as _sk  # noqa: F401  – pre-load for cache
# ─────────────────────────────────────────────────────────────────────────────

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import audit, auth, cases, chat, health
from app.api.routes import map as map_routes
from app.api.routes import network, reports, settings as settings_routes, voice
from app.api.routes import intelligence
from app.api.routes import ops as ops_routes
from app.api.routes import financial  # PS7 money-trail
from app.api.routes import dossier as dossier_routes
from app.api.routes import board as board_routes
from app.config import get_settings
from app.logging_config import configure_logging, get_logger

log = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    # ── Fail fast on an insecure JWT secret in production ────────────────────
    # The default secret is public; signing tokens with it lets anyone forge
    # any officer/rank and bypass all RBAC/RLS. Refuse to boot in production.
    if settings.app_env == "production" and settings.jwt_secret == "change-me-in-production":
        raise RuntimeError(
            "JWT_SECRET is still the default value in production. "
            "Set a strong, unique JWT_SECRET before starting Satyam."
        )
    log.info(
        "satyam.startup",
        env=settings.app_env,
        model_backend=settings.model_backend,
        demo_mode=settings.demo_mode,
    )
    # ── Warm up local models so the first user request isn't slow ────────────
    # Models are ~2.3 GB; loading them here avoids a cold-start penalty on the
    # first chat/embed request.  Runs in the threadpool to stay non-blocking.
    try:
        from app.models.registry import get_embedder, get_reranker
        import asyncio as _asyncio
        embedder = get_embedder()
        reranker = get_reranker()
        await _asyncio.gather(
            embedder.embed(["warmup"]),
            reranker.rerank("warmup", ["x"]),
        )
        log.info("satyam.models_warmed_up", device=settings.model_device)
    except Exception as exc:  # noqa: BLE001
        # Non-fatal: demo/api mode has no local weights — log and continue.
        log.info("satyam.model_warmup_skipped", reason=str(exc))

    # ── Log resolved routing so it's visible at every startup ────────────────
    try:
        from app.models.registry import get_llm, get_tts, get_translator
        log.info(
            "satyam.routing",
            brain=type(get_llm()).__name__,
            tts=type(get_tts()).__name__,
            translator=type(get_translator()).__name__,
        )
    except Exception as exc:  # noqa: BLE001
        log.info("satyam.routing_check_skipped", reason=str(exc))
    yield
    log.info("satyam.shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Satyam API",
        version="0.1.0",
        description="Conversational AI for the KSP crime database (grounded, RBAC, audited).",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, tags=["health"])
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(chat.router, prefix="/chat", tags=["chat"])
    app.include_router(cases.router, prefix="/cases", tags=["cases"])
    app.include_router(cases.router, prefix="/api/cases", tags=["cases"])
    app.include_router(map_routes.router, prefix="/map", tags=["map"])
    app.include_router(network.router, prefix="/network", tags=["network"])
    app.include_router(financial.router, prefix="/financial", tags=["financial"])
    app.include_router(reports.router, prefix="/reports", tags=["reports"])
    app.include_router(audit.router, prefix="/audit", tags=["audit"])
    app.include_router(settings_routes.router, prefix="/settings/db-source", tags=["settings"])
    app.include_router(voice.router, prefix="/voice", tags=["voice"])
    app.include_router(intelligence.router, prefix="/api", tags=["intelligence"])
    app.include_router(dossier_routes.router, prefix="/api/dossier", tags=["dossier"])
    app.include_router(board_routes.router, prefix="/api/board", tags=["board"])
    if settings.enable_response_ops:
        app.include_router(ops_routes.router, prefix="/api/ops", tags=["response-ops"])
    return app


app = create_app()
