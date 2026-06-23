"""Investigation Board API routes.

POST /api/board/generate  — generate a scene graph from a prompt (CHAT guard)
POST /api/board/save      — save (insert/update) a board
GET  /api/board/list      — list boards owned by the current user
GET  /api/board/{board_id} — load a single board (404 if not found/not owned)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.board import BoardGenerateRequest, BoardSaveRequest, SceneGraph
from app.services import board_service as svc

router = APIRouter()


def _guard_chat(principal: Principal) -> None:
    """Require Permission.CHAT (clearance >= 1)."""
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc))


# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=SceneGraph)
async def board_generate(
    req: BoardGenerateRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SceneGraph:
    """Generate a SceneGraph from a natural-language prompt."""
    _guard_chat(principal)
    await write_audit(
        session,
        action="board.generate",
        user_id=principal.officer_id,
        query_text=req.prompt[:500],
    )
    return await svc.generate_scene(req, existing_snapshot=req.existing_snapshot)


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------

@router.post("/save")
async def board_save(
    req: BoardSaveRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Insert or update a board. Returns {board_id: int}."""
    _guard_chat(principal)
    board_id = await svc.save_board(session, principal, req)
    return {"board_id": board_id}


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("/list")
async def board_list(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[dict]:
    """List boards owned by the current user, newest first."""
    _guard_chat(principal)
    return await svc.list_boards(session, principal)


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

@router.get("/{board_id}")
async def board_load(
    board_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Load a single board by id. 404 if not found or not owned by caller."""
    _guard_chat(principal)
    result = await svc.load_board(session, principal, board_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Board {board_id} not found.")
    return result


# ---------------------------------------------------------------------------
# Claim (recover orphaned board)
# ---------------------------------------------------------------------------

@router.post("/{board_id}/claim")
async def board_claim(
    board_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Claim an orphaned board (owner_user_id IS NULL) for the current user.

    Safe to call multiple times — idempotent if you already own the board.
    """
    _guard_chat(principal)
    ok = await svc.claim_board(session, principal, board_id)
    if not ok:
        raise HTTPException(status_code=409, detail="Board not found or owned by another user.")
    return {"ok": True, "board_id": board_id}
