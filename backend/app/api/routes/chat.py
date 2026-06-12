"""Conversational endpoint: grounded answers streamed over SSE.

The response is a `text/event-stream` of JSON frames (token / tool / citation /
blocked / done / error) produced by the orchestrator. The RLS-scoped session is
held open for the duration of the stream and committed on completion, so the
audit write and every grounded read happen under the caller's security context.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.chat import ChatRequest
from app.services import chat_service

router = APIRouter()


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> StreamingResponse:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    async def event_source():
        async for event in chat_service.stream_chat(
            message=req.message,
            conversation_id=req.conversation_id,
            lang=req.lang,
            principal=principal,
            session=session,
        ):
            yield event.sse()

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
