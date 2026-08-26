"""Intent router. Uses the LLM with a JSON schema, with a cheap keyword fallback
so routing still works in demo mode or on LLM failure.

Ordering is primary LLM -> fallback LLM -> keywords, and every downgrade is
logged. That matters: an earlier version caught bare `Exception` and silently
returned the keyword guess, so when the Gemini key started returning 401 the
primary lane failed on 100% of requests and produced no log line at all. The
symptom looked like bad routing ("victim was threatened with a knife near a bus
stand" -> hotspot, because "near" is a hotspot keyword) rather than a dead brain.
If routing quality degrades, grep for `router.` warnings before touching the
keyword lists.
"""
from __future__ import annotations

import json
import logging
from typing import Literal

from app.models.base import LLM
from app.models.registry import get_classifier_llm, get_fallback_llm, get_llm
from app.pipeline.prompts import ROUTER_SCHEMA, ROUTER_SYSTEM

log = logging.getLogger("satyam.router")

# Single source of truth for what the orchestrator can dispatch on. The LLM's
# reply is validated against this rather than trusted, so a hallucinated intent
# like "narrative" degrades to the keyword guess instead of reaching the
# orchestrator and matching no branch.
VALID_INTENTS: frozenset[str] = frozenset(
    ROUTER_SCHEMA["properties"]["intent"]["enum"]
)

# ---------------------------------------------------------------------------
# Keyword lane.
#
# Only reached when every LLM lane is down, so it aims to pick a plausible data
# lane rather than to be clever. Matching is ordered by SPECIFICITY, which is the
# part that used to be wrong: one flat list of generic verbs was tested before the
# domain nouns, so "show hotspots in Mysuru" matched "show" and became sql_query,
# and "what is my rank" matched "rank" and became sql_query too.
# ---------------------------------------------------------------------------

# Questions about the caller or the system. Must precede everything else: "what is
# my rank" contains the aggregation word "rank".
_SELF_PATTERNS = (
    "my name", "my rank", "my scope", "my clearance", "my district",
    "my station", "who am i", "who are you", "what can you do",
    "what are you", "how do i use", "help me use", "what is satyam",
)

_GREETINGS = ("hello", "hi ", "hey", "namaskara", "good morning",
              "good evening", "thanks", "thank you", "bye")

# Unambiguous aggregation/statistics wording. Strong enough to beat a domain noun,
# so "top crime areas" is a ranking question, not a map request.
_STRONG_SQL = (
    "top ", "how many", "count", "most", "highest", "lowest", "total",
    "breakdown", "average", "per cent", "percent", "rank", "trend",
    "crime type", "crime types", "which crime", "common crime", "statistic",
    "list ", "compare",
)

# Domain nouns for the specialised lanes. Beat the weak verbs below.
# "near" and "location" are deliberately NOT hotspot triggers: they occur in
# ordinary incident prose ("threatened ... near a bus stand"), which is how a
# narrative description ended up routed to the map lane.
_KEYWORDS = {
    "hotspot": ("hotspot", "heatmap", "map", "zone", "cluster", "hot spot"),
    "network": ("link", "connection", "associate", "network", "related to",
                "co-accused", "linked to"),
    "report": ("report", "export", "pdf", "briefing", "brief "),
    "narrative_search": ("modus", "similar to", "describe the case",
                         "find cases about", "involving a",
                         "details of the incident", "narrative"),
}

# Generic verbs and time words. Suggest a database question but are too weak to
# outrank a domain noun.
_WEAK_SQL = (
    "show", "tell me about", "summarize", "summary of", "overview",
    "what are", "how is", "this year", "last year", "last month",
    "recent", "latest", "reported in", " cases", " case in", " fir",
    " incident", "stat",
)


def _keyword_intent(message: str) -> str:
    """Best-effort intent when no LLM is reachable.

    The default is narrative_search rather than smalltalk. An officer typing a
    free-text description of an incident is asking about the corpus, and
    narrative_search is the only lane that accepts arbitrary prose; answering
    such a question with smalltalk drops it on the floor. Greetings and questions
    about the caller are matched explicitly above, so they do not reach here.
    """
    m = message.lower()
    if any(w in m for w in _SELF_PATTERNS):
        return "smalltalk"
    if any(m.startswith(w) or m.strip() == w.strip() for w in _GREETINGS):
        return "smalltalk"
    if any(w in m for w in _STRONG_SQL):
        return "sql_query"
    for intent, words in _KEYWORDS.items():
        if any(w in m for w in words):
            return intent
    if any(w in m for w in _WEAK_SQL):
        return "sql_query"
    if any(m.startswith(w) for w in ("which", "when", "where", "who ")):
        return "sql_query"
    return "narrative_search"


def _strip_fences(raw: str) -> str:
    """Drop ```json ... ``` fences. Gemini 2.5 Flash adds them despite the prompt."""
    cleaned = raw.strip()
    if not cleaned.startswith("```"):
        return cleaned
    lines = cleaned.splitlines()
    return "\n".join(
        l for i, l in enumerate(lines)
        if not (i == 0 and l.strip().startswith("```"))
        and not (i == len(lines) - 1 and l.strip() == "```")
    ).strip()


def _llm_lanes(
    brain_engine: Literal["gemini", "groq"] | None,
) -> list[tuple[str, LLM]]:
    """Primary lane, then the Groq fallback lane when it is a different provider.

    get_fallback_llm() already exists for exactly this purpose and the
    orchestrator uses it for answer composition; the router did not, so a primary
    outage skipped straight past a working second LLM to the keyword guess.

    Intent routing deliberately does NOT use the metered brain. Classifying an
    utterance into a closed enum does not need GPT-4o, and with a 50-request
    daily budget it must not: one spoken command already costs screen_agent +
    router + compose, so letting routing spend the budget would leave roughly 16
    commands for an entire day. An explicit `brain_engine` is still honoured when
    it names a cheap engine, so the Settings panel keeps working — but "openai"
    resolves to the classifier lane instead.
    """
    primary = (
        get_classifier_llm()
        if (brain_engine or "") in ("", "openai")
        else get_llm(brain_engine)
    )
    lanes = [(type(primary).__name__, primary)]
    try:
        fallback = get_fallback_llm()
    except Exception as exc:  # noqa: BLE001  (never let lane setup break routing)
        log.warning("router.fallback_unavailable err=%s", exc)
        return lanes
    # When the primary already IS the fallback provider, retrying it would just
    # spend another request on a lane that has already failed.
    if type(fallback) is not type(primary):
        lanes.append((type(fallback).__name__, fallback))
    return lanes


async def route(
    message: str,
    brain_engine: Literal["gemini", "groq"] | None = None,
) -> tuple[str, dict]:
    """Classify `message` into an intent plus slots.

    Returns the keyword guess only when every LLM lane has failed, and logs the
    reason each time so a dead brain is never mistaken for bad routing.
    """
    for label, llm in _llm_lanes(brain_engine):
        try:
            raw = await llm.complete(
                message, system=ROUTER_SYSTEM, temperature=0.0,
                json_schema=ROUTER_SCHEMA,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("router.llm_failed engine=%s err=%s", label, exc)
            continue

        try:
            data = json.loads(_strip_fences(raw))
        except Exception as exc:  # noqa: BLE001
            # Reasoning models (e.g. qwen3) emit <think> prose around the JSON.
            log.warning(
                "router.unparseable engine=%s err=%s raw=%.120r", label, exc, raw
            )
            continue

        intent = data.get("intent")
        if intent not in VALID_INTENTS:
            log.warning("router.invalid_intent engine=%s intent=%r", label, intent)
            continue

        slots = data.get("slots") or {}
        return intent, slots if isinstance(slots, dict) else {}

    intent = _keyword_intent(message)
    log.warning(
        "router.keyword_fallback intent=%s - every LLM lane failed, routing is "
        "degraded", intent,
    )
    return intent, {}
