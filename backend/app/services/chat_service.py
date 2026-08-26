"""Chat service: bridges the API to the orchestrator + conversation store + audit."""
from __future__ import annotations

from typing import AsyncIterator, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.rbac import Principal
from app.db.session import get_sessionmaker
from app.pipeline.orchestrator import PipelineEvent, run
from app.pipeline.slots import ConversationStore

_store = ConversationStore()


async def _audit_query(principal: Principal, message: str) -> None:
    """Persist the audit row in its OWN committed transaction.

    The streaming RLS session commits only when the SSE generator finishes, so
    if the client disconnects mid-stream that transaction (and its audit row)
    would roll back. Auditing in a dedicated short transaction makes the record
    durable regardless of what happens to the stream. audit_log has no RLS
    policy, so it does not need the caller's scope GUCs.
    """
    sm = get_sessionmaker()
    async with sm() as audit_session:
        async with audit_session.begin():
            await write_audit(
                audit_session,
                action="chat.query",
                user_id=principal.officer_id,
                query_text=message[:500],
            )


async def stream_chat(
    *,
    message: str,
    conversation_id: str | None,
    principal: Principal,
    session: AsyncSession,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq", "local"] | None = None,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> AsyncIterator[PipelineEvent]:
    state = await _store.load(conversation_id, owner_id=principal.id)
    await _audit_query(principal, message)
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
