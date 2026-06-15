"""Chat service: bridges the API to the orchestrator + conversation store + audit."""
from __future__ import annotations

from typing import AsyncIterator, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.rbac import Principal
from app.pipeline.orchestrator import PipelineEvent, run
from app.pipeline.slots import ConversationStore

_store = ConversationStore()


async def stream_chat(
    *,
    message: str,
    conversation_id: str | None,
    principal: Principal,
    session: AsyncSession,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq"] | None = None,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> AsyncIterator[PipelineEvent]:
    state = await _store.load(conversation_id, owner_id=principal.id)
    await write_audit(
        session,
        action="chat.query",
        query_text=message[:500],
    )
    async for event in run(
        message=message,
        principal=principal,
        session=session,
        state=state,
        lang=lang,
        brain_engine=brain_engine,
        sql_engine=sql_engine,
    ):
        yield event
    await _store.save(state, owner_id=principal.id)
