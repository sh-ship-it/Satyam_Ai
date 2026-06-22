"""Router-first orchestration.

Given a user message + RLS-scoped session + principal, route to a lane, call the
appropriate grounded tool(s), compose a cited answer, and emit pipeline events.
Events are consumed by the SSE endpoint for live streaming.

Engine overrides (brain_engine, sql_engine) are passed from the per-request
ChatRequest so the Settings panel can flip lanes live without redeploying.
"""
from __future__ import annotations

import json
import logging
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

log = logging.getLogger("satyam.pipeline")


@dataclass
class PipelineEvent:
    type: str
    data: dict

    def sse(self) -> str:
        return f"data: {json.dumps({'type': self.type, **self.data})}\n\n"


def _rows_context(rows: list[dict], limit: int = 25) -> str:
    return json.dumps(rows[:limit], default=str)


import re as _re
from collections import Counter as _Counter

_SPEAK_RE = _re.compile(r"\[SPEAK\](.*?)\[/SPEAK\]", _re.DOTALL | _re.IGNORECASE)


def _build_spoken_summary(rows: list[dict], message: str, lang: str = "en") -> str:
    """Build a 2–3 sentence spoken briefing from raw SQL rows.

    Works entirely from the data — no LLM needed — so it is guaranteed to work
    in demo/keyless mode AND when Gemini doesn't follow the [SPEAK] convention.

    Respects `lang`: when "kn", generates Kannada output so the TTS reads in
    the correct language matching the user's UI language toggle.
    """
    if not rows:
        return ""

    total = len(rows)
    is_kn = lang == "kn"

    # Detect location hint from the question / rows
    location = ""
    for key in ("station_name", "district"):
        vals = [str(r.get(key, "")).strip() for r in rows if r.get(key)]
        if vals:
            most_common = _Counter(vals).most_common(1)[0][0]
            if most_common:
                location = most_common
                break

    if is_kn:
        lead = f"{location + ' ನಲ್ಲಿ ' if location else ''}{total} ಪ್ರಕರಣ{'ಗಳು' if total != 1 else ''} ದಾಖಲಾಗಿವೆ."
    else:
        lead = f"Found {total} case{'s' if total != 1 else ''}"
        lead += f" at {location}." if location else "."

    # Top crime types
    crime_counts = _Counter(
        str(r.get("crime_type", "")).strip().title()
        for r in rows if r.get("crime_type")
    )
    top_crimes = crime_counts.most_common(2)
    crime_sentence = ""
    if top_crimes:
        if is_kn:
            crime_sentence = f"ಅತಿ ಹೆಚ್ಚಿನ ಪ್ರಕರಣಗಳು {top_crimes[0][0]} ವರ್ಗದಲ್ಲಿವೆ."
        else:
            parts = [f"{name} with {cnt}" for name, cnt in top_crimes]
            crime_sentence = f"The most common crime type is {parts[0]} record{'s' if top_crimes[0][1] != 1 else ''}"
            if len(parts) > 1:
                crime_sentence += f", followed by {parts[1]}"
            crime_sentence += "."

    # Status breakdown
    status_counts = _Counter(
        str(r.get("status", "")).strip().title()
        for r in rows if r.get("status")
    )
    status_sentence = ""
    if status_counts:
        top_status, top_n = status_counts.most_common(1)[0]
        if top_n > 1:
            pct = round(top_n / total * 100)
            if is_kn:
                status_sentence = f"ಇವುಗಳಲ್ಲಿ {top_n} ಪ್ರಕರಣಗಳು {top_status} ಸ್ಥಿತಿಯಲ್ಲಿವೆ."
            else:
                status_sentence = f"{top_n} of these ({pct}%) are {top_status}."

    parts = [p for p in [lead, crime_sentence, status_sentence] if p]
    return " ".join(parts[:3])


def _extract_speak(answer: str) -> tuple[str, str]:
    """Return (spoken_summary, display_text).

    Pulls out the [SPEAK]...[/SPEAK] block from a Gemini answer when it exists.
    If not found returns ("", answer) — caller falls back to the deterministic summary.
    """
    m = _SPEAK_RE.search(answer)
    if not m:
        return "", answer
    spoken = m.group(1).strip()
    display = _SPEAK_RE.sub("", answer).strip()
    return spoken, display


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
    spoken_summary = ""   # built from rows; sent as "speak" SSE event for TTS
    rows_data: list[dict] = []   # kept for deterministic spoken summary
    recovery_note: str | None = None  # set when a query had to be broadened

    try:
        if intent == "sql_query":
            yield PipelineEvent("tool", {"name": "text_to_sql", "status": "start"})
            try:
                sql_used, rows_data, recovery_note = await answer_with_sql(
                    session, message, state.slots,
                    principal=principal, history=state.turns, sql_engine=sql_engine
                )
                context = _rows_context(rows_data)
                citations = [{"ref": r.get("fir_number", str(i)), "label": "case"}
                             for i, r in enumerate(rows_data[:5]) if r.get("fir_number")]
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
            rows_data = hits
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

        # Prepend a recovery note when the query was auto-broadened, so the
        # officer understands why these results (not an empty dead-end) appear.
        if recovery_note and rows_data:
            answer = f"*{recovery_note}*\n\n{answer}"

        # Build the spoken summary two ways and take the best one:
        # (a) Deterministic — built directly from rows, always available.
        # (b) LLM tag — Gemini may have wrapped [SPEAK]...[/SPEAK] in its answer.
        # Prefer (b) when it exists (more contextual), fall back to (a).
        gemini_spoken, display_answer = _extract_speak(answer)
        if gemini_spoken:
            spoken_summary = gemini_spoken
        else:
            # Gemini didn't include the tag (demo mode, or it forgot) —
            # build it deterministically from the raw rows.
            display_answer = answer
            spoken_summary = _build_spoken_summary(rows_data, message, lang=lang)

        if spoken_summary:
            yield PipelineEvent("speak", {"text": spoken_summary})
        for chunk in display_answer.split(" "):
            yield PipelineEvent("token", {"text": chunk + " "})
        for c in citations:
            yield PipelineEvent("citation", c)
        state.add_turn("assistant", display_answer)

    except Exception as e:  # noqa: BLE001
        # Distinguish a genuine guardrail/safety block (carries a `reason`) from
        # an unexpected failure (DB/LLM/tool error). Only the former should tell
        # the user a safety filter fired; the latter is logged and reported as a
        # generic error instead of being silently mislabeled.
        reason = getattr(e, "reason", None)
        if reason is not None:
            msg = guardrails.safety_fallback(reason)
        else:
            log.exception("pipeline.unexpected_error", exc_info=e)
            msg = (
                "Sorry — something went wrong while answering that. "
                "Please try rephrasing, or try again in a moment."
            )
        yield PipelineEvent("token", {"text": msg})

    yield PipelineEvent("done", {"conversation_id": state.conversation_id})
