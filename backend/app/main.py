"""FastAPI application factory for Satyam."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import audit, auth, cases, chat, health
from app.api.routes import map as map_routes
from app.api.routes import network, reports, settings as settings_routes
from app.config import get_settings
from app.logging_config import configure_logging, get_logger

log = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    log.info(
        "satyam.startup",
        env=settings.app_env,
        model_backend=settings.model_backend,
        demo_mode=settings.demo_mode,
    )
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
    app.include_router(map_routes.router, prefix="/map", tags=["map"])
    app.include_router(network.router, prefix="/network", tags=["network"])
    app.include_router(reports.router, prefix="/reports", tags=["reports"])
    app.include_router(audit.router, prefix="/audit", tags=["audit"])
    app.include_router(settings_routes.router, prefix="/settings/db-source", tags=["settings"])
    return app


app = create_app()
