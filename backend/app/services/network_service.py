"""Network / link-analysis service."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.pipeline.tools import analytics
from app.schemas.network import EgoRequest, EgoResponse, GraphEdge, GraphNode


async def ego(session: AsyncSession, req: EgoRequest) -> EgoResponse:
    # person_id is normalised by the validator (entity_name → person_id)
    nodes_raw, edges_raw = await analytics.ego_network(
        session, person_id=req.person_id, depth=req.depth
    )

    # Build case_ids per person node so the frontend can open the CaseDrawer
    person_case_ids: dict[str, list[int]] = {}
    for e in edges_raw:
        # Edge is person_id ↔ "case:<int>"
        src, tgt = str(e["source"]), str(e["target"])
        for person, case in [(src, tgt), (tgt, src)]:
            if case.startswith("case:"):
                try:
                    cid = int(case[5:])
                    person_case_ids.setdefault(person, []).append(cid)
                except ValueError:
                    pass

    seed_id = str(req.person_id)
    nodes = []
    for n in nodes_raw:
        nid = str(n["id"])
        kind = n.get("kind", "person")
        nodes.append(GraphNode(
            id=nid,
            label=n.get("label", nid),
            kind=kind,
            entity_type=kind,
            degree=n.get("degree", 0),
            case_ids=person_case_ids.get(nid, []),
        ))

    return EgoResponse(
        root=seed_id,
        seed_id=seed_id,
        nodes=nodes,
        edges=[GraphEdge(**e) for e in edges_raw],
    )
