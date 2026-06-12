"""Input/output guardrails.

 - Pre-flight: block obviously out-of-scope or prompt-injection-y inputs.
 - Post-flight: when the LLM raises a safety block (e.g. child-safety, which is
   always-on and cannot be disabled), fall back to a templated, DB-grounded
   answer instead of failing the turn.
"""
from __future__ import annotations

import re

_INJECTION = re.compile(
    r"(ignore (all|previous) instructions|drop table|delete from|;\s*--|system prompt)",
    re.IGNORECASE,
)


def precheck(message: str) -> str | None:
    """Return a refusal reason if the input should be blocked, else None."""
    if _INJECTION.search(message):
        return "input_filtered"
    if len(message) > 4000:
        return "input_too_long"
    return None


def safety_fallback(reason: str) -> str:
    return (
        "I can't generate a free-text answer for that request "
        f"(safety filter: {reason}). I can still return the matching records "
        "directly from the database if you rephrase as a data query."
    )
