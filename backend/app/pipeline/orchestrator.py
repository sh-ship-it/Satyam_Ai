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
from app.config import get_settings
from app.pipeline import guardrails
from app.pipeline.prompts import build_answer_system
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


def _render_grounded(question: str, context: str) -> str:
    """D5.3 FIX: deterministic, no-LLM answer used in demo/keyless mode."""
    try:
        data = json.loads(context)
    except Exception:
        data = None

    # Help / report / note payloads.
    if isinstance(data, dict):
        if "help" in data:
            return (
                "I can answer questions over the crime database. Try: "
                '"top crime types in Bengaluru City", "how many theft cases this year", '
                'or "list recent cases in Mysuru".'
            )
        if "note" in data:
            return str(data["note"])
        if "nodes" in data:
            return (
                f"Network built: {len(data.get('nodes', []))} nodes, "
                f"{len(data.get('edges', []))} links. Open the Network panel to explore."
            )
        return "Found no matching records."

    rows = data if isinstance(data, list) else []
    if not rows:
        return "Found no matching records. Try a different district, crime type, or year."

    # Single aggregate value (e.g. COUNT or top-N).
    if len(rows) == 1 and len(rows[0]) == 1:
        (k, v), = rows[0].items()
        return f"**{v}** {k.replace('_', ' ')}."

    # Build a Markdown table from the columns that are actually present.
    cols = list(rows[0].keys())
    header = "| " + " | ".join(c.replace("_", " ").title() for c in cols) + " |"
    sep = "| " + " | ".join("---" for _ in cols) + " |"
    body = []
    for r in rows[:10]:
        body.append("| " + " | ".join("" if r.get(c) is None else str(r.get(c)) for c in cols) + " |")
    more = (
        "" if len(rows) <= 10
        else f"\n\nShowing 10 of {len(rows)} — ask to narrow by date, status, or crime type."
    )
    return f"Found {len(rows)} matching record(s).\n\n{header}\n{sep}\n" + "\n".join(body) + more


async def _compose(
    question: str,
    context: str,
    lang: str = "en",
    brain_engine: Literal["gemini", "groq"] | None = None,
    principal: "Principal | None" = None,
) -> str:
    """Grounded answer composition with Groq fallback on primary failure."""
    system = build_answer_system(principal)

    # D5.3 FIX: in demo/keyless mode skip the echo stub entirely.
    if get_settings().demo_mode:
        return _render_grounded(question, context)

    lang_directive = (
        "\n\nRespond in Kannada (ಕನ್ನಡ). Keep IPC section numbers, FIR identifiers, "
        "station names, and dates in their original form."
        if lang == "kn"
        else ""
    )
    prompt = f"Question: {question}\n\nGrounded data:\n{context}{lang_directive}"
    try:
        return await get_llm(brain_engine).complete(
            prompt, system=system, temperature=0.2
        )
    except Exception:
        try:
            return await get_fallback_llm().complete(
                prompt, system=system, temperature=0.2
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

        else:  # smalltalk — let the LLM answer conversationally with full context
            # Don't pass a data stub; compose directly so Gemini can use its world
            # knowledge + the officer's identity from the system prompt.
            system = build_answer_system(principal)
            if get_settings().demo_mode:
                answer = (
                    f"Hello! I'm Satyam, the KSP crime-intelligence assistant. "
                    f"Ask me about crime statistics, FIRs, hotspots, or suspect networks."
                )
            else:
                lang_directive = (
                    " Respond in Kannada (ಕನ್ನಡ)." if lang == "kn" else ""
                )
                try:
                    answer = await get_llm(brain_engine).complete(
                        message + lang_directive, system=system, temperature=0.3
                    )
                except Exception:
                    try:
                        answer = await get_fallback_llm().complete(
                            message + lang_directive, system=system, temperature=0.3
                        )
                    except Exception:
                        answer = (
                            "I'm Satyam, the KSP crime-intelligence assistant. "
                            "Ask me about crime statistics, FIRs, hotspots, or networks."
                        )
            for chunk in answer.split(" "):
                yield PipelineEvent("token", {"text": chunk + " "})
            state.add_turn("assistant", answer)
            yield PipelineEvent("done", {"conversation_id": state.conversation_id})
            return

        # 3) compose grounded answer (token stream)
        answer = await _compose(message, context, lang, brain_engine=brain_engine, principal=principal)
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
