"""Server-side field masking.

Masking happens on the server BEFORE data leaves the API — never client-side —
so a privileged payload is never sent to an under-cleared browser (spec risk:
server-side masking).
"""
from __future__ import annotations

from typing import Any

from app.core.rbac import Principal

_PII_FIELDS = {"name", "phone", "address", "person_id"}


def mask_value(value: Any) -> str:
    if value is None:
        return "\U0001f512 restricted"
    s = str(value)
    if len(s) <= 2:
        return "\u2022\u2022"
    return s[0] + "\u2022" * (len(s) - 2) + s[-1]


def mask_case(case: dict, principal: Principal) -> dict:
    """Return a copy of a case dict with PII masked unless the principal is cleared."""
    sensitivity = int(case.get("sensitivity_flag", 0) or 0)
    cleared = principal.can_view_sensitivity(sensitivity)
    out = dict(case)
    out["_masked"] = not cleared
    if cleared:
        return out
    for person in out.get("persons", []) or []:
        for field in _PII_FIELDS:
            if field in person:
                person[field] = mask_value(person[field])
    return out
