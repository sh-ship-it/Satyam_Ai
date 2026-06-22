"""Investigation Board service.

Responsibilities:
  - generate_scene  : call Gemini (text or multimodal) to produce a SceneGraph
  - save_board      : upsert a Board row; return board_id
  - load_board      : fetch a board by id with ownership check
  - list_boards     : list boards owned by the current principal

ISOLATION: this module is fully decoupled from the synthetic dataset tables.
No dataset-specific table is imported or queried here.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.rbac import Principal
from app.db.board_models import Board
from app.models.registry import get_llm
from app.schemas.board import BoardGenerateRequest, SceneEdge, SceneGraph, SceneNode

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
SYSTEM = (
    "You are an investigation-board planner for Karnataka State Police. "
    "Return ONLY JSON matching the schema: a scene graph of nodes and edges. "
    "Lay nodes out on a 1600x1000 canvas with no overlaps. "
    "Use red solid edges for strong/suspected links and dashed for inferred. "
    "Respond in the user's language."
)

# ---------------------------------------------------------------------------
# JSON schema sent to Gemini as responseSchema constraint
# ---------------------------------------------------------------------------
SCENE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id":          {"type": "string"},
                    "type":        {"type": "string"},
                    "x":           {"type": "number"},
                    "y":           {"type": "number"},
                    "w":           {"type": "number"},
                    "h":           {"type": "number"},
                    "label":       {"type": "string"},
                    "image_ref":   {"type": "string"},
                    "color":       {"type": "string"},
                    "entity_kind": {"type": "string"},
                    "entity_id":   {"type": "string"},
                },
                "required": ["id", "type", "x", "y"],
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "label":  {"type": "string"},
                    "color":  {"type": "string"},
                    "style":  {"type": "string"},
                    "kind":   {"type": "string"},
                },
                "required": ["source", "target"],
            },
        },
    },
    "required": ["nodes", "edges"],
}


# ---------------------------------------------------------------------------
# Scene generation
# ---------------------------------------------------------------------------

def _parse(raw: str) -> SceneGraph:
    """Parse a JSON string into SceneGraph. Never raises — returns empty on failure."""
    try:
        data = json.loads(raw)
        nodes = [SceneNode(**n) for n in data.get("nodes", [])]
        edges = [SceneEdge(**e) for e in data.get("edges", [])]
        return SceneGraph(nodes=nodes, edges=edges)
    except Exception as exc:  # noqa: BLE001
        log.warning("board_service._parse failed: %s", exc)
        return SceneGraph()


async def _multimodal_generate(prompt: str, images: list[Any], lang: str) -> str:
    """Self-contained httpx POST to Gemini multimodal endpoint."""
    s = get_settings()
    key = s.gemini_api_key
    if not key:
        return json.dumps({"nodes": [], "edges": []})

    model = s.gemini_model
    url = (
        f"https://generativelanguage.googleapis.com/v1beta"
        f"/models/{model}:generateContent?key={key}"
    )

    parts: list[dict] = [{"text": prompt}]
    for img in images:
        # img.data_url is "data:<mime>;base64,<data>"
        try:
            header, b64data = img.data_url.split(",", 1)
            mime = header.split(":")[1].split(";")[0]
        except Exception:  # noqa: BLE001
            mime = "image/jpeg"
            b64data = img.data_url
        # Validate base64 is decodable
        try:
            base64.b64decode(b64data, validate=True)
        except Exception:  # noqa: BLE001
            continue
        parts.append({"inlineData": {"mimeType": mime, "data": b64data}})

    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "responseSchema": SCENE_SCHEMA,
        },
        "safetySettings": [
            {"category": c, "threshold": "BLOCK_ONLY_HIGH"}
            for c in (
                "HARM_CATEGORY_HARASSMENT",
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
            )
        ],
    }

    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.post(url, json=body)
        r.raise_for_status()
        data = r.json()

    candidates = data.get("candidates", [])
    if not candidates:
        return json.dumps({"nodes": [], "edges": []})
    parts_out = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts_out)


async def generate_scene(req: BoardGenerateRequest) -> SceneGraph:
    """Generate a SceneGraph from a text prompt (+ optional images)."""
    s = get_settings()

    if req.images and s.gemini_api_key:
        # Multimodal path — self-contained httpx call
        raw = await _multimodal_generate(req.prompt, req.images, req.lang)
    else:
        # Text-only path — use the standard LLM adapter
        llm = get_llm("gemini")
        raw = await llm.complete(
            req.prompt,
            system=SYSTEM,
            temperature=0.2,
            json_schema=SCENE_SCHEMA,
        )

    return _parse(raw)


# ---------------------------------------------------------------------------
# Board CRUD
# ---------------------------------------------------------------------------

async def save_board(
    session: AsyncSession,
    principal: Principal,
    req,  # BoardSaveRequest (avoid circular import; validated in route)
) -> int:
    """Insert or update a board. Returns board_id as int."""
    try:
        owner_id = int(principal.id)
    except (ValueError, TypeError):
        owner_id = None

    if req.board_id:
        # Update existing
        await session.execute(
            update(Board)
            .where(Board.board_id == req.board_id)
            .values(
                title=req.title,
                state_json=req.state_json,
                thumbnail=req.thumbnail,
            )
        )
        return req.board_id
    else:
        # Insert new
        board = Board(
            owner_user_id=owner_id,
            title=req.title,
            state_json=req.state_json,
            thumbnail=req.thumbnail,
        )
        session.add(board)
        await session.flush()
        return int(board.board_id)


async def load_board(
    session: AsyncSession,
    principal: Principal,
    board_id: int,
) -> dict | None:
    """Fetch a board by id. Returns None if not found or not owned by principal."""
    try:
        owner_id = int(principal.id)
    except (ValueError, TypeError):
        owner_id = None

    result = await session.execute(
        select(Board).where(Board.board_id == board_id)
    )
    board = result.scalar_one_or_none()
    if board is None:
        return None
    # Ownership check: allow if owner matches or board has no owner
    if board.owner_user_id is not None and board.owner_user_id != owner_id:
        return None
    return {
        "board_id":      board.board_id,
        "title":         board.title,
        "district":      board.district,
        "state_json":    board.state_json,
        "thumbnail":     board.thumbnail,
        "created_at":    board.created_at.isoformat() if board.created_at else None,
        "updated_at":    board.updated_at.isoformat() if board.updated_at else None,
    }


async def list_boards(
    session: AsyncSession,
    principal: Principal,
) -> list[dict]:
    """List boards owned by principal, ordered by updated_at desc."""
    try:
        owner_id = int(principal.id)
    except (ValueError, TypeError):
        return []

    result = await session.execute(
        select(Board)
        .where(Board.owner_user_id == owner_id)
        .order_by(Board.updated_at.desc())
    )
    boards = result.scalars().all()
    return [
        {
            "board_id":   b.board_id,
            "title":      b.title,
            "district":   b.district,
            "thumbnail":  b.thumbnail,
            "updated_at": b.updated_at.isoformat() if b.updated_at else None,
        }
        for b in boards
    ]
