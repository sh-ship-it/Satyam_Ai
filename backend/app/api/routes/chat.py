"""Conversational endpoint: grounded answers streamed over SSE.

The response is a `text/event-stream` of JSON frames (token / tool / citation /
blocked / done / error) produced by the orchestrator.

The RLS-scoped session is opened INSIDE the event generator rather than injected
with `Depends(get_scoped_session)`, and this is load-bearing rather than
stylistic. FastAPI tears a yield-dependency down when the handler returns, and a
streaming handler returns as soon as it hands back the StreamingResponse — before
a single frame is produced. The dependency's `async with session.begin()` therefore
exits first, and because `apply_rls_context` stamps the jurisdiction with
`set_config(..., true)` (transaction-local), the whole security context is
discarded before the pipeline runs.

Measured symptom when it was wired through Depends: `app.scope` and
`app.clearance` both read back as empty strings inside the generator, the
least-privilege role correctly matched no rows, and RAG plus Text-to-SQL each
returned zero results on every query while reporting success. It was invisible
for as long as the app connected as the table owner, because an owner bypasses
RLS entirely and so never noticed the missing context.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import get_principal, stamp_rls
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.db.session import get_sessionmaker
from app.schemas.chat import ChatRequest
from app.services import chat_service

router = APIRouter()


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    principal: Principal = Depends(get_principal),
) -> StreamingResponse:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    async def event_source():
        # Owned here so the transaction, and therefore the RLS context, stays
        # alive for every frame. See the module docstring.
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as session:
            async with session.begin():
                await stamp_rls(session, principal)
                async for event in chat_service.stream_chat(
                    message=req.message,
                    conversation_id=req.conversation_id,
                    lang=req.lang,
                    principal=principal,
                    session=session,
                    brain_engine=req.brain_engine,
                    sql_engine=req.sql_engine,
                ):
                    yield event.sse()

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
