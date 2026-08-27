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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import audit, auth, cases, chat, health
from app.api.routes import map as map_routes
from app.api.routes import network, reports, settings as settings_routes, voice
from app.api.routes import intelligence
from app.api.routes import ops as ops_routes
from app.api.routes import vision as vision_routes
from app.api.routes import financial  # PS7 money-trail
from app.api.routes import dossier as dossier_routes
from app.api.routes import board as board_routes
from app.api.routes import admin as admin_routes
from app.api.routes import security as security_routes
from app.api.routes import news as news_routes
from app.api.routes import documents as document_routes
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
    cors_kwargs = dict(
        allow_origins=settings.cors_origin_list,
        # Quick-tunnel demo links (cloudflared) get a random subdomain per run, so
        # a fixed allow_origins entry can't be added ahead of time. Regex-matching
        # the whole *.trycloudflare.com family covers frontend AND backend tunnel
        # URLs without needing a restart once the link is known. Remove this once
        # the demo is over.
        allow_origin_regex=r"https://.*\.trycloudflare\.com",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        # No expose_headers: every remaining endpoint answers JSON, and JS can read
        # a JSON body without any header being exposed. This carried
        # X-Document-Sha256 and Content-Disposition for the /documents/encrypt
        # binary download, which has been removed.
        #
        # Worth remembering if a binary download is added back: configure the
        # header list HERE, never on the Response. CORSMiddleware emits
        # Access-Control-Expose-Headers itself, so setting it again in a route
        # produced TWO copies, and a browser rejects a duplicated CORS header
        # outright — the endpoint answered 200 and the fetch still failed with
        # "Failed to fetch", which reads like an outage rather than a header clash.
    )
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    # An unhandled exception unwinds PAST CORSMiddleware to Starlette's outermost
    # error handler, so the 500 reaches the browser with no
    # Access-Control-Allow-Origin. The browser then refuses to expose the response
    # at all and fetch() rejects with "Failed to fetch" — which reads like the
    # server is unreachable. That is exactly how the /documents/encrypt latin-1
    # header bug hid for so long: the server logged a clean 500 and the UI showed a
    # network error. This handler puts the CORS headers back so any future 500
    # surfaces as a 500.
    #
    # The origin check is delegated to a CORSMiddleware instance built from the
    # same kwargs, rather than re-implemented, so the two can never disagree.
    _cors = CORSMiddleware(app=app, **cors_kwargs)

    @app.exception_handler(Exception)
    async def _cors_aware_500(request: Request, exc: Exception) -> JSONResponse:
        log.exception("satyam.unhandled_error", path=request.url.path)
        # Deliberately generic: the detail is in the log, not on the wire.
        resp = JSONResponse({"detail": "internal error"}, status_code=500)
        origin = request.headers.get("origin")
        if origin and _cors.is_allowed_origin(origin=origin):
            resp.headers.update(_cors.simple_headers)
            # allow_explicit_origin sets Access-Control-Allow-Origin AND appends
            # Vary: Origin — Starlette's own helper, so a credentialed response can
            # never end up with a wildcard by accident.
            _cors.allow_explicit_origin(resp.headers, origin)
        return resp

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
    app.include_router(admin_routes.router, prefix="/admin", tags=["admin"])
    app.include_router(security_routes.router, prefix="/security", tags=["security"])
    app.include_router(news_routes.router, prefix="/api/news", tags=["news"])
    app.include_router(document_routes.router, prefix="/api/documents", tags=["documents"])
    if settings.enable_response_ops:
        app.include_router(ops_routes.router, prefix="/api/ops", tags=["response-ops"])
    if settings.enable_vision:
        app.include_router(vision_routes.router, prefix="/api/vision", tags=["vision"])
    return app


app = create_app()
