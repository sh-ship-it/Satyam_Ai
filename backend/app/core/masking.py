"""Server-side field masking — KSP clearance-aware.

Masking tiers (never send unmasked PII the caller is not cleared for):

  L4 (SP+): full access including victim identity on PROTECTED crimes.
  L3 (DySP/PI): PROTECTED crime victim names masked; everything else visible.
  L2 (PSI/SI/ASI): all person PII (names, age, place_of_offence) masked;
                   case metadata + aggregates visible; PROTECTED narratives redacted.
  L1 (HC/PC): all names masked, coordinates coarsened to ~10 km grid,
              PROTECTED crime narratives hidden, counts/categories only.
"""
from __future__ import annotations

import math
from typing import Any

from app.core.rbac import Principal, is_protected

_LOCK = "\U0001f512"
_BULLET = "\u2022"


def _mask_str(value: Any) -> str:
    if value is None:
        return f"{_LOCK} restricted"
    s = str(value)
    if len(s) <= 2:
        return _BULLET * max(len(s), 2)
    return s[0] + _BULLET * (len(s) - 2) + s[-1]


def _coarsen_coord(v: float | None, precision: int = 1) -> float | None:
    """Round to ~10 km grid (1 decimal degree ≈ 110 km → 0.1° ≈ 11 km)."""
    if v is None:
        return None
    return round(v, precision)


def mask_case(case: dict, principal: Principal) -> dict:
    """Return a copy of `case` with fields masked according to clearance level.

    Always safe to call — returns case unmodified if the principal is fully cleared.
    Deep-copies the persons list so callers' dicts are not mutated.
    """
    import copy
    crime_type = case.get("crime_type")
    protected = is_protected(crime_type)
    out = dict(case)
    # Deep-copy mutable nested structures to avoid mutating the caller's dict
    if "persons" in out:
        out["persons"] = copy.deepcopy(out["persons"])
    out["_masked"] = False

    # ── L1: lowest clearance ─────────────────────────────────────────────
    if principal.clearance < 2:
        out["_masked"] = True
        # Coarsen coordinates
        out["latitude"]  = _coarsen_coord(out.get("latitude"))
        out["longitude"] = _coarsen_coord(out.get("longitude"))
        # Mask all person names
        for p in out.get("persons", []) or []:
            p["name"]            = _mask_str(p.get("name"))
            p["age"]             = None
            p.setdefault("_masked", True)
        # Hide PROTECTED narratives entirely
        if protected:
            out["narrative"] = f"{_LOCK} narrative restricted — insufficient clearance"
        return out

    # ── L2: PSI/SI/ASI ───────────────────────────────────────────────────
    if principal.clearance < 3:
        out["_masked"] = True
        # Mask person PII (place_of_offence is case-level, not person-level)
        for p in out.get("persons", []) or []:
            p["name"]            = _mask_str(p.get("name"))
            p["age"]             = None
            p.setdefault("_masked", True)
        out["place_of_offence"] = _mask_str(out.get("place_of_offence"))
        # Redact PROTECTED narratives
        if protected:
            out["narrative"] = f"{_LOCK} narrative restricted — protected crime type"
        return out

    # ── L3: DySP / PI / CI ───────────────────────────────────────────────
    if principal.clearance < 4:
        if protected:
            out["_masked"] = True
            for p in out.get("persons", []) or []:
                role = (p.get("role") or "").lower()
                if role in ("victim", "complainant"):
                    p["name"] = _mask_str(p.get("name"))
                    p.setdefault("_masked", True)
        return out

    # ── L4: SP+ — full access ────────────────────────────────────────────
    return out
