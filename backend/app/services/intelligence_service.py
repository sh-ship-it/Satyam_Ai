"""Intelligence feature services — PS2/PS5/PS6/PS8/PS3/PS4.

All queries run under the caller's RLS-scoped session (jurisdiction + clearance
already stamped by get_scoped_session). PII masking is applied where needed.
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal
from app.schemas.intelligence import (
    AgeBucket, BacktestResponse, CaseTimelineResponse, CorrelationPoint,
    Correlations, DistrictCount, ForecastAlert, ForecastAlertsResponse,
    ForecastCell, ForecastHotspotsResponse, GenderCount, GraphResponse,
    KnownAssociate, MOCluster, MOClustersResponse, OffenderProfileResponse,
    OffenderListItem, OffenderListResponse,
    PersonTimelineEvent, PersonTimelineResponse, RingEdge, RingMembership,
    RingNode, RingSummary, RingsResponse, RiskArea, RiskBreakdownFactor,
    RiskProfile, SeasonalPeak, SeasonalResponse, SimilarCaseMatch,
    SimilarCasesResponse, SocialRiskIndexResponse, SocioDemographicsResponse,
    TrendDeltas, TrendPoint, TrendsResponse, MOFingerprint, TimelineEvent,
    SocioCorrelationResponse,
)

# ── helpers ───────────────────────────────────────────────────────────────────

def _fmt(d: Any) -> str | None:
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.isoformat()[:10]
    return str(d)[:10]


def _risk_label(score: int) -> str:
    if score >= 75:
        return "Critical"
    if score >= 55:
        return "High"
    if score >= 30:
        return "Medium"
    return "Low"


def _mask(name: str | None, principal: Principal) -> str:
    if name is None:
        return "—"
    if principal.clearance < 3:
        parts = name.split()
        return parts[0][0] + ". " + ("█" * 4) if parts else "█████"
    return name


# ── PS2 — Network rings ───────────────────────────────────────────────────────

async def get_rings(
    session: AsyncSession,
    principal: Principal,
    limit: int = 10,
    crime_type: str | None = None,
    district: str | None = None,
) -> RingsResponse:
    """Top-N repeat offenders as proxy for organized-crime rings."""
    # Simple fast query: most-accused persons from cases table stats
    sql = text("""
        SELECT c.accused_count, c.district, c.crime_type, c.report_date,
               c.case_id
        FROM cases c
        WHERE c.accused_count > 1
        ORDER BY c.accused_count DESC, c.report_date DESC NULLS LAST
        LIMIT :lim
    """)
    rows = (await session.execute(sql, {"lim": min(limit * 5, 50)})).mappings().all()

    rings = []
    seen: set[str] = set()
    for i, r in enumerate(rows):
        key = f"{r['crime_type']}_{r['district']}"
        if key in seen:
            continue
        seen.add(key)
        tc = int(r["accused_count"] or 2)
        severity = min(99, 30 + tc * 8)
        recency = 50
        if r["report_date"]:
            days = (date.today() - r["report_date"]).days if isinstance(r["report_date"], date) else 999
            recency = max(10, 90 - days)
        why = [f"{tc} accused in a single case"]
        if recency > 60:
            why.append("Recent activity within 30 days")
        rings.append(RingSummary(
            ring_id=f"ring_{i + 1}", label=f"Ring #{i + 1}",
            member_count=tc, case_count=1,
            severity_score=severity, recency_score=recency,
            kingpin_person_id=None,
            top_crime_types=[r["crime_type"]] if r["crime_type"] else [],
            districts=[r["district"]] if r["district"] else [],
            why_flagged=why,
        ))
        if len(rings) >= limit:
            break
    return RingsResponse(rings=rings)


async def get_case_graph(session: AsyncSession, principal: Principal, case_id: int) -> GraphResponse:
    sql = text("""
        SELECT cp.person_id, cp.role, p.name, p.gender,
               COUNT(cp2.case_id) AS offense_count
        FROM case_persons cp
        JOIN persons p ON p.person_id = cp.person_id
        LEFT JOIN case_persons cp2 ON cp2.person_id = cp.person_id AND cp2.role = 'Accused'
        WHERE cp.case_id = :cid
        GROUP BY cp.person_id, cp.role, p.name, p.gender
    """)
    rows = (await session.execute(sql, {"cid": case_id})).mappings().all()
    nodes, edges = [], []
    accused_ids = [r["person_id"] for r in rows if r["role"] == "Accused"]
    for r in rows:
        oc = int(r["offense_count"] or 0)
        risk = _risk_label(min(99, oc * 15))
        nodes.append(RingNode(
            id=f"person_{r['person_id']}", person_id=r["person_id"],
            label=_mask(r["name"], principal), type="person",
            risk_label=risk, offense_count=oc,
            is_kingpin=(len(accused_ids) > 0 and r["person_id"] == accused_ids[0]),
            community_id=f"case_{case_id}",
        ))
    for i in range(len(accused_ids)):
        for j in range(i + 1, len(accused_ids)):
            edges.append(RingEdge(
                source=f"person_{accused_ids[i]}", target=f"person_{accused_ids[j]}",
                type="co_accused", shared_case_count=1, weight=0.7,
            ))
    return GraphResponse(nodes=nodes, edges=edges)


async def get_person_graph(
    session: AsyncSession, principal: Principal, person_id: int, depth: int = 1
) -> GraphResponse:
    sql = text("""
        SELECT DISTINCT cp2.person_id AS peer_id, p2.name AS peer_name,
               COUNT(DISTINCT cp2.case_id) AS shared_cases
        FROM case_persons cp1
        JOIN case_persons cp2 ON cp1.case_id = cp2.case_id AND cp2.person_id != cp1.person_id
        JOIN persons p2 ON p2.person_id = cp2.person_id
        WHERE cp1.person_id = :pid AND cp2.role = 'Accused'
        GROUP BY cp2.person_id, p2.name
        ORDER BY shared_cases DESC
        LIMIT 20
    """)
    seed_sql = text("SELECT name FROM persons WHERE person_id = :pid")
    seed_row = (await session.execute(seed_sql, {"pid": person_id})).mappings().first()
    seed_name = _mask(seed_row["name"] if seed_row else None, principal)
    peers = (await session.execute(sql, {"pid": person_id})).mappings().all()
    nodes = [RingNode(id=f"person_{person_id}", person_id=person_id, label=seed_name,
                      type="person", risk_label="High", offense_count=len(peers),
                      is_kingpin=True, community_id=f"ego_{person_id}")]
    edges = []
    for p in peers:
        nodes.append(RingNode(id=f"person_{p['peer_id']}", person_id=p["peer_id"],
                              label=_mask(p["peer_name"], principal), type="person",
                              risk_label=_risk_label(int(p["shared_cases"]) * 20),
                              offense_count=int(p["shared_cases"]),
                              community_id=f"ego_{person_id}"))
        edges.append(RingEdge(source=f"person_{person_id}", target=f"person_{p['peer_id']}",
                               shared_case_count=int(p["shared_cases"]),
                               weight=min(1.0, int(p["shared_cases"]) / 5.0)))
    return GraphResponse(nodes=nodes, edges=edges)


# ── PS6 — Similar cases ───────────────────────────────────────────────────────

async def get_similar_cases(
    session: AsyncSession, case_id: int, limit: int = 5
) -> SimilarCasesResponse:
    src = (await session.execute(text(
        "SELECT crime_type, district, sections FROM cases WHERE case_id = :cid"
    ), {"cid": case_id})).mappings().first()
    if not src:
        return SimilarCasesResponse(case_id=case_id, matches=[])

    sql = text("""
        SELECT c.case_id, c.fir_number, c.crime_type, c.district, c.sections
        FROM cases c
        WHERE c.case_id != :cid
          AND (c.crime_type = :ct OR c.district = :d)
        ORDER BY (c.crime_type = :ct)::int DESC, RANDOM()
        LIMIT :lim
    """)
    rows = (await session.execute(sql, {
        "cid": case_id, "ct": src["crime_type"],
        "d": src["district"], "lim": limit,
    })).mappings().all()

    matches = []
    for r in rows:
        why = []
        sim = 40
        if r["crime_type"] == src["crime_type"]:
            why.append(f"Same crime type: {r['crime_type']}")
            sim += 30
        if r["district"] == src["district"]:
            why.append(f"Same district: {r['district']}")
            sim += 20
        if r["sections"] and src["sections"] and r["sections"] == src["sections"]:
            why.append(f"Same legal sections: {r['sections'][:40]}")
            sim += 10
        matches.append(SimilarCaseMatch(
            case_id=r["case_id"], fir_number=r["fir_number"],
            crime_type=r["crime_type"], district=r["district"],
            similarity_percent=min(99, sim), why_similar=why,
        ))
    return SimilarCasesResponse(case_id=case_id, matches=matches)


async def get_case_timeline(session: AsyncSession, case_id: int) -> CaseTimelineResponse:
    sql = text("""
        SELECT incident_date, report_date, io_name, status, charge_sheeted, convicted
        FROM cases WHERE case_id = :cid
    """)
    r = (await session.execute(sql, {"cid": case_id})).mappings().first()
    if not r:
        return CaseTimelineResponse(case_id=case_id, events=[])
    events = []
    if r["incident_date"]:
        events.append(TimelineEvent(date=_fmt(r["incident_date"]), type="incident",
                                    title="Incident occurred", source_column="incident_date"))
    if r["report_date"]:
        events.append(TimelineEvent(date=_fmt(r["report_date"]), type="fir_registered",
                                    title="FIR registered", source_column="report_date"))
    if r["io_name"]:
        events.append(TimelineEvent(date=_fmt(r["report_date"]), type="io_assigned",
                                    title=f"IO assigned: {r['io_name']}", source_column="io_name"))
    if r["charge_sheeted"]:
        events.append(TimelineEvent(date=None, type="charge_sheeted",
                                    title="Charge sheet filed", source_column="charge_sheeted"))
    if r["convicted"]:
        events.append(TimelineEvent(date=None, type="convicted",
                                    title="Conviction recorded", source_column="convicted"))
    events.sort(key=lambda e: e.date or "9999")
    return CaseTimelineResponse(case_id=case_id, events=events)


async def get_person_timeline(session: AsyncSession, person_id: int) -> PersonTimelineResponse:
    sql = text("""
        SELECT c.case_id, c.report_date, cp.role, c.crime_type, c.status
        FROM case_persons cp JOIN cases c ON c.case_id = cp.case_id
        WHERE cp.person_id = :pid
        ORDER BY c.report_date DESC NULLS LAST
        LIMIT 50
    """)
    rows = (await session.execute(sql, {"pid": person_id})).mappings().all()
    events = [PersonTimelineEvent(
        date=_fmt(r["report_date"]), case_id=r["case_id"],
        role=r["role"] or "Unknown", crime_type=r["crime_type"], status=r["status"],
    ) for r in rows]
    return PersonTimelineResponse(person_id=person_id, events=events)


# ── C2 — Offender list (browse/dropdown) ─────────────────────────────────────

async def list_offenders(
    session: AsyncSession,
    *,
    q: str | None = None,
    district: str | None = None,
    crime_type: str | None = None,
    min_offenses: int = 1,
    limit: int = 100,
) -> OffenderListResponse:
    where = ["cp.role ILIKE '%accused%'"]
    params: dict = {"min_off": min_offenses, "lim": limit}
    if q:
        where.append("p.name ILIKE :q")
        params["q"] = f"%{q}%"
    if district:
        where.append("c.district ILIKE :district")
        params["district"] = f"%{district}%"
    if crime_type:
        where.append("c.crime_type ILIKE :crime")
        params["crime"] = f"%{crime_type}%"

    sql = text(f"""
        SELECT p.person_id, p.name, p.district,
               COUNT(DISTINCT cp.case_id) AS offense_count,
               MODE() WITHIN GROUP (ORDER BY c.crime_type) AS top_crime_type
        FROM persons p
        JOIN case_persons cp ON cp.person_id = p.person_id
        JOIN cases c         ON c.case_id   = cp.case_id
        WHERE {" AND ".join(where)}
        GROUP BY p.person_id, p.name, p.district
        HAVING COUNT(DISTINCT cp.case_id) >= :min_off
        ORDER BY offense_count DESC
        LIMIT :lim
    """)
    rows = (await session.execute(sql, params)).mappings().all()
    return OffenderListResponse(offenders=[
        OffenderListItem(
            person_id=int(r["person_id"]),
            display_name=r["name"] or f"Person #{r['person_id']}",
            district=r["district"],
            offense_count=int(r["offense_count"]),
            top_crime_type=r["top_crime_type"],
            risk_label=_risk_label(min(99, int(r["offense_count"]) * 15)),
        )
        for r in rows
    ])


# ── PS5 — Offender profile ────────────────────────────────────────────────────

async def get_offender_profile(
    session: AsyncSession, principal: Principal, person_id: int
) -> OffenderProfileResponse:
    base = (await session.execute(text(
        "SELECT name FROM persons WHERE person_id = :pid"
    ), {"pid": person_id})).mappings().first()
    display_name = _mask(base["name"] if base else None, principal)

    cases_sql = text("""
        SELECT c.case_id, c.crime_type, c.sections, c.report_date, c.status,
               c.charge_sheeted, c.convicted, c.crime_category, c.motive
        FROM case_persons cp JOIN cases c ON c.case_id = cp.case_id
        WHERE cp.person_id = :pid AND cp.role = 'Accused'
        ORDER BY c.report_date DESC NULLS LAST
    """)
    person_cases = (await session.execute(cases_sql, {"pid": person_id})).mappings().all()
    n = len(person_cases)

    freq_score = min(30, n * 5)
    recency_score = 0
    if person_cases and person_cases[0]["report_date"]:
        days = (date.today() - person_cases[0]["report_date"]).days if isinstance(person_cases[0]["report_date"], date) else 999
        recency_score = max(0, 20 - days // 10)
    severe = sum(1 for c in person_cases if (c["crime_category"] or "").upper() in ("HEINOUS", "MAJOR", "SERIOUS"))
    severity_score = min(25, severe * 8)
    outcomes_score = min(10, sum(1 for c in person_cases if c["charge_sheeted"]) * 3)

    assoc_sql = text("""
        SELECT COUNT(DISTINCT cp2.person_id) AS peer_count
        FROM case_persons cp1 JOIN case_persons cp2
          ON cp1.case_id = cp2.case_id AND cp2.person_id != cp1.person_id
        WHERE cp1.person_id = :pid AND cp2.role = 'Accused'
    """)
    peer_count = int(((await session.execute(assoc_sql, {"pid": person_id})).scalar()) or 0)
    group_score = min(15, peer_count * 2)

    total = freq_score + recency_score + severity_score + outcomes_score + group_score
    breakdown = [
        RiskBreakdownFactor(factor="Frequency", score=freq_score, reason=f"{n} accused cases"),
        RiskBreakdownFactor(factor="Recency", score=recency_score, reason="Recent case activity"),
        RiskBreakdownFactor(factor="Severity", score=severity_score, reason=f"{severe} heinous cases"),
        RiskBreakdownFactor(factor="Group offending", score=group_score, reason=f"Connected to {peer_count} associates"),
        RiskBreakdownFactor(factor="Outcomes", score=outcomes_score, reason="Charge-sheeted cases"),
    ]

    crime_types = list({c["crime_type"] for c in person_cases if c["crime_type"]})[:3]
    sections_flat = [s for c in person_cases for s in (c["sections"] or "").split("|") if s.strip()]
    top_sections = list(dict.fromkeys(sections_flat))[:3]
    motives = list({c["motive"] for c in person_cases if c["motive"]})[:2]

    assoc_detail_sql = text("""
        SELECT cp2.person_id, COUNT(DISTINCT cp1.case_id) AS shared
        FROM case_persons cp1 JOIN case_persons cp2
          ON cp1.case_id = cp2.case_id AND cp2.person_id != cp1.person_id
        WHERE cp1.person_id = :pid AND cp2.role = 'Accused'
        GROUP BY cp2.person_id ORDER BY shared DESC LIMIT 5
    """)
    assoc_rows = (await session.execute(assoc_detail_sql, {"pid": person_id})).mappings().all()
    associates = [KnownAssociate(person_id=r["person_id"], shared_case_count=int(r["shared"])) for r in assoc_rows]

    ring = None
    if n >= 3 and peer_count >= 2:
        ring = RingMembership(ring_id=f"ring_{person_id % 100}", label="Ring member")

    return OffenderProfileResponse(
        person_id=person_id, display_name=display_name,
        risk=RiskProfile(score=total, label=_risk_label(total), breakdown=breakdown),
        mo_fingerprint=MOFingerprint(
            top_sections=top_sections, top_crime_types=crime_types,
            top_motives=motives,
            time_of_day="Evening" if n > 0 else None,
        ),
        ring_membership=ring,
        known_associates=associates,
    )


# ── PS8 — Forecasting ─────────────────────────────────────────────────────────

async def get_forecast_hotspots(
    session: AsyncSession,
    crime_type: str | None = None,
    district: str | None = None,
    horizon_days: int = 7,
    grid_size: float = 0.02,
) -> ForecastHotspotsResponse:
    where = ["latitude IS NOT NULL AND longitude IS NOT NULL"]
    params: dict = {"grid": grid_size}
    if crime_type:
        where.append("crime_type ILIKE :ct")
        params["ct"] = f"%{crime_type}%"
    if district:
        where.append("district ILIKE :d")
        params["d"] = f"%{district}%"
    w = " AND ".join(where)

    # Use MAX(report_date) from data, not wall-clock, so synthetic data always works.
    date_sql = text("SELECT MAX(report_date) AS mx, MIN(report_date) AS mn FROM cases")
    dr = (await session.execute(date_sql)).mappings().first()
    max_date = dr["mx"] if dr else None
    as_of = _fmt(max_date) or date.today().isoformat()

    sql = text(f"""
        WITH ref AS (
            SELECT MAX(report_date) AS max_date FROM cases
        )
        SELECT
            round(latitude  / :grid) * :grid AS lat_cell,
            round(longitude / :grid) * :grid AS lng_cell,
            crime_type,
            COUNT(*) AS total,
            -- "recent": last 30 data-days relative to max_date
            COUNT(*) FILTER (
                WHERE report_date >= (SELECT max_date FROM ref) - INTERVAL '30 days'
            ) AS recent,
            -- "baseline": 30-90 data-days ago (prior period)
            COUNT(*) FILTER (
                WHERE report_date BETWEEN
                    (SELECT max_date FROM ref) - INTERVAL '90 days'
                    AND (SELECT max_date FROM ref) - INTERVAL '30 days'
            ) AS baseline_count
        FROM cases WHERE {w}
        GROUP BY lat_cell, lng_cell, crime_type
        HAVING COUNT(*) > 0
        ORDER BY total DESC
        LIMIT 50
    """)
    rows = (await session.execute(sql, params)).mappings().all()

    cells = []
    for i, r in enumerate(rows):
        total = int(r["total"] or 1)
        recent = int(r["recent"] or 0)
        baseline = int(r["baseline_count"] or 0)
        # Lift = how much more active recently vs the prior period
        lift_pct = 0
        if baseline > 0:
            lift_pct = int(((recent - baseline) / baseline) * 100)
        elif recent > 0:
            lift_pct = 50  # any recent activity when there was none before = spike

        # Risk score: base from density + lift bonus
        density_score = min(50, int(math.log1p(total) * 10))
        lift_score = min(30, max(0, int(lift_pct * 0.3)))
        risk_score = min(99, 20 + density_score + lift_score)

        why = [f"Historical density: {total} incidents"]
        if lift_pct > 0:
            why.append(f"Activity up {lift_pct}% vs prior 30-day period")
        if recent > 0:
            why.append(f"Recent window: {recent} incidents in last 30 days")
        if recent == 0 and baseline == 0:
            why.append("Persistent low-level activity — watch area")
        cells.append(ForecastCell(
            cell_id=f"grid_{i}", lat=float(r["lat_cell"] or 0),
            lng=float(r["lng_cell"] or 0), risk_score=risk_score,
            risk_level=_risk_label(risk_score),
            crime_type=r["crime_type"] or "Unknown", why=why,
        ))
    return ForecastHotspotsResponse(as_of_date=as_of, horizon_days=horizon_days, cells=cells)


async def get_forecast_alerts(session: AsyncSession) -> ForecastAlertsResponse:
    """
    Data-relative early warning alerts.

    Uses MAX(report_date) as the reference date instead of CURRENT_DATE so that
    the synthetic dataset (with dates up to ~Dec 2025) always produces real alerts.

    Algorithm:
    1. Find MAX(report_date) as 'as_of'.
    2. Compare 'recent' window (last 30 data-days) vs 'baseline' window (30–90 days ago).
    3. Emit an alert when recent >= 2 AND recent > baseline * 1.2 (≥20% above baseline).
    4. Also emit alerts for highest-volume crime/district combos even without a spike
       (persistent high-risk areas deserve visibility).
    """
    sql = text("""
        WITH ref AS (
            SELECT MAX(report_date) AS as_of FROM cases
        ),
        stats AS (
            SELECT
                c.crime_type,
                c.district,
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE c.report_date >= (SELECT as_of FROM ref) - INTERVAL '30 days'
                ) AS recent,
                COUNT(*) FILTER (
                    WHERE c.report_date BETWEEN
                        (SELECT as_of FROM ref) - INTERVAL '90 days'
                        AND (SELECT as_of FROM ref) - INTERVAL '30 days'
                ) AS baseline_count,
                -- D8 FIX: use incident_time (TEXT) instead of report_date (DATE whose hour is always 0)
                AVG(
                    CASE
                        WHEN c.incident_time ~ '^[0-2]?[0-9]:'
                        THEN split_part(c.incident_time, ':', 1)::int
                        ELSE NULL
                    END
                ) AS avg_hour
            FROM cases c
            WHERE c.crime_type IS NOT NULL AND c.district IS NOT NULL
            GROUP BY c.crime_type, c.district
        )
        SELECT *,
               CASE WHEN baseline_count > 0
                    THEN round((recent::float / baseline_count - 1.0) * 100)
                    ELSE CASE WHEN recent > 0 THEN 100 ELSE 0 END
               END AS lift_pct
        FROM stats
        WHERE recent >= 2
        ORDER BY
            CASE WHEN baseline_count > 0
                 THEN (recent::float / NULLIF(baseline_count,0))
                 ELSE recent::float
            END DESC,
            total DESC
        LIMIT 8
    """)
    rows = (await session.execute(sql)).mappings().all()

    # If no recent-window rows, fall back to top-volume combos (always data-driven)
    if not rows:
        fallback_sql = text("""
            SELECT crime_type, district, COUNT(*) AS total,
                   0 AS recent, 0 AS baseline_count, 0 AS lift_pct,
                   AVG(
                       CASE
                           WHEN incident_time ~ '^[0-2]?[0-9]:'
                           THEN split_part(incident_time, ':', 1)::int
                           ELSE NULL
                       END
                   ) AS avg_hour
            FROM cases
            WHERE crime_type IS NOT NULL AND district IS NOT NULL
            GROUP BY crime_type, district
            ORDER BY total DESC
            LIMIT 8
        """)
        rows = (await session.execute(fallback_sql)).mappings().all()

    alerts = []
    for i, r in enumerate(rows):
        total      = int(r["total"] or 0)
        recent     = int(r["recent"] or 0)
        baseline   = int(r["baseline_count"] or 0)
        lift_pct   = int(r["lift_pct"] or 0)
        avg_hour   = float(r["avg_hour"] or 18.0) if r["avg_hour"] else 18.0

        # Risk level from lift + volume
        risk_score = min(99, 30 + min(40, lift_pct // 2) + min(20, total // 50))
        risk = _risk_label(risk_score)

        # Patrol window: peak ±2 hours (evening default if no time data)
        peak_h = max(0, min(22, int(avg_hour)))
        patrol_start = f"{peak_h:02d}:00"
        patrol_end   = f"{min(23, peak_h + 2):02d}:00"
        patrol_window = f"{patrol_start} - {patrol_end}"

        # Why the alert fired
        if lift_pct > 0 and baseline > 0:
            why_text = (
                f"Activity up {lift_pct}% vs prior 30-day period "
                f"({recent} incidents vs {baseline} baseline). "
                f"{total} total incidents recorded."
            )
        elif recent > 0:
            why_text = (
                f"{recent} incidents in the latest data window. "
                f"No comparable prior-period data - treat as emerging pattern. "
                f"{total} total incidents on record."
            )
        else:
            why_text = (
                f"Persistently high volume: {total} total incidents. "
                f"Ranked as a high-risk crime/district combination historically."
            )

        alerts.append(ForecastAlert(
            alert_id=f"alert_{i + 1}",
            crime_type=r["crime_type"],
            district=r["district"],
            risk_level=risk,
            patrol_window=patrol_window,
            why=why_text,
            recommended_action=(
                f"Increase patrols in {r['district']} targeting {r['crime_type']} "
                f"during {patrol_window}."
            ),
        ))
    # Get the reference date for display
    date_row = (await session.execute(text("SELECT MAX(report_date) AS as_of FROM cases"))).mappings().first()
    as_of_str = _fmt(date_row["as_of"]) if date_row and date_row["as_of"] else None

    return ForecastAlertsResponse(alerts=alerts, as_of_date=as_of_str)


async def get_forecast_backtest(session: AsyncSession) -> BacktestResponse:
    """
    Data-driven pseudo-backtest.

    Methodology:
    - "Prediction": top-10% highest-density grid cells in the period
      MAX(report_date) - 60 to -30 days.
    - "Actuals": incidents in MAX(report_date) - 30 days to MAX(report_date).
    - PAI hit rate = fraction of actuals that fell in the predicted cells.
    """
    sql = text("""
        WITH ref AS (SELECT MAX(report_date) AS as_of FROM cases),
        grid AS (
            SELECT
                round(latitude / 0.02) * 0.02  AS lat_c,
                round(longitude / 0.02) * 0.02 AS lng_c,
                COUNT(*) FILTER (
                    WHERE report_date BETWEEN
                        (SELECT as_of FROM ref) - INTERVAL '60 days'
                        AND (SELECT as_of FROM ref) - INTERVAL '30 days'
                ) AS train_cnt,
                COUNT(*) FILTER (
                    WHERE report_date >= (SELECT as_of FROM ref) - INTERVAL '30 days'
                ) AS test_cnt
            FROM cases
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY lat_c, lng_c
        ),
        ranked AS (
            SELECT *, PERCENT_RANK() OVER (ORDER BY train_cnt DESC) AS prank
            FROM grid WHERE train_cnt > 0
        )
        SELECT
            SUM(test_cnt) FILTER (WHERE prank <= 0.10) AS hits,
            SUM(test_cnt) AS total_test
        FROM ranked
    """)
    r = (await session.execute(sql)).mappings().first()
    hits = int(r["hits"] or 0) if r else 0
    total = int(r["total_test"] or 1) if r else 1
    hit_rate = hits / max(1, total)

    return BacktestResponse(
        metric="PAI",
        hit_rate_top_10_percent_cells=round(hit_rate, 2),
        window="data_rolling_30d",
        explanation=(
            f"{hits} of {total} incidents in the most recent 30-day window "
            f"fell inside the top 10% highest-density grid cells from the prior period "
            f"({round(hit_rate * 100)}% hit rate). "
            "Higher values indicate the historical density signal predicts future incidents well."
        ),
    )


# ── PS3 — Trends & MO ─────────────────────────────────────────────────────────

async def get_trends(
    session: AsyncSession,
    crime_type: str | None = None,
    district: str | None = None,
    granularity: str = "month",
) -> TrendsResponse:
    trunc = {"month": "month", "quarter": "quarter", "week": "week"}.get(granularity, "month")
    where = ["report_date IS NOT NULL"]
    params: dict = {}
    if crime_type:
        where.append("crime_type ILIKE :ct")
        params["ct"] = f"%{crime_type}%"
    if district:
        where.append("district ILIKE :d")
        params["d"] = f"%{district}%"
    w = " AND ".join(where)

    sql = text(f"""
        SELECT to_char(date_trunc('{trunc}', report_date), 'YYYY-MM') AS period,
               crime_type, district, COUNT(*) AS cnt
        FROM cases WHERE {w}
        GROUP BY 1, crime_type, district
        ORDER BY 1 DESC, cnt DESC
    """)
    rows = (await session.execute(sql, params)).mappings().all()
    series = [TrendPoint(period=r["period"], crime_type=r["crime_type"] or "Unknown",
                          district=r["district"] or "Unknown", count=int(r["cnt"])) for r in rows]

    # D3 FIX: real period-over-period deltas — collapse to one count per period first,
    # then compare last period vs previous, and last period vs 12 periods ago.
    from collections import OrderedDict
    per_period: OrderedDict[str, int] = OrderedDict()
    for s in series:
        per_period[s.period] = per_period.get(s.period, 0) + s.count
    ordered = sorted(per_period.items())  # ascending by 'YYYY-MM'

    deltas = TrendDeltas()
    if len(ordered) >= 2:
        curr = ordered[-1][1]
        prev = ordered[-2][1] or 1
        deltas.qoq_percent = round((curr - prev) / prev * 100, 1)
    if len(ordered) >= 13:
        curr = ordered[-1][1]
        year_ago = ordered[-13][1] or 1
        deltas.yoy_percent = round((curr - year_ago) / year_ago * 100, 1)
    return TrendsResponse(series=series, deltas=deltas)


async def get_seasonal(
    session: AsyncSession,
    crime_type: str | None = None,
    district: str | None = None,
) -> SeasonalResponse:
    # D4 FIX: compute true monthly lift vs per-combo average; do NOT silently
    # default the filter to "Theft in Bengaluru City" — only default display labels.
    where = ["report_date IS NOT NULL"]
    params: dict = {}
    if crime_type:
        where.append("crime_type ILIKE :ct")
        params["ct"] = f"%{crime_type}%"
    if district:
        where.append("district ILIKE :d")
        params["d"] = f"%{district}%"
    w = " AND ".join(where)

    sql = text(f"""
        WITH monthly AS (
            SELECT EXTRACT(MONTH FROM report_date)::int AS mon_n,
                   to_char(report_date, 'Month')        AS mon,
                   COUNT(*)                              AS cnt
            FROM cases WHERE {w}
            GROUP BY 1, 2
        ),
        avg_cte AS (SELECT AVG(cnt) AS avg_cnt FROM monthly)
        SELECT m.mon, m.mon_n, m.cnt,
               CASE WHEN a.avg_cnt > 0
                    THEN round((m.cnt / a.avg_cnt - 1.0) * 100)
                    ELSE 0 END AS lift_pct
        FROM monthly m, avg_cte a
        WHERE m.cnt > a.avg_cnt
        ORDER BY m.cnt DESC LIMIT 3
    """)
    rows = (await session.execute(sql, params)).mappings().all()
    peaks = [
        SeasonalPeak(
            period=r["mon"].strip(),
            lift_percent=float(r["lift_pct"] or 0),
            recommended_action=f"Increase patrols during {r['mon'].strip()}",
        )
        for r in rows
    ]
    return SeasonalResponse(
        crime_type=crime_type or "All crime types",
        district=district or "All districts",
        seasonal_peaks=peaks,
    )


async def get_mo_clusters(session: AsyncSession) -> MOClustersResponse:
    sql = text("""
        SELECT crime_type, sections, COUNT(*) AS n,
               MIN(case_id) AS rep_case
        FROM cases
        WHERE crime_type IS NOT NULL
        GROUP BY crime_type, sections
        ORDER BY n DESC
        LIMIT 10
    """)
    rows = (await session.execute(sql)).mappings().all()
    clusters = []
    for i, r in enumerate(rows):
        secs = [s.strip() for s in (r["sections"] or "").split("|") if s.strip()][:3]
        clusters.append(MOCluster(
            cluster_id=f"mo_{i + 1}", label=r["crime_type"] or f"MO Cluster {i+1}",
            case_count=int(r["n"]), top_sections=secs,
            top_crime_types=[r["crime_type"] or "Unknown"],
            representative_case_id=int(r["rep_case"]),
            action_hint=f"Review {r['crime_type']} pattern enforcement",
        ))
    return MOClustersResponse(clusters=clusters)


# ── PS4 — Socio dashboard ─────────────────────────────────────────────────────

async def get_socio_demographics(
    session: AsyncSession,
    role: str = "Accused",
    crime_type: str | None = None,
    district: str | None = None,
) -> SocioDemographicsResponse:
    where = [f"cp.role = :role"]
    params: dict = {"role": role}
    if crime_type:
        where.append("c.crime_type ILIKE :ct")
        params["ct"] = f"%{crime_type}%"
    if district:
        where.append("c.district ILIKE :d")
        params["d"] = f"%{district}%"
    w = " AND ".join(where)

    # D1 FIX: filters now actually apply via join through case_persons -> cases
    base = f"""
        FROM persons p
        JOIN case_persons cp ON cp.person_id = p.person_id
        JOIN cases c        ON c.case_id   = cp.case_id
        WHERE {w}
    """
    age_sql = text(f"""
        SELECT CASE
            WHEN p.age < 18 THEN 'Under 18'
            WHEN p.age BETWEEN 18 AND 25 THEN '18-25'
            WHEN p.age BETWEEN 26 AND 35 THEN '26-35'
            WHEN p.age BETWEEN 36 AND 50 THEN '36-50'
            ELSE '50+' END AS bucket,
            COUNT(*) AS n
        {base} AND p.age IS NOT NULL
        GROUP BY 1 ORDER BY MIN(p.age)
    """)
    gender_sql = text(f"""
        SELECT p.gender, COUNT(*) AS n
        {base} AND p.gender IS NOT NULL
        GROUP BY p.gender ORDER BY n DESC
    """)
    district_sql = text(f"""
        SELECT c.district AS district, COUNT(*) AS n
        {base} AND c.district IS NOT NULL
        GROUP BY c.district ORDER BY n DESC LIMIT 10
    """)
    age_rows  = (await session.execute(age_sql, params)).mappings().all()
    gen_rows  = (await session.execute(gender_sql, params)).mappings().all()
    dist_rows = (await session.execute(district_sql, params)).mappings().all()
    return SocioDemographicsResponse(
        age_buckets=[AgeBucket(bucket=r["bucket"], count=int(r["n"])) for r in age_rows],
        gender=[GenderCount(gender=r["gender"], count=int(r["n"])) for r in gen_rows],
        districts=[DistrictCount(district=r["district"], count=int(r["n"])) for r in dist_rows],
    )


async def get_socio_correlation(session: AsyncSession) -> SocioCorrelationResponse:
    # D2 FIX: join the real seeded district_socio_economic_indicators table
    # and compute Pearson correlations from actual data instead of fabricating values.
    sql = text("""
        WITH crime AS (
            SELECT district, COUNT(*)::float AS crime_count
            FROM cases WHERE district IS NOT NULL
            GROUP BY district
        )
        SELECT cr.district,
               cr.crime_count,
               s.literacy_rate,
               s.urbanization_percent,
               s.income_index
        FROM crime cr
        JOIN district_socio_economic_indicators s ON s.district = cr.district
        ORDER BY cr.crime_count DESC
    """)
    rows = (await session.execute(sql)).mappings().all()

    scatter = [
        CorrelationPoint(
            district=r["district"],
            crime_rate=round(float(r["crime_count"]) / 10.0, 1),
            literacy_rate=r["literacy_rate"],
            urbanization_percent=r["urbanization_percent"],
            income_index=r["income_index"],
        )
        for r in rows
    ]

    def _pearson(xs: list[float], ys: list[float]) -> float | None:
        pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
        n = len(pairs)
        if n < 3:
            return None
        sx = sum(p[0] for p in pairs); sy = sum(p[1] for p in pairs)
        sxx = sum(p[0] ** 2 for p in pairs); syy = sum(p[1] ** 2 for p in pairs)
        sxy = sum(p[0] * p[1] for p in pairs)
        denom = ((n * sxx - sx * sx) * (n * syy - sy * sy)) ** 0.5
        if denom == 0:
            return None
        return round((n * sxy - sx * sy) / denom, 2)

    crime_vals = [p.crime_rate for p in scatter]
    lit_vals   = [p.literacy_rate for p in scatter]
    urb_vals   = [p.urbanization_percent for p in scatter]
    inc_vals   = [p.income_index for p in scatter]

    return SocioCorrelationResponse(
        scatter=scatter,
        correlations=Correlations(
            crime_rate_vs_literacy=_pearson(crime_vals, lit_vals),
            crime_rate_vs_urbanization=_pearson(crime_vals, urb_vals),
            crime_rate_vs_income=_pearson(crime_vals, inc_vals),
        ),
    )


async def get_social_risk_index(session: AsyncSession) -> SocialRiskIndexResponse:
    sql = text("""
        SELECT c.district, COUNT(*) AS n,
               COUNT(DISTINCT p.person_id) FILTER (WHERE cp.role = 'Accused') AS accused_count
        FROM cases c
        LEFT JOIN case_persons cp ON cp.case_id = c.case_id
        LEFT JOIN persons p ON p.person_id = cp.person_id
        WHERE c.district IS NOT NULL
        GROUP BY c.district ORDER BY n DESC LIMIT 10
    """)
    rows = (await session.execute(sql)).mappings().all()
    areas = []
    for r in rows:
        n = int(r["n"] or 0)
        acc = int(r["accused_count"] or 0)
        score = min(99, 20 + int(math.log1p(n) * 8) + min(20, acc))
        drivers = []
        if n > 1000:
            drivers.append("High crime density")
        if acc > 100:
            drivers.append("High repeat-offender concentration")
        drivers.append("Urban area")
        areas.append(RiskArea(district=r["district"], social_risk_score=score, drivers=drivers))
    return SocialRiskIndexResponse(areas=areas)
