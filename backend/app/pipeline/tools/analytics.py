"""Geospatial + network analytics tools (RLS-scoped reads) — new schema."""
from __future__ import annotations

import networkx as nx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def hotspots(
    session: AsyncSession, *,
    crime_type: str | None = None,
    district: str | None = None,
    range_name: str | None = None,
) -> list[dict]:
    clauses = ["latitude IS NOT NULL", "longitude IS NOT NULL"]
    params: dict = {}
    if crime_type:
        clauses.append("crime_type ILIKE :ct")
        params["ct"] = f"%{crime_type}%"
    if district:
        clauses.append("district ILIKE :d")
        params["d"] = f"%{district}%"
    if range_name:
        clauses.append('"range" ILIKE :r')
        params["r"] = f"%{range_name}%"
    where = " AND ".join(clauses)
    sql = text(
        f"""
        SELECT round(latitude::numeric, 3)  AS lat,
               round(longitude::numeric, 3) AS lng,
               count(*)                      AS weight,
               crime_type
        FROM cases WHERE {where}
        GROUP BY round(latitude::numeric, 3), round(longitude::numeric, 3), crime_type
        ORDER BY weight DESC
        LIMIT 500
        """
    )
    result = await session.execute(sql, params)
    return [dict(r) for r in result.mappings().all()]


async def ego_network(
    session: AsyncSession, *, person_id: int | str, depth: int = 1
) -> tuple[list[dict], list[dict]]:
    """Ego network: person → shared cases → co-involved persons."""
    sql = text(
        """
        WITH seed_cases AS (
            SELECT case_id FROM case_persons WHERE person_id = :pid
        )
        SELECT cp.person_id, cp.case_id, p.name, cp.role,
               c.crime_type, c.fir_number
        FROM case_persons cp
        JOIN persons p ON p.person_id = cp.person_id
        JOIN cases   c ON c.case_id   = cp.case_id
        WHERE cp.case_id IN (SELECT case_id FROM seed_cases)
        LIMIT 200
        """
    )
    try:
        pid = int(person_id)
    except (TypeError, ValueError):
        pid = person_id  # type: ignore[assignment]
    result = await session.execute(sql, {"pid": pid})
    rows = [dict(r) for r in result.mappings().all()]

    g = nx.Graph()
    g.add_node(str(person_id), kind="person")
    for r in rows:
        case_node = f"case:{r['case_id']}"
        g.add_node(case_node, kind="case", label=r.get("fir_number", str(r["case_id"])),
                   crime_type=r.get("crime_type"))
        person_node = str(r["person_id"])
        g.add_node(person_node, kind="person", label=r.get("name", person_node))
        g.add_edge(person_node, case_node, label=r.get("role"))

    nodes = [
        {
            "id":         n,
            "label":      d.get("label", n),
            "kind":       d.get("kind", "person"),
            "crime_type": d.get("crime_type"),
            "degree":     g.degree(n),
        }
        for n, d in g.nodes(data=True)
    ]
    edges = [
        {"source": u, "target": v, "label": d.get("label")}
        for u, v, d in g.edges(data=True)
    ]
    return nodes, edges
