"""Pydantic schemas for the Vision tactical map screen."""
from __future__ import annotations

from pydantic import BaseModel, Field


class VisionLayer(BaseModel):
    """One layer of the snapshot.

    The envelope is typed because clients depend on it; `data` stays loose
    because each layer has its own row shape (crime cells are compact
    [lat, lng, weight] triples, everything else is objects).
    """

    provenance: str = Field(
        description="live | cached | seeded | derived | simulated \u2014 where this geometry came from"
    )
    provider: str | None = None
    count: int = 0
    truncated: bool = False
    note: str | None = None
    degraded: str | None = Field(
        None, description="Human-readable reason this layer is empty or unavailable"
    )
    data: list = Field(default_factory=list)


class VisionSnapshot(BaseModel):
    bbox: list[float] | None = None
    coords_coarsened: bool = False
    layers: dict[str, VisionLayer] = Field(default_factory=dict)
    degraded: list[str] = Field(default_factory=list)


class VisionTelemetry(BaseModel):
    """Drives the HUD status pill and makes the deployment posture observable.

    `rls_enforced` deliberately mirrors the spirit of /health/data's
    `vector_search_available`: a security property that is invisible from
    outside the database is a security property that silently regresses. The
    connected role's bypass flag is the one fact that decides whether every
    jurisdiction guarantee this screen makes is real.
    """

    ok: bool = True
    module: str = "vision"

    # Liveness
    uptime_sec: int
    db_latency_ms: float | None = None
    db_source: str

    # Capability / posture
    ops_enabled: bool = Field(description="ENABLE_RESPONSE_OPS — false hides the live layers")
    ws_clients: int = Field(0, description="Connected live-stream clients on THIS process")
    rls_enforced: bool = Field(
        description="False when the connected role bypasses row-level security"
    )
    rls_note: str | None = None
    coords_coarsened: bool = Field(
        description="True when this caller's clearance forces reduced coordinate precision"
    )

    # Identity echo, so the HUD can show who the map is scoped to
    rank: str
    scope: str
    clearance: int


class LocationCrimeType(BaseModel):
    """One crime type in the neighbourhood breakdown."""

    crime_type: str
    count: int


class LocationCase(BaseModel):
    """A single FIR near the clicked point.

    Deliberately carries **no person data**. `core/masking.mask_case()` is only
    wired into services/case_service, so any new case-level payload would be
    unmasked; the safe answer is to expose only case-level facts an officer can
    already see on the map and to link out to the existing case drawer for the
    rest.
    """

    case_id: int
    fir_number: str
    fir_year: int | None = None
    crime_type: str
    status: str | None = None
    station_name: str | None = None
    district: str | None = None
    place_of_offence: str | None = None
    incident_date: str | None = None
    distance_m: int


class VisionLocation(BaseModel):
    """What is at, and recorded near, one point on the map.

    Answers the question a click implies: *what happened here?* Built from the
    `cases` table's own latitude/longitude, so it is the same ground truth the
    crime layer aggregates — not a second, differently-derived number.
    """

    lat: float
    lng: float
    radius_m: int
    coords_coarsened: bool = False

    # Place context. There is no reverse geocoder in this stack, so these are
    # taken from the nearest recorded case rather than from a gazetteer, and are
    # null when nothing is recorded nearby.
    district: str | None = None
    station_name: str | None = None
    place_label: str | None = None

    total_cases: int = 0
    crime_types: list[LocationCrimeType] = Field(default_factory=list)
    status_breakdown: dict[str, int] = Field(default_factory=dict)
    peak_hours: list[int] = Field(default_factory=list)
    recent: list[LocationCase] = Field(default_factory=list)
    truncated: bool = False
    note: str | None = None
