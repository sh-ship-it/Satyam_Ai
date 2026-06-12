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
    migrations/001_init.sql   schema + RLS policies + masked persons_v view
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
# bring up Postgres+Redis (docker compose up db redis) then:
psql "$DATABASE_URL" -f migrations/001_init.sql
python -m seed.seed
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

## Hard rules (do not violate)

- The LLM is **never** trusted for SQL: everything passes `pipeline/tools/sql_guard.py`
  (single SELECT, allow-listed tables, auto-LIMIT). Text-to-SQL targets the masked
  `persons_v` view, never raw PII.
- Never weaken **RLS** or the **audit hash chain**.
- Keep all data **synthetic**; no individual-guilt prediction; human-in-the-loop.
- Do not add hosted embedding models — BGE-M3 is the sole embedder.
