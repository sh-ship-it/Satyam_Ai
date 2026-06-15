# Satyam — Database Design & Setup

> Conversational AI over the KSP (Karnataka State Police) crime / FIR database.
> This document is the single source of truth for the data layer: engine choice,
> dual-database (local + Neon cloud) strategy, schema, extensions, hybrid search,
> auth, audit, and configuration.

---

## 1. Overview

The data layer runs on **PostgreSQL 16 + pgvector** in two parallel deployments
with an **identical schema** — only the connection URL (`DATABASE_URL`) differs.

| | **Local Postgres** | **Neon (Cloud Postgres)** |
|---|---|---|
| Role | Demo video / on-prem "sovereign" story | Deployed link for judges + authentication |
| Data | **Full 100k** synthetic FIRs + embeddings | **A subset you push manually later** + `users` |
| Embeddings | `vector(1024)`, embedded on the **RTX 4070 (FP16)** | `halfvec(1024)` to fit the free tier |
| Reachable by | Your machine only | Anywhere (deployed app + judges) |
| Cost / quota | ₹0, unlimited storage | Free tier (~0.5 GB), scale-to-zero |
| Engine | PostgreSQL 16 + pgvector | PostgreSQL (Neon) + pgvector |

**Why two databases?** A deployed cloud app cannot reach a database on your
laptop (it sits behind your home network). So anything the deployed app needs
(auth + a data sample) lives in **Neon**; the full 100k corpus + GPU inference
live **locally** for the on-prem demo. Same schema, same code, one env switch.

---

## 2. Engine choice: PostgreSQL everywhere (not SQLite)

Both local and cloud use **the same engine — PostgreSQL 16**. This is a hard
requirement, not a preference:

- **Text-to-SQL consistency** — the app generates Postgres SQL. A different local
  engine (e.g. SQLite) has a different dialect, so generated queries would behave
  differently across tracks.
- **Vector search** — SQLite has no `pgvector`; the entire RAG lane depends on it.
- **One codebase** — identical schema + SQL means the only difference between
  local and cloud is `DATABASE_URL`.

---

## 3. Cloud database — Neon

**Neon** = serverless PostgreSQL with first-class `pgvector`, the most generous
free tier, scale-to-zero, a browser SQL editor, and a single shareable
connection string.

### 3.1 Setup (one-time)

1. Sign up at console.neon.tech → **Create project** (region: choose the closest,
   e.g. AWS `ap-south-1` Mumbai for India latency).
2. Copy the connection string from the dashboard. It looks like:
   ```
   postgresql://<user>:<password>@<endpoint>.neon.tech/<db>?sslmode=require
   ```
3. Enable extensions (Neon SQL editor or psql):
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Run the schema in `Section 5` (use `halfvec(1024)` for the cloud embedding
   column — see `Section 7`).
5. Paste the URL into `.env` as `DATABASE_URL` and share that file **privately**
   with your teammate (never commit it to a public repo).

### 3.2 Free-tier limits to respect

- ~**0.5 GB storage**, ~100 compute-hrs/month, shared 0.25 vCPU.
- **Scale-to-zero**: idle compute sleeps and wakes in ~300–600 ms (ping it
  before judging so the first query isn't cold).
- Connection limit is comfortably enough for a 2-person team.
- Upgrade path: Neon **Launch** (~10 GB) if you ever need the full 100k in cloud.

---

## 4. Local database — PostgreSQL + pgvector (no Docker)

| OS | Install |
|---|---|
| Windows (i7-13650HX laptop) | EDB PostgreSQL 16 installer + `pgvector` prebuilt binary |
| macOS | Postgres.app (bundles pgvector) |
| Linux | `sudo dnf install postgresql16-server` (or apt), then build/install pgvector |

Then, in `psql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
Load the **full 100k** dataset here. Embeddings are generated on the **RTX 4070
(FP16)** and stored as `vector(1024)`.

---

## 5. Schema (DDL)

```sql
-- ============ Extensions ============
CREATE EXTENSION IF NOT EXISTS vector;

-- ============ Reference / org tables ============
CREATE TABLE stations (
    station_id   SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    district     TEXT NOT NULL,
    range_name   TEXT NOT NULL,            -- one of the 7 KSP ranges
    latitude     DOUBLE PRECISION,
    longitude    DOUBLE PRECISION,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE officers (
    officer_id   SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    rank         TEXT NOT NULL,            -- PC / HC / ASI / SI / PI / DySP ...
    station_id   INTEGER REFERENCES stations(station_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Core case tables ============
CREATE TABLE cases (
    case_id        SERIAL PRIMARY KEY,
    fir_number     TEXT UNIQUE NOT NULL,   -- e.g. 'BNG-WF/2025/0042'
    crime_type     TEXT NOT NULL,          -- theft, assault, murder, cybercrime ...
    legal_code     TEXT NOT NULL,          -- 'IPC' (pre-2024) | 'BNS' (post-2024)
    sections       TEXT[] NOT NULL,        -- e.g. '{"302","34"}'
    status         TEXT NOT NULL,          -- registered / under_investigation /
                                           -- chargesheeted / disposed
    date_occurred  DATE,                   -- must be <= date_reported
    date_reported  DATE NOT NULL,
    station_id     INTEGER NOT NULL REFERENCES stations(station_id),
    io_officer_id  INTEGER REFERENCES officers(officer_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE persons (
    person_id    SERIAL PRIMARY KEY,
    full_name    TEXT NOT NULL,
    gender       TEXT,
    age          INTEGER,
    address      TEXT,
    phone        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: a person can appear in many cases, with a role per case
CREATE TABLE case_persons (
    case_id    INTEGER NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    person_id  INTEGER NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
    role       TEXT NOT NULL,              -- complainant / accused / victim / witness
    PRIMARY KEY (case_id, person_id, role)
);

-- ============ RAG narratives ============
CREATE TABLE narratives (
    narrative_id  SERIAL PRIMARY KEY,
    case_id       INTEGER NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    language      TEXT NOT NULL,           -- 'en' | 'kn'
    body          TEXT NOT NULL,           -- complaint / FIR free text
    body_tsv      tsvector,                -- keyword lane (see Section 8)
    embedding     vector(1024),            -- BGE-M3; use halfvec(1024) on Neon
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Auth ============
CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,          -- bcrypt / argon2
    role           TEXT NOT NULL DEFAULT 'officer',  -- officer / admin
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Hash-chained audit log ============
CREATE TABLE audit_log (
    audit_id      BIGSERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(user_id),
    action        TEXT NOT NULL,           -- login / nl_query / sql_exec / export ...
    query_text    TEXT,                    -- the natural-language question
    generated_sql TEXT,                    -- the SQL the model produced
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_hash     TEXT,                    -- hash of previous row
    row_hash      TEXT NOT NULL            -- sha256(prev_hash || this row)
);

-- ============ Indexes ============
CREATE INDEX idx_narratives_embedding
    ON narratives USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_narratives_tsv
    ON narratives USING gin (body_tsv);
CREATE INDEX idx_cases_station   ON cases(station_id);
CREATE INDEX idx_cases_status    ON cases(status);
CREATE INDEX idx_cases_legalcode ON cases(legal_code);
CREATE INDEX idx_case_persons_person ON case_persons(person_id);
```

---

## 6. Entity relationships

```
stations 1──∞ officers
stations 1──∞ cases ∞───case_persons───∞ persons
cases    1──∞ narratives (en / kn)
officers 1──∞ cases   (investigating officer)
users    1──∞ audit_log
```

- A **case** belongs to one **station** and (optionally) one investigating **officer**.
- A **case** links to many **persons** via **case_persons**, each with a role.
- A **case** has one or more **narratives** (English and/or Kannada) for RAG.

---

## 7. Embeddings & vector storage

- **Model:** BGE-M3 (sole embedder), **dim 1024**, ~568M params.
- **Local:** `embedding vector(1024)` — FP32 on disk, generated on the RTX 4070 (FP16).
- **Cloud (Neon):** use **`halfvec(1024)`** (pgvector ≥ 0.7, fp16 storage) to halve
  vector size (~2 KB/row vs ~4 KB/row) so the subset fits the ~0.5 GB free tier.
  Retrieval quality is effectively unchanged (cosine similarity tolerates fp16).
- **Index:** HNSW with `vector_cosine_ops` (good recall + speed). Set `ef_search`
  at query time to tune recall vs latency.
- **Consistency rule:** embed the corpus and the live query with the **same**
  precision/pipeline so vectors share one space.

### Storage budget (why the subset)

| | Vectors only | Notes |
|---|---|---|
| 100k × `vector(1024)` (fp32) | ~400 MB | + text + HNSW index → exceeds 0.5 GB free tier |
| 100k × `halfvec(1024)` (fp16) | ~200 MB | still tight with text + index |
| Subset on Neon (`halfvec`) | depends on count | keep it within the free tier |

**Decision:** full 100k local; on Neon, push a subset manually later (use `halfvec` there).

---

## 8. Hybrid search (semantic + keyword)

Retrieval = **pgvector (semantic)** + **keyword lane**, fused (e.g. RRF), then
reranked by **bge-reranker-v2-m3** (local GPU).

- **Keyword lane = native Postgres full-text search** (`tsvector` + GIN). Works on
  **both local and Neon**, free tier, zero extra setup. Populate `body_tsv`:
  ```sql
  UPDATE narratives SET body_tsv = to_tsvector('simple', body);
  -- or maintain via a trigger on insert/update
  ```
  Query example (hybrid):
  ```sql
  -- semantic
  SELECT case_id FROM narratives
  ORDER BY embedding <=> $1 LIMIT 20;
  -- keyword
  SELECT case_id FROM narratives
  WHERE body_tsv @@ plainto_tsquery('simple', $2)
  ORDER BY ts_rank(body_tsv, plainto_tsquery('simple', $2)) DESC LIMIT 20;
  ```
- **Optional upgrades (not required for the demo):**
  - **Neon:** `pg_search` (ParadeDB) for true **BM25** ranking.
  - **Supabase (fallback platform):** **PGroonga** for multilingual FTS, or an
    external ParadeDB replica for BM25.
- **Decision:** ship with native `tsvector` FTS; treat BM25 (`pg_search`/PGroonga)
  as a post-hackathon enhancement.

---

## 9. Authentication

- Lives in the **same Neon database** as the case subset (just the `users` table
  + `audit_log`). No separate auth database needed.
- **Flow:** email + password → hash with **bcrypt/argon2** → issue a **JWT** on
  login → verify the JWT on each request. `role` drives RBAC (officer / admin).
- Independent of the model/voice backends — purely a backend + DB concern.
- *Alternative:* Neon's built-in Auth (or Supabase Auth) can replace hand-rolled
  JWT if you want managed sessions — optional.

---

## 10. Audit log (tamper-evident)

Every sensitive action (login, NL query, generated SQL, export) is appended to
`audit_log`. Each row stores `row_hash = sha256(prev_hash || serialized_row)`,
forming a **hash chain** — any retroactive edit breaks the chain and is
detectable. Store who, what NL question, what SQL, and when.

---

## 11. Caching / Redis

- **Neither Neon nor Supabase hosts Redis.** If/when you need caching, rate
  limiting, or session storage, add **Upstash Redis** (free tier) as a separate
  service via `REDIS_URL`.
- For the hackathon you can **skip Redis** and cache in-app; add Upstash later.

---

## 12. Data loading strategy

1. Run the seeded synthetic generator once → produces the full **100k** set.
2. **Local:** load all 100k; embed on the RTX 4070 (FP16) → `vector(1024)`.
3. **Neon:** push a subset manually later; store embeddings as `halfvec(1024)`.
4. Same schema both sides → no code changes, only `DATABASE_URL`.
5. Use `COPY` for fast bulk loads; build HNSW + GIN indexes **after** loading.

---

## 13. Configuration (`.env`)

```env
# --- Database ---
# Local (full 100k):
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/satyam
# Cloud (Neon, auth + subset):
DATABASE_URL=postgresql://<user>:<password>@<endpoint>.neon.tech/<db>?sslmode=require

# --- Auth ---
JWT_SECRET=<random-long-secret>
JWT_EXPIRY=3600

# --- Optional cache ---
# REDIS_URL=rediss://<token>@<endpoint>.upstash.io:6379
```

Flip between local and cloud by changing `DATABASE_URL` only. Share `.env` with
your teammate over a **private** channel — a leaked DB URL grants full read/write.

---

## 14. Security notes

- Never commit `.env` (add it to `.gitignore`).
- Neon enforces `sslmode=require` — keep TLS on.
- 100% **synthetic** data, **zero real PII** — this is what makes the public
  deployed link legally safe (state it proactively to judges).
- Hashed passwords only; never store plaintext.

---

## 15. Summary of decisions

| Topic | Decision |
|---|---|
| Engine | PostgreSQL 16 + pgvector (local **and** Neon cloud) |
| Cloud provider | **Neon** (Supabase = fallback if managed auth is wanted) |
| Local install | Native Postgres + pgvector (no Docker) |
| Embeddings | BGE-M3, `vector(1024)` local / `halfvec(1024)` cloud, HNSW index |
| Hybrid search | pgvector + native `tsvector` FTS (BM25 via pg_search optional) |
| Auth | `users` table + bcrypt/argon2 + JWT, in Neon |
| Audit | Hash-chained `audit_log` |
| Cache | Upstash Redis (optional add-on) |
| Data split | Full 100k local · subset pushed manually to Neon later |
| Switch | Single `DATABASE_URL` env var |
