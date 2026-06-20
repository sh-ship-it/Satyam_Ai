# Satyam — Complete Architecture & Technical Documentation

> **Project:** Satyam — Bilingual Voice-Enabled Crime Intelligence AI
> **Event:** Datathon 2026 · KSP × hack2skill
> **Stack:** Python 3.11 · FastAPI · PostgreSQL 16 + pgvector · React 19 · TanStack Start
> **Last updated:** 2026-06-21

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
16. [Bug Fixes Applied](#16-bug-fixes-applied)

---

## 1. Project Overview

Satyam is a **bilingual (English + Kannada), voice-enabled conversational AI** for Karnataka State Police crime intelligence. An officer asks a question in natural language — typed or spoken — and Satyam:

1. Auto-detects English vs Kannada, routes the intent, and runs a **grounded** answer pipeline:
   - **Text-to-SQL** → LLM proposes SQL → `sqlglot` guard enforces safety → read-only RLS-scoped execution. In demo/keyless mode, a deterministic `rule_sql.py` generator runs instead of the LLM stub.
   - **RAG** → BGE-M3 embeds the query → pgvector ANN search → bge-reranker-v2-m3 cross-encoder rerank.
   - **Analytics** → crime hotspots, ego/link networks, trend clustering, financial money trails.
2. Composes a **cited answer** streamed token-by-token over SSE. In demo mode, a grounded Markdown table is rendered without any LLM call.
3. Enforces **RBAC/ABAC** (14 KSP ranks, 4 clearance levels) + **Postgres Row-Level Security** on every lane.
4. Appends every query to a **SHA-256 hash-chained tamper-evident audit log**.
5. Can **speak the answer in Kannada** via Sarvam Bulbul v3 TTS and navigate to any screen by voice command.
6. All UI strings are fully bilingual (custom i18n DICT + `tData()` categorical lookup). Case narratives are served in Kannada when the language toggle is active (`?lang=kn`).

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
| NL→SQL fallback | `rule_sql.py` (custom) | Deterministic regex+ILIKE generator; runs in demo/keyless mode and on 0-row recovery |
| Structured logging | structlog | JSON format |
| Settings | pydantic-settings | Env-file based config |

### 2.2 AI / Model Services

| Role | Model / Service | Provider | Notes |
|------|----------------|----------|-------|
| Brain LLM (chat, slots, routing) | **Gemini 2.5 Flash** | Google | Default; best accuracy |
| Fallback LLM | **Llama-3.3-70B-Versatile** | Groq | Low-latency outage fallback |
| Text-to-SQL (open-model option) | **qwen3-coder-next:cloud** | Ollama Cloud | 80B MoE / 3B active, 256K ctx |
| Embeddings (RAG) | **BGE-M3** | BAAI (local) | 1024-dim, FP16, RTX 4070; sole embedder — not swappable |
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
| Categorical translation | `tData()` + `kn-data.json` | crime_type, status, district (41), role, gender, motive, risk_label |
| Font | Noto Sans Kannada | Auto-applied when `html[lang="kn"]` |
| Themes | 6 professional + 8 legacy | `data-theme` attribute on `<html>` |
| PDF export | `conversationPdf.ts` (custom) | Dependency-free; opens a branded print dialog |

### 2.4 Infrastructure

| Component | Technology |
|-----------|-----------|
| Containerisation | Docker + docker-compose |
| Cloud DB | Neon (PostgreSQL 16, pgvector 0.8.0) |
| Local DB | PostgreSQL 17 + pgvector 0.8.2 |
| GPU (local demo) | NVIDIA RTX 4070 8 GB VRAM (BGE-M3 + reranker FP16) |

---

## 3. System Architecture Diagram

### 3.1 Top-Level System

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          OFFICER'S BROWSER                                    │
│                                                                               │
│  Console  │  Network  │  Forecast  │  Trends  │  Profile  │  Reports │ Audit  │
│  (Chat+   │  (Graph+  │  (PS8)     │  (PS3)   │  (PS5)    │          │        │
│   Canvas) │  Finance+ │            │          │           │          │        │
│           │   Rings)  │            │          │           │          │        │
│                          TanStack Router · Shell.tsx (Voice Router)           │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │  HTTPS / REST / SSE
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            FASTAPI BACKEND                                    │
│  /auth  /chat(SSE)  /cases  /map  /network  /financial  /api/*  /health/*    │
│                                                                               │
│  Grounded Pipeline: guardrails → router → orchestrator → tools → compose     │
│  (demo_mode: rule_sql.py → _render_grounded() — no LLM required)             │
│                                                                               │
│  Model Layer   │  Voice Layer   │  Data Layer                                │
│  Gemini 2.5    │  Sarvam v3     │  PostgreSQL 16 + pgvector                  │
│  Groq fallback │  Bhashini      │  Redis (conversation state)                │
│  BGE-M3 local  │  Web Speech    │  audit_log (SHA-256 hash-chain)             │
│  Reranker local│  (browser)     │  financial_accounts / transactions          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Chat Request Flow (SSE)

```
Browser          FastAPI           Pipeline                 DB
  │                 │                  │                     │
  ├─POST /chat ────▶│                  │                     │
  │                 ├─JWT decode ──────▶                     │
  │                 ├─set app.* GUCs ──────────────────────▶│ (RLS context)
  │                 ├─guardrails.precheck() ─────▶           │
  │                 │                  │                     │
  │                 │   demo_mode?     │                     │
  │                 │   ├─Yes → rule_sql.build_sql()         │
  │                 │   └─No  → LLM generate_sql()           │
  │                 │                  ├─sqlglot sanitize()  │
  │                 │                  ├─run_sql() ─────────▶│ (RLS gates rows)
  │◀─SSE tokens ────────────────────────render_grounded() / _compose()
  │◀─SSE done ──────────────────────────────────────────────│
  │                 ├─mask PII ─────────▶                    │
  │                 └─write_audit() ──────────────────────▶ │
```

---

## 4. Database Schema

### 4.1 Core Tables (`backend/migrations/002_schema_v2.sql`)

| Table | PK | Key columns |
|-------|----|-------------|
| `rank_access` | `rank TEXT` | `scope_level`, `clearance`, `gazetted` (14 KSP ranks) |
| `stations` | `station_id INT` | `station_name`, `district`, `"range"`, `latitude`, `longitude` |
| `officers` | `officer_id INT` | `name`, `rank`, `station_id FK` |
| `users` | `user_id SERIAL` | `username`, `password_hash`, `assigned_rank FK` |
| `cases` | `case_id INT` | `fir_number`, `fir_year`, `crime_type`, `crime_category`, `legal_code`, `fir_type`, `status`, `district`, `station_name`, `report_date`, `incident_date`, `incident_time`, `sections`, `motive`, `complaint_mode`, `latitude`, `longitude` |
| `persons` | `person_id INT` | `name`, `gender`, `age`, `district` |
| `case_persons` | `(case_id, person_id, role)` | role CHECK: Accused/Victim/Complainant/Witness/Arrested/IO |
| `narratives` | `narrative_id INT` | `case_id FK`, `language` (en/kn), `body`, `body_tsv`, `embedding vector(1024)` |
| `audit_log` | `audit_id SERIAL` | `at`, `user_id`, `action`, `query_text`, `row_hash` (SHA-256 chain) |

### 4.2 PS4/PS7 Extension Tables

| Table | Purpose |
|-------|---------|
| `district_socio_economic_indicators` | Real `literacy_rate`, `urbanization_percent`, `income_index` per district — joined for true Pearson correlation |
| `financial_accounts` | Synthetic bank/wallet accounts linked to persons |
| `financial_transactions` | Synthetic transactions with `pattern_flag`, `is_suspicious`, `case_id` FK |

> **PS7 note:** `financial_accounts` and `financial_transactions` are intentionally **NOT** in the Text-to-SQL allow-list. They are accessed only via the dedicated `POST /financial/money-trail` service (clearance L2+, audit-logged). This prevents arbitrary LLM SQL from touching financial data.

### 4.3 RLS

`fn_scope_ok()` gates every case/narrative row to the officer's station/district/range/state scope via `app.*` GUCs set per-request.

### 4.4 Row Counts

| Table | Neon cloud (60%) | Local PG17 (100%) |
|-------|-----------------|-------------------|
| cases | ~60,000 | 100,000 |
| persons | ~249,970 | 416,616 |
| narratives (en+kn) | ~120,000 | 200,000 |
| financial_transactions | ~107,000 (local only) | ~107,000 |
| district_socio_economic_indicators | 41 | 41 |

---

## 5. Backend Pipeline — Detailed Workflows

### 5.1 Pipeline Directory

```
app/pipeline/
  guardrails.py        ← step 1: input safety pre-check
  router.py            ← step 2: intent classification (Gemini JSON-schema + keyword fallback)
  slots.py             ← step 2b: cross-turn slot merging
  orchestrator.py      ← step 3: fan-out to tools, compose/render, SSE emit
  prompts.py           ← ROUTER_SYSTEM, SQL_SYSTEM, ANSWER_SYSTEM
  tools/
    text_to_sql.py     ← LLM → SQL; demo_mode shortcut; 0-row recovery
    sql_guard.py       ← sqlglot: single SELECT, 6-table allow-list, LIMIT 200
    rule_sql.py        ← NEW: deterministic NL→SQL (demo/keyless/recovery)
    rag.py             ← BGE-M3 embed → pgvector ANN → reranker
    analytics.py       ← hotspot, ego_network, station_breakdown
```

### 5.2 Demo-mode / Keyless Operation (critical for judges)

When `GEMINI_API_KEY` and `GROQ_API_KEY` are both empty, `demo_mode = True`:

```
User query
  │
  ▼ generate_sql() detects demo_mode
  ├─ rule_sql.build_sql(question, slots)
  │   ├─ extracts place token (ILIKE district/station/range)
  │   ├─ maps crime keyword → ILIKE crime_type
  │   ├─ extracts year / date range
  │   └─ builds: COUNT query / top-N / list of recent cases
  │   └─ passes through sql_guard.sanitize() (safety unchanged)
  │
  ▼ run_sql() → rows from DB (real data)
  │
  ▼ orchestrator._compose() detects demo_mode
  └─ _render_grounded(question, context)
      ├─ COUNT query → "**142** total cases."
      ├─ top-N → Markdown table (Crime Type | Cases)
      └─ list → Markdown table (FIR | Year | Crime Type | Status | Station)
      └─ 0-row → "Found no matching records. Try a different district…"
```

### 5.3 Text-to-SQL Safety

1. LLM proposes SQL (or `rule_sql` generates it deterministically)
2. `sql_guard.sanitize()` → sqlglot AST parse → single SELECT, allow-list tables, cap LIMIT 200
3. `session.execute()` under RLS → `fn_scope_ok()` gates rows to officer's scope
4. `_mask_rows()` → PII columns redacted for clearance < L3 before returning

---

## 6. Model Layer

| Component | Model | Notes |
|-----------|-------|-------|
| Brain LLM | Gemini 2.5 Flash (`gemini-2.5-flash`) | Chat, routing, composition; `_strip_markdown_fences()` applied before JSON parse |
| SQL LLM | Gemini 2.5 Flash (default) or qwen3-coder-next | Selectable via Settings panel |
| Fallback LLM | Groq Llama-3.3-70B | Always used by `get_fallback_llm()` |
| Embedder | BGE-M3 (local, FP16) | Always local; sole embedder; 1024-dim |
| Reranker | bge-reranker-v2-m3 (local, FP16) | ~2.4 GB combined with embedder |
| TTS | Sarvam Bulbul v3 (primary) | `POST /voice/tts` → `speakViaSarvam()` |
| STT | Sarvam Saaras v3 (primary) | `POST /voice/stt` |
| Translation | Sarvam Mayura v1 | `POST /voice/translate` |
| Voice fallback | Bhashini | Free, govt |

**Registry (`app/models/registry.py`):** All factories use `@lru_cache` — per-request engine overrides (Settings panel) are efficient.

---

## 7. Voice Pipeline

### 7.1 Overview

```
Officer speaks → MediaRecorder (recorder.ts) → POST /voice/stt
  → detectLang() → Sarvam Saaras v3 (or Bhashini fallback)
  → transcript → Shell.tsx voice router
      ├─ navigation command → navigate() + sessionStorage pending-voice
      └─ query → window.dispatchEvent("satyam:voice-send")
                   → console.tsx sendMessage({ speak: true })
  → Normal pipeline → composed answer
  → resolveLang(opts.lang, answer_text)
  → speakViaSarvam(text, lang, rate) → POST /voice/tts → audio plays
  → conversation mode: auto-re-activate mic on "done"
```

Language auto-detection: counts Kannada Unicode chars (U+0C80–U+0CFF); >20% → "kn".

### 7.2 Two Independent Microphones

Satyam has **two completely independent mic instances** that must never trigger each other:

| Mic | Location | Purpose | Engine |
|-----|----------|---------|--------|
| **Copilot mic** | Top-right orb in `Shell.tsx` | Screen navigation + data Q&A; sends to Gemini brain | User-selectable: Browser or Sarvam (see §7.3) |
| **Chat-box mic** | Red mic button inside chat textarea in `console.tsx` | Dictation into chat input only; never opens copilot | Always Browser Web Speech API |

**Separation guarantee:** `satyam:open-voice` event has exactly one dispatcher (the copilot orb button in `Shell.tsx`) and exactly one listener (also in `Shell.tsx`). The chat-box mic button calls `toggleChatDictation()` directly — it does not dispatch any events and does not touch copilot state (`listening`, `micActive`, `conversationMode`).

### 7.3 Copilot Mic Engine Toggle

Users can switch the **copilot mic** (top-right) between two STT engines in **Settings → Models → "Voice copilot mic (Speech-to-Text)"**:

| Mode | Engine | Characteristics |
|------|--------|-----------------|
| **Browser** *(default)* | Web Speech API | Lowest latency · live word-by-word captions · good English · OK Kannada |
| **Sarvam** | Sarvam Saaras v3 via `recorder.ts` + `/voice/stt` | Best Kannada accuracy · utterance-based (no live captions) · ~1.5s transcription wait |

The setting is stored in `EngineSettings.copilotStt` (`"browser" | "sarvam"`) in `localStorage`, **independent of** `voiceBackend` (the TTS / chat voice engine). The brain (Gemini) and spoken reply (Sarvam Bulbul v3) are the same in both modes.

**Implementation:** `Shell.tsx` reads `loadEngineSettings().copilotStt` at the start of the copilot STT `useEffect` and branches:
- `"browser"` → `new SpeechRecognition()` with `interimResults=true`, auto-restart on `onend`, silence-timer auto-submit at 1.5s
- `"sarvam"` → `startSttSession()` from `lib/voice/recorder.ts` (MediaRecorder → backend `/voice/stt`)

### 7.4 Chat-Box Dictation (`toggleChatDictation`)

`console.tsx` owns a `chatRecRef` and `chatDictating` state. When the mic button is tapped:
- A fresh `SpeechRecognition` instance is created with `interimResults=true`
- Results are written **only** to the `input` state (the chat textarea value)
- The copilot orb, `listening` state, and all copilot events are untouched
- The button turns red + pulses while active; tapping again stops the recognizer

---

## 8. Security — RBAC · RLS · Masking · Audit

### 8.1 KSP Rank Hierarchy

| Rank | Scope | Clearance |
|------|-------|-----------|
| DGP, ADGP, IGP | state | L4 |
| DIG | range | L4 |
| SP, Addl.SP | district | L4 |
| DySP | district | L3 |
| CPI, PI, CI | station | L3 |
| PSI, SI | station | L2 |
| ASI | station | L2 |
| HC, PC | station | L1 |

### 8.2 Four-Tier PII Masking

| Clearance | What happens |
|-----------|-------------|
| L4 | Full access |
| L3 | Victim/complainant on PROTECTED crimes masked |
| L2 | All names masked, place_of_offence redacted, coords coarsened |
| L1 | L2 + PROTECTED narratives hidden, all coords coarsened |

**PROTECTED crimes:** POCSO, RAPE, MOLESTATION, DOWRY DEATHS, SC/ST ATROCITIES, SEXUAL HARASSMENT, STALKING, ASSAULT ON WOMEN, KIDNAPPING OF WOMEN AND GIRLS.

### 8.3 SHA-256 Audit Hash-Chain

Every query: `row_hash = SHA-256(prev_hash + timestamp + user_id + action + query + result)`. Append-only. `/audit` endpoint verifies chain in O(n).

---

## 9. Intelligence Features (PS1–PS8)

| PS | Screen | Endpoints | Status |
|----|--------|-----------|--------|
| PS1 | Console (Chat + Canvas) | `/chat` SSE, `/map/hotspots`, `/map/station-breakdown` | ✅ Full |
| PS2 | Network (People / Financial / **Rings**) | `/network/ego`, `/api/network/rings`, `/api/network/case/{id}`, `/api/network/person/{id}`, `/financial/money-trail` | ✅ Full + Rings UI |
| PS3 | Trends & Patterns (4 tabs) | `/api/trends`, `/api/trends/seasonal`, `/api/mo/clusters` | ✅ Full — SVG area+line chart, KPI cards, AnimatedBars, DominantCallout, seasonal spike alerts |
| PS4 | Socio Dashboard | `/api/socio/demographics`, `/api/socio/correlation`, `/api/socio/risk-index` | ✅ Full (real Pearson) |
| PS5 | Offender Profile + Browse | `/api/persons/{id}/profile`, `/api/persons/{id}/timeline`, `/api/offenders` | ✅ Full + Picker |
| PS6 | Similar Cases + Timeline | `/api/cases/{id}/similar`, `/api/cases/similar/search`, `/api/cases/{id}/timeline` | ✅ Full + Description search UI |
| PS7 | Financial Intelligence | `/financial/money-trail` (BFS over financial_accounts/transactions) | ✅ Full — NOT via Text-to-SQL |
| PS8 | Early Warning & Forecast | `/api/forecast/hotspots`, `/api/forecast/alerts`, `/api/forecast/backtest` | ✅ Full (real PAI backtest) |
| **OPS** | **Response Ops** (feature-flagged) | `/api/ops/*` — risk zones, dispatch, green corridor, camera review | ✅ Full + Dataset-driven frontend (Phases 0–4, `ENABLE_RESPONSE_OPS=true`) |

### PS2 — Network Screen (3 tabs)

- **People & Cases** — ego-graph force-directed physics simulation; node inspector; depth 1–3
- **Financial Links** — BFS money-trail graph; circular SVG layout; pattern-flag colour coding; node inspector; suspicious/amount filters
- **Rings** — criminal ring detection from `GET /api/network/rings`; severity cards; kingpin → profile link

### PS7 — Financial Money Trail

`POST /financial/money-trail` accepts `{ person_id | entity_name | case_id, depth, suspicious_only, min_amount }`. BFS expands `financial_transactions` up to 3 account hops. Returns nodes (accounts) + edges (flows) with `pattern_flag` values: `high_value`, `near_incident_date`, `rapid_repeated`, `circular_flow`.

> Financial tables are **NOT** in the Text-to-SQL allow-list (`sql_guard.ALLOWED_TABLES`). All financial queries go through the dedicated service with clearance L2+ and audit logging.

---

## 10. Response Ops Module (`ENABLE_RESPONSE_OPS=true`)

A feature-flagged, fully isolated module ported from EMERGE. Off by default — when off the app behaves byte-for-byte identically. Activated via `ENABLE_RESPONSE_OPS=true` in `backend/.env`. All ops tables are `ops_*` prefixed; no existing table is altered.

### 10.1 Architecture

```
ops_patrol_units      — callsign, lat/lng, status (IDLE|EN_ROUTE|ON_SCENE|OFFLINE)
ops_traffic_signals   — junction_id, lat/lng, state (NORMAL|GREEN)
ops_risk_zones        — grid_key, risk_score, risk_label (grid scoring output)
ops_patrol_suggestions— risk_zone_id → patrol_id, distance_km, response_improve_sec
ops_incident_dispatches— patrol→scene route, status lifecycle
ops_cameras           — camera metadata
ops_incident_review_queue — AI-detected candidates awaiting human review
```

### 10.2 Phases

| Phase | Feature | Key files |
|-------|---------|-----------|
| **0** | Tables + empty router + nav entry | `db/ops_models.py`, `api/routes/ops.py`, `seed/init_ops.py`, `routes/operations.tsx` |
| **1** | Predictive deployment (grid scoring) | `services/ops/risk_service.py` → `GET /api/ops/risk-zones`, `GET /api/ops/suggestions` |
| **2** | Dispatch nearest patrol + GPS simulation | `services/ops/routing_service.py`, `services/ops/sim_service.py` → `POST /api/ops/dispatch`, WS `/api/ops/ws` |
| **3** | Green corridor (signals flip GREEN on route) | `services/ops/corridor_service.py` → `GET /api/ops/signals` |
| **4** | AI camera → human review → case + dispatch | `POST /api/ops/detect/notify`, `GET /api/ops/cameras`, `GET /api/ops/review-queue`, confirm/reject |

### 10.3 Risk Scoring (Phase 1)

Python port of EMERGE `predictiveReadinessService.js`:
- `GRID_SIZE=0.01` (~1.1 km cells), `LOOKBACK_DAYS=365`
- Score = `incident_score (max 40)` + `density_score (max 30)` + `time_score (max 30)`
- Labels: Critical ≥75 / High ≥55 / Medium ≥30 / Low
- 5-min debounce (`RECOMPUTE_DEBOUNCE_SEC=300`) prevents flooding on `?refresh=true`
- Suggestions: top-5 zones → nearest IDLE patrol → `distance_km` + `response_improve_sec`

### 10.4 Dispatch Simulation (Phase 2)

- OSRM driving route (free public API); straight-line fallback with error key
- Simulation runs as an `asyncio.Task` — walks route coords at `TICK_SEC=0.8s`
- Broadcasts `PATROL_LOCATION` events over the single `/api/ops/ws` WebSocket
- Status lifecycle: `IDLE → EN_ROUTE → ON_SCENE (6s hold) → COMPLETED → IDLE`
- WS auth: `?token=<JWT>` query param; enforces `RUN_ANALYTICS` clearance (L2+)

### 10.5 Green Corridor (Phase 3)

- `ACTIVATION_RADIUS_KM=0.3` — mirrors EMERGE constant
- Per-tick `corridor_service.activate_near(lat, lng)` flips nearby signals GREEN (emit-only-on-change)
- `reset_all()` called on `ON_SCENE` arrival → `SIGNAL_RESET` broadcast → map dots go gray

### 10.6 Camera Review (Phase 4)

- Confidence tiers: `LOW_CONF=0.5` (ignored), `0.5–0.8` (MEDIUM, queue), `≥0.8` (HIGH, auto-flag)
- `POST /api/ops/detect/notify` — called by the separate `ai_camera/` YOLO process (no import of Satyam)
- **Confirm** → `cases` INSERT (CCTV-{id}, valid station FK, Suo Motu) + auto-dispatch nearest patrol + simulate
- **Reject** → status=REJECTED, no case
- `ai_camera/detect_video.py` — YOLOv8 on video/webcam; stalled vehicle ≥2.5s → confidence ramp → notify

### 10.7 Frontend

| Route | Tab | Component |
|-------|-----|-----------|
| `/operations` | Predictive Deployment | `PredictivePanel` — heat map + suggestion cards (Accept/Dismiss) |
| `/operations` | Dispatch & Green Corridor | `DispatchPanel` — patrol map + route line + gliding live marker + signal dots |
| `/operations` | Camera Review | `ReviewPanel` — candidate cards with frame preview + Confirm/Reject |

`CrimeMap.tsx` extended with:
- `routePath` prop — static blue polyline (dispatch route, no animation)
- `liveMarker` prop — single green dot that pans the map without zoom-bouncing
- `signals` prop — junction dots (green=active, gray=normal)

**Bug fixes applied (bugfix pack):**
- Patrol marked `EN_ROUTE` on dispatch; `COMPLETED→IDLE` lifecycle after 6s on-scene hold
- Null coordinate guard on `dispatch` + `get_route` ValueError
- Camera confirm: resolves valid station FK (never `station_id=0`)
- `ReviewPanel.confirm` kicks off live simulation for the auto-dispatch
- WS stable connection (single subscription, `activeRef` stale-closure fix)
- `suggestions` ordering: NULLs last on `response_improve_sec DESC`
- `init_ops --reset` clears transient state between demo runs
- WS enforces `RUN_ANALYTICS` clearance gate (L2+, closes `4403` for L1 tokens)

### 10.8 Parity Pack (SATYAM_OPS_PARITY_PACK + SATYAM_OPS_SCREENSHOT_PARITY_PACK)

Added to match the EMERGE reference screenshots:

**Backend additions:**
- `corridor_service.state()` — current green-signal count for the dashboard panel
- `corridor_service.activate_corridor(route)` — route-wide signal activation on `EN_ROUTE` (500m radius), broadcasts `GREEN_CORRIDOR_ACTIVE` with `routeCoords` + activated signal list
- `corridor_service.reset_all()` broadcasts `GREEN_CORRIDOR_DEACTIVATED` on arrival/cancel
- `sim_service`: `ACCEPTED` phase (2s hold), `phase` field on every broadcast, `active_states()` / `active_ids()` / `stop_all()`, callsign + scene meta loaded from DB in `_load_meta()`
- New ops routes: `GET /dispatch/active`, `POST /dispatch/simulate-all`, `POST /dispatch/stop-all`, `GET /corridor/state`, `POST /corridor/reset`, `GET /demo/active`, `POST /demo/stop-all`
- YOLO entrypoint at `model/inference/live_cctv.py` (runs as `python inference/live_cctv.py`)

**Frontend additions:**
- `DemoSimPanel` — Demo Mode ON/OFF, Simulate All, Stop All, Active Dispatches list, Green Corridor panel, Live Event Feed
- `DispatchPanel` — phase timeline (`ACCEPTED→EN_ROUTE→ON_SCENE→COMPLETED`), progress bar, ETA, green-corridor floating panel with signal chips and Deactivate button, map legend
- `LiveOperationsMap` — dark CARTO tiles, full-screen with header stats overlay, Heatmap/DEMO/Routes toggles, animated 🚓 markers, green corridor glow, floating signal panel
- `CrimeMap.tsx` — `corridorPath` (3-layer glow), `liveMarker` (animated 🚓 `divIcon`, pans once), `lockBounds` prop, `fitSignal` prop (one-shot zoom), `darkTiles` prop, `liveMarkers`/`routePaths` for multi-unit Demo Simulation

**Zoom/pan fixes:**
- `fitSignal` counter — parent increments once on sim start; `CrimeMap` zooms exactly once
- `lockBounds` — suppresses `fitBounds` from the `points` effect during active simulation
- `liveMarkerPlacedRef` — `panTo` fires only on initial marker creation, never on each GPS tick

### 10.9 Dataset-Driven Frontend (SATYAM_OPS_DATASET_FIX)

Rewrote the three Operations screens to use real forecast/dataset endpoints so they are never blank when the Response-Ops backend is off:

| Screen | Data source | No backend needed? |
|--------|-------------|-------------------|
| **Predictive Deployment** | `intelligence.getForecastAlerts()` + `getForecastHotspots()` → fallback `api.mapHotspots()` | ✅ Yes |
| **Demo Simulation** | Hardcoded 4 Bengaluru anchor scenes (client-side animation only) | ✅ Yes |
| **Live Operations Map** | Always-on: `api.mapHotspots({mode:"by_crime"})` heatmap + forecast risk cell count; ops overlay additive | ✅ Heatmap always; ops overlay when WS up |

**Key design decisions:**
- `PredictivePanel` — instant patrol-car placement (no animation): clicking "Simulate deployment" drops a 🚓 marker at the hotspot immediately; map zooms via `fitSignal`; no route line or timer
- `DemoSimPanel` — `scenes = FALLBACK_SCENES` hardcoded; `intelligence` import removed; no network calls
- `LiveOperationsMap` — crime-density heatmap renders before any WS data; `fittedRef` prevents re-zoom once the user has moved the map; `!hasLiveData` info card explains the view

**UI fixes also applied in this session:**
- Dispatch & Green Corridor map + Predictive Deployment map → dark CARTO tiles (`darkTiles` prop)
- Active Dispatches list removed from Dispatch & Green Corridor screen (backend-dependent, was showing Hoysala-01/02/03 from seeded ops data)
- All `ENABLE_RESPONSE_OPS` operations still work when backend is on; screens degrade gracefully when it is off

---

## 11. Frontend Architecture

### 11.1 Route Map

```
/                     Landing page (hero background video)
/login                Demo login — 14 KSP ranks
/console              PS1: Chat + Results Canvas (station table + SimilarCaseSearch)
/network              PS2: People graph / Financial Links / Rings (3-tab)
/trends               PS3: Overview / Time Series / MO Clusters / Seasonal (4-tab)
/socio                PS4: Socio-Economic Dashboard (SP+ only)
/profile/:personId    PS5: Offender dossier (search + OffenderPicker dropdown)
/forecast             PS8: Early Warning + Forecast Risk Grid
/reports              Report builder + live preview + PDF print
/audit                Hash-chain audit log
/transcripts          Conversations tab (PDF export) + Voice transcripts tab
/operations           Response Ops (feature-flagged) — Live Map / Demo Simulation / Predictive / Dispatch+Corridor / Camera Review
/about                Project info
```

### 11.2 Components

| Component | Purpose |
|-----------|---------|
| `Shell.tsx` | Nav + voice command router + language toggle + theme picker + copilot mic (Browser/Sarvam) |
| `CaseDrawer.tsx` | Sliding case detail (Summary / Persons / Timeline / Similar / Map tabs) |
| `CrimeMap.tsx` | Leaflet heat/pin/grid map + `routePath` + `liveMarker` + `signals` + `corridorPath` + `darkTiles` + `lockBounds` + `fitSignal` + `liveMarkers`/`routePaths` (ops extensions) |
| `FinancialLinksPanel.tsx` | SVG money-trail graph + flows table (PS7) |
| `RingsPanel.tsx` | Criminal ring detection cards (PS2) |
| `SimilarCaseSearch.tsx` | Description-based similar case search widget (PS6) |
| `ThemePicker.tsx` | 6 professional + 8 legacy colour themes |
| `SettingsDialog.tsx` | Live engine overrides (brain/SQL/voice/copilotStt) + DB source picker |
| `ProfileMenu.tsx` | User profile + logout |
| `ops/PredictivePanel.tsx` | Risk zone heat map + patrol suggestion cards |
| `ops/DispatchPanel.tsx` | Patrol map + dispatch controls + live GPS animation |
| `ops/ReviewPanel.tsx` | CCTV incident review queue |

### 11.3 Key Libraries

```
src/lib/
  i18n.tsx              Custom i18n: I18nProvider, useI18n(), useT(), DICT (200+ EN→KN)
  tData.ts              tData(field, value, lang) — categorical DB value lookup
  conversationStore.ts  loadConversations() from localStorage for Transcripts screen
  pdf/conversationPdf.ts exportConversationPdf() — branded print-to-PDF
  api/
    client.ts           REST + SSE streamChat()
    intelligence.ts     PS2–PS8 typed wrappers + listOffenders() + searchPersonsAndCases()
    financial.ts        financial.moneyTrail() for PS7
    responseOps.ts      Response-Ops typed client (opsFetch, openOpsSocket)
  voice/
    tts.ts              speakViaSarvam(), stripMarkdown()
    recorder.ts         MediaRecorder STT + startSttSession()
    lang.ts             detectLang(), resolveLang()
locales/
  kn-data.json          Kannada lookup: 9 fields, 150+ entries (all 41 districts)
  en.json               Reference copy (not loaded by app)
```

### 11.4 Theme System

6 professional themes via `data-theme` on `<html>`: slate, indigo, forest, graphite, midnight, pine. Plus 8 legacy themes via inline CSS variable overrides. `html[lang="kn"]` applies Noto Sans Kannada globally.

---

## 11. Bilingual Support — EN + KN

### 11.1 Four-Layer Architecture

| Layer | Scope | Implementation |
|-------|-------|---------------|
| 1. Static UI strings | Nav, buttons, headers, labels | `i18n.tsx` DICT — 200+ EN→KN entries |
| 2. Categorical DB values | crime_type, status, district, role, gender, motive, risk_label | `tData(field, value, lang)` + `kn-data.json` |
| 3. Case narratives | `narratives.body` | `?lang=kn` → backend prefers `language='kn'` row, falls back to `'en'` |
| 4. AI-generated answers | Chat responses | `lang_directive` injected into ANSWER_SYSTEM prompt |

### 11.2 Coverage

- `kn-data.json`: crime_type (40+ values), status (13), district (all 41 Karnataka districts + 4 special units), role (7), gender (5), motive (13), fir_type, complaint_mode, risk_label, kyc_risk_level
- Applied in: CaseDrawer, console station table, forecast alerts/grid, trends bar chart, profile MO fingerprint + timeline, socio gender/district, network node labels

---

## 12. API Reference Summary

### 12.1 Core

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/auth/login` | JWT login, 14 KSP ranks |
| `POST` | `/chat/stream` | SSE: token, citation, blocked, done events |
| `GET` | `/cases` | RLS-scoped list |
| `GET` | `/cases/{id}?lang=` | Full case + persons + narrative (lang-aware) |
| `GET` | `/cases/search?q=` | Unified person + case autocomplete |
| `POST` | `/map/hotspots` | Lat/lng heat points |
| `POST` | `/map/station-breakdown` | Station FIR table |

### 12.2 Intelligence (`/api/`)

| Path | Clearance | Notes |
|------|-----------|-------|
| `GET /offenders` | L2+ | Browse all offenders with filters |
| `GET /persons/{id}/profile` | L2+ | Risk score + MO fingerprint + associates |
| `GET /persons/{id}/timeline` | L1 | Crime history |
| `GET /cases/{id}/similar` | L1 | RAG similarity |
| `POST /cases/similar/search` | L1 | Description-based search |
| `GET /trends` | L1 | Series + QoQ/YoY deltas |
| `GET /trends/seasonal` | L1 | True lift % vs monthly baseline |
| `GET /mo/clusters` | L1 | MO clustering |
| `GET /socio/demographics` | L3+ | Age/gender/district (role-filtered, real join) |
| `GET /socio/correlation` | L3+ | Real Pearson vs seeded indicators |
| `GET /socio/risk-index` | L2+ | Social risk score per district |
| `GET /forecast/hotspots` | L2+ | Risk grid with PAI scoring |
| `GET /forecast/alerts` | L2+ | Early warning alerts (real incident_time patrol windows) |
| `GET /forecast/backtest` | L1 | PAI hit-rate validation |
| `GET /network/rings` | L2+ | Criminal ring detection (co-accused BFS) |
| `GET /network/case/{id}` | L1 | Case co-accused graph |
| `GET /network/person/{id}` | L1 | Person ego-graph |

### 12.3 Financial & Health

| Path | Clearance | Notes |
|------|-----------|-------|
| `POST /financial/money-trail` | L2+ | BFS money-trail graph (NOT via Text-to-SQL) |
| `GET /health` | None | Liveness + demo_mode flag |
| `GET /health/models` | None | Resolved model class names |
| `GET /health/data` | Session | Row counts for all 7 tables; `seeded` flag |
| `POST /voice/tts` | L1 | Text → audio |
| `POST /voice/stt` | L1 | Audio → transcript |
| `POST /voice/translate` | L1 | MT EN↔KN via Sarvam Mayura v1 |

### 13.4 Response Ops (`/api/ops/` — requires `ENABLE_RESPONSE_OPS=true`)

| Path | Clearance | Notes |
|------|-----------|-------|
| `GET /api/ops/health` | L1 | Liveness probe for the ops module |
| `GET /api/ops/risk-zones` | L2+ | Scored grid zones; `?refresh=true` forces recompute |
| `GET /api/ops/suggestions` | L2+ | Pending patrol pre-positioning suggestions |
| `POST /api/ops/suggestions/{id}/{action}` | L2+ | accept \| dismiss |
| `GET /api/ops/patrols` | L2+ | All patrol units with status/location |
| `POST /api/ops/dispatch` | L2+ | Create dispatch (nearest or explicit patrol) |
| `POST /api/ops/dispatch/{id}/simulate` | L2+ | Start live GPS animation task |
| `GET /api/ops/dispatch/{id}/state` | L2+ | Polling fallback for latest position |
| `GET /api/ops/signals` | L2+ | All traffic signal states |
| `POST /api/ops/detect/notify` | L2+ | YOLO camera service posts candidate |
| `GET /api/ops/cameras` | L2+ | Camera list |
| `GET /api/ops/review-queue` | L2+ | Pending CCTV review items |
| `POST /api/ops/review-queue/{id}/confirm` | L2+ | File case + auto-dispatch |
| `POST /api/ops/review-queue/{id}/reject` | L2+ | Reject candidate |
| `WS /api/ops/ws?token=` | L2+ | Live event stream (PATROL_LOCATION, SIGNAL_GREEN, INCIDENT_CANDIDATE, …) |

---

## 13. Configuration & Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | local asyncpg URL | Primary DB (Neon or local PG17) |
| `REDIS_URL` | `redis://localhost:6379/0` | Conversation state |
| `JWT_SECRET` | `change-me-in-production` | HS256 signing |
| `MODEL_BACKEND` | `api` | `api` \| `local` |
| `BRAIN_ENGINE` | `gemini` | `gemini` \| `groq` |
| `SQL_ENGINE` | `gemini` | `gemini` \| `qwen3-coder-next` |
| `VOICE_BACKEND` | `sarvam` | `sarvam` \| `google` \| `bhashini` |
| `GEMINI_API_KEY` | `""` | Gemini 2.5 Flash |
| `GROQ_API_KEY` | `""` | Groq fallback |
| `SARVAM_API_KEY` | `""` | TTS/STT/MT |
| `BHASHINI_API_KEY` | `""` | Voice fallback |
| `OLLAMA_CLOUD_API_KEY` | `""` | qwen3-coder-next SQL option |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Frontend base URL |
| `VECTOR_TYPE` | `vector` | `vector` (local) \| `halfvec` (Neon) |
| `ENABLE_RESPONSE_OPS` | `false` | `true` to activate the Response Ops module |

**Demo mode:** when both `GEMINI_API_KEY` and `GROQ_API_KEY` are empty, `demo_mode = True` — `rule_sql.py` handles SQL generation and `_render_grounded()` handles answer composition. No API keys required for a working demo with a seeded DB.

---

## 14. Deployment

### 14.1 Docker

```bash
cp .env.example .env   # fill GEMINI_API_KEY (optional for demo)
docker compose up --build
# frontend → http://localhost:3000  |  backend → http://localhost:8000/docs
```

### 14.2 Local Dev

```bash
# Backend
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
docker compose up db redis -d
psql "$DATABASE_URL" -f migrations/002_schema_v2.sql
python -m seed.load_seed        # bulk-loads CSVs via asyncpg COPY
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && bun install && bun run dev

# Verify seeding
curl localhost:8000/health/data | python -m json.tool
```

### 14.3 Database Tracks

| Track | `DATABASE_URL` | Dataset |
|-------|---------------|---------|
| **Neon cloud** | Neon pooler + `ssl=require` | 60% (~192 MB, under 512 MB cap) |
| **Local PG17** | `localhost:5432/satyam` | 100% |

---

## 15. Two-Phase Roadmap

| Layer | Phase 1 (Hackathon demo) | Phase 2 (Sovereign on-prem) |
|-------|--------------------------|------------------------------|
| Brain / chat | Gemini 2.5 Flash | Sarvam-M / Sarvam 30B |
| Text-to-SQL | Gemini 2.5 Flash + qwen3-coder-next | Qwen-Coder local |
| Voice | Sarvam → Bhashini fallback | Bhashini + Sarvam |
| Embeddings | BGE-M3 (local GPU) | BGE-M3 (local) |
| Hosting | External cloud OK (synthetic data) | Fully on-prem / India-hosted |

**Sovereignty principle:** external clouds are used only with synthetic data. For live KSP data, every component must run on-premises or India-hosted infrastructure.

---

## 16. Bug Fixes Applied

All bugs from `SATYAM_DEEP_BUG_SCAN.MD` and the verification pass are fixed:

| ID | Description | Fix |
|----|-------------|-----|
| D1 | Socio-demographics filters silently ignored | Rewrote queries to JOIN persons→case_persons→cases |
| D2 | Socio-correlation fabricated indicators | Now JOINs real `district_socio_economic_indicators`; Pearson computed in Python |
| D3 | Trends QoQ delta split by list index not time | Collapses to `{period: count}` dict, sorts chronologically |
| D4 | Seasonal fake lift% + hidden Bengaluru default | CTE computes `(cnt / AVG(cnt) - 1) * 100` vs real monthly baseline |
| D5 | Demo-mode echo corrupts all chat lanes | `rule_sql.py` (new) + `_render_grounded()` + demo_mode shortcircuit in `generate_sql()` |
| D6 | Console shows "backend unreachable" for blocked/empty | Three distinct branches: transport error / RBAC block / empty result |
| D7 | Audit `user_id` naming trap (latent) | Added clarifying `# NOTE:` comments at all `write_audit` call sites |
| D8 | Forecast patrol always 18:00 (DATE has no hour) | Uses `incident_time TEXT` column: `split_part(incident_time, ':', 1)::int` |
| D9 | Similar-cases search anchors to case #1 on no match | Returns `matches=[]`; switched to deterministic `ORDER BY (ILIKE) DESC, case_id DESC` |

---

## Appendix — File Tree (Abridged)

```
satyam/
├── backend/
│   ├── app/
│   │   ├── api/routes/    auth, chat, cases, map, network, financial(NEW),
│   │   │                  intelligence, reports, audit, voice, settings, health
│   │   ├── core/          rbac, masking, audit, security
│   │   ├── db/            models (ORM), rls, session
│   │   ├── models/        registry + api/(gemini,groq,sarvam,bhashini,ollama_cloud,google_voice)
│   │   │                          + local/(embedder_bge,reranker_bge,stubs)
│   │   ├── pipeline/      guardrails, router, slots, orchestrator, prompts
│   │   │   └── tools/     text_to_sql, sql_guard, rule_sql(NEW), rag, analytics
│   │   ├── schemas/       auth, chat, case, intelligence, map, network, financial(NEW), report, voice
│   │   └── services/      case, chat, intelligence, financial(NEW), map, network, report
│   └── migrations/        002_schema_v2.sql
│
├── frontend/src/
│   ├── routes/            console, network, forecast, trends, socio, profile.$personId,
│   │                      reports, audit, transcripts, login, index, about, operations(NEW)
│   ├── components/        Shell, CaseDrawer, CrimeMap(+ops-props), FinancialLinksPanel,
│   │                      RingsPanel, SimilarCaseSearch, ThemePicker,
│   │                      SettingsDialog, ProfileMenu, AccountManager
│   │   └── ops/           PredictivePanel, DispatchPanel, ReviewPanel
│   ├── lib/
│   │   ├── i18n.tsx        Custom i18n DICT (200+ EN→KN keys)
│   │   ├── tData.ts        Categorical DB value translation
│   │   ├── conversationStore.ts  loads chat history for Transcripts
│   │   ├── pdf/conversationPdf.ts  branded print-to-PDF
│   │   ├── api/            client.ts, intelligence.ts, financial.ts, responseOps.ts(NEW)
│   │   └── voice/          tts.ts, recorder.ts, lang.ts
│   └── locales/            kn-data.json (150+ entries), en.json
│
├── ai_camera/             YOLO sibling process (optional, Phase 4)
│   ├── requirements.txt   ultralytics, opencv, httpx
│   ├── notify.py          POST candidates to /api/ops/detect/notify
│   └── detect_video.py    YOLOv8 on video/webcam
│
└── docs/ARCHITECTURE.md    ← this file
```

---

*Last updated: 2026-06-21 · Satyam v1.4 · Datathon 2026 KSP × hack2skill*
