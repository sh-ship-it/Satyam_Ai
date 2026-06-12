"""Geospatial + network analytics tools (RLS-scoped reads)."""
from __future__ import annotations

import networkx as nx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def hotspots(
    session: AsyncSession, *, crime_type: str | None = None, district: str | None = None,
) -> list[dict]:
    clauses = ["lat IS NOT NULL", "lng IS NOT NULL"]
    params: dict = {}
    if crime_type:
        clauses.append("crime_type = :ct")
        params["ct"] = crime_type
    if district:
        clauses.append("district = :d")
        params["d"] = district
    where = " AND ".join(clauses)
    sql = text(
        f"""
        SELECT round(lat::numeric, 3) AS lat, round(lng::numeric, 3) AS lng,
               count(*) AS weight, crime_type
        FROM cases WHERE {where}
        GROUP BY round(lat::numeric, 3), round(lng::numeric, 3), crime_type
        ORDER BY weight DESC LIMIT 500
        """
    )
    result = await session.execute(sql, params)
    return [dict(r) for r in result.mappings().all()]


async def ego_network(
    session: AsyncSession, *, person_id: str, depth: int = 1
) -> tuple[list[dict], list[dict]]:
    """Build an ego network: person -> shared cases -> co-involved persons."""
    sql = text(
        """
        WITH seed_cases AS (
            SELECT case_id FROM case_persons WHERE person_id = :pid
        )
        SELECT cp.person_id, cp.case_id, p.name, cp.role
        FROM case_persons cp
        JOIN persons p ON p.person_id = cp.person_id
        WHERE cp.case_id IN (SELECT case_id FROM seed_cases)
        """
    )
    result = await session.execute(sql, {"pid": person_id})
    rows = [dict(r) for r in result.mappings().all()]

    g = nx.Graph()
    g.add_node(person_id, kind="person")
    for r in rows:
        g.add_node(r["case_id"], kind="case")
        g.add_node(r["person_id"], kind="person", label=r.get("name"))
        g.add_edge(r["person_id"], r["case_id"], label=r.get("role"))
    nodes = [
        {"id": n, "label": d.get("label", n), "kind": d.get("kind", "person"),
         "degree": g.degree(n)}
        for n, d in g.nodes(data=True)
    ]
    edges = [{"source": u, "target": v, "label": d.get("label")}
             for u, v, d in g.edges(data=True)]
    return nodes, edges
