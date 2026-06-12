# Satyam — Backend

Conversational AI for the KSP crime database. FastAPI + PostgreSQL/pgvector +
Redis, with a router-first grounded pipeline and a swappable model layer
(`MODEL_BACKEND=api|local`).

> Synthetic data only. Records describe *reported* crime, not ground truth. No
> individual-level prediction, no residence profiling, human-in-the-loop, DPDP
> Act 2023 aligned.

## Stack

| Layer | Choice |
|------|--------|
| API | FastAPI (async), SSE streaming for chat |
| DB | PostgreSQL 16 + pgvector (hybrid retrieval) |
| Cache / state | Redis (conversation slots) |
| Auth | Own OIDC/JWT (HS256), role switcher for demo |
| Access control | RBAC + ABAC, enforced again by Postgres RLS |
| Audit | Hash-chained, tamper-evident log |
| Models (api lane) | Gemini 2.5 Flash (chat/Text-to-SQL), Bhashini (Kannada STT/TTS/MT), Groq (low-latency fallback) |
| Embeddings | BGE-M3 (local, sole embedder — no hosted lane) |
| Models (local lane) | vLLM/Ollama, BGE-M3, Whisper/IndicConformer, Indic-Parler-TTS |
| Analytics | NetworkX (link analysis), grouped SQL hotspots |
| SQL safety | sqlglot allow-list + LIMIT enforcement |

## Quick start (demo mode, no keys needed)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # works out of the box in demo mode
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

With no model API keys set, every model lane returns deterministic demo output,
so the whole pipeline runs end-to-end offline. Add keys in `.env` to go live.

## With a database

```bash
psql "$DATABASE_URL" -f migrations/001_init.sql
python -m seed.seed      # loads synthetic cases + computes BGE-M3 embeddings
```

## Docker (full stack)

```bash
docker compose up --build    # postgres+pgvector, redis, backend, frontend
```

## Tests

```bash
pytest -q     # unit tests run in demo mode, no DB required
```

## Model backends

`MODEL_BACKEND=api` (default) uses hosted free-tier lanes. `MODEL_BACKEND=local`
swaps in the on-prem stubs under `app/models/local/` — drop your real weights
there (vLLM/Ollama endpoint, BGE-M3, Whisper, Parler-TTS) without touching the
pipeline. Embeddings are always BGE-M3.

## Gemini safety notes (baked into `app/models/api/gemini.py`)

- Use `BLOCK_ONLY_HIGH` / `OFF` thresholds. `BLOCK_NONE` is **restricted**
  (allowlist or monthly-invoiced billing) and unavailable on a free key.
- Child-safety filters are always-on and cannot be disabled — the client raises
  `BlockedByModel`, and the pipeline falls back to a templated DB answer or the
  Groq open-model lane.
- Search grounding disabled; `responseSchema` + temperature 0 for Text-to-SQL
  and slot extraction; key stays server-side; 429 backoff via tenacity.

## Layout

```
app/
  api/        deps + routes (health, auth, chat-SSE, cases, map, network, reports, audit)
  core/       security (JWT), rbac (RBAC+ABAC), audit (hash chain), masking
  db/         async engine/session, RLS context, ORM models
  models/     base interfaces, registry, api/* lanes, local/* stubs
  pipeline/   router, slots, guardrails, prompts, orchestrator, tools/*
  schemas/    Pydantic DTOs
  services/   case/map/network/report/chat services
migrations/   001_init.sql (schema + pgvector + RLS + audit)
seed/         synthetic generator + loader
tests/        unit tests (demo mode)
```
