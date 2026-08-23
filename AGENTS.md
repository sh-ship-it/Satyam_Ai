# Satyam — Project Briefing for AI Assistants

> Read this first. It tells you what this project is, how it is structured, and
> how to set it up and run it. All shipped data is **synthetic**.

## What we are building

**Satyam** is a bilingual (English + Kannada), **voice-enabled conversational AI**
for police crime intelligence (built for Datathon 2026, KSP x hack2skill). An
officer asks a question in natural language (typed or spoken). Satyam:

1. Routes the intent, then runs a **grounded** lane:
   - **Text-to-SQL** (LLM proposes SQL -> `sqlglot` guard -> read-only, RLS-scoped query),
   - **RAG** over case narratives (BGE-M3 embeddings -> pgvector -> rerank),
   - **analytics** (crime hotspots, ego/link networks).
2. Composes a **cited** answer and streams it token-by-token over SSE.
3. Enforces **RBAC/ABAC + Postgres Row-Level Security** and writes a
   **tamper-evident (hash-chained) audit log** for every query.

The voice assistant **auto-detects English vs Kannada**, can **navigate to any
screen and run that screen's task**, and can **answer + speak in Kannada**.

## Tech stack

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy (async) + asyncpg, Postgres 16
  + pgvector, Redis, PyJWT, sqlglot, structlog. (See `backend/requirements.txt`.)
- **Frontend:** React 19 + TanStack Start/Router, Vite, Tailwind, Bun.
  (See `frontend/package.json`.)
- **Models (via `app/models`, switched by `MODEL_BACKEND`):** Gemini 2.5 Flash
  (chat / Text-to-SQL), Groq (fallback LLM), Bhashini (Indic STT/TTS/MT),
  BGE-M3 (sole local embedder). Local heavy models are stubs to add later.

## Repo layout

```
satyam/
  backend/    FastAPI service: pipeline, RBAC, RLS, audit, model adapters
    app/api/routes/     auth, chat (SSE), cases, map, network, reports, audit, health
    app/pipeline/       router, orchestrator, guardrails, slots, tools/(sql_guard,text_to_sql,rag,analytics)
    app/models/         base + api/(gemini,groq,bhashini) + local/(bge,whisper,parler,...) + registry
    app/core/           security, rbac, audit, masking
    app/db/             session, models, rls
    migrations/               apply 0*.sql in order; 002_schema_v2.sql supersedes 001_init.sql
    migrations/010_*.sql      HNSW index on narratives.embedding (required for vector RAG)
    seed/               synthetic data generator
  frontend/   React UI: Console, Map, Network, Case Drawer, Reports, Audit, Transcripts
    src/components/Shell.tsx   global voice-command router
    src/lib/api/client.ts      typed client + SSE chat stream
  docs/ARCHITECTURE.md
  docker-compose.yml   Postgres(+pgvector) + Redis + backend + frontend
```

## Setup & run

### Option A - Docker (everything)
```
cp .env.example .env        # fill GEMINI_API_KEY etc. (optional for demo)
docker compose up --build
# frontend http://localhost:3000  | backend http://localhost:8000/docs
```

### Option B - local dev
```
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# bring up Postgres+Redis (docker compose up db redis) then apply migrations IN ORDER.
# 001_init.sql alone is NOT enough: it is the v1 schema, and 002_schema_v2.sql
# drops and recreates the core tables. Applying only 001 leaves a schema the app
# cannot use.
for f in migrations/0*.sql; do psql "$DATABASE_URL" -f "$f"; done
python -m seed.load_seed          # core dataset (cases, persons, narratives)
python -m seed.init_ops           # ops_* tables for the Response-Ops screens
python -m seed.embed_narratives   # narratives.embedding + HNSW index; RAG is dead without it
                                  # Embeds ONE narrative per case (the only selection that
                                  # fits the cloud storage quota) and refuses to write at all
                                  # if the projection would breach it. See "Storage budget".
uvicorn app.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend
bun install        # or: npm install
bun run dev        # or: npm run dev
```

## Environment

Copy `.env.example` -> `.env`. Key vars: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
`MODEL_BACKEND` (`api` default | `local`), `GEMINI_API_KEY`, `GROQ_API_KEY`,
`BHASHINI_*`. Frontend uses `VITE_API_BASE_URL` (default `http://localhost:8000`).

### `DB_SOURCE` decides whether RLS is actually enforced

`DB_SOURCE` selects which URL the app starts on and is **security-relevant, not a
convenience switch**:

| value | URL used | connects as | RLS |
|---|---|---|---|
| `cloud` (default) | `DATABASE_URL` | `neondb_owner` — table owner, `rolbypassrls=true` | **bypassed** |
| `local` | `LOCAL_DATABASE_URL` | `satyam_app` — non-owner, no bypass | **enforced** |

The RLS policies are correct and identical in both databases, but no table has
`FORCE ROW LEVEL SECURITY`, so any owner or `rolbypassrls` role ignores every policy.
Measured: as `neondb_owner` with no jurisdiction context, `SELECT count(*) FROM cases`
returns every row; as `satyam_app` it returns 0 and correctly narrows to 83 rows for a
single-station scope.

So a deployment that connects as a table owner has RBAC in Python but **no database-level
jurisdiction enforcement**. Either run as a least-privilege role, or add `FORCE RLS` to
the tables. Local dev uses `DB_SOURCE=local` for this reason; run
`migrations/008_local_app_grants.sql` once so `satyam_app` has its grants.

### Storage budget — the cloud database is nearly full

The Neon project has a hard storage quota. Past it, Neon **fails writes that
increase storage**, which includes the `audit_log` row written on every audited
query, so this is an availability limit and not a billing one.

The cap is **512 MB (536,870,912 bytes)**, confirmed for this project. Note that
Neon's public docs phrase it as "0.5 GB", which read as decimal would be
500,000,000 — a 36.9 MB difference, and larger than the growth budget it governs.
Override with `NEON_STORAGE_CAP_BYTES` if the project ever moves plan.

| Control | | % of cap |
|---|---|---|
| Cap | 512.0 MB | 100% |
| Peak ceiling (one migration only) | 480.0 MB | 93.75% |
| Steady-state ceiling | 448.0 MB | 87.5% |
| Reserved headroom floor | 64.0 MB | 12.5% |

Measured position: **426.7 MB used, 85.3 MB free — compliant, with 21.3 MB of
growth budget.** `narratives` is 354 MB of that, and its HNSW index alone is 94 MB,
larger than every other table combined. Half the corpus is embedded: all 35,993
English narratives, none of the 35,993 Kannada ones. That is not an oversight; it is
the only configuration that fits.

Measured cost of embedding one more narrative: **4,783 bytes** (2,052 B `halfvec`
datum + 2,731 B HNSW share). So the growth budget is about **4,675 narratives**,
roughly 13% of the unembedded Kannada corpus. Embedding all of it would add ~164 MB
and land at ~591 MB, past the cap itself.

`python -m app.core.storage` (or `make storage`) reports the live position and exits
non-zero when a limit is breached. Every cloud backfill projects its cost before
writing and refuses if it does not fit — there is no flag that bypasses that. **Do
not raise the ceilings to make an operation fit; reclaim space instead.** The HNSW
index is the largest single reclaimable object.

A migration may briefly use the peak ceiling, which reduces free space to 32 MB.
That transient dip is what allows an index to be rebuilt beside the original before
the original is dropped, and rebuilding it is how space gets reclaimed.

Caveat: Neon meters *its* notion of project storage, which includes instant-restore
history, while the guard measures `pg_database_size()`. If the console disagrees
with `/health/data`, believe the console.

Plan for the remaining coverage work: `docs/rag-budget-and-coverage/`.

## Hard rules (do not violate)

- The LLM is **never** trusted for SQL: everything passes `pipeline/tools/sql_guard.py`
  (single SELECT, allow-listed tables, auto-LIMIT).
- **Known gap, do not assume otherwise:** there is no `persons_v` masked view in any
  database, and `sql_guard.ALLOWED_TABLES` includes raw `persons`. `core/masking.py`
  exposes only `mask_case()`, which is called solely from `services/case_service.py`,
  so **no masking is applied to Text-to-SQL output**. RLS still scopes *which* rows a
  caller sees; it does not mask columns. Treat column-level PII masking on the
  Text-to-SQL path as unimplemented rather than as an existing guarantee.
- Never weaken **RLS** or the **audit hash chain**.
- Keep all data **synthetic**; no individual-guilt prediction; human-in-the-loop.
- Do not add hosted embedding models — BGE-M3 is the sole embedder.
