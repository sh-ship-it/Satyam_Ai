"""Network / link-analysis service."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.pipeline.tools import analytics
from app.schemas.network import EgoRequest, EgoResponse, GraphEdge, GraphNode


async def ego(session: AsyncSession, req: EgoRequest) -> EgoResponse:
    nodes, edges = await analytics.ego_network(
        session, person_id=req.person_id, depth=req.depth
    )
    return EgoResponse(
        root=req.person_id,
        nodes=[GraphNode(**n) for n in nodes],
        edges=[GraphEdge(**e) for e in edges],
    )
