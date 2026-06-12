"""Map / hotspot service."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.pipeline.tools import analytics
from app.schemas.map import HotspotPoint, HotspotRequest, HotspotResponse


async def hotspots(session: AsyncSession, req: HotspotRequest) -> HotspotResponse:
    cells = await analytics.hotspots(
        session, crime_type=req.crime_type, district=req.district
    )
    points = [
        HotspotPoint(
            lat=float(c["lat"]), lng=float(c["lng"]),
            weight=float(c["weight"]), label=c.get("crime_type"),
        )
        for c in cells
    ]
    return HotspotResponse(mode=req.mode, points=points, total=len(points))
