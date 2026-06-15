# Satyam — Verified Bug Report & Exact Fixes (v2, corrected)

> This file REPLACES the previous report. Every item below was re-verified by reading the
> raw source bytes. **4 bugs from the first report were FALSE POSITIVES** (see the bottom
> section) — do NOT apply those old "fixes"; they would break working code.

Format: File → Problem → **FIND** (exact text) → **REPLACE WITH** (exact text).

---

## ✅ CONFIRMED BUGS — apply these

---

### BUG-A 🔴 CRASH — `docker-compose.yml` + migrations: wrong schema is auto-applied

**This is the most important one.** `docker-compose.yml` mounts ONLY `001_init.sql` into the
Postgres init dir:
```yaml
      - ./backend/migrations/001_init.sql:/docker-entrypoint-initdb.d/001_init.sql:ro
```
But `001_init.sql` is the **v1 schema**: table `cases` uses `fir_no`, and `audit_log` has
columns `id, ts, actor, role, action, resource, detail, prev_hash, hash`.

The entire application — `app/db/models.py`, `app/core/audit.py`, `app/services/*` — expects
the **v2 schema** in `002_schema_v2.sql`: `cases.fir_number`, and
`audit_log(audit_id, at, user_id, case_id, reason, query_text, generated_sql, prev_hash, row_hash)`.

Nothing in the Docker flow applies `002_schema_v2.sql`, so on a fresh `docker compose up` the
backend talks to v1 tables and **every query fails** (`column cases.fir_number does not exist`,
`audit_log.audit_id does not exist`, etc.).

**FIX:** Apply the v2 schema at init. Replace the mount line in `docker-compose.yml`:

**FIND:**
```yaml
      - ./backend/migrations/001_init.sql:/docker-entrypoint-initdb.d/001_init.sql:ro
```

**REPLACE WITH:**
```yaml
      - ./backend/migrations/002_schema_v2.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro
```
(Use `002_schema_v2.sql` as the single source of truth. If you still need the RLS policies /
`persons_v` grants that live only in `001_init.sql`, fold them into `002_schema_v2.sql` so one
file builds the whole v2 DB. Do not run both files as-is — `001` builds v1 tables that conflict
with v2.)

---

### BUG-B 🔴 CRASH — `backend/app/services/report_service.py` — `principal.role.value`

`Principal.role` is a `@property` that returns `self.rank` — a plain `str`. Calling `.value`
on a `str` raises `AttributeError`, crashing every `POST /reports` request.

**FIND:**
```python
         "prepared_by": principal.name, "role": principal.role.value}
```

**REPLACE WITH:**
```python
         "prepared_by": principal.name, "role": principal.rank}
```

---

### BUG-C 🔴 WRONG — `backend/app/services/report_service.py` — str case IDs vs int param

`ReportRequest.case_ids` is `list[str]`, but `case_service.get_case(session, principal, case_id: int)`
compares `Case.case_id == case_id` (an integer PK). Passing a `str` matches nothing, so every
case silently returns `None` and the report renders with zero cases.

**FIND:**
```python
    for fir in req.case_ids:
        case = await case_service.get_case(session, principal, fir)
        if case:
            sections.append({"type": "case", "data": case})
```

**REPLACE WITH:**
```python
    for fir in req.case_ids:
        try:
            case = await case_service.get_case(session, principal, int(fir))
        except (ValueError, TypeError):
            continue
        if case:
            sections.append({"type": "case", "data": case})
```

---

### BUG-D 🟠 DATA — `backend/app/services/chat_service.py` — audit log not attributed to user

`write_audit(...)` is called without `user_id`, so every chat query is stored with
`user_id = NULL`. The correct value is `principal.officer_id` (an `int | None` field that maps to
`users.user_id` — confirmed in `deps.py` and the `AuditLog.user_id` FK). Note: do NOT use
`int(principal.id)` — `principal.id` is the JWT subject string (e.g. `"demo-PI"`), not an int.

**FIND:**
```python
    await write_audit(
        session,
        action="chat.query",
        query_text=message[:500],
    )
```

**REPLACE WITH:**
```python
    await write_audit(
        session,
        action="chat.query",
        user_id=principal.officer_id,
        query_text=message[:500],
    )
```

---

### BUG-E 🟠 UI — `frontend/src/routes/audit.tsx` — maps fields the API never returns

The `GET /audit` endpoint returns each entry as:
`{ id, ts, action, case_id, reason, query_text, generated_sql, hash }`.
There is **no `actor`, `role`, `detail`, or `resource`**. The current mapping reads exactly those
missing fields, so once the live API is wired in, User / Role / Query / Result all show `—`.

**FIND:**
```tsx
          u: e.actor ?? "\u2014",
          role: e.role ?? "\u2014",
          action: "ALLOW",
          query: e.detail ?? e.action ?? "",
          result: e.resource ?? "",
          src: e.action ?? "audit_log",
```

**REPLACE WITH:**
```tsx
          u: e.user_id != null ? `user:${e.user_id}` : "\u2014",
          role: "\u2014",
          action: String(e.action ?? "").toUpperCase().includes("DENY") ? "DENY" : "ALLOW",
          query: e.query_text ?? e.generated_sql ?? e.action ?? "",
          result: e.reason ?? (e.case_id != null ? `case #${e.case_id}` : ""),
          src: e.action ?? "audit_log",
```

---

### BUG-F 🟡 TYPE — `frontend/src/lib/api/client.ts` — `SessionUser` type is stale (v1)

The backend `/auth/login` and `/auth/me` now return
`{ id, name, rank, scope, clearance, station_id, district, range_name }`. The frontend type
still declares `role: Role` and `jurisdiction_id`, neither of which the backend sends — so
`user.role`, `user.clearance`, `user.scope` are wrong/undefined at runtime.

**FIND:**
```typescript
export type Role = "admin" | "investigator" | "analyst" | "viewer";

export type SessionUser = {
```
(...the existing `role: Role;` and `jurisdiction_id?: string | null;` block...)

**REPLACE the whole `SessionUser` type WITH:**
```typescript
export type Role = "admin" | "investigator" | "analyst" | "viewer";

export type SessionUser = {
  id: string;
  name: string;
  rank: string;
  scope: "state" | "range" | "district" | "station";
  clearance: 1 | 2 | 3 | 4;
  station_id?: number | null;
  district?: string;
  range_name?: string;
};
```

And update the login call to send `rank` (the backend accepts `role` only as a legacy alias):

**FIND:**
```typescript
  async login(username: string, role?: Role): Promise<{ token: string; user: SessionUser }> {
    const out = await request<{ token: string; user: SessionUser }>("/auth/login", {
```
**REPLACE WITH:**
```typescript
  async login(username: string, rank?: string): Promise<{ token: string; user: SessionUser }> {
    const out = await request<{ token: string; user: SessionUser }>("/auth/login", {
```
and in the same method change `body: JSON.stringify({ username, role })` to
`body: JSON.stringify({ username, rank })`.

---

### BUG-G 🟡 ORM — `backend/app/db/models.py` — `fir_number` unique mismatch

ORM declares `fir_number` as `unique=True`, but `002_schema_v2.sql` defines it as
`fir_number TEXT NOT NULL` (no UNIQUE — correct, FIR numbers repeat across station/year). The
mismatch makes Alembic autogenerate a spurious UNIQUE index that breaks seed loading.

**FIND:**
```python
    fir_number: Mapped[str] = mapped_column(Text, unique=True)
```

**REPLACE WITH:**
```python
    fir_number: Mapped[str] = mapped_column(Text)  # not globally unique (repeats per station/year)
```

---

### BUG-H 🟡 SDK — `backend/app/models/api/sarvam.py` — TTS model version mismatch

The module docstring and project spec lock TTS to **Bulbul v3**, and STT already uses
`saaras:v3`, but the TTS body still sends `"model": "bulbul:v1"`.

**FIND:**
```python
                    "model": "bulbul:v1",
```

**REPLACE WITH:**
```python
                    "model": "bulbul:v3",
```

---

## ⚠️ Review item (not a hard bug)

- **`backend/app/pipeline/tools/sql_guard.py` docstring is stale.** It says the Text-to-SQL lane
  "only ever sees `persons_v`", but v2 deliberately switched to querying `persons` directly with
  masking at the API layer (see `prompts.py`: *"persons_v replaced by direct persons table"*).
  The `ALLOWED_TABLES` list (`persons`, not `persons_v`) is therefore CORRECT for v2 — only the
  comment is outdated. **However**, confirm that rows returned by the free-form Text-to-SQL lane
  (`text_to_sql.run_sql`) actually pass through masking for low-clearance users, since the
  in-DB masking view `persons_v` is no longer used. If they don't, low-clearance users could read
  unmasked `persons.name` via chat SQL. Worth a manual check of the orchestrator.

---

## ❌ RETRACTED — these were FALSE POSITIVES in the first report (do NOT "fix")

The first report claimed corrupted `style=`/`value=` placeholders in four spots. After reading the
raw file bytes, these are all **valid JSX** and were only display artifacts in the earlier scan.
Leave them exactly as they are:

| Old bug | File | Reality |
|---|---|---|
| 01 | `frontend/src/routes/login.tsx` | `style= backgroundImage: "...", backgroundSize: "80px 80px" ` — valid ✅ |
| 02 | `frontend/src/routes/map.tsx` | `style= background: "linear-gradient(...)" ` and `style= left: x, top: y ` — valid ✅ |
| 03 | `frontend/src/lib/i18n.tsx` | `<I18nCtx.Provider value= lang, setLang, t >` — valid ✅ |
| 11 | `backend/migrations/001_init.sql` | `audit_log_id_seq` IS correct: in `001` the PK column is `id BIGSERIAL`. The real problem is the schema-version mismatch — see **BUG-A**. |

---

## Summary

| # | Severity | File | Fix |
|---|---|---|---|
| A | 🔴 CRASH | `docker-compose.yml` / migrations | Apply `002_schema_v2.sql` at init, not `001` |
| B | 🔴 CRASH | `report_service.py` | `principal.role.value` → `principal.rank` |
| C | 🔴 WRONG | `report_service.py` | cast case id with `int(fir)` |
| D | 🟠 DATA | `chat_service.py` | pass `user_id=principal.officer_id` to `write_audit` |
| E | 🟠 UI | `audit.tsx` | map real API fields (`user_id`, `query_text`, `reason`, `case_id`) |
| F | 🟡 TYPE | `client.ts` | replace stale `SessionUser` (`role`) with `rank/scope/clearance/...` |
| G | 🟡 ORM | `db/models.py` | remove `unique=True` on `fir_number` |
| H | 🟡 SDK | `sarvam.py` | `bulbul:v1` → `bulbul:v3` |


---

# ROUND 2 — DEEPER BUG SCAN (pipeline / analytics / seed / masking)

These are **5 NEW confirmed bugs** found after auditing the orchestrator, router,
slots, guardrails, analytics, RAG, services, RLS, masking, seed loaders, and the
text-to-SQL executor. They are SEPARATE from the 8 bugs above. All verified
against raw source bytes.

---

## BUG R1 — Chat SQL citations are always empty (`fir_no` vs `fir_number`)
**Severity: Medium** | **File: `backend/app/pipeline/orchestrator.py` (lines ~104-105)**

The SQL lane builds citations from `fir_no`, but the v2 schema and the SQL prompt
(`prompts.py` SQL_SYSTEM) only ever produce `fir_number`. So `r.get("fir_no")`
is always `None`, the `if r.get("fir_no")` filter drops every row, and SQL-query
answers never get any [ref] citations.

**Find:**
```python
                citations = [{"ref": r.get("fir_no", str(i)), "label": "case"}
                             for i, r in enumerate(rows[:5]) if r.get("fir_no")]
```
**Replace:**
```python
                citations = [{"ref": r.get("fir_number", str(i)), "label": "case"}
                             for i, r in enumerate(rows[:5]) if r.get("fir_number")]
```

---

## BUG R2 — `seed/seed.py` is entirely the OLD v1 schema (will crash)
**Severity: High (if used)** | **File: `backend/seed/seed.py`**

This legacy seeder still targets v1 columns that no longer exist in
`002_schema_v2.sql`. Every INSERT will fail:
- `stations(station_id, name, zone, district, lat, lng)` — v2 is `station_name, district, range, latitude, longitude` (no `name`, `zone`, `lat`, `lng`).
- `persons(person_id, name, age, gender, role_type)` — v2 persons has no `role_type`.
- `cases(fir_no, date, ipc_sections, crime_type, status, station_id, lat, lng, district, zone, sensitivity_flag, jurisdiction_id)` — none of `fir_no`, `date`, `ipc_sections`, `lat`, `lng`, `zone`, `sensitivity_flag`, `jurisdiction_id` exist in v2.
- `narratives(case_id, text, embedding)` with `ON CONFLICT (case_id)` — v2 uses `narrative_id` PK + `body` + `language`, and `case_id` is NOT unique (en + kn rows per case), so the upsert is invalid.
- Docstring even says “Requires an applied 001_init.sql”.

**Fix (recommended):** delete this dead file so nobody runs it by mistake — the
canonical loader is `seed/load_seed.py` (v2, correct) + the synthetic CSV dataset:
```bash
git rm backend/seed/seed.py
```
Then seed with:
```bash
psql "$SEED_DATABASE_URL" -f backend/migrations/002_schema_v2.sql
python -m seed.load_seed            # or --local
```
(If you still want an ORM/embedding seeder, it must be rewritten to v2 columns:
`station_name/range/latitude/longitude`, `persons(person_id,name,gender,age,district)`,
`cases(... fir_number, sections, report_date, incident_date, latitude, longitude ...)`,
`narratives(narrative_id, case_id, language, body, embedding)`.)

---

## BUG R3 — Text-to-SQL lane BYPASSES PII masking (data-leak)
**Severity: HIGH (security/privacy)** | **Files: `backend/app/pipeline/tools/text_to_sql.py`, `backend/app/pipeline/orchestrator.py`**

`run_sql()` returns raw rows straight from the DB, and the orchestrator feeds them
directly into the answer context. RLS only enforces *jurisdiction* scope (which
rows) — it does NOT do column-level masking. The masking tiers in
`core/masking.py` are applied only in `case_service` (the structured `/cases`
endpoints), so a low-clearance officer (L1/L2) can ask the chat
“list victim names for POCSO cases in my district” and the SQL lane will return
**unmasked names/ages** that the same user would never see in the Case drawer.
The SQL prompt even says masking is “done in the API layer” — but for this lane it
never happens.

**Fix (minimal, concrete):** thread the principal through and mask PII columns
before the rows leave the lane.

In `text_to_sql.py`:
```python
from app.core.rbac import Principal

_PII_COLUMNS = {"name", "victim_name", "accused_name", "complainant", "io_name", "place_of_offence"}

def _mask_rows(rows: list[dict], principal: Principal) -> list[dict]:
    # L3+ (DySP/PI and above) see names; L1/L2 get masked PII.
    if principal.clearance >= 3:
        return rows
    from app.core.masking import _mask_str  # reuse the same bullet-masking
    out = []
    for r in rows:
        rr = dict(r)
        for col in list(rr):
            if col.lower() in _PII_COLUMNS and rr[col] is not None:
                rr[col] = _mask_str(rr[col])
        out.append(rr)
    return out

async def answer_with_sql(session, question, slots=None, *, principal: Principal, sql_engine=None):
    sql = await generate_sql(question, slots, sql_engine=sql_engine)
    rows = await run_sql(session, sql)
    return sql, _mask_rows(rows, principal)
```
In `orchestrator.py` (sql_query lane) pass the principal:
```python
                sql_used, rows = await answer_with_sql(
                    session, message, state.slots,
                    principal=principal, sql_engine=sql_engine,
                )
```
(Better long-term: also block `SELECT`ing raw `persons.name` in `sql_guard` for
low clearance, or expose a masked DB view to the runtime role.)

---

## BUG R4 — Network lane passes a person *name* into an integer `person_id`
**Severity: Medium** | **Files: `backend/app/pipeline/orchestrator.py` (~136-138), `backend/app/pipeline/tools/analytics.py` (`ego_network`)**

The router emits `slots.person` as a free-text string (e.g. “Ramesh Kumar”). The
orchestrator passes it as `person_id=person`, and `ego_network` only does
`int(person_id)` with a fallback to the raw string. `case_persons.person_id` is
`INTEGER`, so binding a name string makes Postgres raise
`invalid input syntax for type integer`, which bubbles up and triggers the
safety-fallback message. Network-by-name from chat never works.

**Fix:** resolve a name to an id inside `ego_network`. Replace:
```python
    try:
        pid = int(person_id)
    except (TypeError, ValueError):
        pid = person_id  # type: ignore[assignment]
    result = await session.execute(sql, {"pid": pid})
```
**with:**
```python
    try:
        pid = int(person_id)
    except (TypeError, ValueError):
        resolved = (
            await session.execute(
                text("SELECT person_id FROM persons WHERE name ILIKE :n ORDER BY person_id LIMIT 1"),
                {"n": str(person_id)},
            )
        ).scalar_one_or_none()
        if resolved is None:
            return [], []
        pid = resolved
    result = await session.execute(sql, {"pid": pid})
```

---

## BUG R5 — L2 masking injects a phantom `place_of_offence` onto every person
**Severity: Low (cosmetic / minor data clutter)** | **File: `backend/app/core/masking.py` (line ~77)**

In the L2 branch, the per-person loop sets
`p["place_of_offence"] = _mask_str(p.get("place_of_offence"))`. Person dicts have
no `place_of_offence` field (it’s a case-level field, masked separately on the
next line), so `p.get(...)` is `None` and this *adds* a spurious
`place_of_offence: "🔒 restricted"` key to each person in the response.

**Find (inside the `if principal.clearance < 3:` person loop):**
```python
            p["name"]            = _mask_str(p.get("name"))
            p["age"]             = None
            p["place_of_offence"] = _mask_str(p.get("place_of_offence"))
            p.setdefault("_masked", True)
```
**Replace with:**
```python
            p["name"]            = _mask_str(p.get("name"))
            p["age"]             = None
            p.setdefault("_masked", True)
```
(The case-level `out["place_of_offence"]` masking on the following line is correct
and stays.)

---

## Round 2 summary
| # | Severity | File | One-liner |
|---|----------|------|-----------|
| R1 | Medium | orchestrator.py | citations use `fir_no` → should be `fir_number` (always empty) |
| R2 | High* | seed/seed.py | entire file is v1 schema; crashes on v2 (delete; use load_seed.py) |
| R3 | **HIGH** | text_to_sql.py / orchestrator.py | chat SQL lane returns unmasked PII to low-clearance users |
| R4 | Medium | orchestrator.py / analytics.py | person name passed into int `person_id` → network-by-name crashes |
| R5 | Low | masking.py | L2 adds phantom `place_of_offence` to person dicts |

*R2 is high impact only if `seed.py` is actually run; `load_seed.py` is the correct path.

Verified clean (no bug): `core/audit.py` + `audit_log` DDL match exactly
(`audit_id`/`at`/`row_hash`/`prev_hash`); `rls.py`, `deps.py`, `security.py`,
`config.py`, `case_service.py`, `map_service.py`, and `load_seed.py` column lists
all match v2.


---

# ROUND 3 — VERY DEEP SCAN (security / infra / deployment)

Full audit of app wiring (`main.py`, `session.py`, `registry.py`, all model
adapters), the SQL guard, RBAC, auth, RLS policies, the v2 DDL, the embed job,
Docker, and the frontend API client. **3 new issues** — one is critical.

---

## BUG D1 — 🔴 CRITICAL: v2 migration drops ALL role/grant/RLS-enforcement provisioning
**Severity: CRITICAL (security + total breakage)** | **File: `backend/migrations/002_schema_v2.sql` (around lines 188-215)**

`001_init.sql` (v1) actually provisioned the security model:
```sql
CREATE ROLE satyam_app LOGIN PASSWORD 'satyam_app' NOSUPERUSER ...;
GRANT SELECT ON ... TO satyam_app;
GRANT SELECT, INSERT ON audit_log TO satyam_app;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;   -- + narratives, etc.
```
`002_schema_v2.sql` enables RLS and creates the policies, but **reduced the role
creation, GRANTs, and `FORCE ROW LEVEL SECURITY` to a comment block** (lines
213-215). Nothing actually runs. Meanwhile BOTH `docker-compose.yml` (line 34)
and `backend/.env.example` point the app at the **`satyam_app`** role. Two ways
this bites, both bad:

1. **App can't connect / permission denied.** On a clean v2 database the
   `satyam_app` role is never created and never granted anything, so the API
   gets `role "satyam_app" does not exist` or `permission denied for table cases`.
2. **If you work around it by connecting as the owner `satyam`, RLS is SILENTLY
   BYPASSED.** Postgres does not apply RLS policies to the table owner unless
   `FORCE ROW LEVEL SECURITY` is set — and v2 never sets it. Result: **every
   officer sees every district/range's cases**, defeating the entire
   jurisdiction-scoping security model (the policies look present but do nothing).

Also note: a v1→v2 sequence rename — the audit sequence is now
`audit_log_audit_id_seq` (v2 PK is `audit_id BIGSERIAL`), NOT `audit_log_id_seq`.

**Fix:** append this block to the END of `002_schema_v2.sql` (after the policies):
```sql
-- ===================== APP ROLE + GRANTS + FORCE RLS ========================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'satyam_app') THEN
    CREATE ROLE satyam_app LOGIN PASSWORD 'satyam_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO satyam_app;
GRANT SELECT ON stations, officers, cases, case_persons, narratives, persons,
                rank_access, users, v_officer_session TO satyam_app;
GRANT SELECT, INSERT ON audit_log TO satyam_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_audit_id_seq TO satyam_app;  -- NB: audit_id seq

-- Force RLS so even the table OWNER is subject to the jurisdiction policies.
ALTER TABLE cases        FORCE ROW LEVEL SECURITY;
ALTER TABLE narratives   FORCE ROW LEVEL SECURITY;
ALTER TABLE persons      FORCE ROW LEVEL SECURITY;
ALTER TABLE case_persons FORCE ROW LEVEL SECURITY;
```
(Combine with Round 1 Bug A: make sure `002_schema_v2.sql` is actually applied —
docker-compose only auto-runs `001_init.sql`. If you keep the compose init mount,
point it at `002_schema_v2.sql`, or run migrations explicitly via `make`.)

---

## BUG D2 — Vector search breaks on Neon (`halfvec` ops-class / cast mismatch)
**Severity: Medium (your documented Neon deployment)** | **Files: `backend/seed/embed_narratives.py` (~154), `backend/app/pipeline/tools/rag.py` (~27-35)**

DATABASE.md says the Neon free tier stores embeddings as `halfvec(1024)` (you
`ALTER ... TYPE halfvec(1024)` after load). But:
- `embed_narratives.py` builds the ANN index with `USING hnsw (embedding vector_cosine_ops)`. On a `halfvec` column that **must** be `halfvec_cosine_ops`, so the `CREATE INDEX` fails on Neon.
- `rag.py` queries `n.embedding <=> (:qvec)::vector`. Against a `halfvec` column pgvector has no `halfvec <=> vector` operator — it raises, the `except` swallows it, and RAG **silently falls back to the non-semantic lexical path** (`SELECT ... LIMIT k*3` with no ranking). Retrieval quality quietly collapses.

**Fix (make the vector type configurable):** add a setting (e.g. `vector_type: Literal["vector","halfvec"] = "vector"`) and use it in both places:
```python
# rag.py
vt = get_settings().vector_type            # "vector" | "halfvec"
sql = text(f"""
    SELECT n.case_id, n.body AS text,
           (n.embedding <=> (:qvec)::{vt}) AS distance
    FROM narratives n
    WHERE n.embedding IS NOT NULL
    ORDER BY n.embedding <=> (:qvec)::{vt}
    LIMIT :k
""")
```
```python
# embed_narratives.py
ops = "halfvec_cosine_ops" if get_settings().vector_type == "halfvec" else "vector_cosine_ops"
await conn.execute(
    f"CREATE INDEX IF NOT EXISTS idx_nar_embedding "
    f"ON narratives USING hnsw (embedding {ops})"
)
```
Also make the `embedding` UPDATE cast match (`$1::{vt}`). Set `VECTOR_TYPE=halfvec`
in the Neon env, `vector` locally.

---

## BUG D3 — Minor: translator ignores local backend + demo audit has no user
**Severity: Low** | **Files: `backend/app/models/registry.py` (`get_translator`), `backend/app/api/routes/auth.py` (`login`)**

- `get_translator()` resolves `backend or s.voice_backend` and never checks
  `model_backend == "local"` (unlike `get_stt`/`get_tts`), so it always calls a
  hosted provider even in fully-local mode. There's no local translator class, so
  in `MODEL_BACKEND=local` with no keys, translation hits demo/empty instead of a
  local lane. Low impact, but inconsistent with the other voice resolvers.
- Demo `login` never sets `officer_id` on the token. So even after fixing the
  chat audit (Round 2 Bug D → `user_id=principal.officer_id`), demo sessions still
  write `audit_log.user_id = NULL`. For real attribution, map the demo username to
  a `users.user_id`/`officers.officer_id` (or read `v_officer_session`) and pass
  `officer_id` into `create_access_token`.

---

## Reconfirmed by this pass (already listed above — not new)
- **R3 (HIGH, PII):** `sql_guard.py`'s own docstring claims the SQL lane is pointed at a masked `persons_v` view “never the raw persons PII table” — but `ALLOWED_TABLES` contains raw `persons` and v2 has no `persons_v`. The documented protection does not exist. Fix per R3.
- **Round-1 Bug E:** `/audit` returns `{id, ts, action, case_id, reason, query_text, generated_sql, hash}`; `audit.tsx` maps `actor/role/detail/resource` — confirmed mismatch.
- **Round-1 Bug 06 / R-F:** `client.ts` `SessionUser` uses `role`/`station_id: string`/`jurisdiction_id`; `/auth/me` returns `rank, scope, clearance, station_id:int, district, range_name`.

## Verified genuinely clean (no bug)
`main.py` router wiring & CORS; `session.py` engine/pool; `registry.py` LLM/embedder/
reranker resolution + `@lru_cache` per-engine; `base.py` protocols; `gemini.py`/
`groq.py`/`ollama_cloud.py` adapters (demo-mode + retry + block handling) all sound;
`core/audit.py` hash-chain + `audit_log` DDL match exactly; `rbac.py` rank→scope/
clearance maps; `fn_scope_ok()` + the 4 RLS policies are correctly written (they
just aren't FORCEd — see D1); `sql_guard.sanitize()` AST checks are solid; the
frontend SSE frame parser in `client.ts` is correct.

---

## GRAND TOTAL across all 3 rounds: 16 issues
- **Critical/High (5):** A (docker runs v1 schema), D1 (RLS not enforced / app role missing), R3 (PII leak via chat SQL), B & C (report_service crashes).
- **Medium (6):** R1 (empty citations), R4 (network-by-name crash), D2 (Neon vector search), E (audit UI fields), F (SessionUser type), G/H (ORM unique + Bulbul version).
- **Low (3):** R5 (phantom field), D3 (translator/audit-user), plus the stale `sql_guard` docstring.
- **Retracted false positives (4):** login.tsx / map.tsx×2 / i18n.tsx JSX “corruption” — these are VALID; do NOT touch them.


---

# ROUND 4 — VERIFICATION SCAN (tests, voice adapters, local models, schemas, frontend contract)

Audited the test suite, both voice adapters (Sarvam/Bhashini), all local model
stubs (BGE embedder/reranker, local LLM), `health.py`, `logging_config.py`, the
`auth`/`chat`/`case` schemas, and the login/CaseDrawer frontend. **One new
multi-part bug** (the test suite doesn't run), plus reconfirmations. Everything
else in this pass is clean.

---

## BUG T1 — 🟠 The test suite imports the OLD (v1) RBAC API → collection fails / tests error
**Severity: Medium (CI is red; every `pytest` run breaks)** | **Files: `backend/tests/test_rbac.py`, `backend/tests/test_health.py`**

Verified against `app/core/rbac.py`: there is **no `Role` symbol**, `Principal`
is a `@dataclass` whose field is `rank` (the `role` attribute is a read-only
`@property` returning `rank`), and there is **no `can_view_sensitivity()`**
method (the real ones are `can_view_case_full`, `should_mask_pii`,
`should_coarsen_coords`, `can_see_narrative`, `has`).

**`tests/test_rbac.py` — breaks 3 ways:**
```python
from app.core.rbac import Permission, Principal, Role   # ❌ ImportError: no `Role` → whole file fails to collect
p = Principal(id="v", name="V", role=Role.VIEWER, clearance=1)  # ❌ `role` is not a ctor field (it's `rank`, and `role` is read-only)
assert inv.can_view_sensitivity(0)                     # ❌ AttributeError: no such method
```
Fixed version:
```python
from app.core.rbac import Permission, Principal

def test_viewer_cannot_run_analytics():
    p = Principal(id="v", name="V", rank="viewer", scope="station", clearance=1)
    assert not p.has(Permission.RUN_ANALYTICS)
    assert p.has(Permission.READ_CASE)

def test_clearance_gates_sensitivity():
    inv = Principal(id="i", name="I", rank="investigator", scope="district", clearance=2)
    # L2 may NOT see full PII on a PROTECTED crime, but may on a normal one:
    assert inv.can_view_case_full("THEFT") is False      # clearance 2 < 3
    assert inv.should_mask_pii("THEFT") is True

def test_admin_sees_everything():
    a = Principal(id="a", name="A", rank="admin", scope="state", clearance=4)
    assert a.can_view_case_full("POCSO") is True
    assert a.has(Permission.READ_AUDIT)
```
(Adjust the assertions to whatever clearance semantics you intend — the key fix
is: drop `Role`, pass `rank=`/`scope=`, and call methods that exist. Also note
admin needs `clearance=4` to clear `READ_AUDIT`/sensitivity, not `clearance=1` as
the old test passed.)

**`tests/test_health.py::test_login_and_me` — wrong response key:**
```python
assert me.json()["role"] == "investigator"   # ❌ KeyError: /auth/me returns `rank`, not `role`
```
Verified: `SessionUser` (schemas/auth.py) = `id, name, rank, scope, clearance, station_id, district, range_name`. Fix:
```python
assert me.json()["rank"] == "investigator"
```
(`test_health::test_health_ok` and all of `test_sql_guard.py` pass — though
`test_sql_guard` still uses the v1 column name `fir_no` in its sample query; it
only passes because the guard validates *tables*, not *columns*. Harmless but
worth modernizing to `fir_number`.)

---

## BUG T2 — Minor: CaseDrawer crashes when a person has no role
**Severity: Low** | **File: `frontend/src/components/CaseDrawer.tsx` (~line 106)**

`PersonRef.role` is `Optional[str] = None` (schemas/case.py), but the drawer
renders `{p.role[0]}` (the avatar initial) unconditionally. If the backend
returns a person with `role: null`, this throws *“Cannot read properties of null
(reading '0')”* and the whole drawer fails to render. Fix: `{(p.role ?? "?")[0]}`
(and guard the `t(p.role)` label similarly).

---

## Reconfirmed this pass (already listed — not new)
- **Bug H:** `sarvam.py:72` TTS model is `"bulbul:v1"`; per the architecture (and the file's own docstring “Bulbul v3 TTS”) it should be `"bulbul:v3"`. STT correctly uses `saaras:v3`; translate uses `mayura:v1` (correct Sarvam MT model).
- **D3 / R-prior:** demo `login` still mints a token without `officer_id`, so audit attribution stays NULL even after the chat-audit fix.

## Verified genuinely clean in this pass (no bug)
`bhashini.py` (demo stubs + explicit NotImplementedError for unconfigured real
calls — intentional); `embedder_bge.py` (deterministic 1024-d normalized stub,
dim matches column), `reranker_bge.py`, `llm_local.py` (demo echo + word stream);
`health.py`; `logging_config.py` (structlog JSON); `schemas/chat.py`,
`schemas/auth.py`, `schemas/case.py` (shapes consistent with routes);
`login.tsx` (the hardcoded demo creds + “continue even if API is down” is an
INTENTIONAL offline-pitch fallback, not a bug; the earlier JSX `style=<LB><LB>...<RB><RB>`
I once flagged remains a FALSE POSITIVE — valid React inline-style).

---

## RUNNING TOTAL after 4 rounds: 17 distinct issues
- **Critical/High (5):** A (docker boots v1 schema), D1 (RLS not enforced / app role missing), R3 (chat SQL PII leak), B & C (report_service crashes).
- **Medium (7):** R1, R4, D2 (Neon vector), E (audit UI), F (SessionUser type), G/H (ORM unique + Bulbul version), **T1 (broken test suite)**.
- **Low (3):** R5, D3, **T2 (CaseDrawer null role)**.
- **Stale-but-passing / cosmetic (2):** `test_sql_guard` uses `fir_no`; `sql_guard` docstring falsely claims `persons_v` (the latter is the security-relevant half of R3).
- **Confirmed FALSE POSITIVES — do NOT touch (4):** login.tsx style, map.tsx ×2, i18n.tsx — all valid JSX.
