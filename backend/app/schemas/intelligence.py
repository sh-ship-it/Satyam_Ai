"""Typed response schemas for all intelligence feature endpoints."""
from __future__ import annotations
from typing import Any
from pydantic import BaseModel


# ── Network / Rings ───────────────────────────────────────────────────────────

class RingNode(BaseModel):
    id: str
    person_id: int
    label: str
    type: str = "person"
    risk_label: str = "Unknown"
    offense_count: int = 0
    is_kingpin: bool = False
    community_id: str = ""

class RingEdge(BaseModel):
    source: str
    target: str
    type: str = "co_accused"
    shared_case_count: int = 1
    weight: float = 0.5

class RingSummary(BaseModel):
    ring_id: str
    label: str
    member_count: int
    case_count: int
    severity_score: int
    recency_score: int
    kingpin_person_id: int | None = None
    top_crime_types: list[str] = []
    districts: list[str] = []
    why_flagged: list[str] = []

class RingsResponse(BaseModel):
    rings: list[RingSummary]

class GraphResponse(BaseModel):
    nodes: list[RingNode]
    edges: list[RingEdge]


# ── Similar Cases ─────────────────────────────────────────────────────────────

class SimilarCaseMatch(BaseModel):
    case_id: int
    fir_number: str | None = None
    crime_type: str | None = None
    district: str | None = None
    similarity_percent: int = 0
    why_similar: list[str] = []

class SimilarCasesResponse(BaseModel):
    case_id: int
    matches: list[SimilarCaseMatch]

class SimilarSearchRequest(BaseModel):
    query: str
    limit: int = 5


# ── Timeline ──────────────────────────────────────────────────────────────────

class TimelineEvent(BaseModel):
    date: str | None = None
    type: str
    title: str
    source_column: str = ""

class CaseTimelineResponse(BaseModel):
    case_id: int
    events: list[TimelineEvent]

class PersonTimelineEvent(BaseModel):
    date: str | None = None
    case_id: int
    role: str
    crime_type: str | None = None
    status: str | None = None

class PersonTimelineResponse(BaseModel):
    person_id: int
    events: list[PersonTimelineEvent]


# ── Offender Profile ──────────────────────────────────────────────────────────

class RiskBreakdownFactor(BaseModel):
    factor: str
    score: int
    reason: str

class RiskProfile(BaseModel):
    score: int
    label: str
    breakdown: list[RiskBreakdownFactor]
    notice: str = "Risk Indicator — investigative use only"

class MOFingerprint(BaseModel):
    top_sections: list[str] = []
    top_crime_types: list[str] = []
    top_motives: list[str] = []
    time_of_day: str | None = None

class RingMembership(BaseModel):
    ring_id: str
    label: str

class KnownAssociate(BaseModel):
    person_id: int
    shared_case_count: int

class OffenderProfileResponse(BaseModel):
    person_id: int
    display_name: str
    risk: RiskProfile
    mo_fingerprint: MOFingerprint
    ring_membership: RingMembership | None = None
    known_associates: list[KnownAssociate] = []


# C1 — Offender list (browse/dropdown)
class OffenderListItem(BaseModel):
    person_id: int
    display_name: str
    district: str | None = None
    offense_count: int
    top_crime_type: str | None = None
    risk_label: str

class OffenderListResponse(BaseModel):
    offenders: list[OffenderListItem] = []


# ── Forecasting ───────────────────────────────────────────────────────────────

class ForecastCell(BaseModel):
    cell_id: str
    lat: float
    lng: float
    risk_score: int
    risk_level: str
    crime_type: str
    why: list[str] = []

class ForecastHotspotsResponse(BaseModel):
    as_of_date: str
    horizon_days: int
    cells: list[ForecastCell]

class ForecastAlert(BaseModel):
    alert_id: str
    crime_type: str
    district: str
    risk_level: str
    patrol_window: str
    why: str
    recommended_action: str
    fairness_note: str = "Decision support only; based on reported incidents, not arrests."

class ForecastAlertsResponse(BaseModel):
    alerts: list[ForecastAlert]
    as_of_date: str | None = None

class BacktestResponse(BaseModel):
    metric: str
    hit_rate_top_10_percent_cells: float
    window: str
    explanation: str


# ── Trends & MO ───────────────────────────────────────────────────────────────

class TrendPoint(BaseModel):
    period: str
    crime_type: str
    district: str
    count: int

class TrendDeltas(BaseModel):
    qoq_percent: float | None = None
    yoy_percent: float | None = None

class TrendsResponse(BaseModel):
    series: list[TrendPoint]
    deltas: TrendDeltas

class SeasonalPeak(BaseModel):
    period: str
    lift_percent: float
    recommended_action: str

class SeasonalResponse(BaseModel):
    crime_type: str
    district: str
    seasonal_peaks: list[SeasonalPeak]

class MOCluster(BaseModel):
    cluster_id: str
    label: str
    case_count: int
    top_sections: list[str] = []
    top_crime_types: list[str] = []
    representative_case_id: int | None = None
    action_hint: str = ""

class MOClustersResponse(BaseModel):
    clusters: list[MOCluster]


# ── Socio Dashboard ───────────────────────────────────────────────────────────

class AgeBucket(BaseModel):
    bucket: str
    count: int

class GenderCount(BaseModel):
    gender: str
    count: int

class DistrictCount(BaseModel):
    district: str
    count: int

class SocioDemographicsResponse(BaseModel):
    age_buckets: list[AgeBucket]
    gender: list[GenderCount]
    districts: list[DistrictCount]
    notice: str = "Aggregate-only demographic view. Not used for individual risk scoring."

class CorrelationPoint(BaseModel):
    district: str
    crime_rate: float
    literacy_rate: float | None = None
    urbanization_percent: float | None = None
    income_index: float | None = None

class Correlations(BaseModel):
    crime_rate_vs_literacy: float | None = None
    crime_rate_vs_urbanization: float | None = None
    crime_rate_vs_income: float | None = None

class SocioCorrelationResponse(BaseModel):
    scatter: list[CorrelationPoint]
    correlations: Correlations
    notice: str = "Correlation does not imply causation. For planning use only."

class RiskArea(BaseModel):
    district: str
    social_risk_score: int
    drivers: list[str] = []

class SocialRiskIndexResponse(BaseModel):
    areas: list[RiskArea]
