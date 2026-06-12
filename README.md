# Satyam — Conversational AI for the KSP Crime Database

Satyam is a bilingual (English / Kannada), voice-enabled conversational AI workspace
for police crime intelligence. Officers ask questions in natural language; Satyam
translates them into **guarded, read-only SQL** and **grounded retrieval** over a
crime database, then returns cited answers, maps, network graphs, and court-ready
reports — with role-based access control and a tamper-evident audit trail.

> All data shipped in this repo is **synthetic**. Satyam never predicts individual
> guilt and keeps a human in the loop for every sensitive action.

## Monorepo layout

```
satyam/
  backend/     FastAPI service: grounded pipeline, RBAC/ABAC, RLS, audit, model adapters
  frontend/    React 19 + TanStack Start UI (Console, Map, Network, Case, Reports, Audit)
  docs/        Architecture notes
  docker-compose.yml   Postgres(+pgvector) + Redis + backend + frontend
```

## The pipeline (router-first, grounded)

```
user ─▶ guardrails ─▶ router ─▶ ┌─ catalog / schema lookup
                                ├─ Text-to-SQL  (LLM → sqlglot guard → RLS-scoped read)
                                ├─ RAG          (BGE-M3 embed → pgvector → rerank)
                                └─ analytics    (hotspots / ego-network / trends)
                       ─▶ compose grounded answer (+ citations) ─▶ audit ─▶ stream (SSE)
```

## Model strategy (3 free lanes; ML added later)

All model access goes through one adapter layer (`app/models`) selected by
`MODEL_BACKEND`:

| Capability   | `api` lane (default)            | `local` lane (add later)        |
|--------------|---------------------------------|---------------------------------|
| Chat / SQL   | Gemini 2.5 Flash                | Qwen2.5-Coder / Llama (vLLM)    |
| Indic STT/TTS/MT | Bhashini (primary) + Google | IndicConformer / Parler-TTS    |
| Fallback LLM | Groq (low latency)              | —                               |
| Embeddings   | BGE-M3 (local, sole embedder)   | BGE-M3                          |
| Reranker     | bge-reranker-v2-m3              | bge-reranker-v2-m3             |

The `local/` implementations are **interface-complete stubs** so you can drop in
real weights later without touching the pipeline.

## Quick start

```bash
cp .env.example .env            # fill secrets (or leave blank to run in demo mode)
docker compose up --build       # postgres + redis + backend + frontend
# backend  → http://localhost:8000  (docs at /docs)
# frontend → http://localhost:3000
```

Seed synthetic data:

```bash
docker compose exec backend python -m seed.seed
```

See `backend/README.md` for local (non-docker) development and `docs/ARCHITECTURE.md`
for the full design.
