# Satyam — Complete Architecture & Technical Documentation

> **Project:** Satyam — Bilingual Voice-Enabled Crime Intelligence AI
> **Event:** Datathon 2026 · KSP × hack2skill
> **Stack:** Python 3.11 · FastAPI · PostgreSQL 16 + pgvector · React 19 · TanStack Start
> **Last updated:** 2026-06-24 · v4.0

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

---

## 1. Project Overview

Satyam is a **bilingual (English + Kannada), voice-enabled conversational AI** for Karnataka State Police crime intelligence. An officer asks a question in natural language — typed or spoken — and Satyam:

1. Auto-detects language, routes intent, runs a **grounded** answer pipeline (Text-to-SQL, RAG, analytics)
2. Composes a **cited, spoken-summary** answer streamed token-by-token over SSE
3. Enforces **RBAC/ABAC** (14 KSP ranks, 4 clearance levels) + **Postgres Row-Level Security**
4. Appends every query to a **SHA-256 hash-chained tamper-evident audit log**
5. Can **speak answers in Kannada** via Sarvam Bulbul v3 TTS and navigate screens by voice
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
| TTS | Sarvam Bulbul v3 | Sarvam AI | Primary voice output |
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
| Themes | 6 professional + 8 legacy | `data-theme` on `<html>` |

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
│  Live Ops │ Predictive │ Dispatch │ Camera  (12 sidebar routes)          │
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
| `narratives` | `narrative_id INT` | `case_id FK`, `language` (en/kn), `body`, `embedding vector(1024)` |
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
| TTS | Sarvam Bulbul v3 | `POST /voice/tts` |
| STT | Sarvam Saaras v3 | `POST /voice/stt` |
| Translation | Sarvam Mayura v1 | EN↔KN |
| Voice fallback | Bhashini | Free |
| YOLO | YOLOv8s (COCO) | `model/yolov8s.pt`; optional `model/gun.pt` |

### 6.1 Engine Selection

Three settings in `EngineSettings` (stored in `localStorage`):
- `brainEngine` — `gemini | groq | openai | local` — powers the chat brain
- `sqlEngine` — `gemini | qwen3-coder-next | local` — powers Text-to-SQL
- `boardEngine` — `gemini | groq | openai` — powers the Board AI scene generator
- `copilotStt` — `browser | sarvam` — copilot microphone transcription engine (default: `browser`)
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

### 8.2 Four-Tier PII Masking

| Clearance | Effect |
|-----------|--------|
| L4 | Full access |
| L3 | PROTECTED crime victim masked |
| L2 | All names masked, coords coarsened |
| L1 | L2 + PROTECTED narratives hidden |

**PROTECTED:** POCSO, RAPE, MOLESTATION, DOWRY DEATHS, SC/ST ATROCITIES, SEXUAL HARASSMENT, STALKING, ASSAULT ON WOMEN, KIDNAPPING OF WOMEN AND GIRLS.

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

### 10.1 Four Dedicated Sidebar Routes

| Route | Screen | Component |
|-------|--------|-----------|
| `/operations` | Live Ops Map | `LiveOperationsMap` — dark CARTO heatmap; always shows real crime density base layer |
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

### 14.1 Route Map (12 sidebar routes + landing)

```
/                     Animated landing page (tldraw Brain particle + Three.js)
/login                Demo login — 14 KSP ranks (grouped by access tier)
/console              PS1: Chat + Results Canvas (resize divider, CaseDrawer)
/network              PS2: People / Financial Links / Rings (3 tabs)
/trends               PS3: Overview / Time Series / MO Clusters / Seasonal
/socio                PS4: Socio-Economic Dashboard
/profile/:personId    PS5: Offender dossier
/forecast             PS8: Early Warning + Forecast Risk Grid
/reports              Report builder + PDF print
/audit                Hash-chain audit log
/transcripts          Conversations + Voice transcripts
/operations           Live Ops Map (full-bleed dark CARTO)
/ops-predictive       Predictive Deployment
/ops-dispatch         Dispatch & Green Corridor
/ops-camera           Camera Review + YOLO MJPEG feed
/board                Investigation Board (tldraw design canvas)
/dossier              Person 360 Dossier (L4+ only)
/admin                Access Control (L4+ only)
/about                Project info
```

### 14.2 Key Components

| Component | Purpose |
|-----------|---------|
| `Shell.tsx` | Nav rail (18 routes) + voice router + language toggle + `isAdmin` gate + `HandsFreeLayer` mount |
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
| `DATABASE_URL` | local asyncpg | Primary DB |
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
| `001_init.sql` | Legacy v1 schema |
| `002_schema_v2.sql` | Core schema — cases, persons, narratives, users, audit_log, RLS |
| `003_users_extend.sql` | full_name, email, photo_b64 on users |
| `004_demo_dossier.sql` | 5 isolated demo_dossier_* tables |
| `005_boards.sql` | boards + board_snapshots |
| `006_admin_access_control.sql` | created_by, clearance_override, scope_override on users |

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

**`_rule_plan()`** — deterministic fallback extractor:
- Detects route by keyword scoring (longer keyword = stronger match, EN + KN)
- Extracts: crime types, Karnataka districts, person names, numbers (1-30 → horizon)
- Per-route action builder: forecast gets `set_crime_type` + `set_district` + `set_horizon`; network gets `search_seed` + `set_depth`; etc.
- Works with zero LLM — demo mode, 429, offline

### 21.4 Frontend Changes

**`Shell.tsx`** — the main voice handler now calls `planVoiceAction()` instead of dispatching raw free-text tasks. Both the explicit-route branch AND the generic data-query branch go through the agent (agent returns `answer:true` for pure data questions → falls back to `answerInCopilot`).

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
| `POST` | `/voice/agent` | AgentRequest → AgentPlan · Requires CHAT permission |

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

### 23.2 Runtime LLM Enrichment (Settings → Translation)

**`enrichDictWithLLM(onProgress)`** — Phase 1:
- Static manifest of 271 strings from all `t("...")` calls in source
- Sends to `POST /settings/translate` (Groq Llama-3.1-70B) in batches of 20
- Filters: no Kannada script input, no pure numbers/symbols
- Merges into live DICT immediately; cached in `localStorage["satyam.translation.llm-cache"]`

**`enrichDataWithLLM(onProgress)`** — Phase 2:
- `GET /settings/data-values` → fetches unique station names (200), districts (60), crime types (100), statuses (30) from DB
- Translates with context hints ("Translate these Karnataka police station names…")
- Cached in `localStorage["satyam.data-translations"]`
- `tData()` reads this cache so station names display in Kannada on all screens

**`POST /settings/translate`** — backend endpoint (Groq Llama-3.1-70B):
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

| Gesture | On map screens (`/console`, `/operations`, `/ops-*`) | On `/board` | Everywhere else |
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
