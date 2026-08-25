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

---

## 1. Project Overview

Satyam is a **bilingual (English + Kannada), voice-enabled conversational AI** for Karnataka State Police crime intelligence. An officer asks a question in natural language — typed or spoken — and Satyam:

1. Auto-detects language, routes intent, runs a **grounded** answer pipeline (Text-to-SQL, RAG, analytics)
2. Composes a **cited, spoken-summary** answer streamed token-by-token over SSE
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
| Brain LLM (alt) | GPT-4o | OpenAI | User-selectable |
| Fallback LLM | Llama-3.3-70B | Groq | Auto-fallback |
| Board AI | Gemini / Groq / OpenAI | Configurable | Scene generation |
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
│  Gemini/Groq/OpenAI  │  Sarvam TTS/STT  │  PostgreSQL + pgvector        │
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
| Brain alt | GPT-4o (OpenAI) | Optional, `openai_llm.py` adapter |
| Fallback LLM | Groq Llama-3.3-70B | Always Groq, not configurable |
| SQL LLM | Gemini 2.5 Flash | Default |
| SQL alt | qwen3-coder-next | Ollama Cloud |
| Board AI | Configurable | Gemini / Groq / OpenAI — per `boardEngine` setting |
| Embedder | BGE-M3 (local, FP16) | Sole embedder, 1024-dim |
| Reranker | bge-reranker-v2-m3 (local) | ~2.4 GB combined |
| TTS | Sarvam Bulbul v2 (`anushka`) | `POST /voice/tts` · 22.05 kHz · input trimmed to 480 chars on a sentence boundary |
| STT | Sarvam Saaras v3 | `POST /voice/stt` |
| Translation | Sarvam Mayura v1 | EN↔KN |
| Voice fallback | Bhashini | Free |
| YOLO | YOLOv8s (COCO) | `model/yolov8s.pt`; optional `model/gun.pt` |

### 6.1 Engine Selection

Three settings in `EngineSettings` (stored in `localStorage`):
- `brainEngine` — `gemini | groq | openai | local` — powers the chat brain
- `sqlEngine` — `gemini | qwen3-coder-next | local` — powers Text-to-SQL
- `boardEngine` — `gemini | groq | openai` — powers the Board AI scene generator
- `copilotStt` — `browser | sarvam` — voice copilot engine, drives **both** its mic (STT) and spoken replies (TTS) (default: `browser`)
- `copilotPlanner` — `llm | rule` — copilot screen-agent planner: `llm` uses the brain (Gemini→Groq cascade), `rule` uses the deterministic keyword planner (default: `llm`)
- `voiceBackend` — `sarvam | google | webspeech` — TTS engine for voice replies

The Settings → Models tab shows each provider as a card with configured/unconfigured badge fetched from `GET /settings/db-source/models` (returns booleans only — never API keys). The copilot STT picker is a two-button selector independent of `voiceBackend`.

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
2. `POST /api/board/generate` → Gemini (or Groq/OpenAI per `boardEngine` setting)
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
/network              PS2: People / Financial Links / Rings (3 tabs)
/trends               PS3: Overview / Time Series / MO Clusters / Seasonal
/socio                PS4: Socio-Economic Dashboard
/profile/:personId    PS5: Offender dossier
/forecast             PS8: Early Warning + Forecast Risk Grid
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
| `BRAIN_ENGINE` | `gemini` | `gemini \| groq \| openai` |
| `SQL_ENGINE` | `gemini` | `gemini \| qwen3-coder-next` |
| `VOICE_BACKEND` | `sarvam` | `sarvam \| google \| bhashini` |
| `GEMINI_API_KEY` | `""` | Gemini 2.5 Flash |
| `GROQ_API_KEY` | `""` | Groq fallback |
| `OPENAI_API_KEY` | `""` | ChatGPT (gpt-4o) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model name |
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
| Board AI | Gemini / Groq / OpenAI | Local Ollama |
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
| B2 | Board AI `brain_engine` field forwarded from frontend request — chosen engine (Gemini/Groq/OpenAI) is used instead of always Gemini |
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
      ├─ LLM call (Gemini/Groq/OpenAI) with full CAPABILITY MANIFEST
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
| `_llm_extract()` | Calls Gemini/Groq/OpenAI with richer schema |
| `_style_node()` | Maps `entity_kind` → tldraw shape + color + size |
| `_style_edge()` | Maps relationship `kind` → dash style + color |
| `apply_layout()` | 6 layout engines: ring, timeline, tree, radial, grid, hierarchical |
| `_no_overlap()` | 80-iteration iterative push — guarantees no two nodes collide |
| `detect_conflicts()` | Regex scan for contradictions → adds ⚠ warning nodes |
| `merge_into_snapshot()` | Reads existing tldraw store, deduplicates, merges incrementally |
| `keyword_fallback()` | Zero-LLM deterministic scene from keywords |
| `generate_scene()` | Orchestrates all above with Gemini→Groq→OpenAI→keyword cascade |

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

**Multi-LLM fallback cascade:** Gemini → Groq → OpenAI → `keyword_fallback()`. Partial enrichment on batch failure — still useful.

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
