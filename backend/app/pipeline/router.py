"""Intent router. Uses the LLM with a JSON schema, with a cheap keyword fallback
so routing still works in demo mode or on LLM failure.
"""
from __future__ import annotations

import json
from typing import Literal

from app.models.registry import get_llm
from app.pipeline.prompts import ROUTER_SCHEMA, ROUTER_SYSTEM

_KEYWORDS = {
    "hotspot": ("map", "hotspot", "area", "near", "district", "zone", "location", "heatmap"),
    "network": ("link", "connection", "associate", "network", "related to", "co-accused"),
    "report": ("report", "export", "pdf", "document", "brief"),
    # narrative_search only matches explicit case-description queries, NOT "top crimes about X"
    "narrative_search": ("modus", "similar to", "describe the case", "find cases about",
                         "involving a", "details of the incident"),
}

def _keyword_intent(message: str) -> str:
    m = message.lower()
    # SQL aggregation / query signals win first
    if any(w in m for w in (
        "top ", "how many", "count", "list", "show", "most", "highest",
        "crime type", "crime types", "total", "breakdown", "stat",
        "rank", "which crime", "common crime",
        # Natural patterns like "theft cases in X", "murder in X", "FIR in X"
        " cases", " case in", " fir", " incident", "reported in",
        "tell me about", "summarize", "summary of", "overview",
        "what are", "how is", "this year", "last year", "last month",
        "recent", "latest", "trend",
    )):
        return "sql_query"
    for intent, words in _KEYWORDS.items():
        if any(w in m for w in words):
            return intent
    if any(w in m for w in ("which", "when", "where")):
        return "sql_query"
    return "smalltalk"


async def route(
    message: str,
    brain_engine: Literal["gemini", "groq"] | None = None,
) -> tuple[str, dict]:
    llm = get_llm(brain_engine)
    try:
        raw = await llm.complete(
            message, system=ROUTER_SYSTEM, temperature=0.0, json_schema=ROUTER_SCHEMA
        )
        # Gemini 2.5 Flash sometimes wraps JSON in ```json ... ``` fences — strip them.
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            cleaned = "\n".join(
                l for i, l in enumerate(lines)
                if not (i == 0 and l.strip().startswith("```"))
                and not (i == len(lines) - 1 and l.strip() == "```")
            ).strip()
        data = json.loads(cleaned)
        intent = data.get("intent") or _keyword_intent(message)
        return intent, data.get("slots", {}) or {}
    except Exception:
        # LLM unavailable (429 / timeout) → reliable keyword fallback
        return _keyword_intent(message), {}
