# Satyam — Database Design & Setup

> Conversational AI over the KSP (Karnataka State Police) crime / FIR database.
> This document is the single source of truth for the data layer: engine choice,
> dual-database (local + Neon cloud) strategy, schema, extensions, RBAC, hybrid
> search, auth, audit, and configuration.
>
> **Schema version:** `002_schema_v2.sql` (matches `satyam_synthetic_dataset` CSVs)
> **Last updated:** 2026-06-15

---

## 1. Overview

The data layer runs on **PostgreSQL + pgvector** in two parallel deployments
with an **identical schema** — only the connection URL (`DATABASE_URL`) differs.

| | **Local Postgres** | **Neon (Cloud Postgres)** |
|---|---|---|
| Role | Demo video / on-prem "sovereign" story | Deployed link for judges + authentication |
| Data | **Full 100k** synthetic FIRs (loaded) | **100k loaded** — subset for production later |
| Embeddings | `vector(1024)`, embedded on **RTX 4070 (FP16)** | `halfvec(1024)` to fit the free tier |
| Reachable by | Your machine only | Anywhere (deployed app + judges) |
| Cost / quota | ₹0, unlimited storage | Free tier (~0.5 GB), scale-to-zero |
| Engine | PostgreSQL 17 + pgvector 0.8.2 | PostgreSQL 16.14 + pgvector 0.8.0 |

**Why two databases?** A deployed cloud app cannot reach a database on your
laptop (behind your home network). So auth + a data sample live in **Neon**;
the full 100k corpus + GPU inference live **locally** for the on-prem demo.
Same schema, same code, one env switch.

---

## 2. Engine choice: PostgreSQL everywhere

Both local and cloud use **PostgreSQL**. This is a hard requirement:

- **Text-to-SQL consistency** — the app generates Postgres SQL. A different engine
  (e.g. SQLite) has a different dialect, so queries would behave differently.
- **Vector search** — SQLite has no `pgvector`; the entire RAG lane depends on it.
- **RLS** — Postgres Row-Level Security enforces jurisdiction scope at the DB level.
- **One codebase** — only `DATABASE_URL` changes between local and cloud.

---

## 3. Cloud database — Neon

**Neon** = serverless PostgreSQL with first-class `pgvector`, scale-to-zero,
a browser SQL editor, and a single shareable connection string.

### 3.1 Current state (already done)
- Project created on Neon (AWS `us-east-1`)
- Schema `002_schema_v2.sql` applied
- `satyam_synthetic_dataset` CSVs bulk-loaded via `seed/load_seed.py`:
  - 1,074 stations · 6,949 officers · 100,000 cases
  - 416,616 persons · 416,616 case_persons · 200,000 narratives
- `embedding` column is currently `NULL` — fill with `seed/embed_narratives.py`
  when ready (use `halfvec(1024)` on Neon to stay inside the free tier)

### 3.2 Free-tier limits to respect
- ~**0.5 GB storage**, ~100 compute-hrs/month, shared 0.25 vCPU.
- **Scale-to-zero**: idle compute wakes in ~300–600 ms. Ping before judging.
- Upgrade path: Neon **Launch** (~10 GB) if you need the full embedded corpus in cloud.

### 3.3 Altering the embedding column for Neon (halfvec)
On the Neon SQL editor, after the schema is applied:
```sql
-- Switch from vector(1024) to halfvec(1024) to halve storage cost
ALTER TABLE narratives ALTER COLUMN embedding TYPE halfvec(1024);
-- Rebuild the HNSW index with the matching ops class
DROP INDEX IF EXISTS idx_nar_embedding;
CREATE INDEX idx_nar_embedding ON narratives USING hnsw (embedding halfvec_cosine_ops);
```

---

## 4. Local database — PostgreSQL + pgvector

| OS | Installed |
|---|---|
| Windows (this machine) | EDB PostgreSQL **17.7** + pgvector **0.8.2** (built from source) |
| macOS | Postgres.app (bundles pgvector) |
| Linux | `sudo apt install postgresql-16` + build pgvector from source |

Both databases are live and loaded. Switch by changing `DATABASE_URL` only.

---

## 5. Schema (DDL) — `backend/migrations/002_schema_v2.sql`

### Run order
```
migrations/teardown.sql       # drops all old objects (idempotent)
migrations/002_schema_v2.sql  # creates fresh schema
seed/load_seed.py             # bulk-loads CSVs via asyncpg COPY
seed/embed_narratives.py      # fills narratives.embedding (BGE-M3, run after load)
```

### Extensions
```sql
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector (ANN search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram FTS (optional BM25 lane)
```

### Core data tables

```sql
CREATE TABLE stations (
    station_id    INTEGER PRIMARY KEY,
    station_name  TEXT NOT NULL,
    district      TEXT NOT NULL,
    "range"       TEXT NOT NULL,     -- quoted: RANGE is a SQL keyword
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION
);

CREATE TABLE officers (
    officer_id    INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    rank          TEXT NOT NULL,     -- PC / HC / ASI / SI / PSI / PI / DySP / SP ...
    station_id    INTEGER NOT NULL REFERENCES stations(station_id)
);

CREATE TABLE cases (
    case_id          INTEGER PRIMARY KEY,
    fir_number       TEXT NOT NULL,
    fir_year         INTEGER NOT NULL,
    station_id       INTEGER NOT NULL REFERENCES stations(station_id),
    station_name     TEXT NOT NULL,
    district         TEXT NOT NULL,
    "range"          TEXT NOT NULL,
    crime_type       TEXT NOT NULL,
    crime_category   TEXT NOT NULL CHECK (crime_category IN ('IPC','SLL')),
    legal_code       TEXT NOT NULL CHECK (legal_code IN ('IPC','BNS')),
    sections         TEXT,                          -- pipe-joined, e.g. '302|34'
    fir_type         TEXT NOT NULL CHECK (fir_type IN ('Heinous','Non Heinous')),
    status           TEXT NOT NULL,
    complaint_mode   TEXT,
    motive           TEXT,
    incident_date    DATE,
    incident_time    TEXT,
    report_date      DATE NOT NULL,
    latitude         DOUBLE PRECISION,
    longitude        DOUBLE PRECISION,
    place_of_offence TEXT,
    io_officer_id    INTEGER REFERENCES officers(officer_id),
    io_name          TEXT,
    victim_count     INTEGER NOT NULL DEFAULT 0,
    accused_count    INTEGER NOT NULL DEFAULT 0,
    is_group         BOOLEAN NOT NULL DEFAULT FALSE,
    arrested_count   INTEGER NOT NULL DEFAULT 0,
    charge_sheeted   BOOLEAN NOT NULL DEFAULT FALSE,
    convicted        BOOLEAN NOT NULL DEFAULT FALSE,
    -- GENERATED: array form of pipe-joined sections (do NOT include in COPY)
    sections_arr     TEXT[] GENERATED ALWAYS AS (string_to_array(sections,'|')) STORED,
    CHECK (report_date >= incident_date),
    CHECK (arrested_count <= accused_count)
);

CREATE TABLE persons (
    person_id    INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    gender       TEXT,
    age          INTEGER,
    district     TEXT
);

CREATE TABLE case_persons (
    case_id    INTEGER NOT NULL REFERENCES cases(case_id)   ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('Complainant','Victim','Accused','Witness')),
    PRIMARY KEY (case_id, person_id, role)
);

CREATE TABLE narratives (
    narrative_id INTEGER PRIMARY KEY,
    case_id      INTEGER NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    language     TEXT NOT NULL CHECK (language IN ('en','kn')),
    body         TEXT NOT NULL,
    -- LOCAL: vector(1024). NEON free tier: ALTER to halfvec(1024) after load.
    embedding    vector(1024),
    -- GENERATED: auto-maintained full-text search column (do NOT include in COPY)
    body_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
```

### RBAC tables

```sql
-- KSP rank → jurisdiction scope + clearance level
CREATE TABLE rank_access (
    rank         TEXT PRIMARY KEY,
    scope_level  TEXT NOT NULL CHECK (scope_level IN ('state','range','district','station')),
    clearance    SMALLINT NOT NULL CHECK (clearance BETWEEN 1 AND 4),
    gazetted     BOOLEAN NOT NULL,
    description  TEXT
);
-- Pre-populated with 14 KSP ranks (see schema file for full INSERT)

-- App login accounts (tied to an officer row or carrying an assigned_rank override)
CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    username       TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,           -- argon2/bcrypt
    officer_id     INTEGER REFERENCES officers(officer_id),
    assigned_rank  TEXT REFERENCES rank_access(rank),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Effective session view (used to build the JWT)
CREATE VIEW v_officer_session AS
SELECT u.user_id, u.username,
       COALESCE(u.assigned_rank, o.rank)  AS rank,
       ra.scope_level, ra.clearance,
       o.officer_id, o.station_id,
       s.district, s."range"             AS range_name
FROM users u
LEFT JOIN officers    o  ON o.officer_id = u.officer_id
LEFT JOIN stations    s  ON s.station_id = o.station_id
LEFT JOIN rank_access ra ON ra.rank = COALESCE(u.assigned_rank, o.rank);
```

### Audit log

```sql
CREATE TABLE audit_log (
    audit_id      BIGSERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(user_id),
    action        TEXT NOT NULL,      -- login / nl_query / sql_exec / view_case / export
    case_id       INTEGER,            -- which case was accessed (for PROTECTED crimes)
    reason        TEXT,               -- required when accessing PROTECTED-crime PII
    query_text    TEXT,               -- the natural-language question
    generated_sql TEXT,               -- the SQL the model produced
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_hash     TEXT,
    row_hash      TEXT NOT NULL       -- sha256(prev_hash || row payload)
);
```

### Indexes (built by `load_seed.py` after data load)

```sql
CREATE INDEX idx_cases_district   ON cases (district);
CREATE INDEX idx_cases_range      ON cases ("range");
CREATE INDEX idx_cases_crime_type ON cases (crime_type);
CREATE INDEX idx_cases_report_dt  ON cases (report_date);
CREATE INDEX idx_cases_status     ON cases (status);
CREATE INDEX idx_cases_station    ON cases (station_id);
CREATE INDEX idx_cases_legalcode  ON cases (legal_code);
CREATE INDEX idx_cp_case          ON case_persons (case_id);
CREATE INDEX idx_cp_person        ON case_persons (person_id);
CREATE INDEX idx_persons_district ON persons (district);
CREATE INDEX idx_nar_case         ON narratives (case_id);
CREATE INDEX idx_nar_bodytsv      ON narratives USING GIN (body_tsv);
-- Built AFTER embeddings are populated by embed_narratives.py:
-- CREATE INDEX idx_nar_embedding ON narratives USING hnsw (embedding vector_cosine_ops);
-- On Neon (halfvec): USING hnsw (embedding halfvec_cosine_ops)
```

---

## 6. Entity relationships

```
stations  1──∞  officers
stations  1──∞  cases ∞──case_persons──∞ persons
cases     1──∞  narratives (en + kn)
officers  1──∞  cases (investigating officer)
officers  0──1  users (officer_id FK)
rank_access 1──∞ users (assigned_rank FK)
users     1──∞  audit_log
```

- A **case** belongs to one **station** and optionally one investigating **officer**.
- A **case** links to many **persons** via **case_persons** (each with a role).
- A **case** has up to 2 **narratives** — one English (`language='en'`), one Kannada (`language='kn'`).
- A **user** is tied to an **officer** (inheriting station/district/range/rank), or has an
  `assigned_rank` override for state/range admins who are not in the officers table.

---

## 7. KSP Rank model (RBAC + ABAC)

### Rank → scope + clearance

| Rank | Type | Scope | Clearance |
|------|------|-------|-----------|
| DGP / ADGP / IGP | Gazetted | state | **L4** |
| DIG | Gazetted | range | **L4** |
| SP / Addl.SP | Gazetted | district | **L4** |
| Dy.SP | Gazetted | district | **L3** |
| CPI / PI / CI | Non-gazetted | station | **L3** |
| PSI / SI | Non-gazetted | station | **L2** |
| ASI | Non-gazetted | station | **L2** |
| HC / PC | Non-gazetted | station | **L1** |

### Jurisdiction scope (row-level, enforced by Postgres RLS)

| Scope | Rows visible |
|-------|-------------|
| `state` | All rows nationwide |
| `range` | Rows where `cases.range = officer.range` |
| `district` | Rows where `cases.district = officer.district` |
| `station` | Rows where `cases.station_id = officer.station_id` |

The FastAPI dependency sets `app.*` GUCs per request:
```sql
SET LOCAL app.scope      = 'district';
SET LOCAL app.range      = 'Bengaluru Range';
SET LOCAL app.district   = 'Bengaluru Urban';
SET LOCAL app.station_id = '764';
SET LOCAL app.clearance  = '4';
```
`fn_scope_ok()` reads these in every RLS policy. Because the app connects as a
**non-superuser role**, RLS is actually enforced — a superuser would bypass it.

### Clearance levels (field-level ABAC masking)

PROTECTED crime types: `POCSO, POCSO RAPE, RAPE, MOLESTATION, DOWRY DEATHS,
SC/ST (ATROCITIES), SEXUAL HARASSMENT, STALKING, ASSAULT ON WOMEN,
KIDNAPPING OF WOMEN AND GIRLS`

| Level | Who | What they can see |
|-------|-----|-------------------|
| **L4** | SP+ | Everything — including victim identity on PROTECTED crimes (access logged with reason) |
| **L3** | DySP / PI / CI | Operational fields; victim names on PROTECTED crimes masked |
| **L2** | PSI / SI / ASI | All person PII (names, age, place_of_offence) masked; aggregates visible; PROTECTED narratives redacted |
| **L1** | HC / PC | All names masked, coordinates coarsened (~10 km), PROTECTED narratives hidden; counts/categories only |

Masking is applied **server-side** in `app/core/masking.py` before data leaves
the API. Lock icons in the UI reflect masked fields.

---

## 8. Row-Level Security implementation

```sql
-- Helper: returns TRUE if the row is within the caller's jurisdiction scope
CREATE OR REPLACE FUNCTION fn_scope_ok(p_range TEXT, p_district TEXT, p_station INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT CASE current_setting('app.scope', true)
           WHEN 'state'    THEN TRUE
           WHEN 'range'    THEN p_range    = current_setting('app.range', true)
           WHEN 'district' THEN p_district = current_setting('app.district', true)
           WHEN 'station'  THEN p_station  = NULLIF(current_setting('app.station_id', true), '')::int
           ELSE FALSE
         END
$$;

-- RLS enabled + policies on all 4 row-bearing tables
ALTER TABLE cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives   ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_cases_scope ON cases
    USING (fn_scope_ok("range", district, station_id));

CREATE POLICY p_narratives_scope ON narratives
    USING (EXISTS (SELECT 1 FROM cases c
                   WHERE c.case_id = narratives.case_id
                     AND fn_scope_ok(c."range", c.district, c.station_id)));

CREATE POLICY p_case_persons_scope ON case_persons
    USING (EXISTS (SELECT 1 FROM cases c
                   WHERE c.case_id = case_persons.case_id
                     AND fn_scope_ok(c."range", c.district, c.station_id)));

CREATE POLICY p_persons_scope ON persons
    USING (EXISTS (SELECT 1 FROM case_persons cp JOIN cases c ON c.case_id = cp.case_id
                   WHERE cp.person_id = persons.person_id
                     AND fn_scope_ok(c."range", c.district, c.station_id)));
```

**Verified live:** PSI at station 1 sees 1,029 / 100,000 cases; DGP sees all 100,000.

---

## 9. Embeddings & vector storage

- **Model:** BGE-M3 (sole embedder), dim 1024, ~568M params, FP16.
- **Local:** `embedding vector(1024)` — generated on RTX 4070 (FP16).
- **Cloud (Neon):** alter to `halfvec(1024)` after load to halve storage (~2 KB → 1 KB/row).
- **Index:** HNSW with `vector_cosine_ops` (built after embeddings exist).
- **Consistency rule:** embed corpus and live query with the same model/precision.

### Run the embedding job
```bash
# GPU (recommended, ~8 min for 200k narratives on RTX 4070)
python -m seed.embed_narratives

# Local Postgres
python -m seed.embed_narratives --local

# Custom batch size
python -m seed.embed_narratives --batch 128
```

### Storage budget

| Scenario | Vectors only | Notes |
|---|---|---|
| 200k × `vector(1024)` fp32 | ~800 MB | Exceeds Neon free tier |
| 200k × `halfvec(1024)` fp16 | ~400 MB | Fits with room for text + index |
| Subset (e.g. 50k) on Neon `halfvec` | ~100 MB | Comfortable in 0.5 GB free tier |

---

## 10. Hybrid search (semantic + keyword)

Retrieval = **pgvector (ANN)** + **tsvector (keyword)**, fused, then reranked
by **bge-reranker-v2-m3** (local GPU).

`body_tsv` is a `GENERATED ALWAYS` column — automatically maintained:
```sql
-- body_tsv is auto-populated on INSERT/UPDATE; no manual maintenance needed.
-- Query examples:

-- Semantic (ANN)
SELECT case_id, body FROM narratives
ORDER BY embedding <=> $1::vector LIMIT 20;

-- Keyword (FTS)
SELECT case_id, body FROM narratives
WHERE body_tsv @@ plainto_tsquery('simple', $2)
ORDER BY ts_rank(body_tsv, plainto_tsquery('simple', $2)) DESC LIMIT 20;
```

Optional upgrade: `pg_search` (ParadeDB) on Neon for true BM25 ranking.
Decision: ship with native `tsvector` FTS for the hackathon.

---

## 11. Authentication

- `users` table in the same database as cases.
- Flow: username + password → `argon2/bcrypt` hash check → JWT issued.
- JWT carries: `sub`, `name`, `rank`, `scope`, `clearance`, `station_id`,
  `district`, `range`, `officer_id`.
- Demo mode: `POST /auth/login` with `{"username": "test", "rank": "SP"}` mints
  a JWT for any rank without password (disabled in `APP_ENV=production`).
- Real auth: create a row in `users`, link to `officers.officer_id`, call
  `v_officer_session` to read effective scope/clearance into the JWT.

---

## 12. Audit log (tamper-evident hash chain)

Every sensitive action appends to `audit_log`:
```
row_hash = sha256(prev_hash || canonical_json(row_payload))
```
Any retroactive edit breaks the chain — detectable by a single verification pass
(`GET /audit` returns `chain_valid: true/false`).

PROTECTED-crime access additionally requires a `reason` field in the log row.

---

## 13. Data loading

### Loading the synthetic dataset
```bash
# Neon (default — uses SEED_DATABASE_URL from backend/.env)
python -m seed.load_seed

# Local Postgres
python -m seed.load_seed --local

# Custom CSV directory
python -m seed.load_seed --dir /path/to/csvs
```

### What load_seed.py does
1. TRUNCATE all tables (idempotent reset)
2. COPY CSVs via asyncpg in FK-safe order:
   `stations → officers → cases → persons → case_persons → narratives`
3. Build btree + GIN indexes after load
4. ANALYZE all tables

### After loading — embed narratives
```bash
python -m seed.embed_narratives        # Neon
python -m seed.embed_narratives --local  # local
```

### CSV files (`backend/seed/satyam_synthetic_dataset/`)
| File | Rows | Notes |
|------|------|-------|
| `stations.csv` | 1,074 | station_id, station_name, district, range, latitude, longitude |
| `officers.csv` | 6,949 | officer_id, name, rank, station_id |
| `cases.csv` | 100,000 | 29 columns; `sections_arr` is GENERATED — not in COPY |
| `persons.csv` | 416,616 | person_id, name, gender, age, district |
| `case_persons.csv` | 416,616 | case_id, person_id, role |
| `narratives.csv` | 200,000 | narrative_id, case_id, language, body; `body_tsv`/`embedding` not in COPY |

> **Never commit these CSVs** — they are gitignored under `backend/seed/satyam_synthetic_dataset/`.

---

## 14. Configuration (`.env`)

```env
# ── Database ─────────────────────────────────────────────────────────────────
# ACTIVE: Neon cloud (runtime — least-privilege role)
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<endpoint>.neon.tech/<db>?ssl=require

# Migrations + seeding (owner/superuser role)
SEED_DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<endpoint>.neon.tech/<db>?ssl=require

# LOCAL (flip back for on-prem demo):
# DATABASE_URL=postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam
# SEED_DATABASE_URL=postgresql+asyncpg://satyam:satyam@localhost:5432/satyam

# ── Auth ──────────────────────────────────────────────────────────────────────
JWT_SECRET=<random-long-secret>
JWT_EXPIRE_MINUTES=480
```

Flip between local and cloud by swapping `DATABASE_URL` only. Share `.env`
privately — a leaked DB URL grants full read/write access.

---

## 15. Security notes

- **Never commit `.env`** — covered by `.gitignore` rule `**/.env`.
- Neon enforces `sslmode=require` — always keep TLS on.
- 100% **synthetic** data, **zero real PII** — state this proactively to judges.
- Passwords hashed with argon2/bcrypt only — no plaintext storage.
- App connects as a **non-superuser** role so RLS is actually enforced.
- `FORCE ROW LEVEL SECURITY` on the 4 core tables defends against accidental
  superuser connections.

---

## 16. Summary of decisions

| Topic | Decision |
|---|---|
| Engine | PostgreSQL + pgvector (local 17.7 · Neon 16.14) |
| Cloud provider | **Neon** (Supabase = fallback if managed auth wanted) |
| Local install | Native Postgres + pgvector 0.8.2 (built from source on Windows) |
| Schema | `002_schema_v2.sql` — matches `satyam_synthetic_dataset` CSVs exactly |
| Embeddings | BGE-M3, `vector(1024)` local / `halfvec(1024)` cloud, HNSW index |
| Hybrid search | pgvector ANN + native `tsvector` GENERATED column (BM25 optional) |
| RBAC | 14 KSP ranks → scope (state/range/district/station) + clearance L1–L4 |
| RLS | `fn_scope_ok()` + `app.*` GUCs — jurisdiction enforced at DB level |
| Field masking | 4-tier (`app/core/masking.py`) — server-side, never client-side |
| Auth | `users` table + argon2/bcrypt + JWT with rank/scope/clearance |
| Audit | Hash-chained `audit_log` (`audit_id`, `at`, `row_hash`, `case_id`, `reason`) |
| Cache | Upstash Redis optional — skip for hackathon |
| Data split | Full 100k local · same loaded on Neon (subset for production later) |
| Switch | Single `DATABASE_URL` env var — no code changes needed |
