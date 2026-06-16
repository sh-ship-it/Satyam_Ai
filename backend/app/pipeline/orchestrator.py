"""Router-first orchestration.

Given a user message + RLS-scoped session + principal, route to a lane, call the
appropriate grounded tool(s), compose a cited answer, and emit pipeline events.
Events are consumed by the SSE endpoint for live streaming.

Engine overrides (brain_engine, sql_engine) are passed from the per-request
ChatRequest so the Settings panel can flip lanes live without redeploying.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import AsyncIterator, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, Principal
from app.models.registry import get_fallback_llm, get_llm
from app.pipeline import guardrails
from app.pipeline.prompts import ANSWER_SYSTEM
from app.pipeline.router import route
from app.pipeline.slots import ConversationState
from app.pipeline.tools import analytics, rag
from app.pipeline.tools.text_to_sql import UnsafeSQL, answer_with_sql


@dataclass
class PipelineEvent:
    type: str
    data: dict

    def sse(self) -> str:
        return f"data: {json.dumps({'type': self.type, **self.data})}\n\n"


def _rows_context(rows: list[dict], limit: int = 25) -> str:
    return json.dumps(rows[:limit], default=str)


async def _compose(
    question: str,
    context: str,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq"] | None = None,
) -> str:
    """Grounded answer composition with Groq fallback on primary failure."""
    lang_directive = (
        "\n\nRespond in Kannada (ಕನ್ನಡ). Keep IPC section numbers, FIR identifiers, "
        "station names, and dates in their original form."
        if lang == "kn"
        else ""
    )
    prompt = f"Question: {question}\n\nGrounded data:\n{context}{lang_directive}"
    try:
        return await get_llm(brain_engine).complete(
            prompt, system=ANSWER_SYSTEM, temperature=0.2
        )
    except Exception:
        try:
            return await get_fallback_llm().complete(
                prompt, system=ANSWER_SYSTEM, temperature=0.2
            )
        except Exception:
            return "I found the records below, but couldn't generate a summary just now."


async def run(
    *,
    message: str,
    principal: Principal,
    session: AsyncSession,
    state: ConversationState,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq"] | None = None,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> AsyncIterator[PipelineEvent]:
    # 1) guardrails
    blocked = guardrails.precheck(message)
    if blocked:
        yield PipelineEvent("blocked", {"reason": blocked})
        yield PipelineEvent("done", {"conversation_id": state.conversation_id})
        return

    state.add_turn("user", message)

    # 2) route (uses brain LLM with per-request override)
    intent, slots = await route(message, brain_engine=brain_engine)
    state.merge_slots(slots)
    yield PipelineEvent("tool", {"name": "router", "status": "end", "detail": intent})

    citations: list[dict] = []
    context = ""
    sql_used: str | None = None

    try:
        if intent == "sql_query":
            yield PipelineEvent("tool", {"name": "text_to_sql", "status": "start"})
            try:
                sql_used, rows = await answer_with_sql(
                    session, message, state.slots,
                    principal=principal, sql_engine=sql_engine
                )
                context = _rows_context(rows)
                citations = [{"ref": r.get("fir_number", str(i)), "label": "case"}
                             for i, r in enumerate(rows[:5]) if r.get("fir_number")]
            except UnsafeSQL as e:
                yield PipelineEvent("tool", {"name": "text_to_sql", "status": "end",
                                             "detail": f"rejected: {e}"})
                context = "[]"
            else:
                yield PipelineEvent("tool", {"name": "text_to_sql", "status": "end",
                                             "detail": sql_used})

        elif intent == "narrative_search":
            yield PipelineEvent("tool", {"name": "rag", "status": "start"})
            hits = await rag.search_narratives(session, message, k=5)
            context = _rows_context(hits)
            citations = [{"ref": h["case_id"], "label": "narrative"} for h in hits]
            yield PipelineEvent("tool", {"name": "rag", "status": "end",
                                         "detail": f"{len(hits)} hits"})

        elif intent == "hotspot":
            if not principal.has(Permission.RUN_ANALYTICS):
                yield PipelineEvent("blocked", {"reason": "insufficient_permission"})
                yield PipelineEvent("done", {"conversation_id": state.conversation_id})
                return
            pts = await analytics.hotspots(
                session, crime_type=state.slots.get("crime_type"),
                district=state.slots.get("district"),
            )
            context = _rows_context(pts)
            yield PipelineEvent("tool", {"name": "analytics.hotspots", "status": "end",
                                         "detail": f"{len(pts)} cells"})

        elif intent == "network":
            person = state.slots.get("person")
            if person:
                victim_framed = any(w in message.lower() for w in ("against", "victim", "targeted", "attacked"))
                if victim_framed:
                    nodes, edges = await analytics.victim_offender_network(session, person_id=person)
                else:
                    nodes, edges = await analytics.ego_network(session, person_id=person)
                context = json.dumps({"nodes": nodes, "edges": edges}, default=str)
                yield PipelineEvent("citation", {"ref": f"/network?seed={person}", "label": "Open network"})
            yield PipelineEvent("tool", {"name": "analytics.network", "status": "end"})

        elif intent == "report":
            context = json.dumps({"note": "Use the Reports panel to build a document."})

        else:  # smalltalk / help
            context = json.dumps({"help": "Ask about cases, hotspots, links, or reports."})

        # 3) compose grounded answer (token stream)
        answer = await _compose(message, context, lang, brain_engine=brain_engine)
        for chunk in answer.split(" "):
            yield PipelineEvent("token", {"text": chunk + " "})
        for c in citations:
            yield PipelineEvent("citation", c)
        state.add_turn("assistant", answer)

    except Exception as e:  # noqa: BLE001
        # If the safety filter fired (always-on child-safety etc.), template-fallback.
        reason = getattr(e, "reason", str(e))
        msg = guardrails.safety_fallback(reason)
        yield PipelineEvent("token", {"text": msg})

    yield PipelineEvent("done", {"conversation_id": state.conversation_id})
