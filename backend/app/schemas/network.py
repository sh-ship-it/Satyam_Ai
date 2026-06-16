from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, model_validator


class EgoRequest(BaseModel):
    # Accept either person_id (numeric/string) or a free-text entity_name
    # that the service will resolve via name lookup.
    person_id: Optional[str] = None
    entity_name: Optional[str] = None
    depth: int = 1
    focus: Optional[str] = None

    @model_validator(mode="after")
    def _require_one(self) -> "EgoRequest":
        if not self.person_id and not self.entity_name:
            raise ValueError("Supply either person_id or entity_name")
        # Normalise: if only entity_name provided, copy it to person_id
        # (analytics.ego_network resolves names when the value is non-numeric)
        if not self.person_id and self.entity_name:
            self.person_id = self.entity_name
        return self


class GraphNode(BaseModel):
    id: str
    label: str
    kind: str  # person | case
    degree: int = 0
    entity_type: Optional[str] = None   # person | location | …
    case_ids: list[int] = []
    seed_id: Optional[str] = None
    role: Optional[str] = None
    crime_type: Optional[str] = None



class GraphEdge(BaseModel):
    source: str
    target: str
    label: Optional[str] = None


class EgoResponse(BaseModel):
    root: str
    seed_id: Optional[str] = None
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
