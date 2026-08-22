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
    bbox: tuple[float, float, float, float] | None = None,
    precision: int = 3,
    group_by_crime_type: bool = True,
    limit: int = 500,
) -> list[dict]:
    """Grid-aggregated crime density.

    Every new parameter defaults to the historical behaviour, so the two existing
    callers (services/map_service.hotspots and pipeline/orchestrator) are
    unaffected.

    `group_by_crime_type` matters more than it looks. With it on — the original
    behaviour — one geographic cell yields one row PER crime type, so `weight` is
    a per-(cell, crime-type) count, not a per-cell count. Summing those weights
    to drive a single 3D column double-counts. Measured on the current dataset:
    34,641 distinct cells at 0.001 deg versus 35,755 (cell, crime_type) rows, so
    the inflation is real but small. Vision passes False to get true per-cell
    counts.

    `precision` is the grid resolution in decimal places: 3 = ~110 m, 2 = ~1.1 km.
    Used for level-of-detail — coarse when the whole state is in view, fine when
    zoomed in.

    `limit` was a hard 500. On the current dataset that returned 1.4% of the
    available cells, which silently understated crime density everywhere. It is
    now a parameter; callers that need completeness raise it and check for
    truncation by testing `len(rows) == limit`.
    """
    if precision < 0 or precision > 6:
        raise ValueError("precision must be between 0 and 6")
    if limit < 1:
        raise ValueError("limit must be positive")

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
    if bbox:
        west, south, east, north = bbox
        clauses.append("longitude BETWEEN :west AND :east")
        clauses.append("latitude  BETWEEN :south AND :north")
        params.update(west=west, east=east, south=south, north=north)
    where = " AND ".join(clauses)

    # `precision` and `limit` are validated ints above, never caller strings, so
    # interpolating them cannot introduce injection. Every value-bearing filter
    # stays a bound parameter.
    cell = (
        f"round(latitude::numeric, {precision})  AS lat, "
        f"round(longitude::numeric, {precision}) AS lng"
    )
    group = (
        f"round(latitude::numeric, {precision}), round(longitude::numeric, {precision})"
    )
    if group_by_crime_type:
        select_extra = ", crime_type"
        group_extra = ", crime_type"
    else:
        select_extra = ""
        group_extra = ""

    sql = text(
        f"""
        SELECT {cell},
               count(*) AS weight{select_extra}
        FROM cases WHERE {where}
        GROUP BY {group}{group_extra}
        ORDER BY weight DESC
        LIMIT {limit}
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
        resolved = (
            await session.execute(
                text("SELECT person_id FROM persons WHERE name ILIKE :n ORDER BY person_id LIMIT 1"),
                {"n": str(person_id)},
            )
        ).scalar_one_or_none()
        if resolved is None:
            return [], []
        pid = resolved
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


async def offender_trail(
    session: AsyncSession, *, person_id: int | str
) -> tuple[str, list[dict]]:
    """Ordered crime locations for one offender (role = accused/offender)."""
    try:
        pid = int(person_id)
        label = str(person_id)
    except (TypeError, ValueError):
        row = (await session.execute(
            text("SELECT person_id, name FROM persons WHERE name ILIKE :n ORDER BY person_id LIMIT 1"),
            {"n": str(person_id)},
        )).first()
        if not row:
            return str(person_id), []
        pid, label = row[0], row[1]
    sql = text(
        """
        SELECT c.latitude AS lat, c.longitude AS lng, c.report_date AS date,
               c.fir_number, c.crime_type, c.station_name AS station
        FROM case_persons cp
        JOIN cases c ON c.case_id = cp.case_id
        WHERE cp.person_id = :pid
          AND cp.role ILIKE '%accused%'
          AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY c.report_date ASC
        LIMIT 200
        """
    )
    rows = (await session.execute(sql, {"pid": pid})).mappings().all()
    return str(label), [dict(r) for r in rows]


async def victim_offender_network(
    session: AsyncSession, *, person_id: int | str
) -> tuple[list[dict], list[dict]]:
    """Given a victim/complainant, return the offenders (accused) across their
    cases and the people/cases connected around them."""
    try:
        pid = int(person_id)
    except (TypeError, ValueError):
        resolved = (await session.execute(
            text("SELECT person_id FROM persons WHERE name ILIKE :n ORDER BY person_id LIMIT 1"),
            {"n": str(person_id)},
        )).scalar_one_or_none()
        if resolved is None:
            return [], []
        pid = resolved
    sql = text(
        """
        WITH victim_cases AS (
            SELECT case_id FROM case_persons
            WHERE person_id = :pid AND (role ILIKE '%victim%' OR role ILIKE '%complainant%')
        )
        SELECT cp.person_id, p.name, cp.role, c.case_id, c.fir_number, c.crime_type
        FROM case_persons cp
        JOIN persons p ON p.person_id = cp.person_id
        JOIN cases   c ON c.case_id   = cp.case_id
        WHERE cp.case_id IN (SELECT case_id FROM victim_cases)
        LIMIT 300
        """
    )
    rows = [dict(r) for r in (await session.execute(sql, {"pid": pid})).mappings().all()]
    g = nx.Graph()
    g.add_node(str(pid), kind="person", label="victim", role="seed")
    for r in rows:
        cnode = f"case:{r['case_id']}"
        g.add_node(cnode, kind="case", label=r.get("fir_number", str(r["case_id"])), crime_type=r.get("crime_type"))
        pnode = str(r["person_id"])
        g.add_node(pnode, kind="person", label=r.get("name", pnode), role=(r.get("role") or "").lower())
        g.add_edge(pnode, cnode, label=r.get("role"))
    nodes = [{"id": n, "label": d.get("label", n), "kind": d.get("kind", "person"),
              "crime_type": d.get("crime_type"), "degree": g.degree(n), "role": d.get("role")}
             for n, d in g.nodes(data=True)]
    edges = [{"source": u, "target": v, "label": d.get("label")} for u, v, d in g.edges(data=True)]
    return nodes, edges

