"""Pydantic schemas for the Investigation Board feature."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------

class BoardImage(BaseModel):
    """A named image supplied by the client (base-64 data-URL)."""
    name: str
    data_url: str


class BoardGenerateRequest(BaseModel):
    prompt: str
    images: list[BoardImage] = []
    lang: str = "en"
    brain_engine: Optional[str] = None          # override: gemini | groq
    existing_snapshot: Optional[dict] = None    # tldraw snapshot for incremental merge


# ---------------------------------------------------------------------------
# Scene graph types
# ---------------------------------------------------------------------------

class SceneNode(BaseModel):
    id: str
    type: str
    x: float
    y: float
    w: float = 220
    h: float = 140
    label: str = ""
    image_ref: Optional[str] = None
    color: Optional[str] = None
    entity_kind: Optional[str] = None
    entity_id: Optional[str] = None


class SceneEdge(BaseModel):
    source: str
    target: str
    label: str = ""
    color: str = "#ef4444"
    style: str = "solid"
    kind: str = "link"


class SceneGraph(BaseModel):
    nodes: list[SceneNode] = []
    edges: list[SceneEdge] = []


# ---------------------------------------------------------------------------
# Board persistence
# ---------------------------------------------------------------------------

class BoardSaveRequest(BaseModel):
    board_id: Optional[int] = None
    title: str = "Untitled board"
    state_json: dict
    thumbnail: Optional[str] = None
