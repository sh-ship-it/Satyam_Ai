"""News Feed: which Karnataka news channels are live right now.

Read-only and database-free. Deliberately writes no audit row: audit exists to
record access to case data, and every row costs storage in a project that is near
its cap. Nothing here touches the crime database, so there is nothing to audit.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.deps import get_principal
from app.core.rbac import Principal
from app.services import news_service

router = APIRouter()


class NewsChannel(BaseModel):
    slug: str
    name: str
    broadcaster: str
    channel_id: str
    # None when the channel is between broadcasts. The screen shows an off-air
    # card in that case rather than an embed that would render as an error.
    video_id: str | None = None
    live: bool = False


class NewsChannelsResponse(BaseModel):
    channels: list[NewsChannel] = Field(default_factory=list)
    live_count: int = 0
    resolved_at: int = 0
    ttl_seconds: int = 0
    cached: bool = False


@router.get("/channels", response_model=NewsChannelsResponse, tags=["news"])
async def news_channels(
    refresh: bool = Query(False, description="Bypass the cache and re-resolve now."),
    # Authenticated like every other /api route, but no clearance gate: this is
    # public broadcast television, not case data.
    principal: Principal = Depends(get_principal),
) -> NewsChannelsResponse:
    data = await news_service.get_channels(force=refresh)
    return NewsChannelsResponse(**data)
