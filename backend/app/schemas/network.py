from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class EgoRequest(BaseModel):
    person_id: str
    depth: int = 1


class GraphNode(BaseModel):
    id: str
    label: str
    kind: str  # person | case
    degree: int = 0


class GraphEdge(BaseModel):
    source: str
    target: str
    label: Optional[str] = None


class EgoResponse(BaseModel):
    root: str
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
