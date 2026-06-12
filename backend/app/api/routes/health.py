"""Liveness / readiness probe."""
from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter()


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
