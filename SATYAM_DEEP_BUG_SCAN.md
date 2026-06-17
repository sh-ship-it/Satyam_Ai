# Satyam — Deep Bug Scan (Round 3)

**Project:** Satyam — Intelligent Conversational AI for the KSP Crime Database (Challenge 01, Datathon 2026)
**Scope of this pass:** Exhaustive line-by-line read of the **entire** backend (`app/**`, `seed/**`, `migrations/**`) and frontend (`src/**`), cross-checked against the DB models and Pydantic schemas. This document lists **only NEW issues** found in this deep pass. The chat "no data" root cause and the 6 issues from the first two reports are *not* repeated here except where this pass adds proof.

> Companion docs already delivered: `SATYAM_BUG_SCAN_AND_FIXES.md` (requirements matrix + 6 issues) and `SATYAM_CHAT_NO_DATA_FIX.md` (chat empty-answer root cause + fixes). Read those first; this is additive.

---

## Severity legend

| Tag | Meaning |
|-----|---------|
| 🔴 HIGH | Wrong results, broken feature, or judge-facing authenticity failure |
| 🟠 MEDIUM | Misleading output / incorrect metric / poor failure UX |
| 🟡 LOW | Cosmetic, latent, or maintainability risk (no current crash) |

Every fix below is a **drop-in replacement** — your agent can open the named file, find the marked block, and paste the replacement.

---

## 🔴 D1 — PS4 Socio-Demographics filters are silently ignored

**File:** `backend/app/services/intelligence_service.py` → `get_socio_demographics()`

**Proof:** The function builds a `where`/`w` clause and a `params` dict from `role`, `crime_type`, `district`, **but the three queries it actually runs (`age_sql`, `gender_sql`, `district_sql`) hit the `persons` table directly and never reference `w` or `params`.** Result: the `role="Accused"` default and any crime-type/district filter from the dashboard have **zero effect** — every call returns demographics for *all* persons. `persons` does have `age`, `gender`, `district` columns (confirmed in `db/models.py`), so it does not crash; it just lies.

**Fix — replace the whole function body** so the filters actually drive a join through `case_persons` → `cases`:

```python
async def get_socio_demographics(
    session: AsyncSession,
    role: str = "Accused",
    crime_type: str | None = None,
    district: str | None = None,
) -> SocioDemographicsResponse:
    # Filters now actually apply: join persons -> case_persons -> cases.
    where = ["cp.role = :role"]
    params: dict = {"role": role}
    if crime_type:
        where.append("c.crime_type ILIKE :ct")
        params["ct"] = f"%{crime_type}%"
    if district:
        where.append("c.district ILIKE :d")
        params["d"] = f"%{district}%"
    w = " AND ".join(where)

    base = f"""
        FROM persons p
        JOIN case_persons cp ON cp.person_id = p.person_id
        JOIN cases c        ON c.case_id   = cp.case_id
        WHERE {w}
    """

    age_sql = text(f"""
        SELECT CASE
            WHEN p.age < 18 THEN 'Under 18'
            WHEN p.age BETWEEN 18 AND 25 THEN '18-25'
            WHEN p.age BETWEEN 26 AND 35 THEN '26-35'
            WHEN p.age BETWEEN 36 AND 50 THEN '36-50'
            ELSE '50+' END AS bucket,
            COUNT(*) AS n
        {base} AND p.age IS NOT NULL
        GROUP BY 1 ORDER BY MIN(p.age)
    """)
    gender_sql = text(f"""
        SELECT p.gender, COUNT(*) AS n
        {base} AND p.gender IS NOT NULL
        GROUP BY p.gender ORDER BY n DESC
    """)
    district_sql = text(f"""
        SELECT c.district AS district, COUNT(*) AS n
        {base} AND c.district IS NOT NULL
        GROUP BY c.district ORDER BY n DESC LIMIT 10
    """)
    age_rows  = (await session.execute(age_sql, params)).mappings().all()
    gen_rows  = (await session.execute(gender_sql, params)).mappings().all()
    dist_rows = (await session.execute(district_sql, params)).mappings().all()
    return SocioDemographicsResponse(
        age_buckets=[AgeBucket(bucket=r["bucket"], count=int(r["n"])) for r in age_rows],
        gender=[GenderCount(gender=r["gender"], count=int(r["n"])) for r in gen_rows],
        districts=[DistrictCount(district=r["district"], count=int(r["n"])) for r in dist_rows],
    )
```

> Note: this now reports the district *of the case*, which is what a crime-demographics view should show. If you specifically want the person's home district, swap `c.district` for `p.district` in `district_sql` only.

---

## 🔴 D2 — PS4 Socio-Correlation fabricates indicators instead of using the real seeded table

**File:** `backend/app/services/intelligence_service.py` → `get_socio_correlation()`

**Proof:** The table `district_socio_economic_indicators` **exists and is seeded with 41 rows** (`db/models.py:175`, `seed/load_new_tables.py`, `seed/load_seed.sql`) with real `literacy_rate`, `urbanization_percent`, `income_index`. Yet the service **ignores it** and invents values positionally:

```python
literacy_rate=round(85 - i * 1.2, 1),
urbanization_percent=round(92 - i * 2.1, 1),
income_index=round(0.74 - i * 0.02, 2),
```

and returns **hardcoded** correlation constants (`-0.21`, `0.43`, `0.12`). For a challenge explicitly judged on **Explainable AI / real KSP data**, presenting invented socio-economic numbers and fake correlation coefficients is a critical authenticity failure.

**Fix — replace the whole function** to join the real table and compute Pearson correlations in SQL:

```python
async def get_socio_correlation(session: AsyncSession) -> SocioCorrelationResponse:
    # Real join: per-district crime counts x seeded socio-economic indicators.
    sql = text("""
        WITH crime AS (
            SELECT district, COUNT(*)::float AS crime_count
            FROM cases WHERE district IS NOT NULL
            GROUP BY district
        )
        SELECT cr.district,
               cr.crime_count,
               s.literacy_rate,
               s.urbanization_percent,
               s.income_index
        FROM crime cr
        JOIN district_socio_economic_indicators s ON s.district = cr.district
        ORDER BY cr.crime_count DESC
    """)
    rows = (await session.execute(sql)).mappings().all()

    scatter = [
        CorrelationPoint(
            district=r["district"],
            crime_rate=round(float(r["crime_count"]) / 10.0, 1),
            literacy_rate=r["literacy_rate"],
            urbanization_percent=r["urbanization_percent"],
            income_index=r["income_index"],
        )
        for r in rows
    ]

    def _pearson(xs: list[float], ys: list[float]) -> float | None:
        pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
        n = len(pairs)
        if n < 3:
            return None
        sx = sum(p[0] for p in pairs); sy = sum(p[1] for p in pairs)
        sxx = sum(p[0] ** 2 for p in pairs); syy = sum(p[1] ** 2 for p in pairs)
        sxy = sum(p[0] * p[1] for p in pairs)
        denom = ((n * sxx - sx * sx) * (n * syy - sy * sy)) ** 0.5
        if denom == 0:
            return None
        return round((n * sxy - sx * sy) / denom, 2)

    crime = [p.crime_rate for p in scatter]
    lit   = [p.literacy_rate for p in scatter]
    urb   = [p.urbanization_percent for p in scatter]
    inc   = [p.income_index for p in scatter]

    return SocioCorrelationResponse(
        scatter=scatter,
        correlations=Correlations(
            crime_rate_vs_literacy=_pearson(crime, lit),
            crime_rate_vs_urbanization=_pearson(crime, urb),
            crime_rate_vs_income=_pearson(crime, inc),
        ),
    )
```

> The `Correlations` model and `district_socio_economic_indicators` columns already match these field names, so no schema change is needed.

---

## 🟠 D3 — PS3 Trends "QoQ %" delta is not quarter-over-quarter

**File:** `backend/app/services/intelligence_service.py` → `get_trends()`

**Proof:** The series is grouped by `(period, crime_type, district)` and ordered `period DESC, cnt DESC`. The delta then does:

```python
curr = sum(s.count for s in series[:len(series)//2])
prev = sum(s.count for s in series[len(series)//2:]) or 1
deltas.qoq_percent = round((curr - prev) / prev * 100, 1)
```

This splits a mixed crime_type/district list **by list index**, not by time period — so the "QoQ %" shown to judges is meaningless, and `yoy_percent` is never computed.

**Fix — replace the delta block** (everything after `series = [...]` to the `return`) with a period-aware computation:

```python
    # Real period-over-period deltas: collapse to one count per period first.
    from collections import OrderedDict
    per_period: "OrderedDict[str, int]" = OrderedDict()
    for s in series:
        per_period[s.period] = per_period.get(s.period, 0) + s.count
    ordered = sorted(per_period.items())  # ascending by 'YYYY-MM'

    deltas = TrendDeltas()
    if len(ordered) >= 2:
        curr = ordered[-1][1]
        prev = ordered[-2][1] or 1
        deltas.qoq_percent = round((curr - prev) / prev * 100, 1)
    if len(ordered) >= 13:
        curr = ordered[-1][1]
        year_ago = ordered[-13][1] or 1
        deltas.yoy_percent = round((curr - year_ago) / year_ago * 100, 1)
    return TrendsResponse(series=series, deltas=deltas)
```

---

## 🟠 D4 — PS3 Seasonal: fabricated "lift %" and silent filter defaulting

**File:** `backend/app/services/intelligence_service.py` → `get_seasonal()`

**Proof:** Two problems:
1. `lift_percent=round(float(r["cnt"]) / 10, 1)` — "lift" is just `count/10`, not a lift versus a baseline month.
2. It forces `ct = crime_type or "Theft"` and `d = district or "Bengaluru City"`, so an **unfiltered** seasonal call silently narrows to Theft in Bengaluru without telling the caller.

**Fix — replace the whole function** to compute true monthly lift vs the per-combo monthly average, and only default the *display label* (not a hidden filter):

```python
async def get_seasonal(
    session: AsyncSession,
    crime_type: str | None = None,
    district: str | None = None,
) -> SeasonalResponse:
    where = ["report_date IS NOT NULL"]
    params: dict = {}
    if crime_type:
        where.append("crime_type ILIKE :ct"); params["ct"] = f"%{crime_type}%"
    if district:
        where.append("district ILIKE :d");   params["d"]  = f"%{district}%"
    w = " AND ".join(where)

    sql = text(f"""
        WITH monthly AS (
            SELECT EXTRACT(MONTH FROM report_date)::int AS mon_n,
                   to_char(report_date, 'Month')        AS mon,
                   COUNT(*)                              AS cnt
            FROM cases WHERE {w}
            GROUP BY 1, 2
        ),
        avg_cte AS (SELECT AVG(cnt) AS avg_cnt FROM monthly)
        SELECT m.mon, m.mon_n, m.cnt,
               CASE WHEN a.avg_cnt > 0
                    THEN round((m.cnt / a.avg_cnt - 1.0) * 100)
                    ELSE 0 END AS lift_pct
        FROM monthly m, avg_cte a
        WHERE m.cnt > a.avg_cnt
        ORDER BY m.cnt DESC LIMIT 3
    """)
    rows = (await session.execute(sql, params)).mappings().all()
    peaks = [
        SeasonalPeak(
            period=r["mon"].strip(),
            lift_percent=float(r["lift_pct"] or 0),
            recommended_action=f"Increase patrols during {r['mon'].strip()}",
        )
        for r in rows
    ]
    return SeasonalResponse(
        crime_type=crime_type or "All crime types",
        district=district or "All districts",
        seasonal_peaks=peaks,
    )
```

---

## 🔴 D5 — Confirmation: demo-mode echo corrupts EVERY chat lane, not just SQL

**File:** `backend/app/pipeline/orchestrator.py` → `_compose()` (and `tools/text_to_sql.py` → `generate_sql()`)

**Proof (extends `SATYAM_CHAT_NO_DATA_FIX.md`):** Every lane — `sql_query`, `narrative_search`, `hotspot`, `network`, `report`, `smalltalk` — ends by calling `_compose()`, which calls `get_llm(brain_engine).complete(...)`. In the shipped `.env.example` **no API keys are set**, so `demo_mode` is true and the LLM stubs return a literal echo like `[demo:gemini] Question: ...`. Therefore in a default checkout:
- SQL lane: echo fails `json.loads` → `sanitize()` raises `UnsafeSQL` → `context="[]"` → "found no matching records."
- All other lanes: the user sees the raw `[demo:...]` echo instead of an answer.

This is the project-wide form of the chat bug. The complete remedy has **three parts**, all inlined below so this document is fully self-contained (these are the same fixes summarized in `SATYAM_CHAT_NO_DATA_FIX.md`). Every path still ends in `sanitize()` (single `SELECT`, allow-listed tables, forced `LIMIT`) and still runs on the RLS-stamped session, so safety and masking are unchanged.

> The key operational step: **set a real `GEMINI_API_KEY` or `GROQ_API_KEY` in `.env` for the demo.** The fixes below additionally make the system answer from data even when no key is present or the model is rate-limited.

### D5.1 — New file: `backend/app/pipeline/tools/rule_sql.py`

A small rule-based generator that produces a real, runnable, guarded `SELECT` for the common crime-DB questions, with fuzzy `ILIKE` location matching. It runs when (a) demo mode, (b) the LLM produced unparseable/unsafe SQL, or (c) the LLM SQL returned 0 rows.

```python
"""Deterministic, keyless NL->SQL fallback for the chat SQL lane.

Used when (a) the app is in demo_mode (no model keys), (b) the LLM returned
unparseable/unsafe SQL, or (c) the LLM SQL returned zero rows. Produces a
SINGLE read-only SELECT over the allow-listed tables only, then passes it
through sql_guard.sanitize() so the same safety rules apply.

Matching philosophy: be forgiving. Use ILIKE substring matching on the most
specific place token so 'Mysuru City' matches 'Mysuru', 'Bengaluru' matches
'Bengaluru City', and 'Cyber Crime Police Station' matches a station_name
containing 'Cyber'.
"""
from __future__ import annotations

import re

from app.pipeline.tools.sql_guard import UnsafeSQL, sanitize

# Words that are never a useful place/crime token.
_GENERIC = {
    "city", "rural", "urban", "district", "range", "police", "station", "ps",
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
}

_CASE_COLUMNS = (
    'fir_number, fir_year, crime_type, status, station_name, district, '
    '"range", incident_date, report_date'
)


def _q(value: str) -> str:
    """Quote a string literal for inline SQL (defensive; also re-guarded later)."""
    cleaned = re.sub(r"[^A-Za-z0-9 .,&/_-]", "", value).strip()
    return "'" + cleaned.replace("'", "''") + "'"


def _tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-z]+", text.lower()) if w not in _GENERIC and len(w) > 2]


def _extract_place(question: str, slots: dict) -> str | None:
    # Prefer explicit slots from the router.
    for key in ("district", "range_name", "station", "place"):
        v = (slots or {}).get(key)
        if v:
            return str(v)
    # Otherwise: capture the phrase after a locative preposition.
    m = re.search(r"\b(?:in|at|near|around|for|of)\s+([A-Za-z][A-Za-z .]+)", question, re.I)
    if not m:
        return None
    phrase = m.group(1)
    toks = _tokens(phrase)
    if not toks:
        return None
    # Use the longest specific token (most discriminating).
    return max(toks, key=len)


def _crime_value(question: str, slots: dict) -> str | None:
    v = (slots or {}).get("crime_type")
    if v:
        return str(v)
    ql = question.lower()
    for kw, val in _CRIME_HINTS.items():
        if kw in ql:
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
    crime = _crime_value(question, slots)
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
```

### D5.2 — Edit `backend/app/pipeline/tools/text_to_sql.py`

**(a) Add imports** near the top (after the existing `from app.pipeline.tools.sql_guard import ...` line):

```python
from app.config import get_settings
from app.pipeline.tools.rule_sql import build_sql as build_rule_sql
```

**(b) Replace the whole `generate_sql` function** with:

```python
async def generate_sql(
    question: str,
    slots: dict | None = None,
    *,
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> str:
    # Keyless / demo mode: the model stubs only echo, so skip them entirely and
    # use the deterministic rule-based generator (still guarded by sanitize()).
    if get_settings().demo_mode:
        rule = build_rule_sql(question, slots)
        if rule:
            return rule

    llm = get_sql_llm(sql_engine)
    prompt = question if not slots else f"{question}\n\nKnown filters: {json.dumps(slots)}"
    try:
        raw = await llm.complete(prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA)
    except Exception:
        # Gemini 429 / timeout -> fall back to Groq for SQL generation
        from app.models.registry import get_fallback_llm
        raw = await get_fallback_llm().complete(
            prompt, system=SQL_SYSTEM, temperature=0.0, json_schema=SQL_SCHEMA
        )

    cleaned = _strip_markdown_fences(raw)
    try:
        candidate = json.loads(cleaned).get("sql", "")
    except Exception:
        candidate = cleaned

    try:
        return sanitize(candidate)
    except UnsafeSQL:
        # LLM produced junk (or an echo). Recover deterministically.
        rule = build_rule_sql(question, slots)
        if rule:
            return rule
        raise
```

**(c) Replace `answer_with_sql`** with a version that retries deterministically when the LLM SQL returns 0 rows:

```python
async def answer_with_sql(
    session: AsyncSession,
    question: str,
    slots: dict | None = None,
    *,
    principal: "Principal",
    sql_engine: Literal["gemini", "qwen3-coder-next"] | None = None,
) -> tuple[str, list[dict]]:
    """Return (safe_sql, masked_rows). Raises UnsafeSQL if no usable SQL exists."""
    sql = await generate_sql(question, slots, sql_engine=sql_engine)
    rows = await run_sql(session, sql)

    # 0-row recovery: try the deterministic generator (fuzzy ILIKE) once.
    if not rows:
        rule = build_rule_sql(question, slots)
        if rule and rule.strip() != sql.strip():
            rule_rows = await run_sql(session, rule)
            if rule_rows:
                sql, rows = rule, rule_rows

    return sql, _mask_rows(rows, principal)
```

### D5.3 — Edit `backend/app/pipeline/orchestrator.py` (grounded answer without an LLM)

With D5.1/D5.2 demo mode now returns rows, but `_compose` would still hand them to the echo stub. This renders a clean Markdown answer with **no LLM** when keyless, leaving the real-LLM path untouched.

**(a) Add an import** at the top (with the other imports):

```python
from app.config import get_settings
```

**(b) Add a renderer** just above `async def _compose(`:

```python
def _render_grounded(question: str, context: str) -> str:
    """Deterministic, no-LLM answer used in demo/keyless mode."""
    try:
        data = json.loads(context)
    except Exception:
        data = None

    # Help / report / note payloads.
    if isinstance(data, dict):
        if "help" in data:
            return ("I can answer questions over the crime database. Try: "
                    "“top crime types in Bengaluru City”, “how many theft cases this year”, "
                    "or “list recent cases in Mysuru”.")
        if "note" in data:
            return str(data["note"])
        if "nodes" in data:
            return f"Network built: {len(data.get('nodes', []))} nodes, {len(data.get('edges', []))} links. Open the Network panel to explore."
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
    more = "" if len(rows) <= 10 else f"\n\nShowing 10 of {len(rows)} — ask to narrow by date, status, or crime type."
    return f"Found {len(rows)} matching record(s).\n\n{header}\n{sep}\n" + "\n".join(body) + more
```

**(c) Make `_compose` use it in demo mode** — add these two lines as the **first** lines inside `_compose` (before the `lang_directive` block):

```python
    if get_settings().demo_mode:
        return _render_grounded(question, context)
```

Result: keyless mode now produces a real, grounded, tabular answer for every supported intent — no API keys required. (For full DB seeding and a `/health/data` row-count endpoint, see sections 5–6 of `SATYAM_CHAT_NO_DATA_FIX.md`.)

---

## 🟠 D6 — Console reports "couldn't reach the backend" for empty/blocked answers

**File:** `frontend/src/routes/console.tsx` → `sendMessage()`

**Proof:** After a successful stream:

```js
if (streamError || !acc.trim()) {
  cannedFallback();   // "I couldn't reach the backend just now..."
  return;
}
```

If the backend legitimately returns a `blocked` event (RBAC) or an empty token stream, `acc` is empty and the user is told the **backend is unreachable** — which is false and masks the real cause (permission / no-data). The `blocked` flag is computed but not consulted here.

**Fix — replace that block** so blocked/empty are distinguished from a transport failure:

```js
    if (streamError) {
      cannedFallback();
      return;
    }
    if (blocked) {
      // 'acc' already holds the restricted-access notice set in the handler.
      const finalMessages = [...baseMessages, { role: "ai", text: acc } as ChatMessage];
      setMessages(finalMessages);
      persistMessages(finalMessages);
      setStreamingIdx(null);
      return;
    }
    if (!acc.trim()) {
      const empty = t("No results matched your query. Try a broader question or different filters.");
      const finalMessages = [...baseMessages, { role: "ai", text: empty } as ChatMessage];
      setMessages(finalMessages);
      persistMessages(finalMessages);
      setStreamingIdx(null);
      speak(empty, opts);
      return;
    }
```

---

## 🟡 D7 — Audit `user_id` is populated from a confusingly-named claim (latent)

**Files:** `backend/app/api/routes/auth.py`, `backend/app/services/chat_service.py`, `backend/app/api/routes/intelligence.py`, `backend/app/core/audit.py`

**Proof / current status:** `audit_log.user_id` is an FK to `users.user_id`. Callers write `write_audit(..., user_id=principal.officer_id)`. This works **only because** `auth.login()` mints the token with `officer_id=user_id` (i.e. the claim named `officer_id` actually carries `users.user_id`). So it is **not** currently a crash or FK violation — but the naming is a trap: any future code that treats `principal.officer_id` as a real `officers.officer_id` (e.g. to join `officers`) will silently use the wrong key.

**Recommended (non-urgent) fix:** carry both claims explicitly. In `create_access_token` / `Principal`, add a distinct `user_id` field and set `officer_id` to the *actual* officer id. Then change audit writes to `user_id=principal.user_id`. If you don't want to touch the token now, **leave as-is** (it is correct today) but add a comment at each `write_audit` call:

```python
# NOTE: principal.officer_id currently carries users.user_id (see auth.login).
# audit_log.user_id is FK -> users.user_id, so this is correct. Do NOT use
# principal.officer_id to join the officers table.
```

---

## 🟡 D8 — Forecast patrol windows never reflect real incident time

**File:** `backend/app/services/intelligence_service.py` → `get_forecast_alerts()`

**Proof:** `avg_hour` is computed as `AVG(EXTRACT(HOUR FROM c.report_date::timestamptz))`. `report_date` is a **DATE** (`db/models.py`), so the hour is always `0`; `AVG` → `0.0`, which is falsy, so the code falls back to the hardcoded `18.0`. Net effect: **every** patrol window is `18:00–20:00` regardless of data — even though a real `incident_time` TEXT column exists on `cases` (`models.py:76`).

**Fix — use `incident_time` when present.** Replace the `avg_hour` expression in the `stats` CTE:

```sql
                AVG(
                    CASE
                        WHEN c.incident_time ~ '^[0-2]?[0-9]:'
                        THEN split_part(c.incident_time, ':', 1)::int
                        ELSE NULL
                    END
                ) AS avg_hour
```

The Python `avg_hour = float(r["avg_hour"] or 18.0) if r["avg_hour"] else 18.0` line then keeps 18:00 only when no parseable times exist, and otherwise reflects the real peak hour.

---

## 🟡 D9 — `similar_cases/search` silently returns "similar to case #1" on no match

**File:** `backend/app/api/routes/intelligence.py` → `similar_cases_search()`

**Proof:**

```python
r = (await session.execute(sql, {"q": f"%{req.query}%"})).mappings().first()
cid = int(r["case_id"]) if r else 1   # <- arbitrary fallback
return await svc.get_similar_cases(session, cid, limit=req.limit)
```

Uses `ORDER BY RANDOM() LIMIT 1` and, when nothing matches the query text, falls back to `case_id = 1` — so the user gets cases "similar to" an unrelated case with no indication the search failed.

**Fix — return an empty result instead of a bogus anchor:**

```python
    r = (await session.execute(sql, {"q": f"%{req.query}%"})).mappings().first()
    if not r:
        return SimilarCasesResponse(case_id=0, matches=[])
    return await svc.get_similar_cases(session, int(r["case_id"]), limit=req.limit)
```

(Also consider `ORDER BY (crime_type ILIKE :q) DESC, case_id DESC` instead of `RANDOM()` for deterministic anchoring.)

---

## Items explicitly verified as SOUND in this pass (not bugs)

So you don't re-investigate them:

- **RLS** (`db/rls.py` `fn_scope_ok`, `apply_rls_context` GUCs + `statement_timeout`) — correct; scope hierarchy state→range→district→station resolves properly.
- **Masking** (`core/masking.py` tiers L1–L4) and the SQL-lane masking (`text_to_sql._mask_rows`) — consistent and correct.
- **RBAC** (`core/rbac.py` rank→scope/clearance; DGP→state/L4) — correct; `intelligence._guard` clearance gates are sensible.
- **Auth demo geo** (`_BLR = Bengaluru City / Commissionerates`) — matches seeded data (this was a prior fix; still correct).
- **SQL guard** (`tools/sql_guard.py` single-SELECT, `ALLOWED_TABLES`, `MAX_LIMIT`) — correct.
- **Audit hash-chain** (`core/audit.py` genesis + `_digest(prev+canonical)`) — correct and tamper-evident.
- **Voice TTS/STT stack** (`lib/voice/tts.ts`, `api/client.ts`, `routes/voice.py`, Sarvam/Google providers) — graceful browser fallback; EBML header detection works (the `b"webm"` magic-byte branch is dead but harmless).
- **Network/analytics graph builders** (`tools/analytics.py`, `services/network_service.py`) — match `schemas/network.py` (`GraphEdge.label` optional); no shape mismatch.
- **Forecast hotspots / alerts / backtest SQL** — uses `MAX(report_date)` as the reference date (correct for synthetic data); HAVING/percentile logic valid.
- **Intelligence response models** — all required fields are supplied or have defaults; no 500-risk from missing `notice`/`fairness_note` (they default).

---

## Fix-priority order (recommended)

1. **D5** + the two `SATYAM_CHAT_NO_DATA_FIX.md` fixes — restores the headline chatbot feature.
2. **D2** — real socio-economic data (Explainable-AI authenticity; judges will check).
3. **D1** — make PS4 filters work.
4. **D6** — stop false "backend unreachable" messages.
5. **D3, D4** — correct the trend/seasonal metrics.
6. **D8, D9, D7** — polish / latent hardening.

---

*Generated by a senior-review deep scan pass. Every code block above is a copy-paste replacement for the named function/block.*
