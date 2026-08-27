# Satyam — Complete Architecture & Technical Documentation

> **Project:** Satyam — Bilingual Voice-Enabled Crime Intelligence AI
> **Event:** Datathon 2026 · KSP × hack2skill
> **Stack:** Python 3.11 · FastAPI · PostgreSQL 16 + pgvector · React 19 · TanStack Start
> **Last updated:** 2026-08-24 · v4.1

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [System Architecture](#3-system-architecture)
4. [Database Schema](#4-database-schema)
5. [Backend Pipeline](#5-backend-pipeline)
6. [Model Layer](#6-model-layer)
7. [Voice Pipeline](#7-voice-pipeline)
8. [Security — RBAC · RLS · Masking · Audit](#8-security)
9. [Intelligence Features (PS1–PS8)](#9-intelligence-features)
10. [Response Ops Module](#10-response-ops-module)
11. [Investigation Board](#11-investigation-board)
12. [Person 360 Dossier](#12-person-360-dossier)
13. [Access Control (Admin)](#13-access-control-admin)
14. [Frontend Architecture](#14-frontend-architecture)
15. [Bilingual Support](#15-bilingual-support)
16. [API Reference](#16-api-reference)
17. [Configuration & Environment](#17-configuration--environment)
18. [Deployment](#18-deployment)
19. [Two-Phase Roadmap](#19-two-phase-roadmap)
20. [Bug Fixes & Security Hardening](#20-bug-fixes--security-hardening)
21. [Voice Screen Agent](#21-voice-screen-agent)
22. [Board Brain — Smart Layout Engine](#22-board-brain--smart-layout-engine)
23. [Kannada Translation System](#23-kannada-translation-system)
24. [Hands-free Multimodal Layer](#24-hands-free-multimodal-layer)
25. [Client-Side Read Cache](#25-client-side-read-cache)
26. [Theming & Motion System](#26-theming--motion-system)
27. [About Handbook & SEO Surface](#27-about-handbook--seo-surface)
28. [Document Translation & Sealing](#28-document-translation--sealing-documents)
29. [Frontend Shell & Motion Additions](#29-frontend-shell--motion-additions)
30. [Frontend self-checks without a test framework](#30-frontend-self-checks-without-a-test-framework)
31. [ML, Statistical and Graph Algorithms — Full Formulas](#31-ml-statistical-and-graph-algorithms--full-formulas)
32. [Master Highlighted Feature Catalog & Implementation Deep-Dive](#32-master-highlighted-feature-catalog--implementation-deep-dive)

---

## 1. Project Overview

Satyam is a **bilingual (English + Kannada), voice-enabled conversational AI** for Karnataka State Police crime intelligence. An officer asks a question in natural language — typed or spoken — and Satyam:

1. Auto-detects language, routes intent, runs a **grounded** answer pipeline (Text-to-SQL, RAG, analytics)
2. Composes a **cited, spoken-summary** answer delivered over SSE as `token` frames. The answer is awaited in full and then split on spaces, so the framing is presentational rather than incremental generation — see §5.2 and §27.4.
3. Enforces **RBAC/ABAC** (14 KSP ranks, 4 clearance levels) + **Postgres Row-Level Security**
4. Appends every query to a **SHA-256 hash-chained tamper-evident audit log**
5. Can **speak answers in Kannada** via Sarvam Bulbul v2 TTS and navigate screens by voice
6. Has a full **design/investigation canvas** powered by tldraw with AI scene generation
7. Provides **admin access control** so L4 officers can manage rank/clearance/scope
8. Has a **Person 360 dossier** screen showing mugshots, crime history, bank accounts

All data is **100% synthetic** — no real FIRs or PII.

---

## 2. Tech Stack

### 2.1 Backend

| Category | Technology | Notes |
|----------|-----------|-------|
| Language | Python 3.11+ | |
| Web framework | FastAPI | Async, SSE streaming |
| ORM | SQLAlchemy (async) + asyncpg | |
| Database | PostgreSQL 16 | Primary store |
| Vector search | pgvector 0.8.x | HNSW index, cosine, `vector(1024)` |
| Cache | Redis | Conversation state |
| Auth | PyJWT (HS256) | 14 KSP rank claims + clearance overrides |
| SQL safety | sqlglot | Parse+validate every LLM-generated SQL |
| NL→SQL fallback | `rule_sql.py` (custom) | Progressive relaxation, 4 levels |
| Logging | structlog | JSON format |
| Settings | pydantic-settings | Env-file based |

### 2.2 AI / Model Services

| Role | Model | Provider | Notes |
|------|-------|----------|-------|
| Brain LLM (chat) | Gemini 2.5 Flash | Google | Default |
| Fallback LLM | Llama-3.3-70B | Groq | Auto-fallback |
| Board AI | Gemini / Groq | Configurable | Scene generation |
| Text-to-SQL | Gemini 2.5 Flash | Google | Default |
| Text-to-SQL alt | qwen3-coder-next | Ollama Cloud | Optional |
| Embeddings | BGE-M3 (local, FP16) | BAAI | Sole embedder — not swappable |
| Reranking | bge-reranker-v2-m3 (local) | BAAI | FP16 cross-encoder |
| TTS | Sarvam **Bulbul v2** + speaker `anushka` | Sarvam AI | Primary voice output. Speakers are **not** interchangeable across Bulbul versions — `bulbul:v3 + meera` is an invalid pair and was the cause of an earlier TTS failure. See the header comment in `models/api/sarvam.py`. |
| STT | Sarvam Saaras v3 | Sarvam AI | Primary voice input |
| Translation | Sarvam Mayura v1 | Sarvam AI | EN↔KN |
| Voice fallback | Bhashini | Govt of India | Free, no rate cap |
| YOLO detection | YOLOv8s (COCO) | Ultralytics | Camera Review, fight/crowd/weapon |

### 2.3 Frontend

| Category | Technology | Notes |
|----------|-----------|-------|
| Framework | React 19 | |
| Router / SSR | TanStack Start + TanStack Router | File-based routing |
| Build | Vite + Bun | |
| Styling | Tailwind CSS v4 | Neobrutalist design tokens |
| Canvas / Board | **tldraw v5.1.1** | Full design canvas — shapes, draw, text, images, export |
| Graph library | **@xyflow/react v12** | Network graph (crime links, rings) |
| Maps | Leaflet + leaflet.heat | Heatmap, pins, grid, corridor |
| Markdown | react-markdown + remark-gfm | AI answer rendering |
| i18n | Custom (`src/lib/i18n.tsx`) | 200+ EN→KN keys |
| Categorical i18n | `tData()` + `kn-data.json` | crime_type, district (41), role, etc. |
| Graph layout | **@dagrejs/dagre** + **elkjs** | Production-grade diagram layout engines |
| Gesture / vision | **@mediapipe/tasks-vision 0.10.18** | HandLandmarker + FaceDetector; GPU-accelerated WASM, CDN or offline |
| Decorative globe | **cobe 2.0.1** (pinned exact) | WebGL dotted globe, zero transitive deps — `/ask` backdrop |
| 3D | **three 0.160** | Landing-page particle brain + `GridScan` login backdrop |
| Themes | **13 total** — 6 `data-theme` + 7 legacy inline | `data-theme` on `<html>`, catalogue in `lib/theme.ts` |

### 2.4 Infrastructure

| Component | Technology |
|-----------|-----------|
| Containerisation | Docker + docker-compose |
| Cloud DB | Neon (PostgreSQL 16, pgvector 0.8.0) |
| Local DB | PostgreSQL 17 + pgvector 0.8.2 |
| GPU (local) | NVIDIA RTX 4070 8 GB VRAM |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OFFICER'S BROWSER                                 │
│                                                                          │
│  Console │ Network │ Forecast │ Trends │ Board │ Dossier │ Admin        │
│  Ask │ Vision │ Predictive │ Dispatch │ Camera     (see §14.1)           │
│                                                                          │
│              TanStack Router · Shell.tsx (Voice Router)                  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTPS / REST / SSE / WS
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND                                  │
│  /auth  /chat(SSE)  /cases  /map  /network  /financial                  │
│  /api/*  /api/ops/*  /api/board  /api/dossier  /admin                   │
│                                                                          │
│  Pipeline: guardrails → router → SQL/RAG/analytics → compose → SSE     │
│  [SPEAK] SSE event carries TTS-ready spoken summary (not full table)    │
│                                                                          │
│  Gemini/Groq  │  Sarvam TTS/STT  │  PostgreSQL + pgvector        │
│  BGE-M3 (local GPU)  │  Bhashini        │  Redis  │  audit_log chain    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ subprocess (global Python)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    YOLO INFERENCE PROCESS                                │
│  model/inference/live_cctv.py  — separate Python process                │
│  YOLOv8s + ByteTrack  →  fight/crowd/weapon/vehicle detection           │
│  MJPEG stream :8089  →  annotated feed in browser <img>                 │
│  POST /api/ops/detect/notify  →  Incident Review Queue                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Chat Request Flow (SSE)

```
Browser          FastAPI           Pipeline                 DB
  │                 │                  │                     │
  ├─POST /chat ────▶│                  │                     │
  │                 ├─JWT decode ──────▶                     │
  │                 ├─set app.* GUCs ────────────────────────▶ (RLS)
  │                 ├─guardrails.precheck()                  │
  │                 │                                        │
  │                 │  Progressive NL→SQL recovery:          │
  │                 │  LLM SQL → 0 rows?                      │
  │                 │  → relax=1 (drop year)                  │
  │                 │  → relax=2 (drop crime)                 │
  │                 │  → relax=3 (latest N overall)           │
  │                 │                                        │
  │◀─SSE: [SPEAK] spoken summary ─────────────────────────── │
  │◀─SSE: tokens (table/markdown) ─────────────────────────── │
  │◀─SSE: citations ─────────────────────────────────────────│
  │◀─SSE: done ──────────────────────────────────────────────│
  │                 ├─write_audit (own txn, disconnect-safe) │
```

---

## 4. Database Schema

### 4.1 Core Tables

| Table | PK | Key columns |
|-------|----|-------------|
| `rank_access` | `rank TEXT` | `scope_level`, `clearance` (14 KSP ranks) |
| `stations` | `station_id INT` | `station_name`, `district`, `"range"`, lat/lng |
| `officers` | `officer_id INT` | `name`, `rank`, `station_id FK` |
| `users` | `user_id SERIAL` | `username`, `password_hash`, `assigned_rank`, `is_active`, `created_by`, `clearance_override`, `scope_override` |
| `cases` | `case_id INT` | `fir_number`, `crime_type`, `status`, `district`, lat/lng, `sections` (pipe-joined) |
| `persons` | `person_id INT` | `name`, `gender`, `age`, `district` |
| `case_persons` | `(case_id, person_id, role)` | composite PK |
| `narratives` | `narrative_id INT` | `case_id FK`, `language` (en/kn), `body`, `body_tsv` (generated, GIN), `embedding` — `vector(1024)` locally, `halfvec(1024)` on Neon. The column type is resolved **per request** by `db.session.active_vector_type()` and cast inline, because the Settings panel can switch DB source at runtime; casting to the wrong type breaks the `<=>` operator. |
| `audit_log` | `audit_id SERIAL` | `at`, `user_id`, `action`, `query_text`, `row_hash` (SHA-256 chain) |

### 4.2 PS4/PS7 Extension Tables

| Table | Purpose |
|-------|---------|
| `district_socio_economic_indicators` | Real literacy/urbanisation/income per district |
| `financial_accounts` | Synthetic bank/wallet accounts |
| `financial_transactions` | Synthetic txns with `pattern_flag` |

### 4.3 Response Ops Tables (`ops_*`)

| Table | Purpose |
|-------|---------|
| `ops_patrol_units` | callsign, lat/lng, status (IDLE/EN_ROUTE/ON_SCENE) |
| `ops_traffic_signals` | junction_id, state (NORMAL/GREEN) |
| `ops_risk_zones` | grid scoring output |
| `ops_patrol_suggestions` | risk_zone → patrol, distance_km |
| `ops_incident_dispatches` | route, status lifecycle |
| `ops_cameras` | camera metadata |
| `ops_incident_review_queue` | AI detections awaiting human review |

### 4.4 Investigation Board Tables

| Table | Purpose |
|-------|---------|
| `boards` | owner_user_id, title, `state_json JSONB` (tldraw snapshot), thumbnail |
| `board_snapshots` | versioned snapshots of a board |

### 4.5 Demo Dossier Tables (isolated)

| Table | Purpose |
|-------|---------|
| `demo_dossier_persons` | 10 fictional Karnataka profiles, mugshots, summary |
| `demo_dossier_family` | Family members per person |
| `demo_dossier_bank_accounts` | Bank accounts, flagged suspicious |
| `demo_dossier_crimes` | Crime history per person |
| `demo_dossier_contacts` | Known associates |

### 4.6 Access Control Columns (migration 006)

Added to `users`: `created_by INT NULL`, `clearance_override SMALLINT NULL`, `scope_override TEXT NULL` — allow L4 admins to manually override a user's effective clearance and scope.

### 4.7 RLS

`fn_scope_ok()` gates every case/narrative row to the officer's station/district/range/state scope via `app.*` GUCs set per-request. `advisor_xact_lock` serializes the audit hash-chain appends.

---

## 5. Backend Pipeline

### 5.1 NL Intelligence Upgrades

The SQL lane has been significantly upgraded for natural-language understanding:

- **SQL_SYSTEM prompt** — instructs Gemini to interpret intent not exact words, always use `ILIKE '%...%'` for fuzzy matching, handle relative dates, carry conversation context for follow-ups
- **Conversational memory** — `generate_sql()` receives last 6 turns as `history` so "what about last year?" resolves correctly
- **Progressive zero-result recovery** — `build_sql(relax=0..3)`:
  - `relax=0` — full filters (place + crime + date)
  - `relax=1` — drop date filter
  - `relax=2` — drop crime filter (place only)
  - `relax=3` — show latest cases overall
  - Each level surfaces a friendly note: *"No records for that time period — showing results across all years."*
- **`rule_sql.py` extraction** — keeps full phrase ("Cyber Crime Police Station"), strips temporal words, allows `%` in ILIKE patterns

### 5.2 Spoken Summary ([SPEAK] SSE event)

Every grounded answer now includes a spoken summary separate from the table:

1. Gemini generates `[SPEAK]...[/SPEAK]` block containing 2–3 natural spoken sentences
2. `_extract_speak()` strips the tag from the displayed table — table stays clean
3. If Gemini omits the tag (demo mode, 429), `_build_spoken_summary(rows, message, lang)` generates a deterministic summary from the SQL rows — works without any LLM
4. Backend emits a `"speak"` SSE event carrying the spoken text
5. Frontend uses it for TTS — voice output never reads the table row-by-row
6. Language follows the UI toggle: EN selected → English summary; KN selected → Kannada summary (generated natively)

**Why the `token` stream is not incremental, and what would have to change.**
Both `LLM.stream()` implementations that matter are chunkers over a finished
completion (`api/gemini.py`, `api/groq.py` call `complete()` then `split(" ")`), and
nothing in the app calls `.stream()` at all — the orchestrator splits the composed
string itself. Making the framing real is blocked on the grounded path by three
whole-answer post-processes that each need the complete text before the first token
can be emitted:

| Step | Why it needs the whole answer |
|---|---|
| `_extract_speak()` | Needs the closing `[/SPEAK]` tag to know where the spoken block ends, and the `speak` event is emitted *before* the display tokens. |
| `_post_translate_kn()` | A whole-string substitution; applied to partial text it corrupts chunk boundaries. |
| `recovery_note` prepend | Prefixed to the finished answer when the query was auto-broadened. |

The smalltalk path has no post-processing and *could* stream, but it would need real
`streamGenerateContent`/Groq SSE adapters plus a streaming twin of
`complete_with_brain` with its own cascade — and a mid-stream failure cannot fail
over to another lane without duplicating text the caller already has. Against that,
the payoff is limited to the `/ask` text pane: the voice copilot speaks only after
`onEnd`, so it sees no benefit at all. Left unimplemented deliberately, and the
claim corrected wherever it appeared (§1, §27.4) rather than being left to imply
otherwise. No adapter implements real SSE streaming any more — the one that did
(`api/openai_llm.py`) was deleted with the rest of the OpenAI lane, and it was never
called.

### 5.3 Pipeline Directory

```
app/pipeline/
  guardrails.py        ← input safety pre-check
  router.py            ← intent classification (Gemini JSON + keyword fallback)
  slots.py             ← cross-turn slot merging, conversation state
  orchestrator.py      ← fan-out to tools, compose, SSE emit, [SPEAK] extraction
  prompts.py           ← SQL_SYSTEM (fuzzy NL), ANSWER_SYSTEM (VOICE SUMMARY RULE), ROUTER_SYSTEM
  tools/
    text_to_sql.py     ← LLM → SQL, history-aware, progressive recovery
    sql_guard.py       ← single SELECT, 6-table allow-list, LIMIT 200
    rule_sql.py        ← deterministic NL→SQL (relax=0..3), relaxation_note()
    rag.py             ← BGE-M3 embed → pgvector ANN → reranker
    analytics.py       ← hotspot, ego_network, station_breakdown
```

---

## 6. Model Layer

| Component | Model | Notes |
|-----------|-------|-------|
| Brain LLM | Gemini 2.5 Flash | Default chat/routing |
| Fallback LLM | Groq Llama-3.3-70B | Always Groq, not configurable |
| SQL LLM | Gemini 2.5 Flash | Default |
| SQL alt | qwen3-coder-next | Ollama Cloud |
| Board AI | Configurable | Gemini / Groq — per `boardEngine` setting |
| Embedder | BGE-M3 (local, FP16) | Sole embedder, 1024-dim |
| Reranker | bge-reranker-v2-m3 (local) | ~2.4 GB combined |
| TTS | Sarvam Bulbul v2 (`anushka`) | `POST /voice/tts` · 22.05 kHz · input trimmed to 480 chars on a sentence boundary |
| STT | Sarvam Saaras v3 | `POST /voice/stt` |
| Translation | Sarvam Mayura v1 | EN↔KN |
| Voice fallback | Bhashini | Free |
| YOLO | YOLOv8s (COCO) | `model/yolov8s.pt`; optional `model/gun.pt` |

### 6.1 Engine Selection

Three settings in `EngineSettings` (stored in `localStorage`):
- `brainEngine` — `gemini | groq | local` — powers the chat brain
- `sqlEngine` — `gemini | qwen3-coder-next | local` — powers Text-to-SQL
- `boardEngine` — `gemini | groq` — powers the Board AI scene generator
- `copilotStt` — `browser | sarvam` — voice copilot engine, drives **both** its mic (STT) and spoken replies (TTS) (default: `browser`)
- `copilotPlanner` — `llm | rule` — copilot screen-agent planner: `llm` uses the brain (Gemini→Groq cascade), `rule` uses the deterministic keyword planner (default: `llm`)
- `voiceBackend` — `sarvam | google | webspeech` — TTS engine for voice replies

The Settings → Models tab shows each provider as a card with configured/unconfigured badge fetched from `GET /settings/db-source/models` (returns booleans only — never API keys). The copilot STT picker is a two-button selector independent of `voiceBackend`.

### 6.2 Brain cascade

`registry.complete_with_brain()` returns `(text, engine_actually_used)` and cascades:
the requested engine → Gemini → Groq. A `[demo:` echo counts as a miss (it means the
key is missing) and falls through rather than shipping a placeholder as a grounded
answer. Every downgrade logs its own event name — `brain.lane_failed`,
`brain.demo_echo`, `brain.failover_to_*` — the same discipline as
`pipeline/router.py`, where it exists because a silent fallback once made a dead
Gemini key look like bad routing.

**OpenAI was removed entirely.** It had been an optional brain behind a
50-request/UTC-day cap. Measured on the project key: gpt-4o took ~19 s for a
one-word prompt and its rate limit answered 429 only after 12.8 s of waiting,
against 0.36 s for Groq and ~0.7 s for `gemini-3.5-flash-lite`. On a voice product
that gap is paid in dead air — time to first audio measured **31 s** with OpenAI
first and **~16 s** after it was dropped. `app/models/api/openai_llm.py` and the
whole `app/models/quota.py` daily-budget mechanism went with it, along with
`OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_DAILY_LIMIT`.

Classification never used the brain lane and still does not: routing
(`pipeline/router.py`), screen planning (`pipeline/screen_agent.py`) and Kannada
post-translation all use `get_classifier_llm()` (Groq → Gemini), and Text-to-SQL
has its own `get_sql_llm()` lane.

---


## 7. Voice Pipeline

```
Officer speaks → MediaRecorder → POST /voice/stt
  → detectLang() → Sarvam Saaras v3
  → Shell.tsx voice router
      ├─ navigation command → navigate()
      └─ query → satyam:voice-send event
                   → console.tsx sendMessage({ speak: true })
  → Pipeline → composed answer + [SPEAK] summary
  → speakViaSarvam(spokenSummary, resolvedLang) → POST /voice/tts
  → audio plays; conversation mode auto-re-activates mic
```

**Language priority for TTS:**
1. Explicit voice-turn locale (e.g. `kn-IN` from mic)
2. UI language toggle (`lang === "KN"` → speak Kannada)
3. No more text-content auto-detect — toggle is authoritative

**Two independent microphones:**
- **Copilot mic** (top-right) — screen navigation + Q&A; engine user-selectable in Settings → Models
- **Chat-box mic** (textarea button) — dictation into the chat textarea only; always Browser Web Speech; never dispatches `satyam:open-voice`

### 7.1 Copilot STT Engine Toggle

The top-right copilot supports two STT engines, switchable in Settings → Models → **"Voice copilot mic (Speech-to-Text)"**:

| Engine | Key | Behaviour |
|--------|-----|-----------|
| **Browser** (default) | `copilotStt: "browser"` | Web Speech API — live word-by-word captions, lowest latency, Kannada via `kn-IN` (Chrome/Edge) |
| **Sarvam Saaras v3** | `copilotStt: "sarvam"` | Utterance upload → best Kannada accuracy, ~1.5s wait, any browser |

- `copilotStt` is stored in `localStorage` under `satyam.engine-settings` and merged with `loadEngineSettings()` spread-defaults so existing users inherit `"browser"` automatically.
- The copilot uses **one engine for both its mic and its spoken replies**: when `copilotStt = "browser"`, the copilot listens *and* speaks with the device's built-in Web-Speech voice; when `"sarvam"`, it uses Sarvam STT + Sarvam Bulbul TTS. This override is applied via `copilotVoiceProvider()` in `Shell.tsx`, which passes a `providerOverride` to `speak()`. The global **Voice (Text-to-Speech)** setting still governs the chat-box / console read-aloud independently.
- The chat-box mic (`toggleChatDictation` in `console.tsx`) writes only to the `input` state and never touches copilot state or dispatches `satyam:open-voice`. This is a permanent fix for the regression where the chat-box mic used to open the copilot panel.

```
Copilot mic tap  →  loadEngineSettings().copilotStt
  ├─ "browser"  →  new SpeechRecognition(), rec.lang = "kn-IN" / "en-IN"
  │                 → live interimResults → armSilence (1.5s) → dispatchTurn()
  └─ "sarvam"   →  startSttSession({ backend:"sarvam", silenceMs:1500 })
                    → Sarvam Saaras v3 → onResult → dispatchTurn()
                    → dispatchTurn() → satyam:voice-command → Gemini brain
                    → speakViaSarvam(answer, lang) → Sarvam Bulbul TTS
```

---

## 8. Security

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
| admin, analyst | state | L4/L3 |

### 8.2 PII Masking — three separate mechanisms, not one

> **Corrected in v4.1.** This section previously described a single uniform
> "four-tier masking" model. That is not what the code does, and the difference
> matters: **row** scoping and **column** masking are enforced in different places,
> by different code, with different coverage. Read them as three mechanisms.

| # | Mechanism | Where | Coverage |
|---|-----------|-------|----------|
| 1 | **Row scoping** | Postgres RLS policies, `db/rls.py` GUCs | Every query on the session, including LLM-generated SQL. Decides *which rows exist*. Does **not** mask columns. |
| 2 | **Case-detail masking** | `core/masking.py::mask_case()` | Called only from `services/case_service.py`. Bullet-masks names and coarsens coordinates on the case-detail path. |
| 3 | **Text-to-SQL masking** | `pipeline/tools/text_to_sql.py::_mask_rows()` | Applied to SQL-lane result rows when `principal.clearance < 3`. |

**Mechanism 3 is a fixed column-name allow-list, not a semantic guarantee.**
`_PII_COLUMNS` is exactly: `name`, `full_name`, `victim_name`, `accused_name`,
`complainant`, `io_name`, `place_of_offence`. A generated query that selects a
personal column under a different name — or aliases one — is **not** masked.

**There is no `persons_v` masked view in any database**, and
`sql_guard.ALLOWED_TABLES` includes raw `persons`. Treat column-level PII masking
on the Text-to-SQL path as *partial* rather than as an enforced invariant. Any
claim that the SQL lane is "pointed only at masked views, never raw PII" is false.

**Narrative bodies** are gated separately, in `rag.py::_apply_clearance()`, via
`Principal.can_see_narrative(crime_type)`. That path is deliberately
**fail-closed**: a missing principal or an unresolvable crime type withholds the
body rather than exposing it, and a withheld hit is still returned (with
`restricted=True` and a notice in place of the text) so the officer learns a
restricted record matched instead of seeing a silent absence.

**PROTECTED crime types** (`rbac.PROTECTED_CRIMES`): POCSO, POCSO RAPE, RAPE,
MOLESTATION, DOWRY DEATHS, SC/ST (ATROCITIES), SEXUAL HARASSMENT, STALKING,
ASSAULT ON WOMEN, KIDNAPPING OF WOMEN AND GIRLS. Helpers: `can_view_case_full()`
(L4 for protected, else L3), `should_mask_pii()`, `should_coarsen_coords()` (L<2),
`can_see_narrative()` (L3 for protected).

### 8.3 SHA-256 Audit Hash-Chain (C1 fix applied)

- Every query: `row_hash = SHA-256(prev_hash + payload)`
- `pg_advisory_xact_lock` serializes all appends — chain can no longer fork under concurrent load
- `write_audit()` committed in its own transaction (survives mid-stream client disconnect)
- `verify_chain()` walks rows in `audit_id ASC` and confirms hash integrity

### 8.4 JWT + Login Hardening

- Startup refuses to boot in production with the default JWT secret (H1 fix)
- `is_active` check at login — disabled accounts get HTTP 403 before password check
- `clearance_override` / `scope_override` columns respected at login — policy changes take effect on next sign-in
- Anti-lockout: admins cannot disable their own account or lower own clearance below L4

### 8.5 Ops Write Guard

`_guard_write(principal)` — requires `Permission.RUN_ANALYTICS` (L2+) on all side-effecting ops endpoints: dispatch, confirm_item, detect/notify, camera/start|stop. Read endpoints remain open to all authenticated officers.

---

## 9. Intelligence Features (PS1–PS8)

| PS | Screen | Endpoints | Status |
|----|--------|-----------|--------|
| PS1 | Console | `/chat` SSE, `/map/hotspots`, `/map/station-breakdown` | ✅ |
| PS2 | Network (3 tabs) | `/network/*`, `/api/network/rings`, `/financial/money-trail` | ✅ |
| PS3 | Trends (4 tabs) | `/api/trends`, `/api/trends/seasonal`, `/api/mo/clusters` | ✅ |
| PS4 | Socio Dashboard | `/api/socio/*` | ✅ Real Pearson |
| PS5 | Offender Profile | `/api/persons/{id}/profile`, `/api/offenders` | ✅ |
| PS6 | Similar Cases | `/api/cases/{id}/similar`, `/api/cases/similar/search` | ✅ |
| PS7 | Financial | `/financial/money-trail` (BFS, NOT via Text-to-SQL) | ✅ |
| PS8 | Forecast | `/api/forecast/hotspots`, `/api/forecast/alerts`, `/api/forecast/backtest` | ✅ |

### Console Intelligence Upgrades

- **Chat width resize** — drag divider between chat rail and results canvas (260px–60%)
- **CaseDrawer** — persistent component (never unmounts), per-caseId cache so re-opening is instant, Map tab shows real embedded mini-map + "Take me to map" button
- **"Ask AI about this area"** fix — place extraction keeps full phrases, no false "no records" from rate-limited prompts, progressive broadening fallback

---

## 10. Response Ops Module (`ENABLE_RESPONSE_OPS=true`)

### 10.1 Dedicated Sidebar Routes

> **Changed since v4.0.** The standalone `/operations` route no longer exists.
> `LiveOperationsMap` was absorbed into the Vision workspace and is now referenced
> only from `components/vision/` (`VisionMapCanvas.tsx`, `useVisionData.ts`), which
> the `/vision` route renders via `VisionWorkspace`.

| Route | Screen | Component |
|-------|--------|-----------|
| `/vision` | Tactical Map (formerly Live Ops Map) | `VisionWorkspace` → `VisionMapCanvas`, which hosts `LiveOperationsMap` |
| `/ops-predictive` | Predictive Deployment | `PredictivePanel` — forecast heatmap + patrol suggestions + deployment simulation |
| `/ops-dispatch` | Dispatch & Green Corridor | `DemoSimPanel` — in-browser patrol simulation; scenes from real forecast hotspots |
| `/ops-camera` | Camera Review | `ReviewPanel` — live annotated MJPEG feed + incident queue |

### 10.2 Dataset-Grounded Ops (no backend WebSocket required)

All three map screens were previously gated behind `ENABLE_RESPONSE_OPS`, seeded patrols, and a live WebSocket — so they showed blank when the ops backend was off. They now fall back gracefully to the **dataset endpoints that already work**:

| Panel | Data source | Fallback |
|-------|-------------|---------|
| `PredictivePanel` | `GET /api/forecast/alerts` + `GET /api/forecast/hotspots` | Synthesises risk cells from `POST /map/hotspots` (real crime density) |
| `DemoSimPanel` | `GET /api/forecast/hotspots` (top 5 by risk score) | 4 fixed Bengaluru anchor scenes |
| `LiveOperationsMap` | `GET /api/forecast/hotspots` + `GET /api/risk-zones` | Always shows crime density heatmap; live ops overlay layered additively on top when WebSocket is running |

**No synthetic or hard-coded coordinates** — every lat/lng comes from the real case dataset.

**Deployment simulation (client-side only):**  
`PredictivePanel` animates a patrol car from an idle origin to the forecast hotspot using a straight lerp route (48 steps, 110 ms/tick). `DemoSimPanel` adds a curved Bézier approach path + green signal corridor leg + live event feed — 100% browser-side, zero backend writes.

### 10.2 YOLO Camera Review Pipeline

```
Backend FastAPI
  └─ POST /camera/start
       ├─ _resolve_python()  — probes for Python with cv2+ultralytics (cached)
       │   → run via asyncio.to_thread (non-blocking)
       ├─ _free_port(8089)   — guaranteed-free port
       ├─ _yolo_lock         — prevents double-spawn
       ├─ JWT via create_access_token() for subprocess auth
       └─ Popen([python, live_cctv.py, --no-display, --mjpeg-port N])
            └─ _drain() thread reads stdout (prevents pipe-buffer freeze)

YOLO Process (model/inference/live_cctv.py)
  ├─ Loads model/yolov8s.pt (COCO)
  ├─ Optional model/gun.pt for weapon detection
  ├─ Detection: fight (proximity+speed), crowd (≥4 people), vehicle stall, weapon
  ├─ 15s cooldown per detection type
  ├─ notify() → POST /api/ops/detect/notify with JWT
  └─ MJPEG server on :N  →  annotated frames with bounding boxes + detection banners
```

**Frontend:** `<img src="http://localhost:{streamPort}/stream">` shows live annotated feed.

---

## 11. Investigation Board (`/board`)

### 11.1 Architecture

**Frontend:** tldraw v5.1.1 — full design canvas in a React route

**Features:**
- All tldraw built-in tools: shapes (rect/ellipse/triangle/star/arrow), freehand draw, text, image, stickers
- Resize handles on every shape
- Inline text editing (double-click any shape)
- Color fills, borders, shadows, dash styles
- Infinite pan/zoom with snap-to-grid and rulers
- Layers (pages panel)
- Alignment + distribution tools
- Export to PNG (2× resolution) via `editor.toImage()`

**AI Scene Generator (bottom-right chatbox):**
1. User types a crime scene description (+ optional photos)
2. `POST /api/board/generate` → Gemini (or Groq per `boardEngine` setting)
3. Returns `SceneGraph` (nodes + edges) validated by Zod
4. `applySceneToEditor()` creates geo shapes + bound arrows in tldraw
5. `editor.zoomToFit()` ensures every scene fits regardless of complexity
6. If LLM returns empty or 429 → `_keyword_scene()` fallback builds a ring layout from prompt keywords

**Save/Load:** `POST /api/board/save` stores tldraw `editor.getSnapshot()` as JSONB in `boards` table.

**Backend isolation:** `boards` / `board_snapshots` tables have no FK to real dataset tables, no RLS.

### 11.2 Pointer Events Architecture

The `BoardInner` overlay wrapper is `pointer-events: none` — only the toolbar bar and AI chatbox have `pointer-events: auto`. This ensures tldraw receives all draw/click/drag events uninterrupted.

---

## 12. Person 360 Dossier (`/dossier`)

**Access:** L4+ admins only (clearance ≥ 4 or rank in DGP/ADGP/IGP/SP/admin)

**10 fictional Karnataka personas** — each has:
- Mugshot face card (front/left/right angles) with forensic height grid lines
- Physical description, contact details, home address
- Crime history timeline (DEMO/year/nnnn case refs)
- Family members table
- Known associates table
- Bank accounts with flagged suspicious accounts

**Data isolation:** All data in `demo_dossier_*` tables — no FKs to real dataset, no RLS, no seed/embed involvement.

**Performance:** Background pre-fetch of all 10 profiles on mount — subsequent clicks are instant (cache hit, zero network call).

---

## 13. Access Control Admin (`/admin`)

**Access:** L4+ only — `Permission.ADMIN` guard on all endpoints

**Features:**
- Searchable table of all users with: name, rank, effective clearance, scope, "Created by" (or "Self-registered"), active/disabled status
- **Edit Policy modal** — change rank, clearance override (L1-L4), scope override (state/range/district/station), enable/disable account
- Every change writes `ADMIN_POLICY_CHANGE` to the hash-chained audit log with before/after state and mandatory reason
- **Anti-lockout:** admins cannot disable themselves or drop their own clearance below L4
- Changes take effect on target's next login (JWT re-minted with overrides)

**New `users` columns (migration 006):**
- `created_by INT NULL` — tracks who provisioned the account
- `clearance_override SMALLINT NULL` — overrides rank-derived clearance
- `scope_override TEXT NULL` — overrides rank-derived scope

---

## 14. Frontend Architecture

### 14.1 Route Map

> Verified against `frontend/src/routes/*.tsx` on 2026-08-24. Two corrections
> since v4.0: **`/operations` no longer exists** (the full-bleed ops map was
> superseded by `/vision`; the name survives only in comments inside
> `components/vision/map/buildLayers.ts`), and **`/ask` and `/vision` were missing**
> from this list.

```
/                     Animated landing page (Three.js particle brain, scoped CSS)
/login                Demo login — 14 KSP ranks · GridScan WebGL backdrop
/about                Technical handbook — 5 chapters, LineSidebar rail (§27)
/ask                  Dedicated chat surface — SSE stream, voice I/O, history rail
/console              PS1: Chat + Results Canvas (resize divider, CaseDrawer)
/forecast             PS8 + PS3 merged — Early warning · Risk surface · Trends · Patterns
/trends               → 307 redirect to /forecast?tab=trends (see §14.5)
/network              PS2: People / Financial Links / Rings (3 tabs)
/socio                PS4: Socio-Economic Dashboard
/profile/:personId    PS5: Offender dossier
/reports              Report builder + PDF print
/audit                Hash-chain audit log
/transcripts          Conversations + Voice transcripts
/vision               Tactical geospatial surface (deck.gl / MapLibre)
/ops-predictive       Predictive Deployment
/ops-dispatch         Dispatch & Green Corridor
/ops-camera           Camera Review + YOLO MJPEG feed
/board                Investigation Board (tldraw design canvas)
/dossier              Person 360 Dossier (L4+ only)
/admin                Access Control (L4+ only)
```

**Public (no `Shell`, no auth):** `/`, `/about`, `/login`.
**Everything else** renders inside `Shell`. Note there is **no route-level auth
guard** — `Shell`-wrapped routes are protected only by the fact that their API
calls 401 without a bearer token, and `login.tsx` has an offline demo path that
navigates to `/console` when the backend is unreachable. Client-side rank gates
exist on `/admin` and `/dossier` only.

### 14.2 Key Components

| Component | Purpose |
|-----------|---------|
| `Shell.tsx` | Nav rail (`NAV` array — see §14.1 for the live route list) + voice router + language toggle + `isAdmin` gate + header Hands-free camera toggle + `HandsFreeLayer` mount |
| `CrimeMap.tsx` | Leaflet map with `darkTiles`, `lockBounds`, `fitSignal`, `liveMarker`, `corridorPath` |
| `CaseDrawer.tsx` | Persistent (never unmounts), per-caseId cache, Map tab with embedded map + "Take me to map" |
| `SettingsDialog.tsx` | 3-provider AI Chat Model cards, Board AI engine dropdown, copilot STT toggle, **Hands-free** tab |
| `HandsFreeLayer.tsx` | Single integration point: mounts gesture/face controllers, executes intents, manages War-room + wake-word |
| `GestureController.tsx` | rAF detection loop: cursor mapping, swipe, vote+hold, pinch-click, intent dispatch |
| `FacePresenceController.tsx` | Face detection poll: auto-lock on absence, audit entry, re-arm on resume |
| `LockOverlay.tsx` | Full-screen PII blur gate; bilingual; dispatches `satyam:session-unlock` on resume |
| `WarRoomMode.tsx` | Presentation banner + vignette ring; pointer-events isolated |
| `board.tsx` | tldraw design canvas — `pointer-events-none` overlay, `applySceneToEditor`, AI chatbox |
| `dossier.tsx` | Person 360 — background pre-fetch, FaceCard with lightbox, crime timeline |
| `admin.tsx` | Access Control — policy editor modal, anti-lockout warning |
| `index.tsx` | Landing page — Three.js particle brain (v2 velocity physics), tldraw-inspired look |
| `ask.tsx` | Dedicated chat surface — SSE, voice I/O, conversation rail, `Globe` backdrop, `BorderGlow` composer |
| `LineSidebar.tsx` | Proximity-reactive chapter rail for `/about` (§26.4) |
| `Globe.tsx` | Rotating dotted globe backdrop on `/ask`, `cobe` + theme tokens (§26.4) |
| `BorderGlow.tsx` | Edge-lit halo around the chat composer, theme-driven (§26.4) |
| `GridScan.tsx` | Scanning-grid WebGL backdrop on `/login`, reuses the existing `three` dep (§26.4) |
| `lib/theme.ts` | Theme catalogue + `applyTheme()` / `applyStoredTheme()` — single source of truth (§26.1) |
| `lib/viewTransition.ts` | Circular-reveal theme switch via the View Transitions API (§26.2) |
| `lib/api/readCache.ts` | Short-TTL read cache at the transport seam (§25) |

### 14.3 Landing Page (/)

- **Three.js v0.160.0** — 9,000-particle morphing brain (`/` route only, SSR-safe `useEffect`)
- **Velocity physics v2** — `vel[N*3]` buffer, spring (SPRING=0.05) + damping (DAMP=0.87) + radial lift + tangential swirl + wake/drag for comet-trail effect
- **7 themes + light/dark** — `window.satyamState`, `localStorage`, scoped CSS under `.satyam-landing`
- **Routing:** Login → `<Link to="/login">`, Features → `#sl-features`, Console → `<Link to="/console">`
- CSS scoped under `.satyam-landing` — never bleeds into the authenticated app

### 14.4 API Client (`lib/api/client.ts`)

Key exports:
- `api.adminUsers()` / `api.updateUserPolicy()`
- `api.modelProviders()` → configured booleans only
- `api.cameraStart()` / `api.cameraStatus()` → returns `stream_port`
- `streamChat()` — SSE with `"speak"` event type for spoken summary

All GET traffic goes through `cachedFetch()` from `lib/api/readCache.ts` rather
than `fetch()` directly — see §25. This applies to `client.ts::request()` and to
the four duplicate `apiFetch` helpers in `intelligence.ts`, `financial.ts`,
`dossier.ts` and `board.ts`.

---

### 14.5 Trends merged into Forecast (PS3 + PS8)

`/trends` was a separate screen. It asked the same question as `/forecast` from the
other end of the same data — trend analysis is "where has this been", forecasting is
"where is this going" — and an officer deciding where to place a patrol needs both at
once. The two screens also duplicated a filter bar, a KPI idiom, a refresh control,
three competing KPI treatments, two count-up hooks, four separate horizontal-bar
implementations and five disagreeing colour schemes.

`/forecast` is now four tabs, selectable via `?tab=`:

| Tab | Content | Sources |
|-----|---------|---------|
| `warning` | Severity mix, alert cards, backtest validation | `/forecast/alerts`, `/forecast/backtest` |
| `surface` | Geographic risk scatter, ranked highest-risk cells | `/forecast/hotspots` |
| `trends` | Area+line time series, QoQ/YoY deltas, crime×period heatmap, top types and districts | `/trends` |
| `patterns` | MO clusters (expandable, opens `CaseDrawer`), seasonal peaks | `/mo/clusters`, `/trends/seasonal` |

**`/trends` is now a redirect**, not a deleted route:
`beforeLoad: () => { throw redirect({ to: "/forecast", search: { tab: "trends" }, replace: true }) }`.
Verified as `307 → /forecast?tab=trends`. It is the only redirect in the repo. The
file is kept because `/trends` is still named by bookmarks and this document; the
gesture ring and the voice manifest have been migrated.

**Six sources settle independently.** The previous screen awaited three endpoints in
one `Promise.all`, so a single failure blanked everything and every panel showed zero
with no indication which request had died. Each source now settles on its own into
`pending` / `failed` sets, so a dead endpoint degrades exactly one panel and names
itself. Measured cold load: **~10-14s**, because the six endpoints take 3-6s each.

**The load indicator is real.** The old "neural forecast engine" panel animated a
four-stage pipeline (FIR intake → Features → Risk model → Risk surface) that was
wired to nothing, so a slow load was indistinguishable from a broken screen — that is
exactly what the "Acquiring signal… / 0 cells / 0 high risk" report was. `SourceStatus`
reports `Loading n/6`, `All sources live`, or `n of 6 failed` with a Retry button.
`pending` is seeded with all six keys, because an empty initial set makes the first
paint claim every source is live before a single request has been made.

**One severity scale.** `severityColor(level, palette)` is ordered
green → yellow → orange → red from `--chart-down` / `--warning` / `--chart-2` /
`--chart-up`. It replaces six `RISK_*` Tailwind maps, a `BAR_COLORS` gradient list,
inline lift ternaries, a delta-card trio and direct `var(--main)` fills. The middle
stop is `--warning` rather than a categorical series colour: an earlier revision used
`--chart-6` (cyan) for Medium, which made Medium read as more urgent than High.

**Honesty labels on this screen are deliberate.** There is no neural network:
`risk_score` is a hand-tuned formula over incident density and a 30-vs-30-day lift,
and the `why` strings are templates. The screen therefore labels the PAI tile
"heuristic", states on the risk surface that **the horizon control does not yet
change the numbers** (`get_forecast_hotspots` accepts `horizon_days` and never uses
it — the windows are fixed), and notes that MO clusters ignore the filters because
`/mo/clusters` takes no parameters.

### Local-only bilingual RAG and the 1,120-station roll

Everything in this section applies to the **local** database only. The Neon cloud
database is deliberately untouched — verified after the work: 646 stations, 71,986
narratives, 35,993 embedded, and neither new table nor new index present.

**The local corpus was already ahead of the cloud one.** Cloud carries 35,993 cases
with half the narratives embedded because of the 512 MB cap. Local carries **100,000
cases, 416,616 persons and 200,000 narratives — 100,000 English and 100,000 Kannada,
all 200,000 embedded**, in a 3.2 GB database with no cap. All 100,000 Kannada bodies
contain real Kannada script; none of the English ones do. So Kannada RAG needed no
embedding work locally. What it needed was a lexical arm that worked.

**The lexical arm was dead, and the logs said so.** Every narrative query reported
`strategy=vector`. Three compounding causes, each measured:

| Cause | Evidence |
|---|---|
| `plainto_tsquery` ANDs every term | "find cases about thefts of two-wheelers near a market" became an 11-lexeme conjunction and matched **0 rows** |
| `body_tsv` is `to_tsvector('simple', body)` — no stemming | "thefts" 0 hits, "robberies" 0, "murdered" 0, "vehicles" 0. The corpus says "theft" |
| `ts_rank` has no IDF, so OR-ing instead does not help | OR matched 109,749 rows; 1 of the top 6 mentioned any distinctive term and `ts_rank_cd` tied at exactly 0.60000 |

The narratives are template-generated, so `investig`, `hrs`, `regist`, `fir`, `vide`,
`district`, `limit` appear in **100%** of documents, `case` in 94%, `report`/`complain`
in 81%. Ranking cannot separate documents when the matched terms are the boilerplate.

**An expression index was tried and rejected on measurement.** A partial functional
GIN index over `to_tsvector('english', body)` is fast for the table owner (51 ms) and
collapses to **8.5 s** for the app role, past the 5 s `statement_timeout` that
`db/rls.py` sets. The narratives RLS policy is
`EXISTS (SELECT 1 FROM cases c WHERE c.case_id = narratives.case_id AND fn_scope_ok(...))`,
which is a security barrier, and `@@` is not leakproof — so the planner cannot use the
tsquery as an index condition through it. The plan degrades to a filter that recomputes
`to_tsvector` for all 100,000 English rows and runs the policy subplan 100,000 times.
That index was dropped again rather than left as dead weight.

**What shipped** (`migrations/012_local_bilingual_rag.sql`, local-guarded): keep
matching the *stored* `body_tsv` — a column, not an expression, so it stays cheap under
RLS — and move the intelligence into a precomputed vocabulary table
`narrative_lexeme_df(lang, lexeme, stem, ndoc)`:

- **IDF filtering** drops any term group appearing in more than 20% of the corpus, so
  the boilerplate never reaches the query.
- **Stem expansion** recovers stemming against an unstemmed index: a query token is
  mapped to the corpus tokens sharing its English stem, so "thefts" → `(theft)` and
  "two-wheelers" → `(wheelers)`.
- **Relaxation** ANDs the surviving groups most-selective-first and drops the commonest
  group when a round is empty — "minimum should match" by retry. Measured: the 5-group
  conjunction matched nothing, the 4-group one matched 8, all containing every kept term.

Build cost is 2 s (`ts_stat` runs at 0.9 s per 20,000 documents), producing 11,084
English and 10,804 Kannada tokens. Query cost under RLS is **~380 ms**, inside the cap.

Retrieval now reports `strategy=hybrid` with `groups=4/5` and `groups=2/3` in the logs.
`rag.py` probes for the vocabulary table once per database source and falls back to the
previous `plainto_tsquery` behaviour when it is absent, which is what keeps cloud
byte-identical in behaviour.

**Language handling is a bias, not a partition,** and the two arms differ. The dense arm
partitions cleanly because the embedding space clusters by script — probing with an
English narrative's own vector returned ten English neighbours and never its Kannada
twin. The lexical arm does not, because Kannada narratives carry Latin-script tokens
(names, "Bengaluru City", vehicle numbers); an English question produced 4 English
groups and 2 Kannada ones. Both arms run and merge by rank, which is reasonable here
because every case exists in both languages, so a cross-language hit is the same case
seen through its other narrative.

**Stations: 1,074 → 1,120** via `seed/local_expand_stations.py` (local-guarded,
idempotent, `--dry-run` supported). The brief cites "1100+"; 1,074 was under it. New
rows use real Karnataka taluk and town headquarters plus station types KSP genuinely
operates (Women, CEN, Traffic), added only to districts lacking them. No district or
range is invented — each row reuses an existing district and its modal range, so
jurisdiction joins and `fn_scope_ok` are unaffected, and 0 cases are orphaned.
Coordinates are seeded random points inside the bounding box of the district's existing
stations: plausible district-level placements, **not surveyed locations**, consistent
with a synthetic dataset.

### The forecast backtest is a real backtest now

`get_forecast_backtest` was a single-fold density comparison that published a
figure it could not support. Every problem below was live, and all of them are
fixed together because they interact — correcting the denominator alone moves the
number in the opposite direction to correcting the train window.

| Was | Problem | Now |
|---|---|---|
| `metric="PAI"` on a hit rate | PAI is a *ratio* against area share, not a percentage. The card printed 41% as "PAI score". | `pai` is the ratio (4.41x measured); `hit_rate_top_10_percent_cells` stays a rate and is labelled as one. |
| `ranked … WHERE train_cnt > 0` | Cells with no history were dropped from the **denominator**, not just from selection. 345 of 452 held-out incidents (76%) never counted. | Unrankable cells are still never selected, but every held-out incident stays in the denominator. `excluded_incidents` reports how many. |
| 30-day train window | Combined with the filter above, only 381 cells were rankable and the busiest held 4 incidents. | Features match the scorer: all-time density, last-30-day count, prior 30-90-day baseline, all as of the fold origin. |
| Hardcoded `0.02` grid | ~1.1 incidents per cell. Ranking counts that small ranks Poisson noise. | `grid_size` parameter, default `0.05`. The screen forwards its own Grid control, so Fine/Medium/Coarse now changes the score. |
| One fold, n=107 | 95% CI of 32-50%. Any "improvement" under 18 points was unmeasurable. | `folds` rolling-origin windows (default 6, n=2,581) plus a Wilson interval and per-fold breakdown. |
| Ranked raw `train_cnt` | The screen shows `20 + density + lift`, so the backtest validated a different model than the UI. | `_RISK_SCORE_SQL` transcribes `_risk_score()`; the two are pinned together by `tests/test_forecast_backtest.py`. |
| `PERCENT_RANK() <= 0.10` | Ties on a sparse grid pushed the "top decile" to 11.0% of cells. | `NTILE(10)`, tie-broken on coordinates — never on `test_cnt`, which would leak the answer. |
| No parameters | Crime type, district and grid filters could not narrow it. | All three accepted and forwarded from the screen. |
| No baseline | 41% sounds good or bad depending on nothing. | Reports the random-targeting baseline, and PEI against the best achievable selection at equal area. |

Measured on the cloud dataset, 6 folds x 30 days, n=2,581 held-out incidents:

| Grid | Hit rate | PAI | PEI | Train incidents/cell |
|---|---|---|---|---|
| 0.01° | 27.7% | 2.78x | 0.28 | 3.4 |
| 0.02° | 33.8% | 3.39x | 0.34 | 6.4 |
| 0.05° | 44.1% (95% CI 42-46) | 4.41x | 0.61 | 20.3 |

The PEI column is the finding: at 0.02° the formula captures a third of what a
hindsight-perfect selection of the same cell count would capture, at 0.05° nearly
two thirds. Grid resolution, not data quality, was the binding constraint — 99.6%
of cases carry coordinates.

**Definitions that a reader has to know to quote the number.** The *study area* is
the set of cells that ever hold an incident, not the map extent; a wider study
area inflates PAI for identical predictions. *Hit rate* is pooled over incidents
rather than averaged over folds, so a sparse fold cannot outvote a busy one. The
response carries these as a `caveats` list and the screen renders them under the
metrics, so the qualifications travel with the figure instead of living only here.

**Still open, and deliberately not hidden:** this validates a hand-tuned formula,
not a learned model. The next gains are model-side — near-repeat/Hawkes decay
instead of a flat window, kernel density instead of hard cell edges, per-crime-type
models, and the unused `district_socio_economic_indicators` and `incident_time`
hour-of-day features. Fitting the `20 + density + lift` weights against this
backtest is now possible because there is finally a stable metric to fit against.

**Voice.** `screen_agent.py` merged the `/trends` manifest into `/forecast`: the union
of both keyword sets and `set_granularity` added to the seven existing actions. The
`/trends` manifest entry and its `_rule_plan` branch are gone, with the
week|month|quarter extraction folded into the `/forecast` branch. The frontend
listener accepts actions addressed to **either** `/forecast` or `/trends`, so a stale
plan still lands; `set_severity` opens the Early-warning tab and `set_granularity`
opens the Trends tab. A `/forecast` entry was also added to `Shell.tsx`'s
`SCREEN_ROUTES` (neither screen had one), placed above the `/console` "map" entry so
"hotspot forecast" reaches Forecast, and deliberately claiming neither bare `hotspot`
nor bare `predict` — `/ops-predictive` sits lower in that list and would be starved.

`components/ModelInferenceTheater.tsx` is now unused by any route.

## 15. Bilingual Support — EN + KN

| Layer | Scope | Implementation |
|-------|-------|---------------|
| 1. Static UI | Nav, buttons, labels | `i18n.tsx` DICT — 250+ EN→KN entries |
| 2. Categorical DB | crime_type, status, district | `tData(field, value, lang)` + `kn-data.json` |
| 3. Case narratives | `narratives.body` | `?lang=kn` → backend prefers `language='kn'` |
| 4. AI answers | Chat responses | `lang_directive` in ANSWER_SYSTEM prompt |
| 5. Spoken summary | TTS voice output | `_build_spoken_summary(lang="kn")` for Kannada |

**Language toggle authority:** The EN/KN button in the header is the sole source of truth for TTS language. Text content auto-detection is disabled — if you set EN, voice always speaks English regardless of response content.

---

## 16. API Reference

### 16.1 Core

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/auth/login` | JWT, respects clearance/scope overrides |
| `POST` | `/auth/register` | Creates user + officer row |
| `GET` | `/auth/stations` | All KSP stations (for sign-up picker) |
| `POST` | `/chat/stream` | SSE with `speak`, `token`, `citation`, `done` events |
| `GET` | `/cases/{id}?lang=` | Case + persons + narrative |
| `POST` | `/map/hotspots` | Heatmap points |
| `POST` | `/map/station-breakdown` | Station FIR table |

### 16.2 Intelligence (`/api/`)

| Path | Notes |
|------|-------|
| `GET /offenders` | L2+ — browse all accused |
| `GET /persons/{id}/profile` | L2+ — risk, MO, associates |
| `GET /cases/{id}/similar` | RAG similarity |
| `POST /cases/similar/search` | Description-based search |
| `GET /trends` | Series + QoQ/YoY |
| `GET /forecast/hotspots` | Risk grid with PAI |
| `GET /network/rings` | Criminal ring detection |
| `POST /financial/money-trail` | L2+ — BFS money trail (NOT via Text-to-SQL) |

### 16.3 Response Ops (`/api/ops/`)

| Path | Notes |
|------|-------|
| `GET /risk-zones` | Scored patrol grid |
| `POST /dispatch` | Nearest patrol dispatch |
| `POST /detect/notify` | YOLO posts detection |
| `GET /review-queue` | Pending CCTV items |
| `POST /review-queue/{id}/confirm` | File case + auto-dispatch |
| `POST /camera/start` | Launch YOLO, returns `stream_port` |
| `WS /ws?token=` | Live events (PATROL_LOCATION, INCIDENT_CANDIDATE, …) |

### 16.4 Board (`/api/board/`)

| Path | Notes |
|------|-------|
| `POST /generate` | SceneGraph from prompt + optional images |
| `POST /save` | Upsert board (stores tldraw snapshot as JSONB) |
| `GET /list` | User's boards |
| `GET /{id}` | Load board |

### 16.5 Dossier (`/api/dossier/`)

| Path | Notes |
|------|-------|
| `GET /list` | L4+ — all 10 demo personas |
| `GET /{id}` | Full dossier with nested data |

### 16.6 Admin (`/admin/`)

| Path | Notes |
|------|-------|
| `GET /users` | L4+ — all users with creator info |
| `PATCH /users/{id}/policy` | L4+ — change rank/clearance/scope, audit-logged |

### 16.7 Settings

| Path | Notes |
|------|-------|
| `GET /settings/db-source/models` | Configured provider booleans (never keys) |

---

## 17. Configuration & Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | local asyncpg | Cloud/primary DB, used when `DB_SOURCE=cloud` |
| `LOCAL_DATABASE_URL` | `postgresql+asyncpg://satyam_app:…@localhost:5432/satyam` | Used when `DB_SOURCE=local` |
| `DB_SOURCE` | `cloud` | **Security-relevant, not a convenience switch** — see the warning below |
| `VECTOR_TYPE` | `vector` | `vector` (fp32, local) or `halfvec` (fp16, Neon) |
| `EMBEDDING_DIM` | `1024` | Asserted against the embedder at load |
| `NEON_STORAGE_CAP_BYTES` | `536870912` | 512 MiB hard cap the storage guard enforces |
| `MODEL_SERVICE_URL` | `""` | If set, embed/rerank are POSTed to a remote model service instead of running in-process |
| `REDIS_URL` | `redis://localhost:6379/0` | Conversation state |
| `JWT_SECRET` | `change-me-in-production` | HS256 — **fails to start in production if default** |
| `MODEL_BACKEND` | `api` | `api` or `local` |
| `BRAIN_ENGINE` | `gemini` | `gemini \| groq` |
| `SQL_ENGINE` | `gemini` | `gemini \| qwen3-coder-next` |
| `VOICE_BACKEND` | `sarvam` | `sarvam \| google \| bhashini` |
| `GEMINI_API_KEY` | `""` | Gemini 2.5 Flash |
| `GROQ_API_KEY` | `""` | Groq fallback |
| `SARVAM_API_KEY` | `""` | TTS/STT/MT |
| `BHASHINI_API_KEY` | `""` | Voice fallback |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Frontend → backend URL |
| `ENABLE_RESPONSE_OPS` | `false` | `true` to activate ops module |
| `SELF_BASE_URL` | `http://localhost:8000` | Backend self-URL for YOLO subprocess |
| `YOLO_PYTHON` | auto-detected | Python interpreter path for YOLO |
| `YOLO_MJPEG_PORT` | `8089` | MJPEG stream port (auto-finds free port) |

**Demo mode:** Both `GEMINI_API_KEY` and `GROQ_API_KEY` empty → `demo_mode=True` → `rule_sql.py` handles SQL, `_render_grounded()` handles answers, no API calls needed.

### 17.1 `DB_SOURCE` decides whether RLS is actually enforced

| Value | URL used | Connects as | RLS |
|-------|----------|-------------|-----|
| `cloud` (default) | `DATABASE_URL` | `neondb_owner` — table owner, `rolbypassrls=true` | **bypassed** |
| `local` | `LOCAL_DATABASE_URL` | `satyam_app` — non-owner | **enforced** |

The RLS policies are correct and identical in both databases, but **no table has
`FORCE ROW LEVEL SECURITY`**, so any table owner or `rolbypassrls` role ignores
every policy. A deployment that connects as a table owner therefore has RBAC in
Python but **no database-level jurisdiction enforcement**. Either run as a
least-privilege role or add `FORCE RLS`. Local dev uses `DB_SOURCE=local` for this
reason; run `migrations/008_local_app_grants.sql` once so `satyam_app` has grants.

### 17.2 Storage budget — the cloud database is near its ceiling

The Neon project has a hard **512 MiB** cap. Past it Neon rejects writes that
increase storage, which includes the `audit_log` row written on every audited
query — so this is an **availability** limit, not a billing one.

| Control | Bytes | % of cap |
|---------|-------|----------|
| Cap | 536,870,912 | 100% |
| Peak ceiling (one migration only) | 503,316,480 | 93.75% |
| Steady-state ceiling | 469,762,048 | 87.5% |
| Reserved headroom floor | 67,108,864 | 12.5% |

Live position from `GET /health/data` on 2026-08-24: **447,528,960 bytes used
(426.8 MiB), 89,341,952 free (85.2 MiB)**, `within_steady_ceiling: true`.
Measured cost of embedding one more narrative: **4,783 bytes** (halfvec datum +
HNSW share).

`python -m app.core.storage` (or `make storage`) reports the live position and
exits non-zero when a limit is breached. Every cloud backfill projects its cost
before writing and refuses if it will not fit — there is no bypass flag. **Do not
raise the ceilings to make an operation fit; reclaim space instead.** Caveat: Neon
meters its own notion of project storage including instant-restore history, while
the guard measures `pg_database_size()`. If the console disagrees with
`/health/data`, believe the console.

---

## 18. Deployment

### 18.1 Docker

```bash
cp .env.example .env
docker compose up --build
# frontend http://localhost:3000 | backend http://localhost:8000/docs
```

### 18.2 Local Dev

```bash
# Backend
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
psql "$DATABASE_URL" -f migrations/002_schema_v2.sql
psql "$DATABASE_URL" -f migrations/004_demo_dossier.sql
psql "$DATABASE_URL" -f migrations/005_boards.sql
psql "$DATABASE_URL" -f migrations/006_admin_access_control.sql
python -m seed.load_seed
python -m seed.load_demo_dossier
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && bun install && bun run dev

# YOLO (needs global Python with ultralytics)
# pip install ultralytics opencv-python httpx   (in global Python, not backend venv)
# Backend auto-detects the correct interpreter on camera/start
```

### 18.3 Migrations Applied (in order)

| File | Purpose |
|------|---------|
| `001_init.sql` | Legacy v1 schema. **Not sufficient on its own** — `002` drops and recreates the core tables, so applying only `001` leaves a schema the app cannot use. |
| `002_schema_v2.sql` | Core schema — cases, persons, narratives, users, audit_log, RLS |
| `003_add_ps4_ps7_tables.sql` | socio-economic indicators + financial accounts/transactions |
| `003_users_extend.sql` | full_name, email, photo_b64 on users |
| `004_demo_dossier.sql` | 5 isolated demo_dossier_* tables |
| `005_boards.sql` | boards + board_snapshots |
| `006_admin_access_control.sql` | created_by, clearance_override, scope_override on users |
| `008_local_app_grants.sql` | Grants for the least-privilege `satyam_app` role — required for `DB_SOURCE=local` (§17.1) |
| `010_narrative_vector_index.sql` | HNSW index on `narratives.embedding` — vector RAG is dead without it. `010_rollback.sql` reverses it. |
| `011_ops_rls.sql` | RLS policies for the `ops_*` tables |

Apply in filename order: `for f in migrations/0*.sql; do psql "$DATABASE_URL" -f "$f"; done`.
`teardown.sql` exists for a clean reset and is not part of the forward sequence.

---

## 19. Two-Phase Roadmap

| Layer | Phase 1 (Datathon demo) | Phase 2 (Sovereign on-prem) |
|-------|--------------------------|------------------------------|
| Brain | Gemini 2.5 Flash | Sarvam-M / Sarvam 30B |
| SQL | Gemini 2.5 Flash | Qwen-Coder local |
| Voice | Sarvam → Bhashini | Bhashini + Sarvam |
| Board AI | Gemini / Groq | Local Ollama |
| YOLO | YOLOv8s (COCO) + optional gun.pt | Custom KSP-trained model |
| Embeddings | BGE-M3 (local GPU) | BGE-M3 (local) |
| Hosting | External cloud (synthetic data) | Fully on-prem / India-hosted |

---

## 20. Bug Fixes & Security Hardening

### 20.1 Security

| ID | Fix |
|----|-----|
| H1 | Backend refuses to start in production if `JWT_SECRET` is the default `"change-me-in-production"` |
| H2 | `is_active` checked before password comparison — disabled accounts get HTTP 403, not 401 |
| H3 | `pg_advisory_xact_lock` serialises all audit-chain appends — hash chain can no longer fork under concurrent load |
| H4 | `write_audit()` committed in its own transaction — survives mid-stream client disconnect |
| H5 | `_guard_write(principal)` on all side-effecting ops endpoints (`dispatch`, `confirm_item`, `detect/notify`, `camera/start/stop`) — requires `Permission.RUN_ANALYTICS` (L2+) |
| H6 | **API keys never in URLs.** Gemini (chat + board brain) and Google voice now send the key in the `x-goog-api-key` header, not `?key=` — so it can't leak into request logs, error messages, or proxy access logs. (Groq/OpenAI/Sarvam already use `Authorization`/header auth.) |
| H7 | **AI never reveals secrets.** Both `build_answer_system()` (rule 9) and the static `ANSWER_SYSTEM` carry an absolute guardrail: never reveal/encode/hint at API keys, tokens, passwords, JWT secrets, DB URLs, or env vars — regardless of phrasing, role-play, or claimed authority; refuse with "That information is confidential." |

### 20.2 Voice / Mic Fixes

| ID | Fix |
|----|-----|
| V1 | Chat-box mic (`toggleChatDictation`) now has its own `SpeechRecognition` instance — never dispatches `satyam:open-voice`, never opens the copilot panel |
| V2 | Copilot STT is selectable (Browser / Sarvam) via `copilotStt` in `EngineSettings` — fully independent of the chat voice (`voiceBackend`) |
| V3 | Language for TTS follows the UI toggle exclusively — text-content auto-detect removed; EN toggle → always English TTS even if the reply contains Kannada words |
| V4 | Sarvam STT branch now passes `backend: "sarvam"` explicitly to `startSttSession()` |

### 20.3 Frontend / UI Fixes

| ID | Fix |
|----|-----|
| F1 | tldraw canvas was black — CSS variable bleed (`--bg: #050805`) fixed by explicit `background: #ffffff` + `--bg: #ffffff` override on the tldraw container |
| F2 | tldraw draw/write/click was blocked — `BoardInner` wrapper set to `pointer-events: none` so tldraw receives all pointer events |
| F3 | Ops screens (Predictive, Demo Sim, Live Map) showed blank without the ops backend — re-pointed to dataset endpoints (`/api/forecast/*`, `/map/hotspots`) that always work |
| F4 | CaseDrawer Map tab "no records" — place extraction now keeps full phrases (e.g. "Cyber Crime Police Station"), uses progressive broadening fallback |
| F5 | Board AI 429 rate-limit error — `_keyword_scene()` deterministic fallback builds a ring layout from prompt keywords when the LLM is rate-limited |
| F6 | Landing page `.thin` keyword colour — dark mode: `var(--text)` (white); light mode: `#0a160a` (black) via `.satyam-landing.light` override |
| F7 | **Landing page always opened dark.** `localStorage.getItem('satyam-mode') === 'light'` treated an *absent* key the same as an explicit dark choice, so every first visit was dark. Now reads the key once and treats anything other than an explicit `'dark'` as light. |
| F8 | **Dark mode left the main content area on a light background.** For the 7 legacy themes `applyTheme()` pinned `--background` as an *inline* style on `<html>`, and an inline custom property outranks every selector — so it beat `.dark { --background: … }` while `--foreground` correctly flipped to near-white. On `/ask` the headline measured **1.05:1** contrast. The override is now dropped in dark mode; measured **14.79:1** after. `--main` is still applied in both modes, since clearing it would collapse all 7 legacy themes to one palette. |
| F9 | **`DarkModeToggle` kept F8 alive through a second path** — it only toggled the `dark` class and never re-applied the theme. Both controls now route through `applyStoredTheme()` in `lib/theme.ts`. |
| F10 | **Reopening a chat from history landed on its oldest message.** The stick-to-bottom effect decided by measuring distance from the container's bottom, but on a conversation switch `scrollTop` is still the previous thread's position (usually 0); against the taller new transcript that reads as "far from the bottom", so the scroll was skipped. A conversation switch now jumps unconditionally. |
| F11 | **`/about` rail highlighted the wrong chapter at the top of the page.** The `IntersectionObserver` scrollspy tracked a band near the viewport top; above the first heading nothing intersects, so the callback had no entries and kept the previous chapter. Replaced with a scroll-position computation that always resolves. |
| F12 | **A CSS class passed through `cn()` was silently deleted.** `bg-glow` was read by tailwind-merge as a background-color utility and dropped as conflicting with the `bg-secondary-background` beside it — the class never reached the DOM. Renamed `edge-glow`. **Any hand-written class composed via `cn()` must not begin with a Tailwind utility prefix.** |
| F13 | **Screen-to-screen navigation refetched everything.** Added a short-TTL read cache at the transport seam (§25): 4 screens revisited went from **16 GETs to 6**, and all 6 remaining are `/auth/me`, which is deliberately never cached. |

### 20.4 Backend / API Fixes

| ID | Fix |
|----|-----|
| B1 | `[SPEAK]` tag stripped from the displayed table — only the spoken summary goes to TTS, not the full table |
| B2 | Board AI `brain_engine` field forwarded from frontend request — chosen engine (Gemini/Groq) is used instead of always Gemini |
| B3 | `_build_spoken_summary(rows, message, lang)` provides deterministic spoken summary when Gemini is unavailable or rate-limited |
| B4 | Progressive NL→SQL relaxation (4 levels) prevents "zero rows" dead ends — each level surfaces a friendly note in the chat |


---

## 21. Voice Screen Agent

### 21.1 Overview

The Voice Screen Agent upgrades the top-right copilot from a navigation-only system into a **full automation agent**. When an officer speaks a command, the agent:

1. **Navigates** to the correct screen (any of the 14 Satyam routes)
2. **Automates in-screen tasks** — sets filters, runs searches, generates reports, draws diagrams — without the officer touching the keyboard or mouse

### 21.2 Architecture

```
Officer speaks → copilot STT → Shell.tsx parseVoiceCommand()
  → POST /voice/agent  (AgentRequest: command, current_route, lang, brain_engine)
  → screen_agent.plan()
      ├─ LLM call (Gemini/Groq) with full CAPABILITY MANIFEST
      ├─ _sanitize_actions() — validate against allow-list
      └─ _rule_plan() fallback — deterministic, zero LLM, bilingual EN+KN
  → AgentPlan { route, answer, speak, actions:[{screen,action,params}] }
  → Shell navigates → dispatches satyam:run-task with structured actions
  → Target screen's useEffect listener executes the actions
  → copilot speaks the confirmation via Sarvam TTS
```

### 21.3 Backend Brain (`app/pipeline/screen_agent.py`)

**`SCREEN_CAPABILITIES`** — a manifest of all 14 screens and every action:

| Screen | Automatable actions |
|--------|---------------------|
| `/console` | ask, new_chat, show_on_map, set_map_mode |
| `/network` | search_seed, set_depth, set_link_mode, filter_edge, filter_community |
| `/reports` | add_case, set_title, set_template, clear, generate, print |
| `/forecast` | set_crime_type, set_district, set_horizon, set_grid, set_severity, refresh, toggle_auto |
| `/trends` | set_crime_type, set_district, set_granularity |
| `/board` | generate_scene, save, new, export |
| `/audit` | search, filter_action |
| `/dossier` | search |
| `/admin` | search |
| `/ops-camera` | start, stop |
| `/transcripts` | search_similar |

**`plan(command, current_route, lang, brain_engine)`** — main entry point:
1. Calls LLM with the full capability manifest as system context
2. Validates every `(screen, action, params)` triple — unknown actions are silently dropped
3. Falls back to `_rule_plan()` (deterministic, bilingual, works offline)
4. Returns `AgentPlan` consumed by Shell.tsx

**`plan(command, current_route, lang, brain_engine, planner)`** — main entry point:
1. If `planner="rule"`: skip the LLM entirely and use `_rule_plan()` (deterministic, offline).
2. Otherwise (`planner="llm"`, default): run an **engine cascade** — the chosen brain (`brain_engine`, default Gemini) first, then **Groq as an automatic fallback**. `_try_llm()` treats a `"[demo:...]"` echo (no API key) or any error/429 as a miss and moves to the next engine. This means a missing or rate-limited Gemini key never silently degrades the copilot — Groq picks it up.
3. Each parsed plan is validated + shaped by `_finalize_llm()` (sanitize against the manifest, enrich a bare route with rule-planner actions, normalize sample sentinels).
4. Only if **every** LLM engine fails does it fall back to `_rule_plan()`.

The planner is user-switchable in Settings → Models → **Copilot screen agent**: *LLM screen plan* (Gemini→Groq) vs *Rule screen plan* (deterministic). The chosen value rides on `AgentRequest.planner`.

**`_rule_plan()`** — deterministic fallback extractor:
- Detects route by keyword scoring (longer keyword = stronger match, EN + KN)
- Extracts: crime types, Karnataka districts, person names, numbers (1-30 → horizon)
- Per-route action builder: forecast gets `set_crime_type` + `set_district` + `set_horizon`; network gets `search_seed` + `set_depth`; etc.
- Works with zero LLM — demo mode, 429, offline

### 21.4 Frontend Changes

**`Shell.tsx`** — the main voice handler now calls `planVoiceAction()` instead of dispatching raw free-text tasks. Both the explicit-route branch AND the generic data-query branch go through the agent (agent returns `answer:true` for pure data questions → falls back to `answerInCopilot`).

**Copilot never writes to the Console chat.** The top-right copilot answers data/conversational questions *itself* (voice only, via `answerInCopilot` on a separate `copilotConvId`). `runScreenAgent` strips any `{screen:"/console", action:"ask"}` from the plan and, if nothing actionable remains (or the plan only targets `/console`), answers in the copilot instead of dispatching `satyam:run-task` to the chat. Posting turns into the Console chat thread is exclusively the chat-box mic's job.

**`satyam:run-task` event** extended with `actions` field:
```ts
{
  route: string,
  actions: { screen: string, action: string, params: Record<string,unknown> }[],
  query: string,
  task: string,
  lang: "en" | "kn",
  rate: number,
  speak: boolean,
}
```

**Screens with structured action listeners:**

| Screen | Actions wired |
|--------|--------------|
| `forecast.tsx` | set_crime_type, set_district, set_horizon, set_grid, set_severity, toggle_auto, refresh |
| `network.tsx` | search_seed, set_depth, set_link_mode, filter_edge, filter_community |
| `reports.tsx` | set_title, set_template, clear, generate, print, add_case (auto-search + add) |
| `board.tsx` | generate_scene (auto-fill prompt + trigger AI), save, new, export |
| `console.tsx` | ask (send to chat), new_chat, set_map_mode, show_on_map |
| `audit.tsx` | search (fill filter box), filter_action |

### 21.5 Security

- `_sanitize_actions()` — only allow-listed `(screen, action, param_key)` triples reach the frontend. The LLM cannot inject arbitrary screen interactions.
- The frontend never executes raw command text — only structured typed actions.
- All requests to `/voice/agent` require `Permission.CHAT` (clearance ≥ 1).

### 21.7 Value validation and the action-result feedback loop

Two gaps made a failed action indistinguishable from a successful one.

**1. `_sanitize_actions()` validated param KEYS, never VALUES.** Every domain was
already declared in `SCREEN_CAPABILITIES` (`"3|7|14|30"`, `"boolean"`,
`"people|financial|rings"`) and fed to the LLM as a contract, but nothing enforced
it, so `set_horizon days=9` reached a control offering only 3/7/14/30 and blanked
it, and `toggle_layer on="no"` reached a `Boolean(...)` cast — which reads `"no"` as
`true` — and switched the layer ON.

`_coerce_param(value, domain)` now enforces the declared domain and returns the
**canonical** form, so `"3D"` becomes `"3d"` and `"14"` becomes `14`:

| Domain | Behaviour |
|---|---|
| `"boolean"` | Word-aware: `yes/on/1/show` → true, `no/off/0/hide` → false, anything else rejected rather than guessed. |
| `"number"` | Numeric coercion; `bool` rejected (it is an `int` subclass). |
| `"a\|b\|c"` | Case-insensitive enum membership, returns the canonical option; numeric enums return an `int`. |
| `"a b\|c d"` | An enum whose options contain spaces is a human-readable **name list**, treated as prompt documentation and validated as free text — `/news set_channel` is resolved fuzzily by the screen, which owns the verified slug table. |
| `"string"` | Non-empty after trimming. |

An action whose parameter fails validation is dropped **whole**, not passed on with
the bad key removed: `set_horizon` with no `days` is a different request, not a
weaker one, and the screen would report it as applied. Rejections log
`screen_agent.param_rejected`.

Three declared domains were wrong and are now fixed, because an unenforced domain
that disagrees with its screen becomes a bug the moment it is enforced:
`set_grid` `fine|med|coarse` → `fine|medium|coarse` (the screen only understood
"medium"); `set_hex_radius` `50|100|500|1000` → `auto|100|500|1000` (50 is not one
of the BIN control's choices, `auto` is); `set_view` `2d|3d|earth` → adds `street3d`
(a mode the screen always supported but the manifest hid from the planner).

`_rule_plan()` now passes through `_sanitize_actions()` too. It only ever emitted
canonical values, but that was unenforced and left the manifest with two places to
keep in sync — which is how the hex-radius domain drifted.

**2. The copilot spoke the plan, not the result.** `runScreenAgent` said
`planRes.speak` the moment it dispatched `satyam:run-task` — whether or not a screen
was listening, the action name existed, or the parameter survived. Since every
screen handler is an if/else chain that falls off the end on an unknown action, the
failure was invisible.

`frontend/src/lib/taskBus.ts` adds two events on the existing window bus:

| Event | Direction | Purpose |
|---|---|---|
| `satyam:screen-ready` | screen → Shell | The screen's `satyam:run-task` listener is attached. The Shell dispatches on this ack instead of a blind 550 ms post-navigation timer (the timer is kept as a ceiling, so a screen that never announces behaves exactly as before). |
| `satyam:task-result` | screen → Shell | `{ route, applied[], skipped[] }` — what actually ran. |

`runActions(route, detail, handle)` wraps each screen's existing if/else chain: the
handler returns `false` to mark a skip, a throwing handler is a skip that does not
abandon the rest of the plan, and the result fires even for an empty action list
(otherwise "nothing to do" is indistinguishable from "the event was never
received"). `asBool()` is the frontend twin of the backend boolean coercion, for the
same `Boolean("no") === true` reason.

The Shell then speaks the truth: all applied → `planRes.speak`; some skipped →
`planRes.speak` + "Some steps didn't apply."; none applied (or no result within 3 s)
→ "I couldn't do that on this screen." Results are route-matched so a
gesture-driven `run-task` in the same window is not mistaken for this plan's result.

Mic re-arm moved with it. The old blind `setTimeout(resumeListening, 1200)` at the
call site could open the mic mid-synthesis and feed the assistant's own voice back
into recognition; the confirmation's `onEnd` now owns the re-arm, and the 3 s ack
timeout guarantees the confirmation fires so the mic is never left closed.

Screen-side bounds were added where the control defines them and the backend cannot:
Forecast rejects a horizon outside its `HORIZONS` list (now a single shared const
instead of an inline `[3, 7, 14, 30]`), Network rejects a depth outside 1–3, Vision
rejects a hex radius that is not one of `HEX_RADIUS_CHOICES`. Reports no longer
calls `handlePrint()` on an **empty** action list — merely saying "open reports"
opened the browser print dialog on an empty report.

Runnable check: `cd frontend && node --experimental-strip-types src/lib/taskBus.check.ts`
(assert-based, no test runner). Backend: `backend/tests/test_screen_agent.py` (55).

### 21.8 Detected language reaches the turn

`lib/voice/recorder.ts` has always passed Sarvam's `detected_lang` to
`onResult(transcript, detectedLang)`, but `Shell.tsx` typed its handler
`(transcript: string)` and dropped the second argument. With `voiceLang: "auto"` the
literal string `"auto"` then reached the command handler, matched no language check,
and fell through to the UI language — so a Kannada question with the UI in English
was answered *and spoken* in English. Script detection does not cover it either,
because Saaras can return Kannada transliterated into Latin script. `dispatchTurn`
now takes the detected language and prefers it whenever the picker is on `auto`.

### 21.6 Example Voice Commands

| Command | What happens |
|---------|-------------|
| "Open forecast and filter to theft in Mysuru for 30 days" | Navigates to /forecast, sets crime_type=Theft, district=Mysuru, horizon=30 |
| "Show the network for Ravi Kumar at depth 3" | Navigates to /network, searches seed Ravi Kumar, sets depth=3 |
| "Generate a report PDF" | On /reports, calls handleGenerate() |
| "Draw a crime scene with two suspects and a vehicle" | On /board, fills AI prompt + triggers generate_scene |
| "Filter to critical alerts" (while on forecast) | Stays on /forecast, calls setSeverityFilter("Critical") |
| "How many thefts last month" | Agent returns answer:true → copilot answers the question out loud |

### 21.7 New API Endpoint

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/voice/agent` | AgentRequest → AgentPlan · Requires CHAT permission · resolves sample sentinels via the RLS-scoped session |

### 21.8 Sample-Value Resolution (real data, never placeholders)

A real copilot must turn "seed **any** person", "filter to **some** district", "pull **a random** FIR" into *actual* database values — not drop the literal instruction words into the field. The agent does this on every screen via typed **sentinels**:

| Sentinel | Resolved from (RLS-scoped) | Selection |
|----------|----------------------------|-----------|
| `__SAMPLE_PERSON__` | `persons ⋈ case_persons ⋈ cases` | most-connected person (richest graph) |
| `__SAMPLE_DISTRICT__` | `cases.district` | most frequent in scope |
| `__SAMPLE_CRIME__` | `cases.crime_type` | most frequent in scope |
| `__SAMPLE_FIR__` | `cases.fir_number` | random in scope |
| `__SAMPLE_STATION__` | `stations.station_name` | random |

Flow:
1. **Detection** — both the LLM prompt (rule 8) and the deterministic planner's `_normalize_samples()` convert vague/placeholder param values into the sentinel that fits the `(screen, action, param)` slot (`_sentinel_for()`). `_is_vague()` is high-precision: it fires on any **strong placeholder keyword** (any/random/sample/some/example…) anywhere in the value, strips possessives (so "any person**'s** name" is caught), and also treats values made entirely of filler words as vague — while real names ("Indrvati Satya", "Bengaluru City") pass through untouched.
2. **Resolution** — the `/voice/agent` route calls `resolve_samples(actions, session)` with the caller's **RLS-scoped** session, replacing each sentinel with a real value (`_SAMPLE_SQL`). Values are cached per request; unresolved sentinels are *dropped* so the frontend never receives a placeholder as data.
3. **Result** — "take me to network and seed any person" now seeds an actual hub offender from the officer's jurisdiction, producing a populated link graph. This works uniformly across all 14 screens because it keys off param type, not screen.

---

## 22. Board Brain — Smart Layout Engine

### 22.1 Backend Board Brain (`app/services/board_brain.py`)

Replaced the original `board_service.py` scene generator with a 400-line intelligent brain:

| Component | What it does |
|-----------|-------------|
| `detect_intent()` | Classifies prompt into 8 diagram types: evidence_board, crime_network, timeline, mind_map, flowchart, org_chart, money_trail, location_map |
| `_build_system()` | Generates an intent-specific system prompt with layout guidance |
| `_llm_extract()` | Calls Gemini/Groq with richer schema |
| `_style_node()` | Maps `entity_kind` → tldraw shape + color + size |
| `_style_edge()` | Maps relationship `kind` → dash style + color |
| `apply_layout()` | 6 layout engines: ring, timeline, tree, radial, grid, hierarchical |
| `_no_overlap()` | 80-iteration iterative push — guarantees no two nodes collide |
| `detect_conflicts()` | Regex scan for contradictions → adds ⚠ warning nodes |
| `merge_into_snapshot()` | Reads existing tldraw store, deduplicates, merges incrementally |
| `keyword_fallback()` | Zero-LLM deterministic scene from keywords |
| `generate_scene()` | Orchestrates all above with Gemini→Groq→keyword cascade |

**Entity kinds and shapes:**

| kind | shape | color |
|------|-------|-------|
| suspect | ellipse | red |
| victim | ellipse | green |
| location | hexagon | amber |
| vehicle | rectangle | blue |
| evidence | diamond | yellow |
| weapon | diamond | dark-red |
| account | rectangle | teal |
| event | rectangle | violet |
| warning | triangle | red |

**Multi-LLM fallback cascade:** Gemini → Groq → `keyword_fallback()`. Partial enrichment on batch failure — still useful.

**Incremental merge:** `BoardGenerateRequest` accepts `existing_snapshot` (the current tldraw store). New nodes are deduplicated by id/label and offset so they don't land on top of existing shapes.

### 22.2 Frontend Layout Engine (`src/lib/boardLayout.ts`)

Two production-grade npm layout engines added:
- **`@dagrejs/dagre@1.0.4`** — Sugiyama hierarchical layout (org chart, flowchart, timeline)
- **`elkjs@0.9.3`** — Eclipse Layout Kernel (force-directed, radial, layered, box-packing)

**`detectStrategy(nodes, edges)`** — auto-selects the best algorithm:

| Scene contains | Algorithm |
|---|---|
| Events with dates | dagre left→right (timeline) |
| Decision / start / end nodes | ELK layered (flowchart) |
| Officers / organizations | dagre top→bottom (org chart) |
| Accounts + transactions | ELK layered (money trail) |
| Dense person graph | ELK force-directed |
| People + locations | ELK radial |
| Locations only | ELK box-packing |
| Small graph (≤8 nodes) | simple ring |

**`applyColorHarmony(nodes)`** — role-aware hex palette applied to every node (suspects=red, victims=green, locations=amber, etc.). LLM color wins if explicitly set.

**Pipeline:** `layoutScene(rawNodes, rawEdges)` → colour harmony → strategy detection → dagre/elk → centred on 1600×900 canvas → returned to `applySceneToEditor`.

---

## 23. Kannada Translation System

### 23.1 Static DICT (`src/lib/i18n.tsx`)

The DICT has grown to **500+ EN→KN entries** covering every screen:
- All navigation labels, page titles, filter labels, error messages, form fields
- Timeline event titles (Incident occurred, FIR registered, IO assigned, etc.)
- Case drawer tabs, dossier field labels, profile risk factors
- Ops/board/forecast/admin/reports/settings panels
- ProfileMenu account switcher strings
- **Forecast Page Rolling Window static labels** — static overrides for `"Historical validation period"`, `"Data Rolling 30d"`, etc., mapping to `"30 ದಿನಗಳ ರೋಲಿಂಗ್ ಡೇಟಾ"`

### 23.2 Runtime LLM Enrichment (Settings → Translation)

**`enrichDictWithLLM(onProgress)`** — Phase 1:
- Static manifest of 271 strings from all `t("...")` calls in source
- Sends to `POST /settings/db-source/translate` (Groq Llama-3.3-70B / configured engine) in batches of 20
- Filters: no Kannada script input, no pure numbers/symbols
- Merges into live DICT immediately; cached in `localStorage["satyam.translation.llm-cache"]`

**`enrichDataWithLLM(onProgress)`** — Phase 2:
- `GET /settings/db-source/data-values` → fetches unique station names (200), districts (60), crime types (100), statuses (30) from DB
- Translates with context hints ("Translate these Karnataka police station names…")
- Cached in `localStorage["satyam.data-translations"]`
- `tData()` reads this cache so station names display in Kannada on all screens

**`POST /settings/db-source/translate`** — backend endpoint (Groq Llama-3.3-70B / configured model):
- **Model Resolution**: Uses `s.groq_model` (falls back to `"llama-3.3-70b-versatile"`) to avoid decommissioned `llama-3.1-70b-versatile`.
- **JSON Compatibility**: Disabled `"response_format": {"type": "json_object"}` to resolve 400 Bad Request errors on Groq endpoints.
- **Robust JSON Parsing**: Uses a pre-parsing cleaning step to strip Markdown code blocks/fences (e.g. ` ```json ` ... ` ``` `) from LLM responses before calling Python's `json.loads()`.
- System prompt keeps acronyms (FIR, IPC, GPS, KSP) in English
- Keeps proper nouns (Bengaluru, Karnataka) in Kannada script
- Returns only Kannada responses (validated by Unicode check `[\u0C80-\u0CFF]`)

**Progress UI (Settings → Translation tab):**
- Two-phase progress bar with `done/total · pct%`
- Phase labels ("Phase 1/2 — UI labels", "Phase 2/2 — Data values")
- Grand total counter across phases
- Error detail with GROQ_API_KEY hint
- "Re-run enrichment" always visible; "Reset all cached translations" clears all 3 localStorage keys

### 23.3 Screen-Level Translation Coverage

All screens now have complete Kannada translations:
- `CaseDrawer.tsx` — tabs (Similar Cases, Timeline), "Profile" link, all event types via `t(e.type)`
- `dossier.tsx` — all field labels, section titles, photo labels (Front/Left/Right), bank table headers
- `socio.tsx` — page title, chart card titles, correlation table headers, risk driver tags
- `reports.tsx` — all cart/template/builder labels, executive summary text
- `ProfileMenu.tsx` — account switcher, progress steps, sign out, photo actions
- `network.tsx` / `audit.tsx` — all filter dropdowns data-driven from live data (no hardcoded options)

### 23.4 Runtime Dynamic Translation (On-The-Fly)

To translate dynamic backend outputs and rule-based ML models without resorting to pre-configured static dictionary files, the system employs **On-The-Fly (OTF) Translation**:

- **Forecast / Early Warning Page (`/forecast`)**: When the user switches to Kannada, all dynamic rule-based ML strings are translated at runtime:
  - Alert descriptions (`alert.why` e.g., *"Activity up 400% vs prior 30-day period..."*)
  - Recommended patrol operations (`alert.recommended_action`)
  - Decision-support/fairness sub-notes (`alert.fairness_note`)
  - Grid cell risk explanation arrays (`cell.why`)
  - Backtest model validation explanations (`backtest.explanation`)
- **API Helper (`translateOnTheFly`)**: Batches English strings from the frontend and sends them as a `POST` request to `/settings/db-source/translate`.
  - Dedupes the batch list.
  - Filters out strings that contain only numbers, percentages, or symbols, ensuring numeric metrics (e.g. `400%`, `41%`) remain dynamic and computed by the database.
  - Skips strings that are already written in Kannada script to save token bandwidth.
- **Reactivity**: The `load()` function inside the forecast route dependencies includes the `lang` state. Switching language instantly triggers dynamic translation, updating the local UI state reactively.
- **Interactive Tooltips**: Tooltips on the Forecast threat map use `tData("crime_type", ...)` and `tData("risk_label", ...)` to ensure interactive elements follow the language toggle without latency.

---

## 24. Hands-free Multimodal Layer

### 24.1 Overview

The hands-free layer adds **camera-based gesture control**, an **always-on wake word**, and a **face-presence security auto-lock** as a second input modality that runs entirely in the browser alongside the existing voice copilot. It is:

- **Frontend-only and event-driven** — it dispatches to the same `satyam:open-voice` / `satyam:run-task` / navigation event bus the voice agent already uses. Zero new backend ML models, zero changes to the SQL guard, RLS, or audit hash-chain.
- **Opt-in and off by default** — a master switch in Settings → Hands-free controls everything. The camera is never acquired unless the officer enables it.
- **Privacy-safe** — all vision processing runs in WASM inside the browser tab. No image or video data leaves the device. The only backend call is a `POST /security/event` that appends a single audit entry to the tamper-evident log.
- **Production-quality library** — uses **`@mediapipe/tasks-vision 0.10.18`** (Google's current MediaPipe Tasks API, GPU-accelerated) instead of the legacy `@mediapipe/hands` package.

### 24.2 Architecture

```
Officer's webcam
  → sharedCamera.ts  (single refcounted getUserMedia stream)
  → visionLoader.ts  (singleton HandLandmarker + FaceDetector, WASM/GPU, CDN)
       │
       ├─ GestureController.tsx  (rAF loop ~30fps)
       │     gestureClassifier.ts  ← geometry classifier (stateless, ported from reference)
       │     → majority-vote (5 frames) + hold (400ms) + swipe (motion samples)
       │     → cursor dot (index-tip → viewport, mirrored X, lerp smoothing)
       │     → pinch → real DOM click/dblclick at elementFromPoint()
       │     → all other gestures → computeGestureIntent(gesture, {route, lang, presentation})
       │         → window.dispatchEvent("satyam:gesture", { intent, gesture })
       │
       └─ FacePresenceController.tsx  (setInterval 400ms)
             → detectForVideo → face present? update lastSeenAt
             → absent > absenceSeconds → "satyam:session-lock"
                                       → POST /security/event → write_audit()
             → face reappears while locked → "satyam:session-present" (hint only, no auto-unlock)
             → "satyam:session-unlock" from LockOverlay Resume → re-arm

HandsFreeLayer.tsx  (mounted once in Shell, under Router + I18n)
  → listens "satyam:gesture" → runIntent(intent)
  → listens "satyam:handsfree-settings" → re-reads settings live
  → manages War-room mode boolean
  → manages wake-word lifecycle (pause while copilot mic open, resume after)
  → bilingual toast + optional TTS confirmation on every fired gesture

wakeWord.ts  (pure module, no React)
  → SpeechRecognition continuous, interimResults=true
  → fires onWake() ≤ once/2.5s on "satyam" / "hey satyam" / "ಸತ್ಯಂ"
  → auto-restarts on onend (Chrome kills continuous recognition after ~30-60s of silence)
  → permanently stops on not-allowed/service-not-allowed
  → pauseWakeWord() / resumeWakeWord() for copilot mic contention avoidance

LockOverlay.tsx  →  full-screen backdrop-blur; blocks all UI; bilingual; Resume dispatches "satyam:session-unlock"
WarRoomBanner.tsx  →  fixed top-center pill + vignette ring when presentation mode is on
```

### 24.3 Gesture Classifier (`input/gestureClassifier.ts`)

Stateless pure function `classifyGesture(landmarks: Landmark[]): GestureName`. All geometry is **normalized** (scaled by palm width = `dist(indexMcp, pinkyMcp)`) so thresholds are camera-distance-invariant.

| Priority | Gesture | Rule |
|----------|---------|------|
| 1 | `pinch` | `dist(thumbTip, indexTip) / palm < 0.38` |
| 2 | `thumb_up` | fingers curled (≤1 extended), thumbDeltaY < -palm×0.45, tip above indexMcp |
| 3 | `thumb_down` | fingers curled, thumbDeltaY > palm×0.45, tip below indexMcp |
| 4 | `open_palm` | all 5 digits extended |
| 5 | `three` | 3 extended fingers (any variant, incl. "love you" sign) |
| 5.5 | `two_finger` | index + middle extended **and joined** (`dist(indexTip, middleTip)/palm < 0.5`) — air-mouse cursor pose |
| 6 | `peace` | index + middle only, **spread apart** |
| 7 | `point` | index only (cursor mode, no action fired) |
| 8 | `fist` | nothing extended |
| — | `swipe_left/right` | motion-based: palm-center samples over 700ms window, speed > 0.35, |dy| < 0.18 |
| — | `null` | ambiguous pose |

**Cursor anchor:** when the classified pose is `point`, the cursor follows the **index tip** (landmark 8); when it is `two_finger` (index + middle **joined**), the cursor follows the **midpoint of tips 8 & 12** — a steadier "air-mouse" anchor. Both poses are cursor-only and fire no action. Camera preview is mirrored → X is flipped: `viewportX = (1 - fx) * innerWidth`. Dead-band padding `PAD=0.18` ensures the full screen is reachable.

**Dwell click (two-finger air-mouse):** while holding the joined two-finger pose, if the cursor stays within `DWELL_MOVE_TOL` (45px) of its anchor for `DWELL_MS` (1.5s), a real left click fires at the cursor target. A conic-gradient **progress ring** around the cursor fills to show the countdown. It fires once per dwell and re-arms only after the cursor moves away — so it never needs the spread/peace sign and never conflicts with the navigate-to-Console gesture. Disabled in War-room/presentation mode (like pinch-click).

**Swipe** is detected by the controller from `palmCenter()` motion samples, not the classifier. Rejected if a thumb_up/down pose appears in the sample window (avoids scroll/swipe confusion).

### 24.4 Gesture → Intent Mapping (GestureActions)

`computeGestureIntent(gesture, ctx)` is **context-aware**: the same gesture can mean different things depending on the current screen and mode.

#### Normal mode

| Gesture | On map screens (`/console`, `/vision`, `/ops-*`) | On `/board` | Everywhere else |
|---------|------------------------------------------------------|-------------|-----------------|
| `swipe_right` | `map_pan dir:right` | `board_pan dir:right` | `nav_cycle dir:+1` (next screen) |
| `swipe_left` | `map_pan dir:left` | `board_pan dir:left` | `nav_cycle dir:-1` (prev screen) |
| `thumb_up` | `map_zoom delta:+1` | `board_zoom delta:+1` | `scroll dy:-0.85` |
| `thumb_down` | `map_zoom delta:-1` | `board_zoom delta:-1` | `scroll dy:+0.85` |
| `open_palm` | `arm_voice` (open copilot mic) | ← same | ← same |
| `fist` | `history_back` | ← same | ← same |
| `peace` ✌ | `navigate /console` | ← same | ← same |
| `three` 🤟 | `toggle_warroom` | ← same | ← same |
| `point` | cursor only (no intent) | ← same | ← same |
| `pinch` | DOM click at cursor target | ← same | ← same |

#### War-room / Presentation mode

| Gesture | Action |
|---------|--------|
| `swipe_right`, `open_palm`, `thumb_up` | `nav_cycle dir:+1` (next slide/screen) |
| `swipe_left` | `nav_cycle dir:-1` (previous) |
| `three` | `read_screen` (speaks the h1/h2/h3 headings aloud) |
| `thumb_down`, `fist` | `toggle_warroom` (exit presentation) |

### 24.5 In-screen Gesture Targets

| Screen | Event listened | Effect |
|--------|---------------|--------|
| `console.tsx` (Leaflet map) | `satyam:hands-map` | `map.panBy` 25% viewport / `map.setZoom +1/-1` |
| `board.tsx` (tldraw) | `satyam:hands-board` | `editor.setCamera` pan step / `editor.zoomIn/zoomOut` |

The Leaflet instance is captured via `L.Map.addInitHook` (installed once with a `window.__satyamMapInitHook` guard) since `CrimeMap` is an internal component that doesn't expose its map ref.

### 24.6 Wake Word (`lib/voice/wakeWord.ts`)

```
startWakeWord({ lang, onWake }) → stop()
  → SpeechRecognition continuous + interimResults
  → onresult: scan every transcript for /(\bsatyam\b|\bhey satyam\b)/i or "ಸತ್ಯಂ"
  → debounce 2.5s → call onWake() → window.dispatchEvent("satyam:open-voice")
  → onend: auto-restart after 300ms (resilience against Chrome's ~30-60s timeout)
  → onerror not-allowed → permanently stop (no retry)
  → onerror no-speech/network/aborted → recover via next onend restart

pauseWakeWord()   — tears down the recognizer (called when copilot mic opens)
resumeWakeWord()  — rebuilds the recognizer (called on satyam:ai-state "done")
```

Chrome only allows **one** `SpeechRecognition` at a time. The pause/resume cycle prevents the wake-word listener and the copilot mic from fighting over the audio device. The wake word is enabled together with gestures by the header **Hands-free** toggle (and individually in Settings). It pauses on `satyam:open-voice` and resumes on **either** `satyam:voice-closed` (panel closed) **or** `satyam:ai-state "done"` — so a navigation-only command can never leave it stuck paused.

**Single-voice guarantee:** `tts.ts` uses a monotonic `speechSession` token plus a per-clip `started` flag. A Sarvam/Google clip that has begun playing will **never** trigger the browser-speech fallback, and any superseded in-flight `speak()` aborts silently — so the user hears exactly one voice (the chosen provider), never Sarvam plus a browser/Google voice on top.

### 24.7 Face-presence Auto-lock

The auto-lock is the only feature with a backend write. When the FacePresenceController detects the officer has been absent for ≥ `absenceSeconds` (configurable 5–120s, default 20s):

1. `"satyam:session-lock"` event → `LockOverlay` covers the app with `backdrop-blur-xl`
2. `logSecurityEvent("auto_lock", "No officer detected for Ns")` → `POST /security/event`
3. Backend allow-lists 5 event types: `auto_lock`, `auto_unlock`, `presence_lost`, `presence_restored`, `manual_lock`
4. `write_audit(session, action="security.auto_lock", user_id=..., reason=...)` appends to the hash chain
5. Officer returns → face detected → `"satyam:session-present"` (hint only — no auto-resume)
6. Officer clicks **Resume session** → `"satyam:session-unlock"` → overlay dismissed, controller re-armed

This makes face-presence events **part of the tamper-evident audit trail**, giving the session-lock a documented, verifiable security record.

### 24.8 New Backend Endpoint

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/security/event` | Any authenticated user | Body: `{ event_type, detail }`. Allow-list: `auto_lock`, `auto_unlock`, `presence_lost`, `presence_restored`, `manual_lock`. Writes to hash-chained audit log. |

### 24.9 New Frontend Files

| File | Purpose |
|------|---------|
| `src/input/types.ts` | Shared types: `Landmark`, `GestureName`, `GestureContext`, `HandsFreeSettings` |
| `src/config/handsFreeConfig.ts` | All thresholds, CDN URLs, settings load/save, `saveHandsFree()` dispatches `satyam:handsfree-settings` |
| `src/input/sharedCamera.ts` | Single refcounted `getUserMedia` stream + `attachVideo()` helper |
| `src/input/visionLoader.ts` | Singleton `HandLandmarker` + `FaceDetector` loaders; `closeVision()` cleanup |
| `src/input/gestureClassifier.ts` | Stateless geometry classifier + `palmCenter()` helper |
| `src/input/gestureActions.ts` | Route-aware intent mapper; `SCREEN_CYCLE`, `cycleIndex()` |
| `src/input/GestureController.tsx` | rAF detection loop, cursor, swipe, hold+latch, DOM click |
| `src/input/FacePresenceController.tsx` | Interval-based presence poll, auto-lock, event dispatch |
| `src/lib/voice/wakeWord.ts` | Always-on resilient wake-word listener; pause/resume API |
| `src/lib/api/security.ts` | Fire-and-forget `logSecurityEvent()` client |
| `src/components/LockOverlay.tsx` | Full-screen lock gate, bilingual, Resume button |
| `src/components/WarRoomMode.tsx` | Presentation banner + vignette; `WAR_ROOM_EVENT` constant |
| `src/components/HandsFreeLayer.tsx` | Single Shell-mounted integration component |

### 24.10 Settings — Hands-free Tab

Added to `SettingsDialog.tsx` as a new **"Hands-free"** tab (icon: `Hand`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Enable hands-free | toggle | off | Master switch |
| Hand-gesture control | toggle | on | Point/pinch cursor, swipe navigate |
| Show gesture cursor | toggle | on | Glowing dot at index finger tip |
| Wake word ("Satyam") | toggle | off | Say "Satyam" → arm copilot mic |
| Presence auto-lock | toggle | off | Auto-lock on officer absence |
| Speak gesture confirmations | toggle | off | Read action aloud via Sarvam TTS |
| Auto-lock after | slider 5–120s | 20s | Absence threshold for lock |

Settings are persisted in `localStorage["satyam.handsfree"]` and broadcast via `"satyam:handsfree-settings"` event so all live controllers update without a page reload.

**Header quick toggle:** the top bar also has a **Hands-free camera button** (`Camera`/`CameraOff` icon, next to the Theme picker) wired to `toggleHandsFree()` in `Shell.tsx`. Clicking it flips the master switch and — when turning **on** — also enables `gestures` and `wakeWord` so the full experience (cursor + "Satyam" wake word) works immediately without opening Settings. It stays in two-way sync with the Settings tab via the `satyam:handsfree-settings` broadcast.

### 24.11 Model / Asset Configuration

By default MediaPipe models load from Google CDN. Override via env vars for offline / air-gapped deployment:

| Env var | Default |
|---------|---------|
| `VITE_MP_WASM_BASE` | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm` |
| `VITE_MP_HAND_MODEL` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/…` |
| `VITE_MP_FACE_MODEL` | `https://storage.googleapis.com/mediapipe-models/face_detector/…` |

### 24.12 Hard Constraints Preserved

- SQL guard, RLS, and audit hash-chain logic are **untouched**.
- No new hosted embedding models — BGE-M3 remains the sole embedder.
- No video/image data leaves the device — all WASM runs in-browser.
- No individual prediction or profiling from face data — only binary presence/absence.
- All synthetic data rules from `AGENTS.md` remain in force.

---

## 25. Client-Side Read Cache

`frontend/src/lib/api/readCache.ts` — a short-lived cache for GET responses, so
returning to a screen shows the data it already had instead of blanking to a
spinner and hitting the cloud database again.

### 25.1 Why not react-query, which is already installed

`@tanstack/react-query` **is** a dependency and `QueryClientProvider` **is**
mounted in `__root.tsx` — but nothing uses it. All nine data screens hand-roll
`useEffect` + `useState` with their own loading, error and abort handling.
Adopting react-query's cache means consuming data through `useQuery`, which is a
rewrite of nine screens' bespoke logic and a chance to regress each one's error
path.

Caching at the **transport seam** instead fixes every screen at once, changes no
screen logic, and cannot touch those error paths. The tradeoff is explicit and
recorded in the module header: **if those screens are ever converted to `useQuery`,
this layer becomes redundant and should be deleted, not kept alongside it.**

### 25.2 Wiring

`cachedFetch()` replaces `fetch()` in all five transports:

| File | Function |
|------|----------|
| `lib/api/client.ts` | `request()` |
| `lib/api/intelligence.ts` | `apiFetch` |
| `lib/api/financial.ts` | `apiFetch` |
| `lib/api/dossier.ts` | `apiFetch` |
| `lib/api/board.ts` | `apiFetch` |

Exports: `cachedFetch`, `peekCached`, `invalidateReadCache`. `intelligence.ts`
additionally exposes `dashboard.peek()`, which `console.tsx` uses to seed state
synchronously on mount so the dashboard paints from cache with no loading frame.

### 25.3 Rules, and the reasoning behind each

| Rule | Why |
|------|-----|
| **Browser-only.** Inert unless `window` exists. | On the server `getRouter()` runs per request, so a module-level cache would be shared across concurrent officers and could hand one officer's RLS-scoped rows to another. This is a security property, not an optimisation. |
| **Keyed to the auth token**, cleared on logout. | Switching accounts in one tab must not show the previous officer's rows. |
| **GET only.** Any non-GET invalidates the *whole* cache. | Otherwise an admin saves a change, reads a 5-minute-old list that lacks it, and concludes the save failed. Coarse invalidation is correct here; a targeted one would need per-endpoint dependency knowledge the transport does not have. |
| **Only `res.ok` is cached.** | A cached 403 would pin an authorisation failure in place for the full TTL after the permission was fixed. |
| **TTL 5 minutes.** | Long enough to make navigation feel instant, short enough that stale analytics self-correct. |

### 25.4 `NEVER_CACHE`

Prefixes `/auth/`, `/settings/db-source`, `/chat/`, `/voice/`.

`/auth/me` is excluded **on purpose**: it is how a revoked session gets kicked
out, and caching it would keep a disabled account looking valid for up to five
minutes. That is why 6 `/auth/me` calls remain on a second pass through the app —
removing them would trade a real security property for 6 requests.
`/settings/db-source` reports which database the *server* is using; `client.ts`
already warns that a stale browser value can disagree.

---

## 26. Theming & Motion System

### 26.1 `lib/theme.ts` — one source of truth

The theme catalogue, `applyTheme()` and `applyStoredTheme()` were extracted from
`components/ThemePicker.tsx` into `frontend/src/lib/theme.ts`.

Two reasons, both load-bearing:

1. **Two components need the logic.** `ThemePicker` and the header's
   `DarkModeToggle` both change the mode. Toggling the `dark` class alone is not
   sufficient (see F8/F9), so both must go through the same function rather than
   keep separate copies of the rule.
2. **Fast refresh.** A module exporting both a component and plain functions
   loses HMR for the whole file — eslint's `react-refresh/only-export-components`
   flags it. `lib/` is the correct home.

`ThemePicker.tsx` dropped from 337 to 158 lines, and one piece of dead code
(`DATA_THEME_IDS`, unused since `applyTheme` began clearing `data-theme`
unconditionally) went with it.

**Two theme families**, 13 total:

| Family | Count | Mechanism |
|--------|-------|-----------|
| Legacy | 7 — default, coral, rose, purple, ocean, emerald, sunshine | Inline `--main` / `--background` on `<html>` |
| `data-theme` | 6 — slate, indigo, forest, graphite, midnight, pine | `data-theme` attribute, resolved by CSS blocks in `styles.css` |

The legacy family only ever defined light-mode values, which is the root of F8.

### 26.2 `lib/viewTransition.ts` — circular-reveal theme switch

`revealThemeChange(origin, apply)` wraps a theme change in the native **View
Transitions API** and animates `clip-path` on `::view-transition-new(root)` from a
zero-radius circle at the pressed control to a radius covering the furthest
viewport corner.

- `styles.css` switches off the browser's default cross-fade on
  `::view-transition-*(root)`, or the two animations run together and wash each
  other out, and stacks the new snapshot above the old one.
- Callers wrap their `setState` in `flushSync` so React-driven bits (the sun/moon
  icon, the active swatch, the tick) are inside the snapshot the transition
  captures. Without it they repaint a frame after the wipe has already passed.
- Falls back to an instant switch where the API is missing (Firefox, Safari < 18).
  A skipped transition rejects `ready`; that is caught and ignored, because the
  DOM change already happened and only the animation was lost.

### 26.3 Reduced-motion policy — soften, do not freeze

A project-wide convention, adopted after a concrete failure: the login trust
badges originally used `@media (prefers-reduced-motion: reduce) { animation: none }`.
The development machine has OS animations disabled and therefore reports `reduce`,
so the feature looked completely broken — a static row — and was reported as "nothing
changed". Judges or officers with the same OS setting would have seen the same.

The rule now is that reduced motion **removes the vestibular component and keeps a
reduced version**, rather than removing the effect:

| Effect | Full motion | Reduced motion |
|--------|-------------|----------------|
| Login trust badges | 3D depth travel, per-badge phase offsets (3.1s / 4.3s / 3.7s with negative delays) | translateZ, rotation and perspective dropped; a 6s scale-and-shadow breathe, all badges in unison |
| `/ask` globe | ~35s rotation | Slowed to 1/6 speed |
| `BorderGlow` beam | 6s sweep | 24s sweep, lower opacity |
| Theme reveal | 520ms wipe | 180ms wipe |
| `BorderGlow` pointer pool | Tracks pointer | **Unchanged** — it only moves in direct response to the user's own pointer, which is not the unprompted motion the media query is about |

### 26.4 Decorative components

All four are written in-repo rather than installed, all read their colours from
the live theme tokens by default, and all are SSR-safe.

| Component | Used on | Notes |
|-----------|---------|-------|
| `Globe.tsx` | `/ask` | `cobe` 2.0.1. Sized off the pane height at 130% with a radial mask that softens the rim. See §26.6 for the tuned visibility values and how they were arrived at. |
| `BorderGlow.tsx` | `/ask` composer | Two ring layers masked with `mask-composite: exclude`: a conic beam sweeping the edge, plus a pointer-tracked pool with linear falloff over 120px. Sits *outside* the existing hard 2px border rather than replacing it. |
| `GridScan.tsx` | `/login` | WebGL scanning grid. Reuses the existing `three` dependency instead of the four-package React Three Fiber + postprocessing graph the original needed. |
| `LineSidebar.tsx` | `/about` | Proximity-reactive chapter rail — see §27.2. |

**Two `cobe` v2 facts that contradict its own README** (verified against
`node_modules/cobe/dist/index.esm.js`):

1. **There is no `onRender` callback and no internal animation loop.** The option
   is still documented but the v2 bundle contains no reference to it. A globe
   built the README's way renders exactly one frame. Rotation must be driven from
   an explicit `requestAnimationFrame` loop calling `globe.update({ phi })`. This
   is also why no spring/animation library is needed for inertia — the frame loop
   is already owned.
2. **`createGlobe` inserts its own wrapper `<div>` around the canvas** (for CSS
   anchor positioning) and `destroy()` does not remove it. If the canvas were a
   React child, React would later try to remove it from a parent it no longer
   belongs to and throw `NotFoundError` from `removeChild` — reliably, on every
   StrictMode double-mount. So React owns only a host `<div>`; the canvas is
   created imperatively and the host is emptied on cleanup.

### 26.5 Shared colour helpers (`lib/utils.ts`)

`cssColorToRgb(value, fallback)` and `mixRgb(a, b, t)` were extracted from
`Globe.tsx` and are now shared with `GridScan.tsx`.

`cssColorToRgb` resolves **any** CSS colour token to an sRGB triple by pushing it
through canvas 2D `fillStyle` and reading one pixel back, rather than parsing it.
The theme tokens are written in a mix of `#hex`, `hsl()` and `oklch()`, and
`getComputedStyle` returns `oklch()` verbatim for some of them — reading its three
numbers as if they were RGB channels turns `L=0.92` into `R=1/255`. A sentinel
(`#ff00ff`) is set first so an unparseable value is detected rather than silently
becoming black.

### 26.6 Globe visibility — tuned against measured pixels

The globe was initially far too faint in both modes. It was retuned by measuring
composited pixels rather than by eye, because "visible enough" and "still legible"
pull in opposite directions and neither is reliable to judge from a screenshot.

**Method.** A headless screenshot is fed back into the page, drawn to a 2D canvas
and sampled. (A WebGL canvas without `preserveDrawingBuffer` cannot be read
directly, hence the round trip.) Two numbers per mode: the **standard deviation**
of luminance in a text-free band — how much of the area the dots actually cover —
and the **WCAG contrast** of the copy sitting over the globe, which is the
constraint being spent against.

> First attempt used `max - min` luminance as the visibility metric. It saturates
> as soon as the band contains one near-white pixel and one dark dot, and reported
> byte-identical numbers for visibly different renders. Standard deviation is the
> metric that actually moves.

**Three levers, and which direction each goes:**

| Lever | Light | Dark | Note |
|-------|-------|------|------|
| Wrapper opacity (empty / chatting) | 0.78 / 0.22 | 0.46 / 0.14 | Dims once messages exist — a watermark that reads well behind an empty state is noise behind body copy |
| `mapBrightness` | **1.5** | **8.5** | **Moves in opposite directions.** Light mode draws the landmass dots *darker* as this drops; dark mode draws them lighter as it rises. Raising it in light mode washes the globe out, which is the mistake that made it invisible. |
| `diffuse` | **0.08** | 1.35 | Light mode keeps the sphere body flat and near the page colour so only dots read. At 0.3 the limb shading turned the globe into a grey disc with a visible rim. Dark mode needs the shading to separate sphere from background. |

The mask stop is `#000 46%, transparent 74%`. Radial-gradient percentages run
along the gradient ray, and with `farthest-corner` sizing 100% is ≈1.41× the
radius — so 74% lands just outside the silhouette and removes the hard rim without
eating the dots. 82% left the full disc edge showing; 58% faded most of the globe.

**Measured result** (1440×950, `/ask`, both modes):

| Mode | Band σ | Headline | Subtitle | Transcript body | AA |
|------|--------|----------|----------|-----------------|-----|
| Light | 19.9 | 20.62:1 | 11.10:1 | 10.39:1 | pass |
| Dark | 10.7 | 15.30:1 | 7.29:1 | 7.04:1 | pass |

Every text measurement clears the 4.5:1 AA floor with margin, so the visibility
was gained out of headroom rather than out of legibility. **If these values are
changed again, re-measure the text contrast** — the empty state has three short
lines, but a live conversation puts paragraphs over the same backdrop.

### 26.7 Gotcha: `cn()` and Tailwind class names

Any hand-written CSS class composed through `cn()` **must not begin with a Tailwind
utility prefix**. `cn()` runs tailwind-merge, which reads `bg-glow` as a
background-color utility and deletes it as conflicting with the
`bg-secondary-background` beside it. The class silently never reaches the DOM.
This cost a debugging round; the classes are `edge-glow*` for that reason and the
CSS carries a comment saying not to rename them back.

---

## 27. About Handbook & SEO Surface

`/about` was rewritten from a feature-marketing page into a five-chapter technical
handbook — the discoverable, plain-language explanation of how the system works.

### 27.1 Structure

| # | Chapter | Covers |
|---|---------|--------|
| I | Overview | The problem, what "grounded" means, the six lanes, the synthetic dataset |
| II | How a question is answered | Ingest and language detection, routing and its fallbacks, lane execution, composition, the SSE event table |
| III | Authority and evidence integrity | Rank → scope and clearance, RLS, the SQL guard, the audit hash chain |
| IV | Retrieval and language | Hybrid retrieval and RRF, live embedding coverage, the bilingual voice path |
| V | The platform | Screens, the model registry, honest status, stack |

**All five chapters are in the DOM at once** and the rail scrolls to them, rather
than swapping one chapter in at a time as the reference design did. Chapter
swapping would mean a crawler indexes chapter one and nothing else, which defeats
the purpose of the page. The reading experience is produced by scroll position.

Content is defined as typed data (`Block` = `p | note | list | steps | table`)
rendered by one `BlockView`, so a new section is a data entry rather than new JSX.
Every string passes through `t()` for Kannada.

### 27.2 `LineSidebar`

Written in-repo; the component the design referenced does not exist here. The prop
surface is kept compatible — `proximityRadius`, `maxShift`, `falloff`,
`markerLength`, `markerGap`, `tickScale`, `scaleTick`, `itemGap`, `fontSize`,
`smoothing`, `showIndex`, `showMarker`, `defaultActive`, `onItemClick` — with two
deliberate differences:

1. **`accentColor` / `textColor` / `markerColor` are optional** and default to
   `--main` and mixes of `--foreground`. The original call site passes fixed hex
   (`#A855F7`, `#c4c4c4`, `#6c6c6c`), which would make the rail the only element
   on the page ignoring the selected theme. Passing a colour explicitly still wins.
2. **`activeIndex` is accepted as a controlled prop** alongside `defaultActive`,
   because the rail follows scroll position and a self-managing active item cannot
   be told the reader has scrolled.

The proximity effect runs on one `requestAnimationFrame` loop writing
`--ls-shift` and `--ls-tick` as inline styles, not through React state — a state
update per frame would re-render the list and its parent for a purely visual
property. The loop **stops when everything settles and the pointer has left**, so
an idle page is not holding a frame callback.

### 27.3 SEO

| Element | Value |
|---------|-------|
| `<title>` | "How Satyam works — bilingual crime intelligence for Karnataka State Police" |
| `description` | 237 chars |
| `robots` | `index, follow` |
| `og:type` | `article`, with absolute `og:url` |
| `twitter:card` | `summary_large_image` |
| `canonical` | Absolute |
| `hreflang` | `en-IN` + `kn-IN` |
| Structured data | One `@graph` with `TechArticle`, `SoftwareApplication`, `WebSite`, `BreadcrumbList` |
| Heading hierarchy | Exactly one `h1`; chapters are `h2`; sections are `h3` with anchor ids |

`SITE` is a module constant in `about.tsx`. **It is currently
`https://satyam.ksp.local` and must be changed to the real origin before any
public deployment** — absolute canonical and `og:url` values pointing at a
non-resolving host are worse than relative ones.

### 27.4 Claims corrected during the rewrite

The previous page asserted several things the code does not do. Each was verified
against the implementation before being changed:

| Old claim | Reality |
|-----------|---------|
| "Mask PII (L1–L4 clearance)" on the SQL lane | Partial — a fixed 7-column allow-list, only below L3, in Python. See §8.2. |
| "Sarvam Bulbul **v3** (TTS)" | The code calls `bulbul:v2` + `anushka`. |
| Token-by-token streaming | The answer is awaited in full, then split on spaces into `token` frames. Presentational only. |
| Reports generated from chat | The `report` lane returns a pointer to the Reports screen; it generates nothing. |
| Stack chips: "Redis PubSub Locks", "Zoho Catalyst Deploy", "YOLOv8s Weapon Detect" | Unverifiable from code at the time of writing; dropped rather than repeated. |

The handbook also states plainly that the local model backend and the Bhashini
provider are stubs, and that half the narrative corpus is unembedded. Two items
were **deliberately kept off the public page** and documented here instead,
because they are operational security notes rather than product facts: the
`FORCE RLS` gap in §17.1, and the bcrypt-missing fallback in `core/security.py`
that stores a `__plain__` sentinel.

### 27.5 Live retrieval coverage

`rag.py`'s module docstring claims "All 71,986 narratives currently have a NULL
embedding". **That is stale.** `GET /health/data` on 2026-08-24 reports:

```
narratives_embedded:          35,993  of 71,986
embedding_coverage_percent:   50.0
vector_search_available:      true
```

All 35,993 English narratives are embedded; none of the 35,993 Kannada ones are,
bounded by the storage cap in §17.2. The reported retrieval strategy is therefore
`hybrid` for English queries. The `rag.py` docstring should be corrected — it is
the first thing anyone reads in that file.


---

## 28. Document Translation & Sealing (`/documents`)

Screen for taking a police document, rendering it in Kannada, and proving it has not
been altered since. Four backend endpoints, no file storage anywhere.

### 28.1 What it is and is not

Two guarantees get conflated in the field ("encrypt with 256, like blockchain"), and
this module deliberately implements only one of them:

| | Mechanism | What it proves |
|---|---|---|
| **Seal** — shipped | SHA-256 appended to the existing `audit_log` hash chain | INTEGRITY. The file is byte-identical to what was sealed. |
| **Encrypt** — built, then removed | AES-256 PDF open password via `pypdf` | CONFIDENTIALITY. Stops a reader. Proves nothing about tampering. |

Sealing reuses `core/audit.py` rather than adding a second ledger: that chain is
already `row_hash = SHA-256(prev_hash + payload)`, serialised by a Postgres advisory
lock. A document seal is one more row in it.

**The AES-256 path was removed at the user's request** after the browser-side failures
described in §28.5 were misattributed to it. `core/doc_crypto.py` retains only
`sha256_hex`, `short_digest` and `extract_pdf_text`; the `/encrypt` route, the
`EncryptDialog`, and the `cryptography` dependency are gone. `pypdf` stays — text
extraction needs it. `backend/tests/test_documents.py::test_there_is_no_encryption_on_this_path`
asserts the removal is complete rather than half-reverted, and step 6 of
`scratch/verify_documents.py` asserts the live endpoint returns **404**.

### 28.2 Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/documents/translate` | multipart (`file`, `source_lang`, `target_lang`) | source text, translated text, digest, page count, `needs_ocr` |
| POST | `/api/documents/seal` | json (`filename`, `sha256`, `note`) | `audit_id`, `prev_hash`, `row_hash`, short digest |
| POST | `/api/documents/verify` | json (`sha256`) | whether it was sealed, and whether its chain link recomputes |

All three are L2+ (`Permission.BUILD_REPORT`) — uploading files is a heavier
capability than asking a question.

### 28.3 Trust boundary

This is the only place in Satyam that accepts arbitrary binary from a client, so the
guards live here rather than being assumed elsewhere:

- **Magic-byte validation**, not declared MIME. The content type is
  attacker-controlled; `evil.exe` renamed `report.pdf` is rejected before it reaches
  a parser.
- 20 MB cap, enforced server-side as well as in the browser.
- A password-protected upload is refused rather than prompted for — accepting
  passwords for arbitrary uploads would turn this screen into a credential collector.
- **Nothing is stored.** Bytes live in the request; the audit row keeps only the
  digest, filename and note. That keeps real case content out of a synthetic-data
  repository and off the Neon budget (§17.2).
- `pypdf` is imported lazily via `_require_pypdf()`, raising `PdfToolingMissing` so
  the route answers **503 with an install instruction** instead of taking the router —
  and therefore startup — down over an optional capability.

### 28.4 Verification is scoped to the sealed row, not the whole chain

`/verify` recomputes the sealed row's own link and its predecessor, **not** a global
`verify_chain()`. The shared demo database contains five pre-existing forked
`financial.money_trail` rows (earliest `audit_id=90`), so a global check returns
`False` for reasons unrelated to the document and would report a good seal as
tampered.

### 28.5 Three bugs behind one "Failed to fetch"

Worth recording because each produced the *same* browser symptom while the server
logged success, and fixing the first two did not fix the screen.

1. **Duplicated CORS header.** The route set `Access-Control-Expose-Headers` while
   `CORSMiddleware` also emits it. Browsers reject a response with a duplicated CORS
   header outright. Fixed by configuring `expose_headers` on the middleware, never on
   a Response. (Both headers were later removed with the encrypt endpoint.)
2. **Non-latin-1 filename → 500.** HTTP header values must be latin-1 encodable, so a
   Kannada or em-dash filename raised inside the ASGI layer *after* the response had
   started. Measured: `report.pdf` → 1497 bytes; `ದಾಖಲೆ.pdf` and `report—final.pdf` →
   500. Fixed with an RFC 6266 two-parameter `Content-Disposition` (sanitised ASCII
   fallback plus `filename*=UTF-8''`).
3. **The rail that hid both: `localhost` resolves to `::1` first on Windows**, and
   `uvicorn --host 0.0.0.0` binds IPv4 only. Measured on the dev machine:
   `127.0.0.1:8000/health` → 200, `[::1]:8000/health` → refused. Chrome caches which
   address family won per origin and re-races periodically, so requests succeeded for
   a while and then stopped. curl and PowerShell always fell back to IPv4, which is
   why every server-side probe passed while the browser failed.

   Fixed on the client: `VITE_API_BASE_URL` and `self_base_url` now use `127.0.0.1`,
   and `CORS_ORIGINS` lists **both** loopback spellings because a browser treats
   `localhost:3000` and `127.0.0.1:3000` as different origins. It cannot be fixed on
   the server: uvicorn never clears `IPV6_V6ONLY`, which Windows defaults to 1, so
   `--host ::` would bind IPv6 *only*.

**A 500 raised in a route never passes back through `CORSMiddleware`**, so it reaches
the browser with no `Access-Control-Allow-Origin`, the browser refuses to expose the
response, and `fetch()` rejects with a bare "Failed to fetch". That is why a clean
500 in the log looked like a network outage. `main.py` now registers an exception
handler that reattaches the CORS headers — delegating the origin check to Starlette's
own `is_allowed_origin`/`allow_explicit_origin` so it cannot drift from the middleware
config, and keeping the exception detail in the log rather than on the wire. Pinned by
`backend/tests/test_health.py::test_a_500_still_carries_cors_headers`.

### 28.6 Why the translated PDF goes through the print dialog

Kannada is a complex script: `ಕ` + `್` + `ನ` must compose into one conjunct glyph,
which needs OpenType GSUB/GPOS shaping. Neither `pypdf` nor `reportlab` has a shaper,
so a server-generated PDF would look like a valid document while the Kannada inside it
was a row of disconnected letters with vowel marks misplaced — worse than useless in a
case file. The browser has a shaper and the system Kannada fonts, and this repo
already exported conversation PDFs through `window.print()`, so
`frontend/src/lib/pdf/printView.ts` reuses that path. `documents.tsx` also offers a
direct `.txt` download, UTF-8 **with a BOM** so Notepad and Excel on Windows do not
render Kannada as mojibake.

The download buttons carry the **translation**, not the upload — the officer already
has the file they uploaded.

### 28.7 Translation coverage is narrower than the UI's language strip suggests

The `/documents` footer lists the 23 languages from Sarvam's picker (22 Indian +
English) and marks Kannada and English as live. That distinction is load-bearing:

- The app calls **`mayura:v1`**, which Sarvam documents as 11 languages (10 Indian +
  English). The 23-language list is `sarvam-translate:v1`'s coverage.
- `_bcp()` in `models/api/sarvam.py` and `_norm_lang()` in the documents route both
  collapse every code to `kn-IN` or `en-IN`, so a Tamil upload would be sent to the
  provider *labelled English*.
- Sarvam documents translation "between English and 22 Indian languages" — English on
  one side of the pair. Tamil→Kannada would be a two-hop pivot through English.

`frontend/scripts/check-languages.mjs` asserts only `kn-IN` and `en-IN` carry
`live: true`. If translation ever widens, update that assertion rather than deleting
it.

---

## 29. Frontend Shell & Motion Additions

### 29.1 The rail was forcing page height on every screen

`Shell.tsx` used `min-h-screen`, which sets a floor and lets the column grow, so the
tallest child decided the document height. The nav rail is ~17 items at `h-11` plus
gaps and padding — about 900px of fixed height — so any window shorter than that
stretched the page and left a band of empty background under every screen's content.

Now `h-dvh` + `overflow-hidden` with a `shrink-0` header, and the rail is
`shrink-0 overflow-y-auto` (scrollbar hidden — a 64px column has no room for one, and
it still scrolls by wheel, drag and keyboard). Consequence: `audit` and `admin`, which
had no height constraint, now scroll inside `<main>` instead of the page, so the header
and rail stay pinned.

`documents.tsx` uses `h-full` rather than `calc(100dvh - 3.5rem)`; a hard-coded header
height is a second copy that has to stay in sync, and any disagreement shows as a gap.

### 29.2 Collapsible rail with dock magnification (`lib/railDock.ts`)

Rail morphs 64px ↔ 208px over 300ms; labels fade in 100ms *behind* the width so text
is not seen sliding out from under its own clip edge; chevron rotates; **Cmd/Ctrl+B**
toggles; state persists in `localStorage`, read in the state initialiser so the rail
renders at its remembered width instead of flashing open and snapping shut.

Hover magnification is scoped to `[data-rail="collapsed"]` — a full-width 208px row
scaling 1.42× would burst the panel. Falloff via `+` and `:has(+ .rail-item:hover)`;
no pointer tracking, no rAF loop, no state.

**No outward translate**, because the rail is a scroll container and anything crossing
its edge is clipped. Growth is centre-origin: a 44px tile at 1.42× is 62.5px, inside
64px. `scripts/check-rail-dock.mjs` asserts `TILE × SCALE ≤ RAIL_WIDTH`, that every
magnification rule is scoped to the collapsed state, and that reduced motion cancels
rather than shortens.

**The bug worth remembering:** hiding collapsed labels with `opacity: 0` was not
enough. An invisible element still occupies its inline size, so a 44px tile held
~114px of content and `justify-content: center` spread the overflow to *both* sides —
putting each icon at a negative x where the rail's hidden overflow sliced it against
the left edge, and leaving the toggle unreachable. Collapsed labels now take
`width: 0`, with `gap: 0` and `overflow: hidden` on the tile.

Rail order follows the specified sequence; **Graphs and Audit were absent from that
list and were kept at the end rather than dropped** — removing them would leave
`/graphs` and `/audit` reachable only by typed URL, and Audit is the compliance
screen.

### 29.3 Download helper (`lib/download.ts`)

Six screens had hand-rolled blob downloads and five shared two bugs: the anchor was
never added to the document (a detached `<a>.click()` is ignored by Firefox and by
Chrome under some settings), and `URL.revokeObjectURL` was called synchronously on the
next line, invalidating the URL before the browser had read it. Both produce "nothing
happened" with no error — this is what made the encrypt flow look broken after the
request had already returned 200 with a valid PDF. `saveBlob()` attaches, clicks,
removes, and defers the revoke by 1s. Pinned by `scripts/check-download.mjs`.

### 29.4 Login page: glass card, ghost mascot, capability badges

- **`components/ui/glass-card.tsx`** — shadcn-conventioned frosted card. Its defaults
  (`text-white` over a 30% wash) assume a dark photographic hero; `/login` is light,
  so the sign-in card overrides the colour classes via `className` and tailwind-merge
  resolves in the caller's favour. A `supports-[not(backdrop-filter:blur(0px))]`
  fallback keeps a readable surface where `backdrop-filter` is unsupported.
- **`GhostMascot`** (`lib/ghostMascot.ts` + `components/GhostMascot.tsx`) — full-height
  background layer, `pointer-events-none` so it cannot intercept a click meant for the
  password field. The liquid read needs three animations at *different* periods: float
  (7s), squash (4.4s, deliberately non-harmonic so the body is not thinnest at exactly
  the top of every rise), and a 26s colour rotation with three blob drifts. Soft edges
  come from **radial gradients that fade to transparent, not a blur** — an SVG filter
  re-runs whenever anything inside it changes, and at ~78vh with everything moving that
  would be a large convolution every frame.
  Eyes track the pointer via a passive listener writing a `transform` straight onto the
  eye group — no React state, one DOM write per frame. Clamped so they cannot leave the
  sockets. `scripts/check-ghost-mascot.mjs` pins the clamp, the path closing, and the
  non-harmonic periods.
- Trust badges extended from 3 to **9**, one per shipped capability.

### 29.5 Reduced motion

Every animation added here stops under `prefers-reduced-motion`, with one deliberate
exception: the mascot's eye tracking. It moves only while the pointer does, which is
direct feedback to the user's own input rather than something animating at them.

---

## 30. Frontend self-checks without a test framework

The frontend has no test runner and one was not added. Five checks run under Node's
own type stripping:

```bash
cd frontend
node --experimental-strip-types scripts/check-download.mjs
node --experimental-strip-types scripts/check-translated-pdf.mjs
node --experimental-strip-types scripts/check-languages.mjs
node --experimental-strip-types scripts/check-rail-dock.mjs
node --experimental-strip-types scripts/check-ghost-mascot.mjs
```

Each asserts an invariant that fails silently in a browser: a download that does
nothing, a PDF containing the source instead of the translation, a language marked
live that the backend cannot reach, an icon clipped mid-hover, eyes leaving their
sockets. They import from `src/lib/*.ts` — which is why the pure geometry, CSS strings
and maths live in `lib/` rather than beside their `.tsx` components, since Node cannot
strip JSX.

Frontend typecheck baseline is **56 errors**: 55 pre-existing duplicate keys in
`lib/i18n.tsx` (TS1117) and one pre-existing comparison in `FinancialLinksPanel.tsx`.
Treat any 57th as introduced.

---

## 31. ML, Statistical and Graph Algorithms — Full Formulas

Every algorithm and mathematical model below is transcribed directly from the active Satyam codebase, complete with formal equations, loss functions, parameter bounds, complexity metrics, and concrete implementation locations.

Where a feature in the system is an empirical, hand-tuned heuristic rather than a learned statistical weights model, it is explicitly documented with its exact mathematical form and design rationale (§31.15).

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                           SATYAM MATHEMATICAL & ML ENGINE MAP                             │
├──────────────────────────────┬─────────────────────────────┬──────────────────────────────┤
│    SEMANTIC & NLP LAYER      │    SPATIO-TEMPORAL LAYER    │     VISION & EDGE LAYER      │
├──────────────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ • BGE-M3 Dense Embeddings    │ • Log-Damped Risk Surface   │ • YOLOv8s CIoU Multi-Task    │
│ • BGE-Reranker-v2-M3 Neural  │ • Rolling-Origin Backtest   │ • ByteTrack Kalman MOT       │
│ • Selective IDF Truncation   │ • PAI & PEI Spatial Metrics │ • Kinetic Assault Vectoring  │
│ • Reciprocal Rank Fusion     │ • Wilson 95% Score Bounds   │ • Crowd Surge Anomaly Rate   │
│ • Progressive SQL Grammar    │ • Haversine Geodesic Mesh   │ • MediaPipe 3D Landmark LERP │
├──────────────────────────────┼─────────────────────────────┼──────────────────────────────┤
│      GRAPH & FLOW LAYER      │     SOCIO-ECONOMIC LAYER    │     SECURITY & CRYPTO        │
├──────────────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ • Bipartite Ego Centrality   │ • Pearson Correlation (r)   │ • SHA-256 Recurrence Chain   │
│ • Multi-Hop Financial BFS    │ • Social Risk Index (SRI)   │ • Advisory Transaction Locks │
│ • Coulomb-Hooke Force Engine │ • Demographics Stratification│ • Zero-Knowledge RLS GUCs   │
│ • Sugiyama & ELK Radial Math │ • Age/Gender Histograms     │ • Clearance Decision Trees   │
└──────────────────────────────┴─────────────────────────────┴──────────────────────────────┘
```

---

### 31.1 Dense Vector Semantic Retrieval — BGE-M3 + pgvector HNSW

**Location:** `backend/app/models/local/embedder_bge.py`, `backend/app/pipeline/tools/rag.py`

#### 1. Representation & Vector Normalization
Let $\mathcal{X}$ denote the space of natural language case narratives and queries. The dense embedding model $E: \mathcal{X} \to \mathbb{R}^d$ maps text to a latent embedding space of dimension $d = 1024$ using `BAAI/bge-m3` (dense output arm, CLS pooling, sequence capacity $L_{\max} = 8192$ tokens).

To enable exact equivalence between inner product search and cosine similarity, embeddings are $L_2$-normalized prior to storage and query execution:
$$\hat{\mathbf{v}} = \frac{\mathbf{v}}{\|\mathbf{v}\|_2} = \frac{\mathbf{v}}{\sqrt{\sum_{i=1}^{1024} v_i^2}}$$

#### 2. Cosine Distance Metric Formulation
The cosine similarity between query embedding $\hat{\mathbf{q}}$ and narrative document embedding $\hat{\mathbf{d}}$ reduces to the Euclidean dot product:
$$\cos(\mathbf{q}, \mathbf{d}) = \frac{\mathbf{q} \cdot \mathbf{d}}{\|\mathbf{q}\|_2 \|\mathbf{d}\|_2} = \hat{\mathbf{q}} \cdot \hat{\mathbf{d}} = \sum_{i=1}^{1024} \hat{q}_i \hat{d}_i$$

pgvector implements the cosine distance operator `<=>`, defined over the metric range $[0, 2]$:
$$\mathcal{D}_{\text{cosine}}(\mathbf{q}, \mathbf{d}) = 1 - \cos(\mathbf{q}, \mathbf{d}) = 1 - \sum_{i=1}^{1024} \hat{q}_i \hat{d}_i$$

#### 3. SQL Query Execution & Runtime Typing
The SQL query resolves the vector column data type dynamically per request (`vector` for FP32 in PostgreSQL 17 local; `halfvec` for FP16 in Neon PostgreSQL 16 cloud):
```sql
SELECT n.narrative_id, n.case_id, n.body AS text,
       (n.embedding <=> (:qvec)::{vector|halfvec}) AS distance
FROM narratives n
WHERE n.embedding IS NOT NULL
ORDER BY n.embedding <=> (:qvec)::{vector|halfvec}
LIMIT :k;  -- k * CANDIDATE_MULTIPLIER = 5 * 3 = 15
```

#### 4. Python-Side Distance Ceiling
To preserve diagnostic observability (distinguishing between zero-match queries and database un-embedded status), distance thresholding is applied in Python after retrieval:
$$\text{Accept}(d) \iff \mathcal{D}_{\text{cosine}}(\mathbf{q}, \mathbf{d}) \le \tau_{\text{dist}} = 0.60$$

#### 5. HNSW (Hierarchical Navigable Small World) Index Geometry
The vector space is indexed with an HNSW graph $\mathcal{G} = \{G_0, G_1, \dots, G_L\}$.
- **Layer distribution:** Element maximum layer $l$ is sampled from an exponential distribution with parameter $m_L = \frac{1}{\ln(M)}$:
  $$l = \left\lfloor -\ln(\text{uniform}(0, 1)) \cdot \frac{1}{\ln(M)} \right\rfloor$$
- **Graph hyperparameters:** $M = 16$ (bidirectional links per node), $ef_{\text{construction}} = 64$ (size of dynamic candidate list during construction).
- **Search complexity:** $\mathcal{O}(\log N)$ distance evaluations per query.
- **Storage Economics:** 
  $$\text{Bytes}_{\text{row}} = \text{Bytes}_{\text{halfvec}} + \text{Bytes}_{\text{HNSW}} = 2052\,\text{B} + 2740\,\text{B} = 4792\,\text{B / record}$$

---

### 31.2 Cross-Encoder Neural Reranking — BGE-Reranker-v2-M3

**Location:** `backend/app/models/local/reranker_bge.py`, `backend/app/pipeline/tools/rag.py`

#### 1. Joint Cross-Attention Mathematical Formulation
Unlike bi-encoders where query and document are projected independently, the cross-encoder cross-attends across all token pairs of both inputs simultaneously:
$$s(q, d) = \sigma\left(\mathbf{W}^T \cdot \text{Transformer}([q \,\|\, \text{[SEP]} \,\|\, d])_{[\text{CLS}]} + b\right)$$
where $[q \,\|\, \text{[SEP]} \,\|\, d]$ is the concatenated sequence truncated at length $L_{\max} = 512$, $\mathbf{W} \in \mathbb{R}^{d_{\text{hidden}}}$ is the projection vector, and $\sigma(z) = \frac{1}{1 + e^{-z}}$.

#### 2. Permutation Generation
Given the fused candidate set $\mathcal{C} = \{d_1, d_2, \dots, d_M\}$, the reranker computes:
$$\pi^* = \operatorname{argsort}_{i \in \{1, \dots, M\}} \left( s(q, d_i) \right) \quad \text{in descending order}$$
The top-$k$ documents are selected: $\mathcal{R}_{\text{final}} = \{ d_{\pi^*(1)}, d_{\pi^*(2)}, \dots, d_{\pi^*(k)} \}$, with default $k = 5$.

#### 3. Post-Reranking Clearance Gating
To guarantee that the neural cross-encoder evaluates authentic contextual semantics rather than synthetic redaction placeholders, clearance redaction is executed strictly *after* reranking:
$$\text{OutputText}(d_i) = \begin{cases} \text{body}(d_i) & \text{if } \text{Principal.can\_see\_narrative}(\text{crime\_type}(d_i)) \\ \text{"[Restricted: protected-crime narrative. Insufficient clearance.]"} & \text{otherwise} \end{cases}$$

---

### 31.3 Lexical Retrieval & Selective Document Frequency Truncation

**Location:** `backend/app/pipeline/tools/rag.py`, `backend/migrations/012_local_bilingual_rag.sql`

#### 1. Corpus Document Frequency & Information Density
For lexeme $t$ in language $L \in \{\text{"en"}, \text{"kn"}\}$, document frequency $n(t)$ is precomputed in `narrative_lexeme_df`:
$$n(t) = |\{d \in \mathcal{D}_L : t \in d\}|$$
The standard Inverse Document Frequency (IDF) is:
$$\text{IDF}(t) = \ln\left( \frac{N_L - n(t) + 0.5}{n(t) + 0.5} + 1 \right)$$

#### 2. Selective DF Thresholding
To eliminate non-informative boilerplate tokens (e.g. `investig`, `fir`, `regist`, `district` which occur in $100\%$ of template documents), query terms are filtered by a document frequency ceiling:
$$\text{Keep}(s) \iff 0 < \text{tot}(s) \le N_L \cdot \text{MAX\_DF\_FRACTION} \quad (\text{MAX\_DF\_FRACTION} = 0.20)$$
where stem-group frequency $\text{tot}(s)$ aggregates all inflectional variants sharing English stem $s$:
$$\text{tot}(s) = \sum_{t \in \text{Stem}(s)} n(t), \quad \text{alt}(s) = \bigvee_{t \in \text{Stem}(s)} t$$
This guarantees an explicit IDF lower bound:
$$\frac{\text{tot}(s)}{N} \le 0.20 \iff \text{IDF}(s) > \ln\left(\frac{1}{0.20}\right) = \ln(5) \approx 1.609$$

#### 3. Progressive Conjunction Relaxation
Query term groups $\{g_1, g_2, \dots, g_m\}$ are sorted in ascending order of $\text{tot}(s)$ (most selective first). The conjunction query is constructed iteratively:
$$\mathcal{Q}_j = \bigwedge_{i=1}^{j} g_i \quad \text{for } j = \min(m, \text{MAX\_TERM\_GROUPS}), \dots, 1$$
The algorithm tests each $\mathcal{Q}_j$ sequentially up to $\text{MAX\_RELAXATIONS} = 4$. The first non-empty result set satisfies precision while guaranteeing reachable recall without unbounded disjunctive table scans.

---

### 31.4 Reciprocal Rank Fusion (RRF) Multi-Arm Blending

**Location:** `backend/app/pipeline/tools/rag.py::_rrf_fuse`

To merge candidate sets from distinct retrieval modalities without requiring score normalization calibration across disparate metric spaces (cosine distance $[0, 2]$ vs PostgreSQL `ts_rank` $[0, 1]$), Reciprocal Rank Fusion is evaluated:

$$\text{RRF\_Score}(d) = \sum_{m \in \mathcal{M}} \frac{1}{k_{\text{rrf}} + \operatorname{rank}_m(d)}$$

Where:
- $\mathcal{M} = \{\text{vector}, \text{lexical}\}$
- $\operatorname{rank}_m(d) \in \{1, 2, \dots, |\mathcal{C}_m|\}$ is the 1-based ordinal rank of document $d$ within strategy $m$.
- $k_{\text{rrf}} = 60$ is the smoothing constant that prevents high-ranking outliers in one strategy from dominating the unified order.
- If $d \notin \mathcal{C}_m$, its contribution from strategy $m$ is $0$.
- Deterministic tie-breaking: ties are broken by initial order of appearance with the vector strategy prioritized:
  $$\operatorname{TieBreak}(a, b) = \begin{cases} a \succ b & \text{if } \text{RRF}(a) > \text{RRF}(b) \\ a \succ b & \text{if } \text{RRF}(a) = \text{RRF}(b) \land \text{FirstSeen}(a) < \text{FirstSeen}(b) \end{cases}$$

---

### 31.5 Spatio-Temporal Crime Forecasting & Multi-Factor Risk Surface

**Location:** `backend/app/services/intelligence_service.py`

#### 1. Geodesic Grid Discretization
Statewide geographic space is discretized into regular bounding boxes parameterized by resolution $g \in \{0.01^\circ, 0.02^\circ, 0.05^\circ, 0.10^\circ\}$ (where $0.01^\circ \approx 1.11\,\text{km}$):
$$\text{lat}_c = \operatorname{round}\left(\frac{\text{latitude}}{g}\right) \cdot g, \quad \text{lng}_c = \operatorname{round}\left(\frac{\text{longitude}}{g}\right) \cdot g$$

#### 2. Temporal Horizon & Incident Aggregation
Given reference temporal anchor $t_{\text{as\_of}} = \max(\text{report\_date})$ and user horizon $H \in \{3, 7, 14, 30\}$ days:
$$T_{\text{recent}} = \max(H, 7)\,\text{days}, \quad T_{\text{baseline}} = 2 \cdot T_{\text{recent}}\,\text{days}$$
$$\text{Recent Window: } \mathcal{W}_{\text{recent}} = (t_{\text{as\_of}} - T_{\text{recent}},\, t_{\text{as\_of}}]$$
$$\text{Baseline Window: } \mathcal{W}_{\text{baseline}} = (t_{\text{as\_of}} - T_{\text{baseline}},\, t_{\text{as\_of}} - T_{\text{recent}}]$$

Counts are aggregated per cell $c = (\text{lat}_c, \text{lng}_c)$ and crime type $k$:
$$N_{\text{total}}(c, k) = \sum_{i \in \text{Cases}} \mathbb{I}\left(c_i = c \land k_i = k \land t_i \le t_{\text{as\_of}}\right)$$
$$N_{\text{recent}}(c, k) = \sum_{i \in \text{Cases}} \mathbb{I}\left(c_i = c \land k_i = k \land t_i \in \mathcal{W}_{\text{recent}}\right)$$
$$N_{\text{baseline}}(c, k) = \sum_{i \in \text{Cases}} \mathbb{I}\left(c_i = c \land k_i = k \land t_i \in \mathcal{W}_{\text{baseline}}\right)$$

#### 3. Non-Linear Risk Score Formulation
The cell risk score combines a logarithmic volume density term with a bounded recency-velocity lift:
$$\text{DensityScore}(c, k) = \min\left(50, \left\lfloor 10 \cdot \ln(1 + N_{\text{total}}(c, k)) \right\rfloor\right)$$

$$\text{LiftPercent}(c, k) = \begin{cases} \left\lfloor \frac{N_{\text{recent}}(c, k) - N_{\text{baseline}}(c, k)}{N_{\text{baseline}}(c, k)} \cdot 100 \right\rfloor & \text{if } N_{\text{baseline}}(c, k) > 0 \\ 50 & \text{if } N_{\text{baseline}}(c, k) = 0 \land N_{\text{recent}}(c, k) > 0 \\ 0 & \text{otherwise} \end{cases}$$

$$\text{LiftScore}(c, k) = \min\left(30, \max\left(0, \left\lfloor 0.3 \cdot \text{LiftPercent}(c, k) \right\rfloor\right)\right)$$

$$\text{RiskScore}(c, k) = \min\left(99, 20 + \text{DensityScore}(c, k) + \text{LiftScore}(c, k)\right) \in [20, 99]$$

Each spatial cell inherits the supremum risk across all active crime categories:
$$\text{RiskScore}(c) = \max_{k} \text{RiskScore}(c, k)$$

#### 4. Discrete Threat Categorization
$$\text{RiskLabel}(S) = \begin{cases} \text{"Critical"} & \text{if } S \ge 75 \\ \text{"High"} & \text{if } 55 \le S < 75 \\ \text{"Medium"} & \text{if } 30 \le S < 55 \\ \text{"Low"} & \text{if } S < 30 \end{cases}$$

#### 5. Early Warning Alert Scoring Formula
For statewide macro alerts surfaced by `GET /api/forecast/alerts`:
$$\text{AlertScore}(k, d) = \min\left(99,\, 30 + \min\left(40, \left\lfloor \frac{\text{LiftPercent}}{2} \right\rfloor\right) + \min\left(20, \left\lfloor \frac{N_{\text{total}}}{50} \right\rfloor\right)\right)$$
Recommended deployment patrol shift window:
$$h_{\text{peak}} = \max\left(0, \min\left(22, \lfloor \bar{h}_{\text{incident}} \rfloor\right)\right), \quad \text{Shift} = [h_{\text{peak}},\, \min(23, h_{\text{peak}} + 2)]$$

---

### 31.6 Rolling-Origin Temporal Backtesting & Spatial Validation Framework

**Location:** `backend/app/services/intelligence_service.py::get_forecast_backtest`

```
Temporal Origin Splitting (Walk-Forward Validation):
Fold k:   |──────── Train Window (History <= Origin_k) ────────|── Test Window (test_days) ──|
                                                                ^ Origin_k                    ^ TestEnd_k
```

#### 1. Rolling-Origin Partitioning
For $K$ folds ($K \in [1, 24]$, default 6) and test window duration $\Delta t_{\text{test}} \in [7, 90]$ days (default 30 days):
$$\text{Origin}_k = t_{\text{as\_of}} - (k + 1) \cdot \Delta t_{\text{test}}$$
$$\text{TestEnd}_k = t_{\text{as\_of}} - k \cdot \Delta t_{\text{test}}$$

Strict temporal causality is enforced: all feature variables ($N_{\text{total}}, N_{\text{recent}}, N_{\text{baseline}}$) are computed strictly from incidents occurring at $t \le \text{Origin}_k$.

#### 2. Spatial Decile Selection
Within each fold $k$, the top decile of rankable spatial cells is selected using `NTILE(10)` ordered by $\text{RiskScore}$ descending:
$$\mathcal{S}_k = \{c \in \Omega_k : \text{decile}(c) = 1\}, \quad \text{where } \text{decile}(c) = \operatorname{NTILE}_{10}(\text{RiskScore}(c))$$

#### 3. Statistical Evaluation Metrics (Pooled Across Folds)
- **Hit Rate:** Fraction of all held-out test incidents occurring within selected cells:
  $$\text{HitRate} = \frac{\sum_{k=1}^K \sum_{c \in \mathcal{S}_k} N_{\text{test}}(c, k)}{\sum_{k=1}^K \sum_{c \in \Omega_k} N_{\text{test}}(c, k)} = \frac{\text{Hits}_{\text{total}}}{N_{\text{test, total}}}$$
- **Area Share:** Proportion of total geographic study area targeted:
  $$\text{AreaShare} = \frac{\sum_{k=1}^K |\mathcal{S}_k|}{\sum_{k=1}^K |\Omega_k|} = \frac{\text{Cells}_{\text{selected}}}{\text{Cells}_{\text{study}}}$$
- **Prediction Accuracy Index (PAI):** Ratio of hit rate to area share ($> 1.0$ indicates performance superior to random spatial targeting):
  $$\text{PAI} = \frac{\text{HitRate}}{\text{AreaShare}} = \frac{\text{Hits} / N_{\text{test}}}{\text{Cells}_{\text{selected}} / \text{Cells}_{\text{study}}}$$
- **Predictive Efficiency Index (PEI):** Ratio of achieved hits to the theoretical maximum hits achievable by a perfect hindsight oracle choosing the identical number of cells:
  $$\text{PEI} = \frac{\text{Hits}}{\text{Hits}_{\max}} = \frac{\sum_{k=1}^K \sum_{c \in \mathcal{S}_k} N_{\text{test}}(c, k)}{\sum_{k=1}^K \sum_{r=1}^{|\mathcal{S}_k|} N_{\text{test}}(\pi_k^{\text{oracle}}(r), k)}$$
  where $\pi_k^{\text{oracle}}$ orders cells by descending held-out test incident count $N_{\text{test}}(c, k)$.

#### 4. Wilson Score Confidence Interval (95% CI)
To avoid degenerate interval estimates associated with small sample sizes or extreme proportions, the 95% Wilson binomial score interval ($z = 1.959964$) is computed:
$$\hat{p} = \frac{\text{Hits}}{N_{\text{test}}}, \quad D = 1 + \frac{z^2}{N_{\text{test}}}$$
$$\text{Center} = \frac{\hat{p} + \frac{z^2}{2 N_{\text{test}}}}{D}$$
$$\text{Margin} = \frac{z \sqrt{\frac{\hat{p}(1 - \hat{p})}{N_{\text{test}}} + \frac{z^2}{4 N_{\text{test}}^2}}}{D}$$
$$\text{CI}_{95\%} = \left[ \max(0, \text{Center} - \text{Margin}),\, \min(1, \text{Center} + \text{Margin}) \right]$$

---

### 31.7 Edge Computer Vision AI & Real-Time Video Analytics

**Location:** `model/inference/live_cctv.py`, `ai_camera/detect_video.py`, `backend/app/api/routes/ops.py`

#### 1. YOLOv8s Neural Architecture & Multi-Task Loss
Object detection runs on a YOLOv8s convolutional network (22.5 MB weights, CSPDarknet53 feature backbone with C2f modules, PAN-FPN multiscale feature pyramid, and an anchor-free decoupled detection head).

The end-to-end training and fine-tuning loss is:
$$\mathcal{L}_{\text{total}} = \lambda_{\text{box}} \mathcal{L}_{\text{CIoU}} + \lambda_{\text{cls}} \mathcal{L}_{\text{BCE}} + \lambda_{\text{dfl}} \mathcal{L}_{\text{DFL}}$$

Where **Complete Intersection over Union (CIoU)** incorporates overlap area, central point distance, and aspect ratio consistency:
$$\text{IoU} = \frac{|\mathbf{b} \cap \mathbf{b}^{gt}|}{|\mathbf{b} \cup \mathbf{b}^{gt}|}$$
$$\mathcal{L}_{\text{CIoU}} = 1 - \text{IoU} + \frac{\rho^2(\mathbf{b}, \mathbf{b}^{gt})}{c^2} + \alpha v$$
$$\rho(\mathbf{b}, \mathbf{b}^{gt}) = \|(c_x, c_y) - (c_x^{gt}, c_y^{gt})\|_2 = \sqrt{(c_x - c_x^{gt})^2 + (c_y - c_y^{gt})^2}$$
$$v = \frac{4}{\pi^2} \left( \arctan\frac{w^{gt}}{h^{gt}} - \arctan\frac{w}{h} \right)^2, \quad \alpha = \frac{v}{(1 - \text{IoU}) + v}$$
$c$ is the diagonal length of the smallest enclosing bounding box.

Distribution Focal Loss ($\mathcal{L}_{\text{DFL}}$) optimizes the continuous bounding box regression coordinates around discrete bin labels $y$:
$$\mathcal{L}_{\text{DFL}}(S_i, S_{i+1}) = - \left( (y_{i+1} - y)\log(S_i) + (y - y_i)\log(S_{i+1}) \right)$$

#### 2. ByteTrack Multi-Object Tracking (MOT) State Space
For every detected entity, a discrete-time linear Kalman filter maintains state vector:
$$\mathbf{x} = [x_c, y_c, a, h, \dot{x}_c, \dot{y}_c, \dot{a}, \dot{h}]^T$$
where $(x_c, y_c)$ is the 2D bounding box center, $a = w/h$ is the aspect ratio, $h$ is box height, and the dotted components represent the respective first-order temporal velocities.

State transition and observation updates:
$$\mathbf{x}_{k} = \mathbf{F} \mathbf{x}_{k-1} + \mathbf{w}_k, \quad \mathbf{w}_k \sim \mathcal{N}(0, \mathbf{Q})$$
$$\mathbf{z}_k = \mathbf{H} \mathbf{x}_k + \mathbf{v}_k, \quad \mathbf{v}_k \sim \mathcal{N}(0, \mathbf{R})$$
Track-to-detection assignment is solved via the Hungarian algorithm across two stages (first associating detections with $\text{conf} \ge 0.5$, followed by associating remaining unmatched tracks with low-confidence detections $\text{conf} \in [0.1, 0.5)$).

#### 3. Kinetic Assault & Physical Violence Heuristic Formula
For all tracked persons $i$ with centroid trajectory $c_i(t) = (x_i(t), y_i(t))$, instantaneous frame velocity $v_i(t)$ is:
$$v_i(t) = \|c_i(t) - c_i(t-1)\|_2 = \sqrt{(x_i(t) - x_i(t-1))^2 + (y_i(t) - y_i(t-1))^2}$$

For all pairs of persons $(i, j)$ where $i < j$:
$$d_{ij}(t) = \|c_i(t) - c_j(t)\|_2 = \sqrt{(x_i(t) - x_j(t))^2 + (y_i(t) - y_j(t))^2}$$
$$\text{IsFightPair}(i, j) \iff d_{ij}(t) < \text{FIGHT\_DIST (80 px)} \land \max(v_i(t), v_j(t)) > \text{FIGHT\_SPEED (6.0 px/frame)}$$

When active fight pairs $N_{\text{fight\_pairs}} \ge 1$, the alert confidence is:
$$\text{Conf}_{\text{fight}} = \min\left(0.92,\, 0.65 + 0.05 \cdot N_{\text{fight\_pairs}}\right)$$

#### 4. Crowd Density Surge Metric
Let $N_{\text{people}}(t)$ be the number of active tracked persons in frame $t$:
$$N_{\text{people}}(t) \ge \text{CROWD\_THRESH (4)} \implies \text{Conf}_{\text{crowd}} = \min\left(0.90,\, 0.55 + 0.04 \cdot N_{\text{people}}(t)\right)$$

#### 5. Stalled / Suspicious Vehicle Anomaly
For vehicles $k \in \{\text{car}, \text{motorcycle}, \text{bus}, \text{truck}\}$:
$$v_k(t) < 2.0\,\text{px/frame for continuous duration } \Delta t \ge 3.0\,\text{seconds} \implies \text{Conf}_{\text{stall}} = \min\left(0.95,\, 0.60 + \frac{\Delta t}{20.0}\right)$$

#### 6. Weapon & Firearm Threat Detection
Specialized secondary firearm weights (`model/gun.pt` or class name matching in primary head):
$$\text{FirearmAlert} \iff \text{class} \in \{\text{"gun"}, \text{"pistol"}, \text{"rifle"}, \text{"weapon"}, \text{"knife"}\} \land \text{conf} \ge \tau_{\text{weapon}} = 0.35$$

---

### 31.8 Response Ops Fleet Dispatch, Geodesy & Dynamic Green Corridor

**Location:** `backend/app/services/ops/risk_service.py`, `corridor_service.py`, `routing_service.py`, `sim_service.py`

#### 1. Predictive Readiness Risk Zone Formula
Grid cells ($\sim 1.1\,\text{km}$, $\text{GRID\_SIZE} = 0.01^\circ$) are scored across historical lookback $T_{\text{lookback}} = 365$ days:
$$\text{SeverityWeights: } w(\text{Murder/Rape/Dacoity/Kidnap}) = 4,\, w(\text{Robbery/Burglary/Riot}) = 3,\, w(\text{Theft/Cheating}) = 2,\, w(\text{Other}) = 1$$
$$\text{IncidentScore}(Z) = \left( \frac{\sum_{i \in Z} w(\text{crime}_i)}{\max_{Z'} \sum_{i \in Z'} w(\text{crime}_i)} \right) \cdot 40.0$$
$$\text{DensityScore}(Z) = \left( \frac{|Z|}{\max_{Z'} |Z'|} \right) \cdot 30.0$$
$$\text{TimeScore}(Z) = \begin{cases} 30.0 & \text{if } \text{PeakHour}(Z) \in [20, 24] \cup [0, 4] \\ 12.0 & \text{otherwise} \end{cases}$$
$$\text{ZoneRiskScore}(Z) = \operatorname{round}\left(\text{IncidentScore}(Z) + \text{DensityScore}(Z) + \text{TimeScore}(Z),\, 1\right) \in [0, 100]$$

#### 2. Haversine Spherical Geodesic Metric
For coordinate pairs $(\phi_1, \lambda_1)$ and $(\phi_2, \lambda_2)$ in radians:
$$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)$$
$$d_{\text{Haversine}}(\mathbf{p}_1, \mathbf{p}_2) = 2 R \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right) \quad (R = 6371.0\,\text{km})$$

#### 3. Optimal Nearest Idle Patrol Dispatch & Pre-positioning Improvement
For top risk zones $Z_1, \dots, Z_5$, the system solves the greedy assignment problem:
$$P^*(Z) = \arg\min_{P \in \text{Patrols}_{\text{IDLE}}} d_{\text{Haversine}}(\text{pos}(P), \text{center}(Z))$$
The estimated transit time reduction achieved by proactive pre-positioning is:
$$\Delta T_{\text{response\_improvement}} = \frac{1}{2} \cdot \left( \frac{d_{\text{Haversine}}(P^*, Z)}{v_{\text{patrol}}} \right) \cdot 3600\,\text{seconds} \quad (v_{\text{patrol}} = 40.0\,\text{km/h})$$

#### 4. Dynamic Green Wave Signal Prioritization Geometry
Let $\mathcal{R} = \{\mathbf{r}_1, \mathbf{r}_2, \dots, \mathbf{r}_m\}$ represent the discrete GPS waypoints along a dispatch route.
- **Route Corridor Preemption:**
  $$\text{ActivateGreen}(S_j) \iff \min_{\mathbf{r} \in \mathcal{R}} d_{\text{Haversine}}(\text{pos}(S_j), \mathbf{r}) \le R_{\text{corridor}} = 0.5\,\text{km}$$
- **Moving Unit Proximity Trigger:**
  $$\text{PreemptNear}(S_j, \mathbf{p}_{\text{unit}}) \iff d_{\text{Haversine}}(\text{pos}(S_j), \mathbf{p}_{\text{unit}}) \le R_{\text{active}} = 0.3\,\text{km}$$

#### 5. Discrete Kinematic Patrol Simulation
Routes are subsampled to $N \le 60$ waypoints. Position evolves via discrete forward integration:
$$\mathbf{p}_{k+1} = \mathbf{p}_k + \mathbf{v}_k \Delta t, \quad \Delta t = 0.8\,\text{seconds / tick}$$
Lifecycle state transitions:
$$\text{IDLE} \xrightarrow{\text{Dispatch}} \text{ACCEPTED (2s)} \xrightarrow{\text{Transit}} \text{EN\_ROUTE} \xrightarrow{\text{Arrival}} \text{ON\_SCENE (6s)} \xrightarrow{\text{Clear}} \text{IDLE}$$

---

### 31.9 Multimodal Hands-Free Vision, Biometric Auto-Lock & Kinetic Smoothing

**Location:** `frontend/src/lib/vision/`, `GestureController.tsx`, `FacePresenceController.tsx`

#### 1. MediaPipe Tasks 3D Hand Landmark Kinematics
WASM GPU-accelerated neural landmark tracking evaluates $K = 21$ hand joints $\mathbf{P} = \{\mathbf{p}_0, \mathbf{p}_1, \dots, \mathbf{p}_{20}\}$ where $\mathbf{p}_k = (x_k, y_k, z_k) \in \mathbb{R}^3$.
- **Index Tip Position:** $\mathbf{p}_{\text{index}} = \mathbf{p}_8$
- **Thumb Tip Position:** $\mathbf{p}_{\text{thumb}} = \mathbf{p}_4$
- **Euclidean Pinch Distance:**
  $$d_{\text{pinch}} = \|\mathbf{p}_4 - \mathbf{p}_8\|_2 = \sqrt{(x_4 - x_8)^2 + (y_4 - y_8)^2 + (z_4 - z_8)^2}$$
  $$\text{TriggerClick} \iff d_{\text{pinch}} < \tau_{\text{pinch}} = 0.065$$

#### 2. Exponential Moving Average (LERP) Cursor Smoothing
To eliminate high-frequency hand tremors from the video cursor coordinate $\mathbf{c}_t = (x_{\text{screen}}, y_{\text{screen}})_t$:
$$\mathbf{c}_{\text{smoothed}}(t) = (1 - \alpha)\mathbf{c}_{\text{smoothed}}(t - 1) + \alpha \mathbf{c}_{\text{raw}}(t) \quad (\alpha = 0.35)$$

#### 3. Temporal Majority-Voting & Gesture Hold Filter
Let $g_t \in \mathcal{G}$ be the frame-level classification output.
- **Majority-Voting Window:** Mode over a sliding temporal buffer of $W = 5$ frames:
  $$g^*_t = \operatorname{mode}\left(\{g_{t-4}, g_{t-3}, g_{t-2}, g_{t-1}, g_t\}\right)$$
- **Hold Duration Threshold:** A gesture triggers its structured intent only if stable for duration $T_{\text{hold}}$:
  $$\text{ExecuteIntent}(g^*) \iff \Delta t(g^* = \text{const}) \ge 400\,\text{ms}$$

#### 4. Face Presence Absence Auto-Lock Metric
`FaceDetector` runs at interval $\Delta t = 400\,\text{ms}$. If no human face is detected within the video stream:
$$t - t_{\text{last\_face\_detected}} \ge T_{\text{absence\_threshold}} = 15.0\,\text{seconds} \implies \text{Trigger}(\text{"satyam:session-lock"})$$
The UI engages full-screen backdrop blur and logs an audited security event to `audit_log`.

---

### 31.10 Socio-Demographic Correlation & Social Risk Index (PS4)

**Location:** `backend/app/services/intelligence_service.py::get_socio_correlation`

#### 1. Pearson Product-Moment Correlation Coefficient
For statewide district data vectors $\mathbf{x} = [x_1, \dots, x_n]$ (e.g. crime rate) and $\mathbf{y} = [y_1, \dots, y_n]$ (e.g. literacy rate, urbanization percent, income index):

$$r_{xy} = \frac{\sum_{i=1}^n (x_i - \bar{x})(y_i - \bar{y})}{\sqrt{\sum_{i=1}^n (x_i - \bar{x})^2} \sqrt{\sum_{i=1}^n (y_i - \bar{y})^2}} = \frac{n \sum_{i=1}^n x_i y_i - \left(\sum_{i=1}^n x_i\right)\left(\sum_{i=1}^n y_i\right)}{\sqrt{\left[n \sum_{i=1}^n x_i^2 - \left(\sum_{i=1}^n x_i\right)^2\right] \left[n \sum_{i=1}^n y_i^2 - \left(\sum_{i=1}^n y_i\right)^2\right]}}$$

Guards: $r_{xy} = \text{None}$ if $n < 3$ or denominator $= 0$.

#### 2. District Social Risk Index (SRI)
$$\text{SRI}(d) = \min\left(99,\, 20 + \lfloor 8 \cdot \ln(1 + N_{\text{crime}}(d)) \rfloor + \min(20, N_{\text{accused}}(d))\right)$$
Key diagnostic drivers fire dynamically:
- `"High crime density"` $\iff N_{\text{crime}}(d) > 1000$
- `"High repeat-offender concentration"` $\iff N_{\text{accused}}(d) > 100$

---

### 31.11 Graph Analytics, Centrality & Multi-Hop BFS Flow (PS2 / PS7)

**Location:** `backend/app/pipeline/tools/analytics.py`, `backend/app/services/financial_service.py`, `frontend/src/lib/forceGraph.ts`

#### 1. Bipartite Ego-Graph Projection & Degree Centrality
The criminal intelligence graph is modeled as a bipartite graph $G = (V_P \cup V_C, E)$ where $V_P$ are persons and $V_C$ are crime cases:
$$C_D(v) = \operatorname{deg}(v) = |\{u \in V : (u, v) \in E\}|$$

#### 2. Multi-Hop BFS Money-Trail Expansion (PS7)
Starting from seed account set $\mathcal{S}_0$, the frontier expands breadth-first up to $D_{\max} = 3$ hops:
$$\mathcal{S}_{d+1} = \left\{ v \notin \bigcup_{i=0}^d \mathcal{S}_i \;\middle|\; \exists u \in \mathcal{S}_d \text{ s.t. } (u, v) \in E_{\text{txn}} \land \text{amount}(u, v) \ge \theta_{\text{min}} \right\}$$
Edge aggregation:
$$\text{Amount}(u, v) = \sum_{t \in \text{Txns}(u, v)} \text{amount}(t), \quad \text{IsSuspicious}(u, v) = \bigvee_{t \in \text{Txns}(u, v)} \text{is\_suspicious}(t)$$

#### 3. Force-Directed Spring-Embedder Physical Simulation
The 2D canvas layout integrates Coulomb repulsive forces, Hooke's spring forces, and velocity damping:
- **Repulsive Force (all pairs, $\mathcal{O}(n^2)$):**
  $$\mathbf{F}_{\text{rep}}(u, v) = \frac{k_{\text{rep}}}{\max(\|\mathbf{p}_u - \mathbf{p}_v\|_2^2,\, d_{\min}^2)} \cdot \frac{\mathbf{p}_u - \mathbf{p}_v}{\|\mathbf{p}_u - \mathbf{p}_v\|_2} \quad (k_{\text{rep}} = 18,\, d_{\min} = 1.2)$$
- **Spring Attractive Force (connected pairs):**
  $$\mathbf{F}_{\text{spring}}(u, v) = -k_{\text{spring}} \left( \|\mathbf{p}_u - \mathbf{p}_v\|_2 - L_0 \right) \cdot \frac{\mathbf{p}_u - \mathbf{p}_v}{\|\mathbf{p}_u - \mathbf{p}_v\|_2} \quad (k_{\text{spring}} = 0.012,\, L_0 = 22)$$
- **Centripetal Gravity Force:**
  $$\mathbf{F}_{\text{grav}}(u) = -k_{\text{grav}} (\mathbf{p}_u - \mathbf{c}_{\text{center}}) \quad (k_{\text{grav}} = 0.002,\, \mathbf{c} = (50, 50))$$
- **Velocity Integration & Kinetic Cooling:**
  $$\mathbf{v}_u(t + \Delta t) = \left( \mathbf{v}_u(t) + \frac{\mathbf{F}_{\text{total}}(u)}{m_u} \Delta t \right) \cdot \gamma^{\Delta t} \quad (\gamma = 0.82,\, \|\mathbf{v}\| \le 4.0)$$
  $$\mathbf{p}_u(t + \Delta t) = \mathbf{p}_u(t) + \mathbf{v}_u(t + \Delta t) \cdot \Delta t \cdot \alpha(t), \quad \alpha(t) = \max(0.15,\, \alpha(0) \cdot 0.985^t)$$
- **Settlement Criterion:** The physics engine terminates when kinetic energy satisfies:
  $$E_{\text{kinetic}} = \frac{1}{n} \sum_{u \in V} \|\mathbf{v}_u\|_2^2 < E_{\text{rest}} = 0.0004$$

---

### 31.12 Investigation Board Layout Algorithms

**Location:** `backend/app/services/board_brain.py`, `frontend/src/lib/boardLayout.ts`

#### 1. Sugiyama 4-Phase Layered DAG Layout (Dagre)
1. **Cycle Removal:** Greedy feedback arc set heuristic reverses back-edges to form a directed acyclic graph.
2. **Layer Assignment:** Integer programming / Network Simplex solves node ranking to minimize total edge length:
   $$\min \sum_{(u, v) \in E} (\text{layer}(v) - \text{layer}(u)) \quad \text{s.t. } \text{layer}(v) - \text{layer}(u) \ge \delta(u, v) \ge 1$$
3. **Crossing Reduction:** Iterative layer-by-layer barycentric / median heuristic vertex reordering.
4. **Coordinate Assignment:** Node placement subject to separation constraints ($\text{nodesep} = 60\,\text{px}$, $\text{ranksep} = 80\,\text{px}$).

#### 2. Polar Radial Layout Transformation
For central hubs (e.g. primary suspect, central crime incident):
$$x_i = x_0 + r \cdot \cos\left(\frac{2\pi i}{N} + \theta_0\right), \quad y_i = y_0 + r \cdot \sin\left(\frac{2\pi i}{N} + \theta_0\right)$$

#### 3. Iterative Repulsive Bounding-Box Collision Resolution
To guarantee zero visual node overlapping across arbitrary LLM-generated scene graphs, an 80-iteration iterative separation projection is computed:
For intersecting axis-aligned bounding boxes $A = (x_A, y_A, w_A, h_A)$ and $B = (x_B, y_B, w_B, h_B)$:
$$\Delta x = \frac{w_A + w_B}{2} + \text{pad} - |x_A - x_B|, \quad \Delta y = \frac{h_A + h_B}{2} + \text{pad} - |y_A - y_B|$$
$$\text{If } \Delta x > 0 \land \Delta y > 0: \quad \text{Resolve along minimal axis: } \mathbf{s} = \begin{cases} (\operatorname{sgn}(x_B - x_A)\Delta x,\, 0) & \text{if } \Delta x < \Delta y \\ (0,\, \operatorname{sgn}(y_B - y_A)\Delta y) & \text{otherwise} \end{cases}$$
$$\mathbf{p}_A \leftarrow \mathbf{p}_A - \frac{1}{2}\mathbf{s}, \quad \mathbf{p}_B \leftarrow \mathbf{p}_B + \frac{1}{2}\mathbf{s}$$

---

### 31.13 Cryptographic Audit Hash Chain Recurrence

**Location:** `backend/app/core/audit.py`, `backend/app/db/session.py`

#### 1. Hash Recurrence Relation
Let $R_k$ represent the $k$-th audited record. The cryptographic hash chain is defined recursively:
$$H_0 = \text{"GENESIS"}$$
$$H_k = \text{SHA-256}\left( H_{k-1} \,\|\, \text{CanonicalJSON}\left( \text{timestamp}_k, \text{user\_id}_k, \text{action}_k, \text{query\_text}_k, \text{client\_ip}_k \right) \right)$$
where $\text{CanonicalJSON}(P)$ is serialized with lexicographically sorted keys, compact delimiters (`","`, `":"`), and UTC ISO timestamps.

#### 2. Concurrency Control & Fork Prevention
To prevent blockchain-style branching forks under concurrent async FastAPI workers, appends are serialized using PostgreSQL transaction-level advisory locking:
```sql
SELECT pg_advisory_xact_lock(728311042);
SELECT row_hash FROM audit_log ORDER BY audit_id DESC LIMIT 1;
-- Compute H_k = SHA-256(prev_hash || canonical_payload)
INSERT INTO audit_log (at, user_id, action, query_text, prev_hash, row_hash) VALUES (...);
```

---

### 31.14 Grounded Natural Language-to-SQL & Progressive Relaxation Grammar

**Location:** `backend/app/pipeline/tools/text_to_sql.py`, `rule_sql.py`, `sql_guard.py`

#### 1. SQL Grammar AST Security Gate (`sqlglot`)
Every query generated by LLMs must strictly satisfy the AST validation theorem:
$$\text{ValidQuery}(Q) \iff \text{NodeType}(Q) = \text{Select} \land \text{Tables}(Q) \subseteq \mathcal{T}_{\text{allow}} \land \neg \text{HasMutations}(Q)$$
where $\mathcal{T}_{\text{allow}} = \{\text{cases}, \text{persons}, \text{case\_persons}, \text{narratives}, \text{stations}, \text{district\_socio\_economic\_indicators}\}$.
Auto-enforced limit: $\operatorname{LIMIT}(Q) \le 200$.

#### 2. 4-Tier Progressive Zero-Result Recovery Hierarchy
When an exact SQL query returns 0 rows due to over-constrained natural language filters, the engine relaxes predicates progressively:
- **Level 0 (Exact Match):** $\mathcal{F}_{\text{district}} \land \mathcal{F}_{\text{crime\_type}} \land \mathcal{F}_{\text{year}}$
- **Level 1 (Drop Date):** $\mathcal{F}_{\text{district}} \land \mathcal{F}_{\text{crime\_type}}$ (surfaces: *"No records for that time period — showing results across all years."*)
- **Level 2 (Drop Crime Type):** $\mathcal{F}_{\text{district}}$ (surfaces: *"No matching crime type in that district — showing all incidents in area."*)
- **Level 3 (Statewide Recency Fallback):** $\operatorname{ORDER BY} \text{report\_date DESC LIMIT } 10$

---

### 31.15 Summary Matrix: Model vs. Statistical vs. Heuristic

| System Surface | Methodology | Mathematical / Algorithm Class | Trained Weights? |
|---|---|---|:---:|
| **Semantic Narrative Search** | Dense Bi-Encoder + pgvector | Cosine Distance + HNSW ANN | ✅ (`bge-m3`) |
| **Document Reranking** | Neural Cross-Encoder | Joint Transformer Cross-Attention | ✅ (`bge-reranker-v2-m3`) |
| **Lexical Keyword Search** | Selective DF Truncation + GIN | TF-IDF Filtering + Progressive Conjunction | ❌ (Statistical) |
| **Hybrid Search Fusion** | Reciprocal Rank Fusion | Non-linear Rank Order Sum ($k=60$) | ❌ (Mathematical) |
| **Hotspot Risk Surface** | Spatio-Temporal Scorer | $\min(99, 20 + \lfloor 10\ln(1+N) \rfloor + 0.3\cdot\text{Lift})$ | ❌ (Empirical Formula) |
| **Forecast Backtest** | Walk-Forward Validation | PAI / PEI / Wilson 95% Score Interval | ❌ (Statistical) |
| **CCTV Object Detection** | YOLOv8s Convolutional Net | CIoU Loss + Distribution Focal Loss | ✅ (`yolov8s.pt`) |
| **CCTV Multi-Object Tracking**| ByteTrack Algorithm | 8-State Kalman Filter + Hungarian Matching | ❌ (Kinematic Filter) |
| **CCTV Fight / Assault Detection**| Kinetic Vector Analysis | Pairwise Euclidean Proximity + Frame Speed | ❌ (Heuristic Rule) |
| **Hands-Free Gesture Tracking** | MediaPipe Tasks Vision | 21 3D Landmarks + LERP + Sliding Window | ✅ (MediaPipe WASM) |
| **Patrol Fleet Allocation** | Greedy Geodesic Optimizer | Haversine Spherical Distance + Minimization | ❌ (Optimization) |
| **Green Wave Traffic Corridor** | Buffer Zone Preemption | Spatial Waypoint Distance Intersection | ❌ (Computational Geometry)|
| **Socio-Crime Correlation** | Parametric Statistics | Pearson Product-Moment ($r_{xy}$) | ❌ (Statistical) |
| **Criminal Ring Analysis** | Bipartite Graph Theory | Degree Centrality + Co-Offending Multi-Hop | ❌ (Graph Theory) |
| **Financial Money Trail** | Breadth-First Search | Bounded Multi-Hop BFS Expansion ($D \le 3$) | ❌ (Graph Traversal) |
| **Investigation Board Layout** | Hierarchical & Radial Layout | Sugiyama 4-Phase DAG + 80-Iter Collision Box | ❌ (Graph Layout) |
| **Tamper-Evident Audit Chain** | Cryptographic Ledger | SHA-256 Hash Chain + Advisory Locking | ❌ (Cryptographic) |
| **Conversational Chat & Voice** | Transformer LLM + TTS/STT | Gemini 2.5 Flash / Groq / Sarvam Bulbul & Saaras | ✅ (Frontier LLMs & ASR) |

---

## 32. Master Highlighted Feature Catalog & Implementation Deep-Dive

This section catalogs, benchmarks, and highlights **every single feature implemented in Satyam**. Each feature is broken down by its operational workflow, underlying algorithmic mechanics, security boundaries, and user value.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SATYAM HIGHLIGHTED FEATURE ECOSYSTEM                            │
├──────────────────────────────────────┬─────────────────────────────────────────────────┤
│  COMMAND & INTELLIGENCE FEATURES     │  RESPONSE OPERATIONS & REAL-TIME VISION         │
├──────────────────────────────────────┼─────────────────────────────────────────────────┤
│  🌟 Feature 1: Grounded Text-to-SQL  │  🌟 Feature 4: Real-Time Tactical Edge Video AI │
│  🌟 Feature 2: Hybrid Multilingual   │  🌟 Feature 5: Response Ops Predictive Fleet &  │
│     Vector RAG (EN+KN)               │     Dynamic Green Wave Corridor                 │
│  🌟 Feature 3: Spatio-Temporal Risk  │  🌟 Feature 7: Multimodal Hands-Free Gestures & │
│     Forecasting & Backtesting        │     Biometric Face Absence Auto-Lock            │
│  🌟 Feature 6: Network Intelligence, │  🌟 Feature 8: Autonomous Voice Screen Agent    │
│     Rings & Financial BFS Trail      │  🌟 Feature 9: Smart Investigation Board AI     │
├──────────────────────────────────────┼─────────────────────────────────────────────────┤
│  EVIDENTIARY & DOSSIER PLATFORM      │  SECURITY, GOVERNANCE & UI ARCHITECTURE         │
├──────────────────────────────────────┼─────────────────────────────────────────────────┤
│  🌟 Feature 10: Person 360 Forensic  │  🌟 Feature 12: Cryptographic SHA-256 Audit     │
│     Dossier & Height-Grid Mugshot    │     Hash Chain with Advisory Locking            │
│  🌟 Feature 11: Socio-Demographics & │  🌟 Feature 14: Dynamic On-The-Fly Kannada      │
│     Social Risk Index (SRI)          │     Translation & LLM Lexicon Enrichment        │
│  🌟 Feature 13: Certified Document   │  🌟 Feature 15: Fine-Grained RBAC / ABAC Matrix │
│     Translation, Seal & Verification │  🌟 Feature 16: Neobrutalist UI Design System   │
└──────────────────────────────────────┴─────────────────────────────────────────────────┘
```

---

### 32.1 Complete Feature Implementation Matrix

| # | Highlighted Feature | Primary Route | Backend Service Seam | Core Mathematical / ML Engine | Security & Access Gate | User / Officer Value |
|---|---|---|---|---|---|---|
| 🌟 1 | **Conversational Grounded Text-to-SQL** | `/console`, `/ask` | `pipeline/tools/text_to_sql.py`, `rule_sql.py` | `sqlglot` AST Validator, 4-tier progressive relaxation grammar | RLS session GUCs, Read-only single SELECT | Instant natural language queries into complex relational crime data without SQL knowledge |
| 🌟 2 | **Hybrid Bilingual Vector RAG** | `/console`, `/ask`, `/cases/{id}` | `pipeline/tools/rag.py`, `embedder_bge.py` | Dense BGE-M3 (1024d) + HNSW ANN + Selective IDF GIN + RRF ($k=60$) + BGE-Reranker-v2 | Fail-closed clearance masking (`can_see_narrative`) | Semantic discovery of Modus Operandi across 200,000 bilingual FIR case narratives |
| 🌟 3 | **Spatio-Temporal Crime Risk Forecasting** | `/forecast` | `services/intelligence_service.py` | Non-linear log-density + recency lift formula, rolling-origin backtest, PAI, PEI, Wilson CI | RLS jurisdiction scoping | Proactive hotspot discovery and empirical forecasting validation against historical ground truth |
| 🌟 4 | **Edge Tactical Vision & CCTV Intelligence** | `/ops-camera` | `model/inference/live_cctv.py`, `api/routes/ops.py` | YOLOv8s CIoU detection + ByteTrack Kalman MOT + Kinetic assault heuristics | L2+ write guard (`Permission.RUN_ANALYTICS`) | Automated edge detection of fights, crowd surges, stalled vehicles, and weapons from CCTV feeds |
| 🌟 5 | **Response Ops & Dynamic Green Wave Corridor** | `/ops-predictive`, `/ops-dispatch`, `/vision` | `services/ops/risk_service.py`, `corridor_service.py` | Haversine geodesy, greedy patrol pre-positioning, radial signal preemption buffer | L2+ dispatch execution | Automated emergency fleet dispatch with preemptive traffic signal clearing along response routes |
| 🌟 6 | **Criminal Network Intelligence & Financial BFS** | `/network` | `pipeline/tools/analytics.py`, `services/financial_service.py` | Bipartite ego-network degree centrality, multi-hop BFS transaction flow ($D \le 3$), Hooke-Coulomb physics | L2+ financial read guard | Visual graph dissection of syndicate relationships, repeat co-offenders, and money laundering paths |
| 🌟 7 | **Multimodal Hands-Free Gestures & Auto-Lock** | Statewide (Shell) | `frontend/src/lib/vision/`, `HandsFreeLayer.tsx` | MediaPipe Tasks 21 3D landmarks, LERP tremor damping, sliding window vote, face absence auto-lock | Client-side privacy WASM, SHA-256 security audit | Touch-free operation in tactical/incident war-rooms; automatic data protection when officer steps away |
| 🌟 8 | **Autonomous Voice Screen Agent** | Statewide (Shell) | `pipeline/screen_agent.py`, `Shell.tsx` | Sarvam Saaras v3 STT, Sarvam Bulbul v2 TTS, Gemini/Groq cascade, allow-list action coercer | `Permission.CHAT`, RLS-scoped sample resolution | Complete hands-free navigation and automated multi-step screen workflow execution via natural voice |
| 🌟 9 | **Smart Investigation Board AI** | `/board` | `services/board_brain.py`, `boardLayout.ts` | Gemini/Groq scene parsing, Sugiyama DAG (Dagre), ELK layered/radial, 80-iter repulsive box collision | Isolated board store, JSONB snapshots | Infinite visual canvas for investigative brainstorming with automated AI crime scene synthesis |
| 🌟 10 | **Person 360 Forensic Dossier** | `/dossier`, `/profile/:id` | `services/dossier_service.py`, `dossier.tsx` | Forensic height grid overlay, multi-angle face card lightbox, financial & associate cross-linking | L4+ clearance only | Comprehensive 360-degree suspect profile consolidating criminal history, family, accounts, and ties |
| 🌟 11 | **Socio-Demographics & Social Risk Index (SRI)** | `/socio` | `services/intelligence_service.py::get_socio_correlation` | Pearson product-moment correlation ($r_{xy}$), logarithmic Social Risk Index formula | RLS district scoping | Quantitative correlation between crime density and economic indicators (literacy, urbanization, income) |
| 🌟 12 | **Cryptographic SHA-256 Audit Hash Chain** | `/audit` | `core/audit.py`, `audit_service.py` | SHA-256 recurrence relation, PostgreSQL transaction advisory locking (`pg_advisory_xact_lock`) | Immutable audit ledger, L4 admin verify | Mathematical proof of tamper-evident audit history across all user queries and system actions |
| 🌟 13 | **Certified Document Translation & Sealing** | `/documents` | `services/document_service.py`, `documents.tsx` | Magic-byte binary gate, Sarvam neural translation, SHA-256 digital sealing, browser OpenType shaping | L2+ (`Permission.BUILD_REPORT`), no server file storage | Official translation of police notices into Kannada with cryptographic integrity verification |
| 🌟 14 | **Dynamic On-The-Fly Kannada Translation** | Statewide | `services/news_service.py`, `i18n.tsx`, `settings.py` | 500+ static DICT, LLM batch enrichment (Groq Llama-3.3-70B), dynamic OTF pipeline | Client-side persistent cache | Complete native Kannada experience spanning static UI, database records, and dynamic ML model outputs |
| 🌟 15 | **Fine-Grained RBAC / ABAC Security Matrix** | Statewide | `core/rbac.py`, `db/rls.py`, `admin_service.py` | 14 KSP Ranks, 4 Clearance Levels, dynamic PostgreSQL Row-Level Security GUCs, column PII masking | Hardcoded security policies, anti-lockout guards | Strict legal data isolation ensuring officers only access records within their station, district, or clearance |
| 🌟 16 | **Neobrutalist UI Design System & Theming** | Statewide | `lib/theme.ts`, `viewTransition.ts`, `LandingThree.tsx` | 13 curated themes, View Transitions circular clip reveal, Three.js 9,000-particle kinetic physics | Scoped CSS styling, accessibility contrast compliance | High-contrast, state-of-the-art police command interface engineered for low-latency tactical monitoring |

---

### 32.2 Highlighted Deep-Dives for Every Implemented Feature

---

#### 🌟 Feature 1: Grounded Conversational Text-to-SQL with 4-Tier Progressive Zero-Result Recovery
* **Primary Route:** `/console`, `/ask`
* **Source Files:** `backend/app/pipeline/tools/text_to_sql.py`, `rule_sql.py`, `sql_guard.py`
* **Architecture & Mechanics:**
  - Translates natural language inquiries (English, Kannada, or code-mixed) into strict PostgreSQL queries.
  - Multi-turn conversation context memory (incorporates last 6 dialogue turns for pronoun resolution and follow-up filtering).
  - Validated by `sql_guard.py` using `sqlglot` Abstract Syntax Trees to guarantee read-only single `SELECT` operations against 6 allow-listed tables with auto-enforced `LIMIT 200`.
  - **4-Tier Progressive Recovery:** If an exact query yields 0 records, it systematically broadens filters:
    1. $\text{Level } 0$: Exact temporal + categorical + spatial filters.
    2. $\text{Level } 1$: Strips date constraints, retaining place and crime category.
    3. $\text{Level } 2$: Strips crime category, showing all activity in the target area.
    4. $\text{Level } 3$: Returns most recent statewide cases.
* **Highlighted Innovation:** Deterministic `[SPEAK]` block extraction decouples natural spoken conversational answers for voice TTS from structured tabular markdown data displayed in the UI.

---

#### 🌟 Feature 2: Hybrid Multilingual Vector RAG with IDF Filtering & Cross-Encoder Reranking
* **Primary Route:** `/console`, `/ask`, `/cases/{id}`
* **Source Files:** `backend/app/pipeline/tools/rag.py`, `embedder_bge.py`, `reranker_bge.py`
* **Architecture & Mechanics:**
  - **Dense Arm:** `BAAI/bge-m3` generates 1024-dimensional normalized embeddings indexed with pgvector HNSW.
  - **Lexical Arm:** Stemmed document frequency filtering in PostgreSQL (`narrative_lexeme_df`) drops non-informative boilerplate tokens ($\text{DF} > 20\%$) and dynamically constructs selective conjunction queries.
  - **Fusion:** Merges dense and lexical candidate lists via Reciprocal Rank Fusion (RRF, $k=60$).
  - **Reranker:** Joint neural cross-attention via `BAAI/bge-reranker-v2-m3` scores semantic candidate pairs.
  - **Security Gate:** Post-reranking clearance check withholds sensitive narratives for protected crimes (POCSO, sexual offenses) if user clearance is below Level 3.
* **Highlighted Innovation:** True dual-language capability supporting 100,000 English and 100,000 native Kannada narratives with zero vector index degradation.

---

#### 🌟 Feature 3: Spatio-Temporal Crime Risk Forecasting & Multi-Fold Rolling-Origin Validation
* **Primary Route:** `/forecast`
* **Source Files:** `backend/app/services/intelligence_service.py`, `frontend/src/routes/forecast.tsx`
* **Architecture & Mechanics:**
  - Discretizes geographic crime occurrences into a multi-resolution spatial grid ($0.01^\circ$ to $0.10^\circ$).
  - Computes non-linear risk scores combining log-damped volume density ($\max 50$) with 30-day recency-lift velocity ($\max 30$) over a base score of 20: $\text{RiskScore} \in [20, 99]$.
  - **Empirical Validation Engine:** Walk-forward rolling-origin backtesting across $K=6$ consecutive 30-day temporal folds.
  - Measures true Predictive Accuracy Index ($\text{PAI} = \text{HitRate}/\text{AreaShare}$) and Predictive Efficiency Index ($\text{PEI} = \text{Hits}/\text{Hits}_{\max}$) with 95% Wilson binomial confidence intervals.
* **Highlighted Innovation:** Honest transparency architecture displaying exact statistical caveats, sample density warnings, and baseline random comparisons directly on the operational dashboard.

---

#### 🌟 Feature 4: Real-Time Tactical Edge Video AI (YOLOv8s + ByteTrack + Assault/Crowd/Weapon Detection)
* **Primary Route:** `/ops-camera`
* **Source Files:** `model/inference/live_cctv.py`, `ai_camera/detect_video.py`, `api/routes/ops.py`
* **Architecture & Mechanics:**
  - Runs YOLOv8s object detection in an isolated background process communicating with the FastAPI backend.
  - Multi-object tracking via ByteTrack with an 8-state kinematic Kalman filter.
  - **Kinetic Assault Detection:** Computes pairwise Euclidean spatial proximity ($d < 80\,\text{px}$) and instantaneous frame velocities ($v > 6.0\,\text{px/frame}$) to detect violent physical altercations.
  - **Crowd & Vehicle Anomaly:** Real-time crowd surge monitoring ($\ge 4$ persons) and stalled vehicle detection ($v < 2.0\,\text{px/frame}$ for $\ge 3.0\,\text{s}$).
  - Dedicated firearm/weapon confidence thresholding ($\tau \ge 0.35$).
* **Highlighted Innovation:** Built-in low-latency MJPEG live-stream server broadcasting annotated bounding boxes and detection alert banners directly into browser `<img>` elements.

---

#### 🌟 Feature 5: Response Ops Predictive Fleet Readiness & Dynamic Green Wave Corridor
* **Primary Route:** `/ops-predictive`, `/ops-dispatch`, `/vision`
* **Source Files:** `backend/app/services/ops/risk_service.py`, `corridor_service.py`, `sim_service.py`
* **Architecture & Mechanics:**
  - Scores $\sim 1.1\,\text{km}$ operational risk zones by incident severity weights, density, and nocturnal peak hours ($20:00 - 04:00$).
  - Evaluates greedy optimal patrol allocation, computing estimated emergency response time savings via Haversine spherical geodesy.
  - **Dynamic Green Corridor Preemption:** Automatically flips all traffic signals along a dispatch route ($R \le 0.5\,\text{km}$) or near a moving unit ($R \le 0.3\,\text{km}$) to `GREEN`.
  - Subsampled 60-step discrete kinematic patrol simulation broadcasting live telemetry over WebSockets.
* **Highlighted Innovation:** Graceful fallback resilience allowing the tactical map and simulation panels to operate client-side from real historical crime density even when live backend WebSockets are offline.

---

#### 🌟 Feature 6: Network Intelligence, Criminal Ring Analysis & BFS Financial Money Trail
* **Primary Route:** `/network`
* **Source Files:** `backend/app/pipeline/tools/analytics.py`, `services/financial_service.py`, `forceGraph.ts`
* **Architecture & Mechanics:**
  - Builds bipartite person-case graphs with degree centrality metrics and shared-case association links.
  - **Financial BFS Money Trail (PS7):** Traverses account-to-account transactions up to 3 hops deep with minimum amount and suspicious flag filters.
  - Calculates aggregated total inflows, outflows, degrees, and flagged transaction counts per banking entity.
  - Custom browser-side force-directed physics engine balancing Hooke attractive spring forces with Coulomb repulsive electrostatic forces.
* **Highlighted Innovation:** Graph seed normalization preventing duplicate seed nodes when resolving numerical IDs vs textual suspect names.

---

#### 🌟 Feature 7: Multimodal Hands-Free Gesture Navigation & Biometric Face Absence Auto-Lock
* **Primary Route:** Statewide (Shell)
* **Source Files:** `frontend/src/lib/vision/`, `HandsFreeLayer.tsx`, `FacePresenceController.tsx`
* **Architecture & Mechanics:**
  - Browser-local WASM execution powered by `@mediapipe/tasks-vision 0.10.18` (zero video frames transmitted over network).
  - Tracks 21 3D hand landmarks; calculates index-thumb pinch metrics ($d < 0.065$) to trigger simulated DOM click events.
  - Exponential Moving Average (LERP, $\alpha=0.35$) eliminates hand jitter for smooth cursor targeting.
  - **Biometric Security Auto-Lock:** Continuously monitors officer face presence; automatically locks the console and blurs all sensitive PII if the officer is absent for $\ge 15$ seconds, appending an audit record to the tamper-evident log.
* **Highlighted Innovation:** Seamless fusion of gesture events into the universal voice copilot bus (`satyam:run-task`), enabling unified hands-free tactical control.

---

#### 🌟 Feature 8: Autonomous Voice Screen Agent with Bilingual Speech (Sarvam AI)
* **Primary Route:** Statewide (Shell)
* **Source Files:** `backend/app/pipeline/screen_agent.py`, `frontend/src/components/Shell.tsx`, `taskBus.ts`
* **Architecture & Mechanics:**
  - Listens to voice commands in English or Kannada via Sarvam Saaras v3 STT or Web Speech API.
  - LLM planner (Gemini $\to$ Groq cascade) or deterministic rule parser maps natural commands to structured UI actions across all 14 screens.
  - Type-safe parameter coercion validates data domains and sanitizes actions against an approved manifest.
  - Dynamic sample sentinel resolution (`__SAMPLE_PERSON__`, `__SAMPLE_DISTRICT__`) populates real RLS-scoped data for vague requests.
  - Speaks synthesized confirmations in high-fidelity Kannada or English using Sarvam Bulbul v2 (`anushka` voice model).
* **Highlighted Innovation:** Bidirectional action-result feedback loop (`satyam:screen-ready` and `satyam:task-result`) ensuring the assistant speaks the ground truth of applied UI actions.

---

#### 🌟 Feature 9: Smart Investigation Board with AI Scene Generation & Multi-Algorithm Layout Engines
* **Primary Route:** `/board`
* **Source Files:** `backend/app/services/board_brain.py`, `frontend/src/lib/boardLayout.ts`, `board.tsx`
* **Architecture & Mechanics:**
  - Embeds full tldraw v5.1.1 design canvas with shapes, arrows, notes, freehand drawing, and image exports.
  - **AI Scene Synthesis:** Natural language prompt is classified into 8 diagram schemas (evidence board, crime network, timeline, mind map, flowchart, org chart, money trail, location map).
  - Generates typed entities (suspects, victims, weapons, locations, accounts) and semantic relationships.
  - Automatic layout selection combining Sugiyama hierarchical DAG algorithms (`@dagrejs/dagre`), ELK radial/force engines (`elkjs`), and an 80-iteration repulsive bounding-box collision resolver.
* **Highlighted Innovation:** Incremental snapshot merging allowing investigators to add new evidence nodes to an existing investigation board without visual collisions or state resets.

---

#### 🌟 Feature 10: Person 360 Forensic Dossier & Height-Grid Mugshot Lightbox
* **Primary Route:** `/dossier`, `/profile/:personId`
* **Source Files:** `backend/app/services/dossier_service.py`, `frontend/src/routes/dossier.tsx`
* **Architecture & Mechanics:**
  - Consolidated investigative dossier screen restricted to Level 4+ senior officers.
  - Multi-angle forensic face cards (front, left profile, right profile) rendered with calibrated height-grid scale lines and lightbox zoom.
  - Structured aggregation of crime history timelines, family relationships, verified aliases, and known criminal associates.
  - Financial intelligence table detailing bank accounts, wallet balances, and risk compliance flags.
* **Highlighted Innovation:** High-speed client prefetching caching all persona records on initial mount for zero-latency investigative browsing.

---

#### 🌟 Feature 11: Socio-Demographic Correlation Analysis & Social Risk Index (SRI)
* **Primary Route:** `/socio`
* **Source Files:** `backend/app/services/intelligence_service.py`, `frontend/src/routes/socio.tsx`
* **Architecture & Mechanics:**
  - Joins actual Karnataka census and economic indicators from `district_socio_economic_indicators`.
  - Computes Pearson correlation coefficients ($r$) between district crime rates and literacy rates, urbanization percentages, and income indices.
  - Calculates district Social Risk Index (SRI) combining logarithmic crime volume and repeat-accused densities.
  - Interactive multi-variable scatter plots with dynamic linear regression trend overlays.
* **Highlighted Innovation:** Grounded data integrity replacing placeholder indicators with real socio-economic tables.

---

#### 🌟 Feature 12: Cryptographic Tamper-Evident SHA-256 Audit Hash Chain
* **Primary Route:** `/audit`
* **Source Files:** `backend/app/core/audit.py`, `backend/app/api/routes/audit.py`, `audit.tsx`
* **Architecture & Mechanics:**
  - Records every natural language query, SQL execution, admin policy modification, and security alert.
  - Appends rows sequentially with recursive SHA-256 hash chains: $H_k = \text{SHA-256}(H_{k-1} \,\|\, \text{Payload}_k)$.
  - Serialized via PostgreSQL transaction advisory locks (`pg_advisory_xact_lock(728311042)`) to eliminate race conditions.
  - Committed in an isolated database transaction ensuring audit persistence even during client network disconnects.
  - L4 admin verification endpoint traverses the entire ledger to mathematically prove zero history tampering.
* **Highlighted Innovation:** Single-document verification scoping allowing sealed digital files to be verified independently without disruption from legacy demo forks.

---

#### 🌟 Feature 13: Certified Document Translation, Digital Sealing & Verification
* **Primary Route:** `/documents`
* **Source Files:** `backend/app/services/document_service.py`, `frontend/src/routes/documents.tsx`
* **Architecture & Mechanics:**
  - Secure portal for uploading official police documents (FIRs, charge sheets, memos) up to 20 MB.
  - Magic-byte validation protecting against malicious file format spoofing.
  - Neural text extraction (`pypdf`) and multi-engine translation (Sarvam Mayura v1 / Llama-3.3-70B) into certified Kannada.
  - Appends document SHA-256 digests directly to the immutable audit hash chain.
  - **OpenType Kannada Shaping:** Renders translated documents through the browser print engine to ensure accurate complex Kannada conjunct glyph rendering (`ಕ್ + ಷ = ಕ್ಷ`).
* **Highlighted Innovation:** Zero server-side file persistence—maintains absolute privacy by processing document streams in-memory without disk writes.

---

#### 🌟 Feature 14: Dynamic On-The-Fly Kannada Translation & Bilingual LLM Enrichment
* **Primary Route:** Statewide
* **Source Files:** `frontend/src/lib/i18n.tsx`, `backend/app/api/routes/settings.py`
* **Architecture & Mechanics:**
  - 500+ static Kannada UI dictionary entries (`i18n.tsx`) covering navigation, labels, and system messages.
  - Categorical database translator (`tData`) covering 41 districts, 1,120 police stations, and crime classifications.
  - **Dynamic On-The-Fly (OTF) Translation:** Batches dynamic backend ML strings (forecast alert reasons, fairness notes, backtest explanations) to `/settings/db-source/translate`.
  - 2-phase offline LLM lexicon enrichment caching translated UI keys in local storage.
* **Highlighted Innovation:** Language toggle authority where header EN/KN buttons govern both visual text and voice TTS synthesis without erratic auto-detection drift.

---

#### 🌟 Feature 15: Fine-Grained RBAC / ABAC Security Matrix & Multi-Tier PII Masking
* **Primary Route:** Statewide
* **Source Files:** `backend/app/core/rbac.py`, `core/masking.py`, `db/rls.py`, `admin.tsx`
* **Architecture & Mechanics:**
  - Formal mapping of 14 Karnataka State Police ranks across 4 Clearance Levels (L1 to L4) and 4 Jurisdictional Scopes (Station, District, Range, State).
  - PostgreSQL Row-Level Security (`fn_scope_ok`) enforced via transaction-local session GUCs.
  - Multi-tier PII masking: bullet-masks civilian names (`A. ████`) and coarsens geographic coordinates ($1.1\,\text{km}$ truncation) for officers below Level 3.
  - Strict protection rules for sensitive crimes (POCSO, sexual offenses, atrocities) requiring L3/L4 clearance for narrative body exposure.
  - Admin access control portal with policy override capabilities and anti-lockout safeguards.
* **Highlighted Innovation:** Dual-mode security engine distinguishing between cloud deployments and least-privilege non-owner local database enforcement (`DB_SOURCE=local`).

---

#### 🌟 Feature 16: Neobrutalist UI Design System, 13 Dynamic Themes & Motion Physics
* **Primary Route:** Statewide
* **Source Files:** `frontend/src/lib/theme.ts`, `viewTransition.ts`, `LandingThree.tsx`, `index.css`
* **Architecture & Mechanics:**
  - Striking neobrutalist police command aesthetic featuring high-contrast borders, sharp shadows, and theme tokens.
  - 13 switchable theme palettes (KSP Khaki, Tactical Dark, Neon Amber, Cyber Terminal, Emerald, Crimson, etc.).
  - Circular reveal theme transitions powered by the native browser View Transitions API.
  - Interactive Three.js particle morphing brain on the landing page driven by a 9,000-particle kinetic velocity physics simulation.
  - Accessible contrast ratios ($> 14:1$) in compliance with operational tactical control room standards.
* **Highlighted Innovation:** Seamless integration of low-overhead client-side read caching (`readCache.ts`) eliminating duplicate redundant network calls across screen navigations.

---

### 32.3 Architectural Integrity & Verification Protocol

The 16 core features and mathematical formulations documented above are verified against live unit tests, RLS security barriers, and AST guardrails:

```bash
# Backend Test Suite (55 unit & regression tests)
cd backend && pytest tests/ -v

# Forecast Backtesting Verification
pytest tests/test_forecast_backtest.py -v

# Document Translation & Sealing Integration
pytest tests/test_documents.py -v

# Frontend Static & Invariant Checks
cd frontend
node --experimental-strip-types scripts/check-download.mjs
node --experimental-strip-types scripts/check-translated-pdf.mjs
node --experimental-strip-types scripts/check-languages.mjs
node --experimental-strip-types scripts/check-rail-dock.mjs
node --experimental-strip-types scripts/check-ghost-mascot.mjs
```

All algorithms operate within the strict ethical parameters of the Satyam mission: **100% synthetic data**, **zero individual-guilt prediction**, **deterministic human-in-the-loop validation**, and **uncompromising cryptographic audit transparency**.

