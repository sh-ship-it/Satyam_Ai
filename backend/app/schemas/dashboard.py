from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class DashboardKpis(BaseModel):
    """Headline counts for the scope the caller asked for.

    `cleared` is defined as `cases.convicted = true`. That is the only disposition
    flag in the schema that unambiguously means a case was carried to conviction;
    `status` holds fourteen values including 'Traced', 'BoundOver' and 'Compounded',
    which are outcomes but not clearances, so counting them as cleared would
    inflate the rate. The full status breakdown is returned separately as
    `status_mix` so the coarse binary is never the only thing on offer.
    """

    total_firs: int = 0
    cleared: int = 0
    pending: int = 0
    clearance_rate_percent: float = 0.0
    per_day: float = 0.0
    first_day: Optional[str] = None
    last_day: Optional[str] = None
    span_days: int = 0
    districts_covered: int = 0
    stations_covered: int = 0


class NamedCount(BaseModel):
    """A ranked row. `yoy_percent` is None when there is no comparable prior period."""

    name: str
    count: int
    percent: float = 0.0
    prev_count: Optional[int] = None
    yoy_percent: Optional[float] = None


class YearRow(BaseModel):
    year: int
    count: int
    cleared: int
    clearance_percent: float
    yoy_percent: Optional[float] = None


class DistrictRow(BaseModel):
    name: str
    count: int
    percent: float
    cleared: int
    clearance_percent: float
    """Signed difference against the median district clearance, in points."""
    vs_median_points: float = 0.0


class StationRow(BaseModel):
    """One station in the performance table.

    `cleared` is `convicted`, matching the KPI strip and the outlier panel. The
    older `/map/station-breakdown` endpoint counts `charge_sheeted` instead, which
    is a different and much larger number — putting the two on one screen made the
    "vs median" column compare a charge-sheet rate against a conviction median.
    This is served from here so the whole dashboard uses one definition.
    """

    station: str
    district: Optional[str] = None
    firs: int
    cleared: int
    pending: int
    clearance_percent: float
    vs_median_points: float = 0.0
    top_crime: Optional[str] = None


class StationClearance(BaseModel):
    """Distribution of clearance rate across stations, plus the tails.

    Only stations at or above `min_firs` are included. A station with nine cases
    can post 0% or 100% clearance without either number meaning anything, and
    letting those dominate the tails would turn an outlier panel into noise.
    """

    min_firs: int = 0
    stations: int = 0
    worst: float = 0.0
    p25: float = 0.0
    median: float = 0.0
    p75: float = 0.0
    best: float = 0.0
    bottom: list[DistrictRow] = []
    top: list[DistrictRow] = []


class DashboardSummary(BaseModel):
    """Everything the Console dashboard renders, in one round trip.

    Deliberately absent: hour-of-day and day-of-week distributions. Both were
    measured on this corpus and carry no signal — only 12 of 24 hours hold any
    incident and weekday counts vary by under 4% — so they are reported as
    coverage facts (`hours_populated`, `dow_spread_percent`) rather than drawn as
    charts that would imply a pattern that is not there.
    """

    scope_label: str
    year: Optional[int] = None
    compare_year: Optional[int] = None
    district: Optional[str] = None
    crime_type: Optional[str] = None

    kpis: DashboardKpis
    yearly: list[YearRow] = []
    crime_mix: list[NamedCount] = []
    status_mix: list[NamedCount] = []
    districts: list[DistrictRow] = []
    station_clearance: StationClearance = StationClearance()
    stations: list[StationRow] = []

    # Coverage / data-quality facts, surfaced instead of charted.
    hours_populated: int = 0
    dow_spread_percent: float = 0.0
    clearance_stable_note: Optional[str] = None
    generated_at: str = ""
