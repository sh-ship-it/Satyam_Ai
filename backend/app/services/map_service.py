"""Map / hotspot service."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.pipeline.tools import analytics
from app.schemas.map import (
    HotspotPoint, HotspotRequest, HotspotResponse,
    StationBreakdownRequest, StationRow, StationBreakdownResponse,
)


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


def _filters(req: StationBreakdownRequest) -> tuple[str, dict]:
    """Shared WHERE fragment for crime_type / district / date range."""
    clauses, params = ["station_name IS NOT NULL"], {}
    if req.crime_type:
        clauses.append("crime_type ILIKE :ct")
        params["ct"] = f"%{req.crime_type}%"
    if req.district:
        clauses.append("district ILIKE :d")
        params["d"] = f"%{req.district}%"
    if getattr(req, "date_from", None):
        clauses.append("report_date >= :df")
        params["df"] = req.date_from
    if getattr(req, "date_to", None):
        clauses.append("report_date <= :dt")
        params["dt"] = req.date_to
    return " AND ".join(clauses), params


async def station_breakdown(
    session: AsyncSession, req: StationBreakdownRequest
) -> StationBreakdownResponse:
    where, params = _filters(req)

    # ── Real grand total (all matching cases, no LIMIT) ─────────────────────
    count_sql = text(f"SELECT count(*) FROM cases WHERE {where}")
    grand_total = int((await session.execute(count_sql, params)).scalar() or 0)

    agg_sql = text(
        f"""
        SELECT station_name                                      AS station,
               count(*)                                          AS firs,
               count(*) FILTER (WHERE charge_sheeted)            AS cleared,
               mode() WITHIN GROUP (ORDER BY crime_type)          AS top_legal_code
        FROM cases
        WHERE {where}
        GROUP BY station_name
        ORDER BY firs DESC
        LIMIT :limit
        """
    )
    rows = [
        dict(r)
        for r in (await session.execute(agg_sql, {**params, "limit": req.limit}))
        .mappings().all()
    ]
    stations = [r["station"] for r in rows]

    # 7-bucket trend sparkline per station (spread across that station's date range)
    trend_map: dict[str, list[int]] = {s: [0] * 7 for s in stations}
    if stations:
        trend_sql = text(
            f"""
            WITH base AS (
                SELECT station_name, report_date,
                       min(report_date) OVER (PARTITION BY station_name) AS mn,
                       max(report_date) OVER (PARTITION BY station_name) AS mx
                FROM cases
                WHERE station_name = ANY(:stations)
                  AND report_date IS NOT NULL
                  AND {where}
            )
            SELECT station_name,
                   LEAST(6, GREATEST(0, floor(
                       CASE WHEN mx = mn THEN 0
                            ELSE 6.0 * (report_date - mn) / NULLIF(mx - mn, 0)
                       END)))::int                AS bucket,
                   count(*)                        AS n
            FROM base
            GROUP BY station_name, bucket
            """
        )
        for r in (
            await session.execute(trend_sql, {**params, "stations": stations})
        ).mappings().all():
            trend_map[r["station_name"]][int(r["bucket"])] = int(r["n"])

    out = [
        StationRow(
            station=r["station"],
            firs=int(r["firs"]),
            cleared=int(r["cleared"] or 0),
            top_legal_code=r["top_legal_code"],
            trend=trend_map.get(r["station"], [0] * 7),
        )
        for r in rows
    ]
    return StationBreakdownResponse(rows=out, total=len(out), grand_total=grand_total)
