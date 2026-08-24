"""Console dashboard aggregates.

One service, one round trip. Every figure is computed in SQL on the RLS-scoped
session, so a station-scoped officer sees their own numbers and a state-scoped
officer sees the state's, with no filtering in the client.

WHY NOT TEXT-TO-SQL
A dashboard renders on every visit and must be identical each time. Routing it
through the LLM would make the headline numbers non-deterministic and put them
behind an API budget, so these are fixed, reviewed queries.

WHAT IS DELIBERATELY NOT HERE
Hour-of-day and day-of-week distributions were measured on this corpus and carry
no signal: only 12 of the 24 hours hold any incident, and their counts sit within
a few percent of each other, as do the seven weekdays. Charting them would invite
an officer to read a peak that is sampling noise. They are reported as coverage
numbers instead.

The same test removed the clearance-rate *trend*: 20.3, 20.3, 20.5, 20.6, 19.9
across 2021-2025 is a flat line. What does vary is clearance *between stations* —
11.0% to 27.9% against a 19.5% median — so that is what gets the panel.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.logging_config import get_logger
from app.schemas.dashboard import (
    DashboardKpis,
    DashboardSummary,
    DistrictRow,
    NamedCount,
    StationClearance,
    StationRow,
    YearRow,
)

log = get_logger()

TOP_DISTRICTS = 12
TOP_CRIMES = 10
TOP_STATUSES = 12
TAIL_SIZE = 5
STATION_TABLE_LIMIT = 80

# A station needs a minimum caseload before its clearance rate means anything.
# Without this the tails of the distribution fill up with stations that closed
# one case out of three.
MIN_FIRS_FOR_CLEARANCE = 100

# Below this spread the aggregate clearance rate is reported as stable rather
# than as a trend, because drawing it as a line implies movement it does not have.
FLAT_CLEARANCE_POINTS = 2.0


def _where(
    year: int | None, district: str | None, crime_type: str | None
) -> tuple[str, dict]:
    """Shared filter. Parameterised — never interpolated.

    The year filter uses `report_date`, not `fir_year`. The two disagree for 138
    rows, and the station-breakdown endpoint on the same screen filters by a
    `report_date` range, so using `fir_year` here would put a headline KPI and the
    table beneath it out of step for the same selected year.
    """
    clauses: list[str] = []
    params: dict = {}
    if year:
        clauses.append("report_date >= :y_from AND report_date <= :y_to")
        params["y_from"] = dt.date(year, 1, 1)
        params["y_to"] = dt.date(year, 12, 31)
    if district:
        clauses.append("district ILIKE :district")
        params["district"] = f"%{district}%"
    if crime_type:
        clauses.append("crime_type ILIKE :crime_type")
        params["crime_type"] = f"%{crime_type}%"
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _and(where: str) -> str:
    """Append a further condition to a possibly-empty WHERE clause."""
    return " AND" if where else " WHERE"


async def _rows(session: AsyncSession, sql: str, params: dict) -> list[dict]:
    result = await session.execute(text(sql), params)
    return [dict(r) for r in result.mappings().all()]


def _pct(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 1) if whole else 0.0


def _yoy(now: int, prev: int | None) -> float | None:
    if prev is None or prev == 0:
        return None
    return round(100.0 * (now - prev) / prev, 1)


async def build_summary(
    session: AsyncSession,
    *,
    year: int | None = None,
    district: str | None = None,
    crime_type: str | None = None,
) -> DashboardSummary:
    where, params = _where(year, district, crime_type)

    # ── KPIs ──────────────────────────────────────────────────────────────────
    # per_day divides by the real span between the first and last report_date
    # rather than by 30. A "per day" figure over an arbitrary month length is not
    # a rate; on the unfiltered corpus the two differ by 60x.
    kpi = (
        await _rows(
            session,
            f"""
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE convicted)     AS cleared,
                   count(*) FILTER (WHERE NOT convicted) AS pending,
                   count(DISTINCT district)     AS districts,
                   count(DISTINCT station_name) AS stations,
                   min(report_date) AS first_day,
                   max(report_date) AS last_day,
                   GREATEST(1, (max(report_date) - min(report_date))) AS span_days
            FROM cases{where}
            """,
            params,
        )
    )[0]
    total = int(kpi.get("total") or 0)
    cleared = int(kpi.get("cleared") or 0)
    span = int(kpi.get("span_days") or 1)
    kpis = DashboardKpis(
        total_firs=total,
        cleared=cleared,
        pending=int(kpi.get("pending") or 0),
        clearance_rate_percent=_pct(cleared, total),
        per_day=round(total / span, 1) if total else 0.0,
        first_day=str(kpi["first_day"]) if kpi.get("first_day") else None,
        last_day=str(kpi["last_day"]) if kpi.get("last_day") else None,
        span_days=span,
        districts_covered=int(kpi.get("districts") or 0),
        stations_covered=int(kpi.get("stations") or 0),
    )

    # ── Volume by year ────────────────────────────────────────────────────────
    # Ignores the year filter on purpose: the point of this panel is to place the
    # selected year in context, which requires the other years to be present.
    year_where, year_params = _where(None, district, crime_type)
    year_rows = await _rows(
        session,
        f"""
        SELECT extract(year from report_date)::int AS y,
               count(*) AS n,
               count(*) FILTER (WHERE convicted) AS cleared
        FROM cases
        {year_where}{_and(year_where)} report_date IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """,
        year_params,
    )
    yearly: list[YearRow] = []
    for i, r in enumerate(year_rows):
        n = int(r["n"])
        c = int(r["cleared"])
        prev = int(year_rows[i - 1]["n"]) if i else None
        yearly.append(
            YearRow(
                year=int(r["y"]),
                count=n,
                cleared=c,
                clearance_percent=_pct(c, n),
                yoy_percent=_yoy(n, prev),
            )
        )

    # The comparison period for the mix table is the year before the selected one.
    #
    # YoY IS OFFERED ONLY WHEN A YEAR IS SELECTED. Without one, the headline count
    # is an all-years total, and pairing that with a single prior year produced
    # garbage: 4,189 motor-vehicle cases across five years against 861 in 2023
    # rendered as "+386.5%". Either both sides of a ratio cover the same span or
    # there is no ratio.
    focus_year = year
    compare_year = focus_year - 1 if focus_year else None
    have_compare = compare_year is not None and any(y.year == compare_year for y in yearly)

    async def mix_with_yoy(column: str, limit: int) -> list[NamedCount]:
        """Ranked breakdown of `column`, with a prior-year count where available."""
        if have_compare:
            sql = f"""
                SELECT {column} AS k,
                       count(*) FILTER (WHERE extract(year from report_date) = :fy) AS now_n,
                       count(*) FILTER (WHERE extract(year from report_date) = :cy) AS prev_n,
                       count(*) AS all_n
                FROM cases
                {year_where}{_and(year_where)} {column} IS NOT NULL
                GROUP BY 1 ORDER BY {'now_n' if year else 'all_n'} DESC LIMIT {limit}
            """
            p = {**year_params, "fy": focus_year, "cy": compare_year}
        else:
            sql = f"""
                SELECT {column} AS k, count(*) AS all_n,
                       NULL::bigint AS now_n, NULL::bigint AS prev_n
                FROM cases
                {where}{_and(where)} {column} IS NOT NULL
                GROUP BY 1 ORDER BY all_n DESC LIMIT {limit}
            """
            p = params
        out: list[NamedCount] = []
        for r in await _rows(session, sql, p):
            # `have_compare` is only true when a year is selected, so `now_n` and
            # `prev_n` always cover one year each and the ratio is comparable.
            n = int(r["now_n"]) if have_compare and r["now_n"] is not None else int(r["all_n"])
            prev = int(r["prev_n"]) if have_compare and r["prev_n"] is not None else None
            out.append(
                NamedCount(
                    name=str(r["k"]),
                    count=n,
                    percent=_pct(n, total),
                    prev_count=prev,
                    yoy_percent=_yoy(n, prev),
                )
            )
        return [x for x in out if x.count > 0]

    crime_mix = await mix_with_yoy("crime_type", TOP_CRIMES)

    status_rows = await _rows(
        session,
        f"""
        SELECT status AS k, count(*) AS n FROM cases
        {where}{_and(where)} status IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT {TOP_STATUSES}
        """,
        params,
    )
    status_mix = [
        NamedCount(name=str(r["k"]), count=int(r["n"]), percent=_pct(int(r["n"]), total))
        for r in status_rows
    ]

    # ── District league table ─────────────────────────────────────────────────
    district_rows = await _rows(
        session,
        f"""
        SELECT district AS k, count(*) AS n,
               count(*) FILTER (WHERE convicted) AS cleared
        FROM cases
        {where}{_and(where)} district IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT {TOP_DISTRICTS}
        """,
        params,
    )
    districts = [
        DistrictRow(
            name=str(r["k"]),
            count=int(r["n"]),
            percent=_pct(int(r["n"]), total),
            cleared=int(r["cleared"]),
            clearance_percent=_pct(int(r["cleared"]), int(r["n"])),
        )
        for r in district_rows
    ]

    # ── Station clearance distribution ────────────────────────────────────────
    stat = await _rows(
        session,
        f"""
        WITH s AS (
            SELECT station_name,
                   count(*) AS n,
                   100.0 * count(*) FILTER (WHERE convicted) / count(*) AS pct
            FROM cases
            {where}{_and(where)} station_name IS NOT NULL
            GROUP BY station_name
            HAVING count(*) >= {MIN_FIRS_FOR_CLEARANCE}
        )
        SELECT count(*) AS stations,
               round(min(pct), 1) AS worst,
               round(percentile_cont(0.25) WITHIN GROUP (ORDER BY pct)::numeric, 1) AS p25,
               round(percentile_cont(0.50) WITHIN GROUP (ORDER BY pct)::numeric, 1) AS median,
               round(percentile_cont(0.75) WITHIN GROUP (ORDER BY pct)::numeric, 1) AS p75,
               round(max(pct), 1) AS best
        FROM s
        """,
        params,
    )
    s0 = stat[0] if stat else {}
    median = float(s0.get("median") or 0)

    async def tail(order: str) -> list[DistrictRow]:
        rows = await _rows(
            session,
            f"""
            SELECT station_name AS k, count(*) AS n,
                   count(*) FILTER (WHERE convicted) AS cleared,
                   round(100.0 * count(*) FILTER (WHERE convicted) / count(*), 1) AS pct
            FROM cases
            {where}{_and(where)} station_name IS NOT NULL
            GROUP BY station_name
            HAVING count(*) >= {MIN_FIRS_FOR_CLEARANCE}
            ORDER BY pct {order}, n DESC
            LIMIT {TAIL_SIZE}
            """,
            params,
        )
        return [
            DistrictRow(
                name=str(r["k"]),
                count=int(r["n"]),
                percent=_pct(int(r["n"]), total),
                cleared=int(r["cleared"]),
                clearance_percent=float(r["pct"]),
                vs_median_points=round(float(r["pct"]) - median, 1),
            )
            for r in rows
        ]

    # ── Station performance table ─────────────────────────────────────────────
    # Served from here rather than from /map/station-breakdown so that "cleared"
    # means the same thing everywhere on this screen. That endpoint counts
    # `charge_sheeted`, which is a different measure, and mixing the two made the
    # table's clearance rate incomparable with the median it was being judged
    # against.
    station_rows = await _rows(
        session,
        f"""
        SELECT station_name AS station,
               mode() WITHIN GROUP (ORDER BY district)   AS district,
               count(*)                                  AS firs,
               count(*) FILTER (WHERE convicted)          AS cleared,
               mode() WITHIN GROUP (ORDER BY crime_type)  AS top_crime
        FROM cases
        {where}{_and(where)} station_name IS NOT NULL
        GROUP BY station_name
        ORDER BY firs DESC
        LIMIT {STATION_TABLE_LIMIT}
        """,
        params,
    )
    stations = [
        StationRow(
            station=str(r["station"]),
            district=str(r["district"]) if r.get("district") else None,
            firs=int(r["firs"]),
            cleared=int(r["cleared"]),
            pending=int(r["firs"]) - int(r["cleared"]),
            clearance_percent=_pct(int(r["cleared"]), int(r["firs"])),
            vs_median_points=round(_pct(int(r["cleared"]), int(r["firs"])) - median, 1)
            if median
            else 0.0,
            top_crime=str(r["top_crime"]) if r.get("top_crime") else None,
        )
        for r in station_rows
    ]

    station_clearance = StationClearance(
        min_firs=MIN_FIRS_FOR_CLEARANCE,
        stations=int(s0.get("stations") or 0),
        worst=float(s0.get("worst") or 0),
        p25=float(s0.get("p25") or 0),
        median=median,
        p75=float(s0.get("p75") or 0),
        best=float(s0.get("best") or 0),
        bottom=await tail("ASC"),
        top=await tail("DESC"),
    )
    for d in districts:
        d.vs_median_points = round(d.clearance_percent - median, 1) if median else 0.0

    # ── Coverage facts, in place of the charts that had no signal ─────────────
    hour_rows = await _rows(
        session,
        f"""
        SELECT count(DISTINCT substring(incident_time from 1 for 2)) AS hrs
        FROM cases
        {where}{_and(where)} incident_time ~ '^[0-2][0-9]'
        """,
        params,
    )
    hours_populated = int(hour_rows[0]["hrs"] or 0) if hour_rows else 0

    dow_rows = await _rows(
        session,
        f"""
        SELECT count(*) AS n FROM cases
        {where}{_and(where)} incident_date IS NOT NULL
        GROUP BY extract(dow from incident_date)
        """,
        params,
    )
    dow_counts = [int(r["n"]) for r in dow_rows if r["n"]]
    dow_spread = (
        round(100.0 * (max(dow_counts) - min(dow_counts)) / max(dow_counts), 1)
        if dow_counts
        else 0.0
    )

    clearance_note = None
    if len(yearly) >= 2:
        rates = [y.clearance_percent for y in yearly]
        spread = round(max(rates) - min(rates), 1)
        if spread <= FLAT_CLEARANCE_POINTS:
            clearance_note = (
                f"Clearance has held between {min(rates)}% and {max(rates)}% every year "
                f"({spread} points of movement across {len(yearly)} years). The variation "
                f"is between stations, not over time."
            )

    scope_bits = [district or "Karnataka"]
    if crime_type:
        scope_bits.append(crime_type)
    scope_bits.append(str(year) if year else "all years")

    log.info(
        "dashboard.summary",
        total=total,
        year=year,
        district=district,
        stations_ranked=station_clearance.stations,
    )

    return DashboardSummary(
        scope_label=" · ".join(scope_bits),
        year=year,
        compare_year=compare_year if have_compare else None,
        district=district,
        crime_type=crime_type,
        kpis=kpis,
        yearly=yearly,
        crime_mix=crime_mix,
        status_mix=status_mix,
        districts=districts,
        station_clearance=station_clearance,
        stations=stations,
        hours_populated=hours_populated,
        dow_spread_percent=dow_spread,
        clearance_stable_note=clearance_note,
        generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    )
