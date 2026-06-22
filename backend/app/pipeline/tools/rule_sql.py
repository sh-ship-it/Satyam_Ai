"""Deterministic, keyless NL->SQL fallback for the chat SQL lane.

Used when (a) the app is in demo_mode (no model keys), (b) the LLM returned
unparseable/unsafe SQL, or (c) the LLM SQL returned zero rows. Produces a
SINGLE read-only SELECT over the allow-listed tables only, then passes it
through sql_guard.sanitize() so the same safety rules apply.

Matching philosophy: be forgiving. Use ILIKE substring matching on the most
specific place token so 'Mysuru City' matches 'Mysuru', 'Bengaluru' matches
'Bengaluru City', and 'Cyber Crime Police Station' matches a station_name
containing 'Cyber Crime'.
"""
from __future__ import annotations

import re

from app.pipeline.tools.sql_guard import UnsafeSQL, sanitize

# Words that are never a useful place/crime token.
# NOTE: "police" and "station" are intentionally NOT here — they appear in
# real KSP station names like "Cyber Crime Police Station", "Banaswadi PS".
_GENERIC = {
    "city", "rural", "urban", "district", "range",
    "the", "a", "an", "in", "at", "near", "around", "of", "for", "about",
    "crime", "crimes", "case", "cases", "fir", "firs", "this", "last",
    "year", "top", "show", "list", "me", "tell", "summarize", "summary",
    "give", "please", "data", "report", "recent", "all", "types", "type",
    "how", "many", "count", "number", "common", "what", "are",
}

# Crime keywords -> value used for ILIKE on crime_type/crime_category.
_CRIME_HINTS = {
    "theft": "theft", "burglary": "burglar", "robbery": "robber",
    "murder": "murder", "assault": "assault", "cyber": "cyber",
    "fraud": "fraud", "cheating": "cheat", "kidnap": "kidnap",
    "rape": "rape", "pocso": "pocso", "dowry": "dowry", "drug": "drug",
    "ndps": "ndps", "accident": "accident", "missing": "missing",
    "extortion": "extort", "riot": "riot", "forgery": "forger",
    "narcotics": "narcotic", "hurt": "hurt", "molestation": "molest",
}

_CASE_COLUMNS = (
    'fir_number, fir_year, crime_type, status, station_name, district, '
    '"range", incident_date, report_date'
)


def _q(value: str) -> str:
    """Quote a string literal for inline SQL (defensive; also re-guarded later)."""
    cleaned = re.sub(r"[^A-Za-z0-9 .,&%/_-]", "", value).strip()
    return "'" + cleaned.replace("'", "''") + "'"


def _tokens(text_: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-z]+", text_.lower()) if w not in _GENERIC and len(w) > 2]


def _extract_place(question: str, slots: dict) -> str | None:
    # Prefer explicit slots from the router.
    for key in ("district", "range_name", "station", "place"):
        v = (slots or {}).get(key)
        if v:
            return str(v)
    # Capture the phrase after a locative preposition — keep the FULL phrase,
    # don't strip individual tokens (station names often contain "Police Station").
    m = re.search(r"\b(?:in|at|near|around|for|of)\s+([A-Za-z][A-Za-z .]+)", question, re.I)
    if not m:
        return None
    phrase = m.group(1).strip()
    # Remove trailing generic sentence words but keep meaningful multi-word phrases
    phrase = re.sub(r"\b(based on|the current|query|please|and)\b.*", "", phrase, flags=re.I).strip()
    if not phrase:
        return None
    # Return the full phrase so "Cyber Crime Police Station" is searched as-is
    return phrase


def _crime_value(question: str, slots: dict, place: str | None = None) -> str | None:
    v = (slots or {}).get("crime_type")
    if v:
        return str(v)
    ql = question.lower()
    place_lower = (place or "").lower()
    for kw, val in _CRIME_HINTS.items():
        if kw in ql:
            # Don't add a crime filter if the keyword is already part of the
            # place name (e.g. "Cyber" in "Cyber Crime Police Station") —
            # that would AND together two conflicting conditions.
            if place_lower and kw in place_lower:
                continue
            return val
    return None


def _year_clause(question: str, slots: dict) -> str:
    if (slots or {}).get("date_from") or (slots or {}).get("date_to"):
        a = (slots or {}).get("date_from")
        b = (slots or {}).get("date_to")
        parts = []
        if a:
            parts.append(f"report_date >= {_q(str(a))}")
        if b:
            parts.append(f"report_date <= {_q(str(b))}")
        return " AND ".join(parts)
    if re.search(r"this year", question, re.I):
        return "fir_year = EXTRACT(YEAR FROM CURRENT_DATE)::int"
    if re.search(r"last year", question, re.I):
        return "fir_year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 1"
    m = re.search(r"\b(20\d{2})\b", question)
    if m:
        return f"fir_year = {int(m.group(1))}"
    return ""


def _place_clause(place: str | None) -> str:
    if not place:
        return ""
    p = _q(f"%{place}%")
    return f"(district ILIKE {p} OR station_name ILIKE {p} OR \"range\" ILIKE {p})"


def build_sql(question: str, slots: dict | None = None) -> str | None:
    """Return a guarded SELECT string, or None if we can't form one."""
    slots = slots or {}
    ql = question.lower()

    place = _extract_place(question, slots)
    crime = _crime_value(question, slots, place=place)
    year = _year_clause(question, slots)

    where = []
    if place:
        where.append(_place_clause(place))
    if crime:
        cv = _q(f"%{crime}%")
        where.append(f"(crime_type ILIKE {cv} OR crime_category ILIKE {cv})")
    if year:
        where.append(year)
    where_sql = (" WHERE " + " AND ".join(w for w in where if w)) if any(where) else ""

    # Intent: counts
    if re.search(r"\b(how many|number of|count of|count)\b", ql):
        sql = f"SELECT COUNT(*) AS total_cases FROM cases{where_sql}"

    # Intent: top / ranking of crime types
    elif re.search(r"\b(top|most common|ranking|rank|breakdown|distribution)\b", ql) \
            or re.search(r"crime types?", ql):
        sql = (
            f"SELECT crime_type, COUNT(*) AS cases FROM cases{where_sql} "
            f"GROUP BY crime_type ORDER BY cases DESC LIMIT 10"
        )

    # Default: list recent matching cases
    else:
        sql = (
            f"SELECT {_CASE_COLUMNS} FROM cases{where_sql} "
            f"ORDER BY report_date DESC LIMIT 25"
        )

    try:
        return sanitize(sql)
    except UnsafeSQL:
        return None


__all__ = ["build_sql"]
