"""Investigation Board service.

generate_scene is now delegated to board_brain.py which provides:
  - Intent detection (8 diagram types)
  - 8 layout engines (ring, timeline, tree, radial, grid, …)
  - 8+ node entity types with correct shapes/colours
  - 5 edge relationship styles
  - Conflict/contradiction detection
  - Multi-engine fallback cascade (Gemini → Groq → OpenAI → keyword)
  - Incremental merge support

All CRUD (save/load/list) remains here.
"""
from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal
from app.db.board_models import Board
from app.schemas.board import BoardGenerateRequest, SceneGraph

# Import the new brain — generate_scene lives there now
from app.services.board_brain import generate_scene as _brain_generate_scene

log = logging.getLogger(__name__)


async def generate_scene(
    req: BoardGenerateRequest,
    existing_snapshot: dict | None = None,
) -> SceneGraph:
    """Delegate to board_brain.generate_scene."""
    return await _brain_generate_scene(req, existing_snapshot=existing_snapshot)


# ---------------------------------------------------------------------------
# Board CRUD
# ---------------------------------------------------------------------------

async def save_board(
    session: AsyncSession,
    principal: Principal,
    req,  # BoardSaveRequest (avoid circular import; validated in route)
) -> int:
    """Insert or update a board. Returns board_id as int."""
    # principal.officer_id = user_id (int) set at login from db_user.user_id
    # principal.id = username string — never cast it to int
    owner_id: int | None = principal.officer_id  # already int | None

    if req.board_id:
        # Update existing — also update owner if it was NULL (first save race)
        await session.execute(
            update(Board)
            .where(Board.board_id == req.board_id)
            .values(
                title=req.title,
                state_json=req.state_json,
                thumbnail=req.thumbnail,
                owner_user_id=owner_id,
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
    owner_id: int | None = principal.officer_id

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
    """List boards owned by principal.

    Also includes orphaned boards (owner_user_id IS NULL) so the user can
    recover boards saved before the owner-id bug was fixed.
    """
    owner_id: int | None = principal.officer_id
    from sqlalchemy import or_

    # Match owned boards OR orphaned boards (NULL owner = pre-fix saves)
    if owner_id is not None:
        where_clause = or_(
            Board.owner_user_id == owner_id,
            Board.owner_user_id.is_(None),
        )
    else:
        # No owner_id in token — show only null-owner boards as recovery
        where_clause = Board.owner_user_id.is_(None)

    result = await session.execute(
        select(Board)
        .where(where_clause)
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
            "orphaned":   b.owner_user_id is None,
        }
        for b in boards
    ]


async def claim_board(
    session: AsyncSession,
    principal: Principal,
    board_id: int,
) -> bool:
    """Assign an orphaned (owner_user_id IS NULL) board to the current user.

    Returns True if claimed, False if the board doesn't exist or already owned
    by someone else.
    """
    owner_id: int | None = principal.officer_id
    if owner_id is None:
        return False

    result = await session.execute(
        select(Board).where(Board.board_id == board_id)
    )
    board = result.scalar_one_or_none()
    if board is None:
        return False
    # Only claim if genuinely orphaned
    if board.owner_user_id is not None and board.owner_user_id != owner_id:
        return False  # owned by someone else — refuse

    await session.execute(
        update(Board)
        .where(Board.board_id == board_id)
        .values(owner_user_id=owner_id)
    )
    return True
