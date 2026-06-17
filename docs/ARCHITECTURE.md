# Satyam — Complete Architecture & Technical Documentation

> **Project:** Satyam — Bilingual Voice-Enabled Crime Intelligence AI
> **Event:** Datathon 2026 · KSP × hack2skill
> **Stack:** Python 3.11 · FastAPI · PostgreSQL 16 + pgvector · React 19 · TanStack Start

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [System Architecture Diagram](#3-system-architecture-diagram)
4. [Database Schema](#4-database-schema)
5. [Backend Pipeline — Detailed Workflows](#5-backend-pipeline--detailed-workflows)
6. [Model Layer](#6-model-layer)
7. [Voice Pipeline](#7-voice-pipeline)
8. [Security — RBAC · RLS · Masking · Audit](#8-security--rbac--rls--masking--audit)
9. [Intelligence Features (PS1–PS8)](#9-intelligence-features-ps1ps8)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Bilingual Support — EN + KN](#11-bilingual-support--en--kn)
12. [API Reference Summary](#12-api-reference-summary)
13. [Configuration & Environment](#13-configuration--environment)
14. [Deployment](#14-deployment)
15. [Two-Phase Roadmap](#15-two-phase-roadmap)

---

## 1. Project Overview

Satyam is a **bilingual (English + Kannada), voice-enabled conversational AI** for Karnataka State Police crime intelligence. An officer asks a question in natural language — typed or spoken — and Satyam:

1. Auto-detects English vs Kannada, routes the intent, and runs a **grounded** answer pipeline:
   - **Text-to-SQL** → LLM proposes SQL → `sqlglot` guard enforces safety → read-only RLS-scoped execution
   - **RAG** → BGE-M3 embeds the query → pgvector ANN search → cross-encoder rerank
   - **Analytics** → crime hotspots, ego/link networks, trend clustering
2. Composes a **cited answer** and streams it token-by-token over SSE.
3. Enforces **RBAC/ABAC** (14 KSP ranks, 4 clearance levels) + **Postgres Row-Level Security** on every lane.
4. Appends every query to a **SHA-256 hash-chained tamper-evident audit log**.
5. Can **speak the answer in Kannada** via Sarvam Bulbul v3 TTS and navigate to any screen by voice command.

All data is **100% synthetic** — no real FIRs or PII are stored anywhere.

---

## 2. Tech Stack

### 2.1 Backend

| Category | Technology | Version / Notes |
|----------|-----------|-----------------|
| Language | Python | 3.11+ |
| Web framework | FastAPI | Async, SSE streaming |
| ORM | SQLAlchemy (async) + asyncpg | Async Postgres driver |
| Database | PostgreSQL 16 | Primary store; Neon cloud (60% dataset) + local PG17 (100%) |
| Vector search | pgvector 0.8.x | HNSW index, cosine similarity, `vector(1024)` / `halfvec(1024)` |
| Cache | Redis | Conversation state |
| Auth | PyJWT (HS256) | 14 KSP rank claims |
| SQL safety | sqlglot | Parse + validate + rewrite every LLM-generated SQL |
| Structured logging | structlog | JSON format |
| Settings | pydantic-settings | Env-file based config |
| Task runner | Makefile | Seed, migrate, test targets |

### 2.2 AI / Model Services

| Role | Model / Service | Provider | Notes |
|------|----------------|----------|-------|
| Brain LLM (chat, slots, routing) | **Gemini 2.5 Flash** | Google | Default; best accuracy |
| Fallback LLM | **Llama-3.3-70B-Versatile** | Groq | Low-latency outage fallback |
| Text-to-SQL (open-model option) | **qwen3-coder-next:cloud** | Ollama Cloud | 80B MoE / 3B active, 256K ctx |
| Embeddings (RAG) | **BGE-M3** | BAAI (local) | 1024-dim, FP16, RTX 4070; sole embedder — never swappable |
| Reranking (RAG) | **bge-reranker-v2-m3** | BAAI (local) | FP16 cross-encoder |
| Kannada/English TTS | **Sarvam Bulbul v3** | Sarvam AI | Primary voice output |
| Kannada/English STT | **Sarvam Saaras v3** | Sarvam AI | Primary voice input |
| Machine translation | **Sarvam Mayura v1** | Sarvam AI | EN↔KN |
| Voice fallback | **Bhashini** | Govt of India | Free, no credit cap |

### 2.3 Frontend

| Category | Technology | Notes |
|----------|-----------|-------|
| Framework | React 19 | |
| Router / SSR | TanStack Start + TanStack Router | File-based routing |
| Build tool | Vite + Bun | |
| Styling | Tailwind CSS v4 | CSS custom properties for themes |
| Maps | Leaflet + leaflet.heat | Heatmap, pins, grid layers |
| Markdown | react-markdown + remark-gfm | AI answer rendering |
| i18n | Custom (`src/lib/i18n.tsx`) | 200+ EN→KN keys; no react-i18next |
| Font | Noto Sans Kannada | Google Fonts; auto-applied when `lang=kn` |
| Themes | 6 professional + 8 legacy | `data-theme` attribute on `<html>` |

### 2.4 Infrastructure

| Component | Technology |
|-----------|-----------|
| Containerisation | Docker + docker-compose |
| Cloud DB | Neon (PostgreSQL 16, pgvector 0.8.0) |
| Local DB | PostgreSQL 17 + pgvector 0.8.2 (built from source) |
| GPU (local demo) | NVIDIA RTX 4070 8 GB VRAM (BGE-M3 + reranker FP16) |

---

## 3. System Architecture Diagram

### 3.1 Top-Level System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OFFICER'S BROWSER                               │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Console  │  │  Map /   │  │ Network  │  │Forecast/ │  │ Audit /  │ │
│  │ (Chat +  │  │ Hotspot  │  │  Graph   │  │Trends/   │  │ Reports  │ │
│  │ Canvas)  │  │          │  │          │  │ Profile  │  │          │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       │              │              │              │              │      │
│       └──────────────┴──────────────┴──────────────┴──────────────┘     │
│                            TanStack Router                               │
│                         Shell.tsx (Voice Router)                        │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │  HTTPS / REST / SSE
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          FASTAPI BACKEND                                │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ API Layer  (app/api/routes/)                                    │     │
│  │  /auth  /chat(SSE)  /cases  /map  /network  /intelligence       │     │
│  │  /reports  /audit  /voice  /settings  /health                   │     │
│  └──────────────────────────┬─────────────────────────────────────┘     │
│                             │                                            │
│  ┌──────────────────────────▼─────────────────────────────────────┐     │
│  │ Grounded Pipeline  (app/pipeline/)                              │     │
│  │                                                                 │     │
│  │  guardrails → router → slots → orchestrator → tools → compose  │     │
│  └──────┬────────────┬──────────────┬──────────────────────────────┘     │
│         │            │              │                                     │
│  ┌──────▼───┐  ┌─────▼──────┐  ┌───▼──────────────────────────────┐    │
│  │  Model   │  │   Voice    │  │         Data Layer               │    │
│  │  Layer   │  │   Layer    │  │  PostgreSQL 16 + pgvector         │    │
│  │          │  │            │  │  Redis (conversation state)       │    │
│  │ Gemini   │  │  Sarvam    │  │  Audit log (hash-chained)         │    │
│  │ Groq     │  │  Bhashini  │  │                                   │    │
│  │ BGE-M3   │  │  Web Speech│  └───────────────────────────────────┘    │
│  │ Reranker │  │  (browser) │                                            │
│  └──────────┘  └────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Chat Request Flow (SSE)

```
Browser                    FastAPI                  Pipeline               DB
  │                           │                        │                   │
  │── POST /chat ─────────────▶                        │                   │
  │   { message, lang,        │                        │                   │
  │     conversation_id,      │── JWT decode ──────────▶                   │
  │     brain_engine,         │   → Principal          │                   │
  │     sql_engine }          │── set app.* GUCs ──────────────────────────▶
  │                           │   (RLS context)        │                   │
  │                           │── guardrails.precheck()▶                   │
  │                           │                        │── blocked? ──────▶│
  │                           │                        │                   │
  │                           │                        │── route() ────────▶
  │                           │                        │   Gemini classifies│
  │                           │                        │   intent + slots  │
  │                           │                        │                   │
  │◀── SSE: tool(router) ─────────────────────────────│                   │
  │                           │                        │                   │
  │                           │     [sql_query lane]   │                   │
  │                           │                        │── text_to_sql() ──▶
  │                           │                        │   LLM → SQL       │
  │                           │                        │── sql_guard() ────│
  │                           │                        │   sqlglot validate│
  │                           │                        │── execute (RLS) ──▶
  │◀── SSE: tool(text_to_sql) ────────────────────────│                   │
  │                           │                        │                   │
  │                           │     [narrative lane]   │                   │
  │                           │                        │── BGE-M3 embed ───▶
  │                           │                        │── pgvector ANN ───▶
  │                           │                        │── reranker ───────▶
  │◀── SSE: tool(rag) ────────────────────────────────│                   │
  │                           │                        │                   │
  │                           │                        │── _compose() ─────▶
  │                           │                        │   Gemini + context│
  │◀── SSE: token ... ────────────────────────────────│  (streamed chunks)│
  │◀── SSE: citation ─────────────────────────────────│                   │
  │◀── SSE: done ─────────────────────────────────────│                   │
  │                           │── mask PII ────────────▶                   │
  │                           │── write_audit() ───────────────────────────▶
```

---

## 4. Database Schema

### 4.1 Core Tables (`backend/migrations/002_schema_v2.sql`)

```sql
-- 14 KSP ranks with scope + clearance
rank_access(rank TEXT PK, scope_level, clearance INT, gazetted BOOL)

-- Org hierarchy
stations(station_id INT PK, station_name, district, "range", latitude, longitude)
officers(officer_id INT PK, name, rank, station_id FK)

-- Auth
users(user_id SERIAL PK, username, password_hash, officer_id FK, assigned_rank FK)
v_officer_session  -- view: resolves effective rank/scope/clearance per user

-- Crime data
cases(
  case_id INT PK, fir_number TEXT, fir_year INT,
  station_id FK, station_name, district, "range",
  crime_type, crime_category, legal_code (IPC|BNS),
  sections TEXT,          -- pipe-joined IPC/BNS sections
  fir_type, status, complaint_mode, motive,
  report_date, incident_date, place_of_offence,
  latitude FLOAT, longitude FLOAT,
  io_name, victim_count, accused_count, arrested_count,
  charge_sheeted BOOL, convicted BOOL
)

persons(
  person_id INT PK, name TEXT,   -- masked at API layer for low clearance
  gender, age INT, address TEXT, district TEXT,
  risk_score FLOAT
)

case_persons(
  case_id FK, person_id FK, role TEXT,  -- Accused/Victim/Complainant/Witness/Arrested/IO
  PRIMARY KEY (case_id, person_id, role)
)

narratives(
  narrative_id INT PK, case_id FK,
  language TEXT,          -- 'en' | 'kn'
  body TEXT,
  body_tsv TSVECTOR,      -- GENERATED for full-text search
  embedding vector(1024)  -- BGE-M3 FP16; halfvec(1024) on Neon
)

-- Tamper-evident audit
audit_log(
  audit_id SERIAL PK, at TIMESTAMPTZ,
  user_id INT, action TEXT, query TEXT,
  result TEXT, src TEXT,
  row_hash TEXT           -- SHA-256(prev_hash || this_row)
)
```

### 4.2 PS4/PS7 Extension Tables

```sql
district_socio_economic_indicators(
  district TEXT PK, literacy_rate FLOAT,
  urbanization_percent FLOAT, income_index FLOAT,
  unemployment_rate FLOAT, poverty_index FLOAT
)

financial_accounts(account_id, person_id FK, account_type, bank_name, balance)
financial_transactions(txn_id, from_account FK, to_account FK, amount, txn_date, txn_type)
```

### 4.3 Row-Level Security

```sql
-- fn_scope_ok() gates every row based on app.* GUCs set per-request
CREATE FUNCTION fn_scope_ok(c cases) RETURNS BOOLEAN AS $$
  CASE current_setting('app.scope')
    WHEN 'state'    → TRUE (all rows)
    WHEN 'range'    → c."range" = current_setting('app.range')
    WHEN 'district' → c.district = current_setting('app.district')
    WHEN 'station'  → c.station_id = current_setting('app.station_id')::INT
  END
$$

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;
CREATE POLICY cases_select ON cases USING (fn_scope_ok(cases.*));
-- narratives inherit via EXISTS(SELECT 1 FROM cases WHERE case_id = narratives.case_id)
```

### 4.4 Dataset Row Counts

| Table | Neon cloud (60%) | Local PG17 (100%) |
|-------|-----------------|-------------------|
| stations | 1,074 | 1,074 |
| officers | 6,949 | 6,949 |
| cases | ~60,000 | 100,000 |
| persons | ~249,970 | 416,616 |
| case_persons | ~249,970 | 416,616 |
| narratives (en+kn) | ~120,000 | 200,000 |

Neon free tier sits at ~192 MB of a 512 MB cap. Financial tables (PS7) are local-only.

---

## 5. Backend Pipeline — Detailed Workflows

### 5.1 Pipeline Directory

```
app/pipeline/
  guardrails.py      ← step 1: input safety pre-check
  router.py          ← step 2: intent classification + slot extraction
  slots.py           ← step 2b: ConversationState, cross-turn slot merging
  orchestrator.py    ← step 3: fan-out to tools, compose, SSE emit
  prompts.py         ← system prompts (ROUTER, SQL, ANSWER)
  tools/
    text_to_sql.py   ← sql_query lane: LLM → SQL → execute
    sql_guard.py     ← sqlglot parse + validate + rewrite
    rag.py           ← narrative_search lane: embed → ANN → rerank
    analytics.py     ← hotspot, ego_network, station_breakdown
```

---

### 5.2 Step 1 — Guardrails (`guardrails.py`)

```
User message
     │
     ▼
precheck(message)
  ├── injection patterns detected? → BLOCK (yield PipelineEvent("blocked"))
  ├── out-of-scope (non-police topic)? → BLOCK
  └── clean → continue to router

safety_fallback(reason)
  └── on Gemini safety-filter fire → templated DB-fallback response
      (never surfaces model error messages to the user)
```

---

### 5.3 Step 2 — Router (`router.py`)

```
User message + brain_engine override
     │
     ▼
get_llm(brain_engine).complete(
  system = ROUTER_SYSTEM,        ← describes 6 intents + slot schema
  json_schema = ROUTER_SCHEMA,   ← forces structured output
  temperature = 0.0
)
     │
     ├── LLM success → parse JSON { intent, slots }
     │     └── strip markdown fences if Gemini wraps in ```json … ```
     │
     └── LLM failure (429 / timeout / safety block)
           └── _keyword_intent(message)   ← cheap regex fallback
                 Priority order:
                 1. SQL signals: "top", "how many", "list", "count", "cases", "trend" → sql_query
                 2. hotspot signals: "map", "hotspot", "area", "heatmap" → hotspot
                 3. network signals: "link", "connection", "associate" → network
                 4. report signals: "report", "export", "pdf" → report
                 5. narrative signals: "modus", "similar to", "find cases about" → narrative_search
                 6. default → smalltalk

Intents:
  sql_query        → Text-to-SQL lane
  narrative_search → RAG lane
  hotspot          → analytics.hotspots()
  network          → analytics.ego_network()
  report           → report assembly hint
  smalltalk        → help message
```

**Slot schema extracted from every message:**

| Slot | Example value |
|------|--------------|
| `crime_type` | `"Theft"`, `"Murder"` |
| `district` | `"Bengaluru City"` |
| `range_name` | `"Bengaluru Range"` |
| `date_from` | `"2024-01-01"` |
| `date_to` | `"2024-12-31"` |
| `person` | `"Ramesh Kumar"` |
| `fir_number` | `"FIR-2024-00123"` |
| `status` | `"Under Investigation"` |
| `legal_code` | `"IPC"`, `"BNS"` |

---

### 5.4 Step 3a — Text-to-SQL Lane (`text_to_sql.py` + `sql_guard.py`)

```
User question + slots + sql_engine override
     │
     ▼
get_sql_llm(sql_engine).complete(
  system = SQL_SYSTEM,           ← lists 6 allowed tables + all columns
  json_schema = SQL_SCHEMA,      ← forces { "sql": "..." }
  temperature = 0.0
)
     │
     ▼
_strip_markdown_fences(raw)      ← Gemini 2.5 Flash may wrap in ```json
     │
     ▼
json.loads(cleaned)["sql"]
     │
     ▼
sql_guard.sanitize(sql)
  ├── sqlglot.parse(sql, read="postgres")   ← parse → AST
  ├── single statement only
  ├── must be exp.Select (no INSERT/UPDATE/DELETE/DDL)
  ├── table allow-list: {cases, persons, case_persons,
  │                       stations, officers, narratives}
  ├── auto-inject LIMIT 200 if missing
  └── cap any existing LIMIT at 200
     │
     ▼ (safe SQL)
session.execute(text(safe_sql))    ← runs under RLS (fn_scope_ok gates rows)
     │
     ▼
_mask_rows(rows, principal)
  └── for clearance < L3: redact name, io_name,
      place_of_offence, address from result rows
     │
     ▼
rows[:200] returned as JSON context
```

**SQL_SYSTEM prompt key rules (enforced in prompt text):**
- Single read-only SELECT
- Only the 6 allow-listed tables
- Always `LIMIT 200`
- `"range"` must be quoted (SQL keyword)
- Return raw JSON `{"sql": "..."}` — no markdown fences, no explanation

---

### 5.5 Step 3b — RAG Lane (`rag.py`)

```
User query
     │
     ▼
BGE-M3.encode(query)             ← 1024-dim embedding, FP16, local GPU
     │
     ▼
pgvector ANN search
  SELECT narrative_id, case_id, body,
         embedding <=> :qvec AS distance
  FROM narratives
  WHERE language = :lang
  ORDER BY distance
  LIMIT 20                       ← candidate pool (k*4)
     │
     ▼
bge-reranker-v2-m3.score(
  [(query, narrative.body) for narrative in candidates]
)                                ← cross-encoder relevance scores
     │
     ▼
top-k = 5 reranked hits
  [{ case_id, fir_number, body_snippet, score }]
     │
     ▼
returned as JSON context for _compose()
```

---

### 5.6 Step 3c — Analytics Lane (`analytics.py`)

```
hotspots(session, crime_type?, district?)
  SELECT latitude, longitude, crime_type, COUNT(*) AS weight
  FROM cases
  WHERE fn_scope_ok(cases.*)          ← RLS automatic
    [AND crime_type = :ct]
    [AND district = :d]
  GROUP BY lat-cell, lng-cell, crime_type
  → List[{ lat, lng, weight, label }]

station_breakdown(session, limit=25)
  SELECT station_name, COUNT(*) firs,
         SUM(charge_sheeted::int) cleared,
         array_agg(monthly_count) trend,
         MODE() WITHIN GROUP (ORDER BY crime_type) top_legal_code
  FROM cases GROUP BY station_name
  → List[StationRow]

ego_network(session, person_id)
  1. Resolve name → person_id if string given
     SELECT person_id FROM persons WHERE name ILIKE :n
  2. Find all shared cases
     SELECT case_id FROM case_persons WHERE person_id = :pid
  3. Find all co-accused in those cases
     SELECT DISTINCT person_id FROM case_persons WHERE case_id IN (...)
  4. Build NetworkX Graph → nodes + edges JSON
  → { nodes: [...], edges: [...] }

victim_offender_network(session, person_id)
  Same as ego_network but filters to Victim role for the seed
```

---

### 5.7 Step 4 — Compose (`orchestrator._compose()`)

```
question + context (JSON rows/narratives) + lang
     │
     ▼
ANSWER_SYSTEM prompt instructs:
  1. Open with ONE sentence: "Found X FIRs in Y."
  2. Render results as GFM Markdown TABLE
     (FIR | Year | Crime Type | Status | Station)
  3. ≤3 records → bullet list acceptable
  4. Bold only for lead summary / table headers
  5. Keep IPC sections / FIR IDs / dates verbatim
  6. Cite each row inline as [ref]
  7. >10 rows → show 10, add "Showing 10 of N — narrow by …"
  8. PROTECTED crimes → remind about victim PII restriction
  + if lang == "kn": "Respond in Kannada. Keep section numbers / FIR IDs / dates as-is."
     │
     ▼
get_llm(brain_engine).complete(prompt, temperature=0.2)
     │
     ├── success → stream answer.split(" ") as SSE token events
     │
     └── failure → get_fallback_llm().complete(...)   ← Groq
           └── failure → hardcoded "I found the records but couldn't generate a summary"
```

---

## 6. Model Layer

### 6.1 Model Registry (`app/models/registry.py`)

```python
get_llm(engine?)          → GeminiLLM | GroqLLM | LocalLLM
get_sql_llm(engine?)      → GeminiLLM | OllamaCloudLLM | LocalLLM
get_fallback_llm()        → GroqLLM (always Groq)
get_stt(backend?)         → SarvamSTT | BhashiniSTT | WhisperSTT
get_tts(backend?)         → SarvamTTS | GoogleTTS | BhashiniTTS | ParlerTTS
get_translator(backend?)  → SarvamTranslator | BhashiniTranslator
get_embedder()            → BGEM3Embedder  (always local, lru_cache)
get_reranker()            → BGEReranker    (always local, lru_cache)
```

All factories use `@lru_cache(maxsize=None)` per argument value — per-request engine overrides are cached efficiently; no re-instantiation on repeated calls.

---

### 6.2 Gemini 2.5 Flash (`app/models/api/gemini.py`)

| Property | Value |
|----------|-------|
| Model ID | `gemini-2.5-flash` |
| Provider | Google AI (via `google-generativeai`) |
| Roles | Brain (chat, routing, composition) + Text-to-SQL |
| `complete()` | Non-streaming; supports `json_schema` for forced structured output |
| `stream()` | Token-by-token streaming for compose answers |
| Demo mode | Returns deterministic stubs when `GEMINI_API_KEY` is unset |
| Fence stripping | `_strip_markdown_fences()` applied before any JSON parse — Gemini 2.5 Flash sometimes wraps JSON in ` ```json ``` ` despite instructions |

---

### 6.3 Groq — Llama-3.3-70B-Versatile (`app/models/api/groq.py`)

| Property | Value |
|----------|-------|
| Model ID | `llama-3.3-70b-versatile` |
| Provider | Groq Cloud |
| Role | Low-latency fallback for brain + compose; always used by `get_fallback_llm()` |
| Latency | ~150 ms TTFT (vs ~800 ms Gemini) |
| Use case | On Gemini 429 / safety block / timeout |

---

### 6.4 Ollama Cloud — qwen3-coder-next (`app/models/api/ollama_cloud.py`)

| Property | Value |
|----------|-------|
| Model ID | `qwen3-coder-next:cloud` |
| Provider | Ollama Cloud |
| Architecture | 80B MoE, 3B active params, 256K context, tool-calling |
| Role | Optional Text-to-SQL engine (selectable via Settings panel) |
| Free tier | Light usage, 5-hour sessions, weekly reset |

---

### 6.5 BGE-M3 Embedder (`app/models/local/embedder_bge.py`)

| Property | Value |
|----------|-------|
| Model | `BAAI/bge-m3` |
| Params | ~568M |
| Embedding dim | 1024 |
| Precision | FP16 on GPU, FP32 fallback CPU |
| VRAM | ~1.3 GB FP16 |
| Hardware | RTX 4070 8 GB (demo); CPU-capable |
| Critical constraint | **The sole embedder — not swappable** for a hosted API without re-embedding all 200K narrative rows. Stays local in both Phase 1 and Phase 2. |

---

### 6.6 BGE Reranker (`app/models/local/reranker_bge.py`)

| Property | Value |
|----------|-------|
| Model | `BAAI/bge-reranker-v2-m3` |
| Type | Cross-encoder (query × passage pair scoring) |
| Params | ~568M |
| Precision | FP16 |
| VRAM | ~1.1 GB FP16 |
| Combined VRAM (with BGE-M3) | ~2.4 GB weights, ~4–5 GB peak |
| Role | Re-ranks pgvector ANN candidates before returning top-k |

---

### 6.7 Sarvam Voice Suite (`app/models/api/sarvam.py`)

| Component | API endpoint | Role |
|-----------|-------------|------|
| **Saaras v3** (STT) | `POST /speech-to-text` | Converts officer speech (EN/KN) to text |
| **Bulbul v3** (TTS) | `POST /text-to-speech` | Speaks AI answers in English or Kannada |
| **Mayura v1** (MT) | `POST /translate` | EN↔KN machine translation |

- Demo mode: deterministic stubs when `SARVAM_API_KEY` is unset
- Free-tier credits are a **one-time grant** (no auto-renewal) — scripted demo TTS is pre-cached to conserve credits

---

### 6.8 Bhashini (`app/models/api/bhashini.py`)

| Property | Value |
|----------|-------|
| Provider | Government of India, MeitY |
| Cost | Free, no credit cap |
| Role | STT + TTS fallback when Sarvam is unavailable |
| Languages | Kannada, English, 20+ Indian languages |

---

## 7. Voice Pipeline

### 7.1 End-to-End Voice Flow

```
Officer speaks
     │
     ▼
Browser MediaRecorder (src/lib/voice/recorder.ts)
  └── captures WebM/Ogg audio blob
     │
     ▼
POST /voice/stt  { audio: base64, lang: "kn" | "en" | "auto" }
     │
     ▼
detectLang(text)  (src/lib/voice/lang.ts)
  ├── Kannada Unicode range U+0C80–U+0CFF → "kn"
  └── otherwise → "en"
     │
     ▼
SarvamSTT.transcribe(audio, language)   [primary]
  └── failure → BhashiniSTT.transcribe() [fallback]
     │
     ▼
transcript text → Shell.tsx voice router
  ├── navigation command? ("open map", "show network")
  │     └── navigate() to target route + sessionStorage.setItem("satyam:pending-voice")
  └── query? → window.dispatchEvent("satyam:voice-send", { text, lang })
                 └── console.tsx sendMessage(text, { speak: true, lang })
     │
     ▼
Normal chat pipeline (§5) produces answer
     │
     ▼
resolveLang(opts.lang, answer_text)  (src/lib/voice/lang.ts)
  ├── opts.lang starts with "kn" → "kn"
  ├── detectLang(answer_text) → "kn" → "kn"
  ├── UI toggle is KN → "kn"
  └── otherwise → "en"
     │
     ▼
speakViaSarvam(text, lang, rate)  (src/lib/voice/tts.ts)
  ├── backend = "sarvam"  → POST /voice/tts → Sarvam Bulbul v3
  ├── backend = "google"  → POST /voice/tts → Google Cloud TTS
  ├── backend = "bhashini" → POST /voice/tts → Bhashini TTS
  └── backend = "webspeech" → browser SpeechSynthesis API (offline)
     │
     ▼
Audio plays in browser
     └── onStart → dispatch "satyam:ai-state" { state: "speaking" }
     └── onEnd   → dispatch "satyam:ai-state" { state: "done" }
                    (conversation mode: re-activates microphone)
```

### 7.2 Conversation Mode

When "Start conversation" is toggled in the voice panel, the system enters a continuous loop:

```
speak "done" event
     → mic re-activates automatically
     → officer speaks next query
     → transcript → pipeline → answer → TTS → repeat
```

The voice panel (`src/routes/transcripts.tsx`) also saves transcripts locally with
Save / Send-to-chat / Delete controls.

### 7.3 Language Auto-Detection

```typescript
// src/lib/voice/lang.ts
detectLang(text: string): "en" | "kn"
  // Counts Kannada Unicode chars (U+0C80–U+0CFF)
  // Returns "kn" if > 20% of chars are Kannada
  // Returns "en" otherwise

resolveLang(hint?: string, text?: string): "en" | "kn"
  // hint "kn-IN" or "kn" → "kn"
  // hint "auto" or null → detectLang(text)
  // hint "en-IN" or "en" → "en"
```

---

## 8. Security — RBAC · RLS · Masking · Audit

### 8.1 JWT Auth

Every request carries a bearer JWT (HS256). The token payload:

```json
{
  "sub": "officer_id",
  "name": "R. Kumar",
  "rank": "PSI",
  "scope": "station",
  "clearance": 2,
  "station_id": 42,
  "district": "Bengaluru City",
  "range": "Bengaluru Range",
  "officer_id": 42,
  "exp": 1234567890
}
```

`get_principal()` in `app/api/deps.py` decodes the token and constructs a frozen `Principal` dataclass.

---

### 8.2 KSP Rank Hierarchy

| Rank | Scope | Clearance | Notes |
|------|-------|-----------|-------|
| DGP, ADGP, IGP | state | L4 | All 100K cases |
| DIG | range | L4 | Range-scoped |
| SP, Addl.SP | district | L4 | District-scoped |
| DySP | district | L3 | |
| CPI, PI, CI | station | L3 | Circle/Police Inspector |
| PSI, SI | station | L2 | Sub-Inspector |
| ASI | station | L2 | |
| HC | station | L1 | Head Constable |
| PC | station | L1 | Police Constable |

**Permission → minimum clearance:**

| Permission | Min Clearance | Granted to |
|-----------|--------------|-----------|
| `CHAT` | L1 | All ranks |
| `READ_CASE` | L1 | All ranks |
| `RUN_ANALYTICS` | L2 | PSI and above |
| `BUILD_REPORT` | L2 | PSI and above |
| `READ_SENSITIVE` | L3 | PI and above |
| `READ_AUDIT` | L3 | PI and above |
| `READ_PROTECTED` | L4 | SP and above |
| `ADMIN` | L4 | SP and above |

---

### 8.3 Row-Level Security (Postgres)

```
Per-request setup (app/db/rls.py):
  SET app.scope     = 'station'
  SET app.district  = 'Bengaluru City'
  SET app.range     = 'Bengaluru Range'
  SET app.station_id = '42'
  SET app.clearance = '2'

fn_scope_ok(cases.*) enforces:
  state    → no restriction
  range    → cases."range" = app.range
  district → cases.district = app.district
  station  → cases.station_id = app.station_id::INT
```

A PSI at station 42 sees only their station's ~1,000 cases. A DGP sees all 100K. No application code change needed — the DB enforces it automatically on every query.

---

### 8.4 Four-Tier PII Masking (`app/core/masking.py`)

Applied **after** DB execution, **before** API response serialization:

| Clearance | What happens |
|-----------|-------------|
| **L4** | Full access — all fields, all narratives |
| **L3** | Victim/complainant names on PROTECTED crimes masked; coordinates precise |
| **L2** | All person names masked (`"[MASKED]"`); place_of_offence redacted; coordinates coarsened to 2 decimal places |
| **L1** | Everything L2 + PROTECTED crime narratives hidden entirely; all coordinates coarsened |

**PROTECTED crimes** (trigger extra masking for L1–L3):
`POCSO`, `POCSO RAPE`, `RAPE`, `MOLESTATION`, `DOWRY DEATHS`, `SC/ST (ATROCITIES)`,
`SEXUAL HARASSMENT`, `STALKING`, `ASSAULT ON WOMEN`, `KIDNAPPING OF WOMEN AND GIRLS`

SQL result rows are also masked by `_mask_rows()` in `text_to_sql.py` for clearance < L3, so even LLM-generated query results never expose PII to under-cleared users.

---

### 8.5 Hash-Chained Audit Log (`app/core/audit.py`)

Every query — chat, case read, analytics call — is appended as:

```
row_hash = SHA-256(
  previous_row_hash
  + timestamp
  + user_id
  + action
  + query_text
  + result_summary
)
```

The chain can be verified in O(n) by the `/audit` endpoint. Any tampered row breaks the hash chain and is flagged as `CHAIN BROKEN`. The audit log is append-only — `satyam_app` role has `INSERT` only, no `UPDATE` or `DELETE`.

---

## 9. Intelligence Features (PS1–PS8)

### PS1 — Conversational Console

**Route:** `/console` · **Backend:** `/chat` (SSE) + `/map/hotspots` + `/map/station-breakdown`

The console has two panels:
- **Conversation rail** — streaming AI answers with citations; chat history persisted to `localStorage`
- **Results canvas** — live station breakdown table + Leaflet crime map (heat/pins/grid), synced to the same filters

```
Filter change (crime_type / district)
     │
     ▼
Promise.all([
  api.mapHotspots({ mode, crime_type, district })   → Leaflet heatmap points
  api.stationBreakdown({ limit: 25 })               → station table rows
])
     │
     ▼
Canvas re-renders with new data
```

---

### PS2 — Criminal Network Graph

**Route:** `/network` · **Backend:** `/network/rings`, `/network/case/{id}`, `/network/person/{id}`

```
Seed input (name or ID)
     │
     ▼
fetchGraph(seedName, depth)
  POST /network/entity  { entity_name, depth }
  → { nodes, edges, seed_id }
     │
     ▼
Force-directed physics simulation (custom canvas, no D3):
  - Repulsion between all node pairs
  - Spring force along edges
  - Centre gravity
  - Damping
  - 60 FPS requestAnimationFrame loop
     │
     ▼
Node inspector panel shows:
  risk_label, degree, linked FIRs, community_id
     │
     ▼
Click node → navigate to /profile/{person_id}
Click "Open Case" → CaseDrawer
```

Ring detection (`/network/rings`): flags groups of co-accused appearing in ≥3 shared cases with elevated combined risk score.

---

### PS3 — Trends & Patterns

**Route:** `/trends` · **Backend:** `/trends`, `/trends/seasonal`, `/mo/clusters`

```
Promise.all([
  getTrends(params)     → { series: TrendPoint[], deltas: {qoq%, yoy%} }
  getMOClusters()       → { clusters: MOCluster[] }
  getSeasonal(ct, dist) → { seasonal_peaks: SeasonalPeak[] }
])
     │
     ▼
Top crime types bar chart    ← tData("crime_type", ct, lang) for KN labels
QoQ / YoY delta cards
Seasonal peaks grid          ← lift_percent above baseline
MO clusters table            ← label, case_count, top_sections, action_hint
```

MO clustering groups cases with similar modus operandi using crime_type + sections + time_of_day features.

---

### PS4 — Socio-Economic Dashboard

**Route:** `/socio` · **Backend:** `/socio/demographics`, `/socio/correlation`, `/socio/risk-index`

**Requires:** SP+ (clearance L4 → `RUN_ANALYTICS` permission)

```
Promise.all([
  getSocioDemographics({ role: "Accused"|"Victim" })
    → age_buckets, gender counts, district breakdown
  getSocioCorrelation()
    → scatter: [{ district, crime_rate, literacy_rate, urbanization%, income_index }]
    → correlations: { literacy: -0.62, urbanization: 0.41, income: -0.55 }
  getSocialRiskIndex()
    → areas: [{ district, social_risk_score, drivers[] }]
])
     │
     ▼
Age distribution bar chart
Gender distribution bar chart     ← tData("gender", g, lang) for KN labels
Correlation matrix table          ← tData("district", d, lang) for KN labels
Social risk index cards
```

---

### PS5 — Offender Profile

**Route:** `/profile/:personId` · **Backend:** `/persons/{id}/profile`, `/persons/{id}/timeline`

```
Promise.all([
  getPersonProfile(pid)  → {
    display_name,
    risk: { score 0-100, label, breakdown: [{factor, score, reason}], notice }
    mo_fingerprint: { top_crime_types[], top_sections[], top_motives[], time_of_day }
    ring_membership: { ring_id, label } | null
    known_associates: [{ person_id, shared_case_count }]
  }
  getPersonTimeline(pid) → { events: [{ date, role, crime_type, status }] }
])
     │
     ▼
Risk gauge (0–100 score + Critical/High/Medium/Low badge)
Risk breakdown bar chart        ← factor contributions
MO fingerprint tags             ← tData("crime_type"), tData("motive") for KN
Ring membership warning banner
Known associates list           ← click → navigate to their profile
Crime history timeline          ← tData("role"), tData("crime_type"), tData("status") for KN
```

---

### PS6 — Similar Cases + Case Timeline

**Embedded in:** `CaseDrawer.tsx` tabs

```
[Similar Cases tab]
getSimilarCases(caseId, limit=5)
  → { matches: [{ case_id, fir_number, crime_type, district,
                  similarity_percent, why_similar[] }] }
     │
     ▼
Cards with similarity % badge + why_similar tags

[Timeline tab]
getCaseTimeline(caseId)
  → { events: [{ date, type, title, source_column }] }
     │
     ▼
Vertical timeline: date → event title + type badge
```

---

### PS7 — Financial Intelligence

**Tables:** `financial_accounts`, `financial_transactions`
**Status:** Schema + data loaded on local DB; query surface available via Text-to-SQL lane

Officers with L4 clearance can query:
```sql
SELECT p.name, fa.bank_name, SUM(ft.amount)
FROM persons p
JOIN financial_accounts fa ON fa.person_id = p.person_id
JOIN financial_transactions ft ON ft.from_account = fa.account_id
WHERE p.person_id = :pid
GROUP BY p.name, fa.bank_name
```

---

### PS8 — Early Warning & Forecast

**Route:** `/forecast` · **Backend:** `/forecast/hotspots`, `/forecast/alerts`, `/forecast/backtest`

```
Promise.all([
  getForecastAlerts()
    → { alerts: [{ alert_id, crime_type, district, risk_level,
                   patrol_window, why, recommended_action, fairness_note }] }
  getForecastHotspots({ horizon_days, crime_type?, district? })
    → { cells: [{ cell_id, lat, lng, risk_score 0-100,
                  risk_level, crime_type, why[] }] }
  getForecastBacktest()
    → { metric: "PAI", hit_rate_top_10_percent_cells: 0.72,
        window: "last_quarter", explanation }
])
     │
     ▼
Early Warning Alerts grid     ← RiskBadge with tData("risk_label") + tData("crime_type") + tData("district")
Forecast Risk Grid table      ← risk bar + expandable "why flagged" bullets
Backtest Validation panel     ← PAI score + ethics disclaimer
Filter bar: crime type, district, horizon (3/7/14/30 days)
Group-by-crime-type toggle    ← shows peak-risk cell per type
```

**Ethics guardrail:** every forecast page shows:
> "Decision support only — not predictive policing. Risk scores are based on historical reported incidents, not arrests or individual characteristics. Patrol decisions require human judgment."

---

## 10. Frontend Architecture

### 10.1 Route Map

```
/                     Landing page (hero video + SaaS stats)
/login                Demo login — 14 KSP ranks, MFA field, face-capture stub
/console              PS1: Chat + Results Canvas (map + station table)
/network              PS2: Force-directed network graph explorer
/trends               PS3: Trend bars + MO clusters + seasonal peaks
/socio                PS4: Socio-economic dashboard (SP+ only)
/profile/:personId    PS5: Offender profile + risk gauge + timeline
/reports              Report cart + template picker + PDF export
/audit                Hash-chain audit log (read-only)
/transcripts          Voice transcript store
/about                Project info
```

### 10.2 Shell & Global Voice Router (`Shell.tsx`)

The `Shell` component wraps every authenticated page and provides:

```
Shell.tsx
  ├── Navigation rail (Console / Map / Network / Reports / Audit)
  │     └── all labels go through t() → Kannada when KN
  ├── Language toggle EN ↔ KN
  │     └── setLang() → localStorage + document.documentElement.lang
  ├── Theme picker (6 professional + 8 legacy themes)
  ├── Voice button → opens voice panel (transcripts.tsx modal)
  ├── Settings gear → SettingsDialog (engine overrides)
  ├── Profile menu → ProfileMenu.tsx
  │
  └── Global voice-command router (satyam:voice-send event)
        ├── "open map"        → navigate("/map")
        ├── "show network"    → navigate("/network")
        ├── "open audit"      → navigate("/audit")
        ├── "show forecast"   → navigate("/forecast")
        ├── "connect the dots for X" → analytics.ego_network(X)
        └── anything else     → sendMessage() in console
```

### 10.3 CaseDrawer (`CaseDrawer.tsx`)

Slide-in drawer triggered from any screen (console table, network node click, similar cases):

```
Tabs: Summary | Persons | Timeline | Similar Cases | Map

Summary tab:
  api.caseById(caseId, lang)   ← ?lang=kn passes to backend
  Fields: crime_type, status, district, station, legal_code, date
          → all run through tData() for Kannada
  Sections: pipe-split, each rendered as §badge
  Narrative: backend prefers kn-language row when lang=kn
  Masked warning: shown when principal.clearance < required

Persons tab:
  persons[].role → tData("role", role, lang)

Timeline tab (lazy load on tab click):
  getCaseTimeline(caseId) → vertical event list

Similar Cases tab (lazy load on tab click):
  getSimilarCases(caseId, 5) → similarity cards with why_similar tags

Map tab:
  place_of_offence + lat/lng display
```

### 10.4 Settings Dialog (`SettingsDialog.tsx`)

Live engine overrides sent with every chat request:

```
localStorage key: "satyam.engine-settings"

Controls:
  Brain engine:    Gemini 2.5 Flash | Groq
  SQL engine:      Gemini 2.5 Flash | qwen3-coder-next (Ollama Cloud)
  Voice backend:   Sarvam | Google | Bhashini | Web Speech (browser)

loadEngineSettings() → { brainEngine, sqlEngine, voiceBackend }
  ↓ included in every streamChat() body
  ↓ overrides server-side BRAIN_ENGINE / SQL_ENGINE / VOICE_BACKEND
    for that request only
```

### 10.5 Theme System (`ThemePicker.tsx` + `styles.css`)

```css
/* 6 professional themes via data-theme attribute */
[data-theme="slate"]    { --primary: 215 25% 27%; ... }
[data-theme="indigo"]   { --primary: 243 75% 59%; ... }
[data-theme="forest"]   { --primary: 142 76% 36%; ... }
[data-theme="graphite"] { --primary: 220 13% 18%; ... }
[data-theme="midnight"] { --primary: 226 71% 40%; ... }
[data-theme="pine"]     { --primary: 173 80% 36%; ... }

/* Kannada font — applied globally when language is KN */
html[lang="kn"] {
  font-family: "Noto Sans Kannada", var(--font-sans);
}
```

---

## 11. Bilingual Support — EN + KN

### 11.1 Architecture Overview

```
Three independent layers — each covers a different type of content:

Layer 1: Static UI strings       → custom i18n DICT (src/lib/i18n.tsx)
Layer 2: Categorical DB values   → lookup dictionary (src/locales/kn-data.json)
Layer 3: Case narratives         → language column in DB + ?lang= API param
(Layer 4: AI-generated answers   → lang forwarded to LLM compose prompt)
```

### 11.2 Layer 1 — Static UI (`src/lib/i18n.tsx`)

```typescript
// Custom context (NOT react-i18next)
const DICT: Record<string, string> = {
  "Crime type":  "ಅಪರಾಧ ಪ್ರಕಾರ",
  "Status":      "ಸ್ಥಿತಿ",
  "By Station":  "ಠಾಣೆಯ ಪ್ರಕಾರ",
  // 200+ entries ...
};

// Usage in any component:
const t = useT();
<th>{t("By Station")}</th>   // → "ಠಾಣೆಯ ಪ್ರಕಾರ" when KN

// Lang toggle (Shell.tsx):
setLang("KN")
  → localStorage["fq-lang"] = "KN"
  → document.documentElement.lang = "kn"    // triggers CSS font rule
  → all t() calls return Kannada instantly (React context re-render)
```

### 11.3 Layer 2 — Categorical DB Values (`src/lib/tData.ts`)

```typescript
import knData from "@/locales/kn-data.json";

// tData(field, value, lang) → Kannada string | original English (fallback)
tData("crime_type", "Theft",            "KN") // → "ಕಳ್ಳತನ"
tData("status",     "Under Investigation", "KN") // → "ತನಿಖೆ ನಡೆಯುತ್ತಿದೆ"
tData("district",   "Bengaluru City",   "KN") // → "ಬೆಂಗಳೂರು ನಗರ"
tData("role",       "Accused",          "KN") // → "ಆರೋಪಿ"
tData("gender",     "Female",           "KN") // → "ಮಹಿಳೆ"
tData("risk_label", "High",             "KN") // → "ಅಧಿಕ"

// Falls back to English if value not in dict (never shows blank)
tData("crime_type", "Unknown Value",    "KN") // → "Unknown Value"
```

**Coverage in `kn-data.json`:**

| Field | Entry count | Sample |
|-------|------------|--------|
| `crime_type` | 40+ (UPPER + Title case variants) | Theft→ಕಳ್ಳತನ, POCSO→ಪೋಕ್ಸೋ |
| `status` | 13 | Open→ತೆರೆದಿದೆ, Charge Sheeted→ಆರೋಪಪಟ್ಟಿ |
| `district` | 41 districts + 4 special units | Bengaluru City→ಬೆಂಗಳೂರು ನಗರ |
| `role` | 7 | Victim→ಸಂತ್ರಸ್ತ, IO→ತನಿಖಾಧಿಕಾರಿ |
| `gender` | 5 | Male→ಪುರುಷ, Female→ಮಹಿಳೆ |
| `motive` | 13 | Financial Gain→ಆರ್ಥಿಕ ಲಾಭ |
| `risk_label` | 4 | Critical→ಗಂಭೀರ, Low→ಕಡಿಮೆ |
| `fir_type` | 4 | Heinous→ಗಂಭೀರ |
| `complaint_mode` | 6 | Written→ಲಿಖಿತ |

**Applied in:** `CaseDrawer`, `console` (station table), `forecast` (alert cards + grid), `trends` (bar chart), `profile` (MO fingerprint + timeline), `socio` (gender chart + district table + risk index).

### 11.4 Layer 3 — Case Narratives (DB + API)

```
UI toggle → lang = "KN"
     │
     ▼
CaseDrawer: api.caseById(id, "kn")
     │
     ▼
GET /cases/{id}?lang=kn
     │
     ▼
case_service.get_case(session, principal, case_id, lang="kn")
     │
     ├── SELECT * FROM narratives WHERE case_id=:id AND language='kn' LIMIT 1
     │     └── found → return kn narrative body
     └── not found → SELECT * FROM narratives WHERE case_id=:id AND language='en' LIMIT 1
                       └── English fallback (never blank)
```

### 11.5 Layer 4 — AI Answer Language

```python
# orchestrator._compose()
lang_directive = (
  "\n\nRespond in Kannada (ಕನ್ನಡ). "
  "Keep IPC section numbers, FIR identifiers, station names, "
  "and dates in their original form."
  if lang == "kn" else ""
)
prompt = f"Question: {question}\n\nGrounded data:\n{context}{lang_directive}"
```

The LLM composes the answer in Kannada. Proper nouns (station names, FIR numbers, dates, IDs, coordinates) are always kept verbatim.

---

## 12. API Reference Summary

### 12.1 Auth

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/auth/login` | `{ username, rank/role }` | `{ access_token, token_type, user }` |

### 12.2 Chat

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/chat` | SSE stream. Body: `{ message, lang, conversation_id?, brain_engine?, sql_engine?, voice_backend? }` |

SSE event types: `tool`, `token`, `citation`, `blocked`, `done`, `error`

### 12.3 Cases

| Method | Path | Query params | Notes |
|--------|------|-------------|-------|
| `GET` | `/cases` | `crime_type, district, status, limit` | RLS-scoped list |
| `GET` | `/cases/{id}` | `lang=en\|kn` | Full case + persons + narrative |
| `GET` | `/cases/{id}/similar` | `limit=5` | RAG similarity search |
| `GET` | `/cases/{id}/timeline` | — | Case event timeline |

### 12.4 Map / Analytics

| Method | Path | Body / Query | Notes |
|--------|------|-------------|-------|
| `POST` | `/map/hotspots` | `{ mode, crime_type?, district? }` | Lat/lng heat points |
| `POST` | `/map/station-breakdown` | `{ limit? }` | Station FIR table |
| `POST` | `/map/offender-trail` | `{ entity_name }` | Offender movement points |

### 12.5 Network

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/network/rings` | Top criminal rings |
| `GET` | `/network/case/{id}` | Case co-accused graph |
| `GET` | `/network/person/{id}` | Person ego-graph |
| `POST` | `/network/entity` | Graph by name or ID |

### 12.6 Intelligence (PS2–PS8)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/persons/{id}/profile` | Offender profile + risk |
| `GET` | `/persons/{id}/timeline` | Person crime history |
| `GET` | `/trends` | Trend series + deltas |
| `GET` | `/trends/seasonal` | Seasonal peaks |
| `GET` | `/mo/clusters` | MO cluster groups |
| `GET` | `/socio/demographics` | Age/gender/district breakdown |
| `GET` | `/socio/correlation` | Crime rate vs socio indicators |
| `GET` | `/socio/risk-index` | Social risk scores per district |
| `GET` | `/forecast/hotspots` | Predictive risk grid cells |
| `GET` | `/forecast/alerts` | Active early-warning alerts |
| `GET` | `/forecast/backtest` | PAI hit-rate validation |

### 12.7 Voice

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `POST` | `/voice/stt` | `{ audio: base64, lang }` | Speech → text |
| `POST` | `/voice/tts` | `{ text, lang, rate? }` | Text → audio |
| `POST` | `/voice/translate` | `{ text, source, target }` | MT EN↔KN |

### 12.8 Audit & Health

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/audit` | Hash-chain log (L3+ only) |
| `GET` | `/health` | Backend liveness |
| `GET` | `/health/models` | Model connectivity status |

---

## 13. Configuration & Environment

### 13.1 All Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| **Infra** | | |
| `DATABASE_URL` | local asyncpg URL | Primary DB — Neon cloud or local PG17 |
| `SEED_DATABASE_URL` | local owner URL | Migration + seed (superuser) |
| `LOCAL_DATABASE_URL` | local app URL | Local PG17 for Settings panel switch |
| `REDIS_URL` | `redis://localhost:6379/0` | Conversation state cache |
| **Auth** | | |
| `JWT_SECRET` | `change-me-in-production` | HS256 token signing |
| `JWT_ALG` | `HS256` | Algorithm |
| `JWT_EXPIRE_MINUTES` | `480` | 8-hour sessions |
| **Model switches** | | |
| `MODEL_BACKEND` | `api` | `api` \| `local` — compute plane |
| `BRAIN_ENGINE` | `gemini` | `gemini` \| `groq` |
| `SQL_ENGINE` | `gemini` | `gemini` \| `qwen3-coder-next` |
| `VOICE_BACKEND` | `sarvam` | `sarvam` \| `google` \| `bhashini` |
| **Model keys** | | |
| `GEMINI_API_KEY` | `""` | Gemini 2.5 Flash |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model ID |
| `GROQ_API_KEY` | `""` | Groq Llama-3.3-70B |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model ID |
| `SARVAM_API_KEY` | `""` | Bulbul v3 / Saaras v3 / Mayura v1 |
| `GOOGLE_TTS_API_KEY` | `""` | Google Cloud TTS/STT |
| `BHASHINI_API_KEY` | `""` | Bhashini |
| `BHASHINI_USER_ID` | `""` | Bhashini user |
| `OLLAMA_CLOUD_URL` | `https://api.ollama.com` | Ollama Cloud base URL |
| `OLLAMA_CLOUD_API_KEY` | `""` | Ollama Cloud |
| `OLLAMA_CLOUD_SQL_MODEL` | `qwen3-coder-next:cloud` | SQL model ID |
| **Local models** | | |
| `EMBEDDING_MODEL_PATH` | `models/bge-m3` | BGE-M3 weights path |
| `RERANKER_MODEL_PATH` | `models/bge-reranker-v2-m3` | Reranker weights path |
| `MODEL_DEVICE` | `cuda` | `cuda` \| `cpu` |
| `MODEL_FP16` | `true` | Half-precision inference |
| `EMBEDDING_DIM` | `1024` | BGE-M3 output dimension |
| `VECTOR_TYPE` | `vector` | `vector` (local) \| `halfvec` (Neon) |
| **Frontend** | | |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Frontend → backend base URL |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins |

### 13.2 Demo Mode

When `GEMINI_API_KEY` and `GROQ_API_KEY` are both empty and `MODEL_BACKEND=api`,
`Settings.demo_mode = True`. All model adapters return deterministic stub responses so
the UI and pipeline can be exercised without any API keys.

### 13.3 Database URL Formats

```bash
# Neon cloud (ssl required)
DATABASE_URL=postgresql+asyncpg://user:pass@ep-xxx.c-2.us-east-1.aws.neon.tech/neondb?ssl=require

# Local PostgreSQL 17
DATABASE_URL=postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam

# halfvec for Neon (saves storage vs vector)
VECTOR_TYPE=halfvec
```

---

## 14. Deployment

### 14.1 Docker Compose (recommended for judges)

```yaml
# docker-compose.yml runs 4 services:
services:
  db:       postgres:16 + pgvector   # port 5432
  redis:    redis:7-alpine            # port 6379
  backend:  python:3.11-slim          # port 8000; mounts 002_schema_v2.sql
  frontend: node:20-alpine (bun)      # port 3000
```

```bash
cp .env.example .env    # fill GEMINI_API_KEY etc.
docker compose up --build
# frontend → http://localhost:3000
# backend docs → http://localhost:8000/docs
```

### 14.2 Local Dev

```bash
# ── Backend ───────────────────────────────────────────────────────
cd backend
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt

# Start Postgres + Redis via Docker:
docker compose up db redis -d

# Apply schema + seed
psql "$DATABASE_URL" -f migrations/002_schema_v2.sql
python -m seed.load_seed          # loads CSVs via asyncpg COPY

# Start backend
uvicorn app.main:app --reload --port 8000

# ── Frontend ──────────────────────────────────────────────────────
cd frontend
bun install          # or: npm install
bun run dev          # or: npm run dev
# → http://localhost:3000

# ── Embed narratives (optional — needs GPU) ───────────────────────
cd backend
python -m seed.embed_narratives   # fills narratives.embedding column
```

### 14.3 Database Tracks

| Track | DATABASE_URL points to | Dataset |
|-------|------------------------|---------|
| **Cloud (Neon)** | Neon pooler URL + `ssl=require` | 60% (~192 MB, under 512 MB cap) |
| **Local (PG17)** | `localhost:5432/satyam` | 100% (416K persons, 200K narratives) |

Switch by changing `DATABASE_URL` in `backend/.env` — no code changes needed.

---

## 15. Two-Phase Roadmap

### Phase 1 — Hackathon Demo (current)

| Layer | Technology |
|-------|-----------|
| Brain / chat / routing | Gemini 2.5 Flash (API) |
| Text-to-SQL | Gemini 2.5 Flash or qwen3-coder-next:cloud |
| LLM fallback | Groq Llama-3.3-70B |
| Embeddings | BGE-M3 (local GPU, FP16) |
| Reranking | bge-reranker-v2-m3 (local GPU, FP16) |
| Voice | Sarvam Bulbul v3 TTS + Saaras v3 STT + Mayura v1 MT |
| Voice fallback | Bhashini (govt, free) |
| Database | Neon cloud PG16 + local PG17 |
| Data | 100% synthetic — no real KSP FIR data |

### Phase 2 — Sovereign On-Premises Deployment

| Layer | Technology |
|-------|-----------|
| Brain / chat | Sarvam-M or Sarvam 30B (Indian LLM, on-prem) |
| Text-to-SQL | Qwen2.5-Coder-7B or Qwen3-Coder-30B (local) |
| Voice | Bhashini (primary, govt) + Sarvam (Indian) |
| Translation | IndicTrans2, AI4Bharat IndicConformer |
| Embeddings | BGE-M3 (same model, stays local) |
| Database | On-premises PostgreSQL, behind the KSP firewall |
| Data | Live KSP FIR records |

**Sovereignty principle:** External cloud APIs (Gemini, Groq, Sarvam, Neon) are
acceptable **only with synthetic data**. Once live KSP data is involved, every
component must run on-premises or on India-hosted infrastructure. The application
code requires **only env-var changes** (`MODEL_BACKEND=local`, new model paths) —
no architectural rewrites.

---

## Appendix — File Tree (Abridged)

```
satyam/
├── backend/
│   ├── app/
│   │   ├── api/routes/      auth, chat, cases, map, network, intelligence,
│   │   │                    reports, audit, voice, settings, health
│   │   ├── core/            rbac, masking, audit, security
│   │   ├── db/              models (ORM), rls, session
│   │   ├── models/
│   │   │   ├── api/         gemini, groq, sarvam, bhashini, ollama_cloud, google_voice
│   │   │   └── local/       embedder_bge, reranker_bge, llm_local (stub),
│   │   │                    stt_whisper (stub), tts_parler (stub)
│   │   ├── pipeline/        guardrails, router, slots, orchestrator, prompts
│   │   │   └── tools/       text_to_sql, sql_guard, rag, analytics
│   │   ├── schemas/         auth, chat, case, intelligence, map, network, report, voice
│   │   ├── services/        case, chat, intelligence, map, network, report
│   │   ├── config.py        Pydantic Settings — all env vars
│   │   └── main.py          FastAPI app factory, CORS, router mounts
│   ├── migrations/          002_schema_v2.sql, teardown.sql
│   └── seed/                load_seed.py, embed_narratives.py
│
├── frontend/src/
│   ├── routes/              __root, index, login, console, network, trends,
│   │                        forecast, socio, profile.$personId, reports,
│   │                        audit, transcripts, about
│   ├── components/          Shell, CaseDrawer, CrimeMap, ThemePicker,
│   │                        SettingsDialog, ProfileMenu, AccountManager,
│   │                        LandingShell, DarkModeToggle
│   ├── lib/
│   │   ├── i18n.tsx         Custom i18n — 200+ EN→KN DICT entries
│   │   ├── tData.ts         Categorical DB value lookup
│   │   ├── api/
│   │   │   ├── client.ts    Typed REST + SSE streamChat()
│   │   │   └── intelligence.ts  PS2–PS8 typed wrappers
│   │   └── voice/           tts.ts, recorder.ts, lang.ts
│   ├── locales/
│   │   ├── kn-data.json     Kannada lookup — 9 fields, 150+ entries
│   │   └── en.json          Reference copy
│   └── styles.css           Tailwind + 6 data-theme blocks + html[lang=kn] rule
│
├── docs/
│   └── ARCHITECTURE.md      ← this file
├── docker-compose.yml
├── DATABASE.md
└── AGENTS.md
```

---

*Last updated: 2026-06-17 · Satyam v1.0 · Datathon 2026 KSP × hack2skill*
