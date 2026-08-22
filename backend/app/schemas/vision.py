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
