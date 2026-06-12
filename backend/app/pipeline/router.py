"""Intent router. Uses the LLM with a JSON schema, with a cheap keyword fallback
so routing still works in demo mode or on LLM failure.
"""
from __future__ import annotations

import json

from app.models.registry import get_llm
from app.pipeline.prompts import ROUTER_SCHEMA, ROUTER_SYSTEM

_KEYWORDS = {
    "hotspot": ("map", "hotspot", "area", "near", "district", "zone", "location"),
    "network": ("link", "connection", "associate", "network", "related to", "co-accused"),
    "report": ("report", "export", "pdf", "document", "brief"),
    "narrative_search": ("about", "describe", "modus", "similar", "like the"),
}


def _keyword_intent(message: str) -> str:
    m = message.lower()
    for intent, words in _KEYWORDS.items():
        if any(w in m for w in words):
            return intent
    if any(w in m for w in ("how many", "count", "list", "show", "top", "which")):
        return "sql_query"
    return "smalltalk"


async def route(message: str) -> tuple[str, dict]:
    llm = get_llm()
    try:
        raw = await llm.complete(
            message, system=ROUTER_SYSTEM, temperature=0.0, json_schema=ROUTER_SCHEMA
        )
        data = json.loads(raw)
        intent = data.get("intent") or _keyword_intent(message)
        return intent, data.get("slots", {}) or {}
    except Exception:
        return _keyword_intent(message), {}
