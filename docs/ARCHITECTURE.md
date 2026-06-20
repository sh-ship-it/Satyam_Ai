# Satyam — Complete Architecture & Technical Documentation

> **Project:** Satyam — Bilingual Voice-Enabled Crime Intelligence AI
> **Event:** Datathon 2026 · KSP × hack2skill
> **Stack:** Python 3.11 · FastAPI · PostgreSQL 16 + pgvector · React 19 · TanStack Start
> **Last updated:** 2026-06-21 · v1.5

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
10. [Response Ops Module](#10-response-ops-module-enable_response_opstrue)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Bilingual Support — EN + KN](#12-bilingual-support--en--kn)
13. [API Reference Summary](#13-api-reference-summary)
14. [Configuration & Environment](#14-configuration--environment)
15. [Deployment](#15-deployment)
16. [Two-Phase Roadmap](#16-two-phase-roadmap)
17. [Bug Fixes Applied](#17-bug-fixes-applied)

---

## 1. Project Overview

Satyam is a **bilingual (English + Kannada), voice-enabled conversational AI** for Karnataka State Police crime intelligence. An officer asks a question in natural language — typed or spoken — and Satyam:

1. Auto-detects English vs Kannada, routes the intent, and runs a **grounded** answer pipeline:
   - **Text-to-SQL** → LLM proposes SQL → `sqlglot` guard enforces safety → read-only RLS-scoped execution. In demo/keyless mode, a deterministic `rule_sql.py` generator runs instead of the LLM stub.
   - **RAG** → BGE-M3 embeds the query → pgvector ANN search → bge-reranker-v2-m3 cross-encoder rerank.
   - **Analytics** → crime hotspots, ego/link networks, trend clustering, financial money trails.
2. Composes a **cited answer** streamed token-by-token over SSE.
3. Enforces **RBAC/ABAC** (14 KSP ranks, 4 clearance levels) + **Postgres Row-Level Security** on every lane.
4. Appends every query to a **SHA-256 hash-chained tamper-evident audit log**.
5. Can **speak the answer in Kannada** via Sarvam Bulbul v3 TTS and navigate to any screen by voice command.
6. All UI strings are fully bilingual (custom i18n DICT + `tData()` categorical lookup).

All data is **100% synthetic** — no real FIRs or PII are stored anywhere.

---

## 2. Tech Stack

### 2.1 Backend

| Category | Technology | Version / Notes |
|----------|-----------|-----------------|
| Language | Python | 3.11+ |
| Web framework | FastAPI | Async, SSE streaming |
| ORM | SQLAlchemy (async) + asyncpg | Async Postgres driver |
| Database | PostgreSQL 16 | Primary store |
| Vector search | pgvector 0.8.x | HNSW index, cosine similarity, `vector(1024)` |
| Cache | Redis | Conversation state |
| Auth | PyJWT (HS256) | 14 KSP rank claims |
| SQL safety | sqlglot | Parse + validate + rewrite every LLM-generated SQL |
| NL→SQL fallback | `rule_sql.py` (custom) | Deterministic regex+ILIKE generator |
| Structured logging | structlog | JSON format |
| Settings | pydantic-settings | Env-file based config |

### 2.2 AI / Model Services

| Role | Model / Service | Provider | Notes |
|------|----------------|----------|-------|
| Brain LLM | **Gemini 2.5 Flash** | Google | Default |
| Fallback LLM | **Llama-3.3-70B-Versatile** | Groq | Low-latency fallback |
| Text-to-SQL option | **qwen3-coder-next:cloud** | Ollama Cloud | 80B MoE / 3B active |
| Embeddings | **BGE-M3** | BAAI (local) | 1024-dim, FP16; sole embedder |
| Reranking | **bge-reranker-v2-m3** | BAAI (local) | FP16 cross-encoder |
| TTS | **Sarvam Bulbul v3** | Sarvam AI | Primary voice output |
| STT | **Sarvam Saaras v3** | Sarvam AI | Primary voice input |
| Translation | **Sarvam Mayura v1** | Sarvam AI | EN↔KN |
| Voice fallback | **Bhashini** | Govt of India | Free, no credit cap |
| **YOLO detection** | **YOLOv8s** | Ultralytics (COCO) | `model/yolov8s.pt`; weapon model optional at `model/gun.pt` |

### 2.3 Frontend

| Category | Technology | Notes |
|----------|-----------|-------|
| Framework | React 19 | |
| Router / SSR | TanStack Start + TanStack Router | File-based routing |
| Build tool | Vite + Bun | |
| Styling | Tailwind CSS v4 | CSS custom properties for themes |
| Maps | Leaflet + leaflet.heat | Heatmap, pins, grid layers |
| i18n | Custom (`src/lib/i18n.tsx`) | 200+ EN→KN keys; no react-i18next |
| Categorical translation | `tData()` + `kn-data.json` | crime_type, status, district (41), role, gender |
| Themes | 6 professional + 8 legacy | `data-theme` attribute on `<html>` |

### 2.4 Infrastructure

| Component | Technology |
|-----------|-----------|
| Containerisation | Docker + docker-compose |
| Cloud DB | Neon (PostgreSQL 16, pgvector 0.8.0) |
| Local DB | PostgreSQL 17 + pgvector 0.8.2 |
| GPU (local demo) | NVIDIA RTX 4070 8 GB VRAM (BGE-M3 + reranker FP16) |

---

## 3. System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          OFFICER'S BROWSER                                    │
│                                                                               │
│  Console │ Network │ Forecast │ Trends │ Profile │ Reports │ Audit            │
│  Live Ops │ Predictive │ Dispatch │ Camera Review  (4 separate routes)        │
│                                                                               │
│                  TanStack Router · Shell.tsx (Voice Router)                   │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │  HTTPS / REST / SSE / WS
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            FASTAPI BACKEND                                    │
│  /auth  /chat(SSE)  /cases  /map  /network  /financial  /api/*  /health/*    │
│  /api/ops/*  (feature-flagged, ENABLE_RESPONSE_OPS=true)                     │
│                                                                               │
│  Grounded Pipeline: guardrails → router → orchestrator → tools → compose     │
│                                                                               │
│  Model Layer   │  Voice Layer   │  Data Layer                                │
│  Gemini 2.5    │  Sarvam v3     │  PostgreSQL 16 + pgvector                  │
│  Groq fallback │  Bhashini      │  Redis (conversation state)                │
│  BGE-M3 local  │  Web Speech    │  audit_log (SHA-256 hash-chain)             │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │  subprocess (global Python)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     YOLO INFERENCE PROCESS                                    │
│  model/inference/live_cctv.py  — runs as a separate Python process           │
│  • YOLOv8s + ByteTrack tracking on preloaded video (loops)                   │
│  • Detects: fight (proximity+speed), crowd (N≥4), vehicle stall, weapon      │
│  • MJPEG stream on :8089 → browser <img> shows live annotated boxes          │
│  • POST /api/ops/detect/notify with JWT → Incident Review Queue              │
└──────────────────────────────────────────────────────────────────────────────┘
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
| `cases` | `case_id INT` | `fir_number`, `fir_year`, `crime_type`, `crime_category`, `legal_code`, `fir_type`, `status`, `district`, `station_name`, `report_date`, `incident_date`, `latitude`, `longitude` |
| `persons` | `person_id INT` | `name`, `gender`, `age`, `district` |
| `case_persons` | `(case_id, person_id, role)` | role: Accused/Victim/Complainant/Witness/Arrested/IO |
| `narratives` | `narrative_id INT` | `case_id FK`, `language` (en/kn), `body`, `embedding vector(1024)` |
| `audit_log` | `audit_id SERIAL` | `at`, `user_id`, `action`, `query_text`, `row_hash` (SHA-256 chain) |

### 4.2 PS4/PS7 Extension Tables

| Table | Purpose |
|-------|---------|
| `district_socio_economic_indicators` | Real `literacy_rate`, `urbanization_percent`, `income_index` per district |
| `financial_accounts` | Synthetic bank/wallet accounts linked to persons |
| `financial_transactions` | Synthetic transactions with `pattern_flag`, `is_suspicious`, `case_id` FK |

### 4.3 Response Ops Tables (`ops_*` prefix)

| Table | Purpose |
|-------|---------|
| `ops_patrol_units` | callsign, lat/lng, status (IDLE\|EN_ROUTE\|ON_SCENE\|OFFLINE) |
| `ops_traffic_signals` | junction_id, lat/lng, state (NORMAL\|GREEN) |
| `ops_risk_zones` | grid_key, risk_score, risk_label |
| `ops_patrol_suggestions` | risk_zone_id → patrol_id, distance_km, response_improve_sec |
| `ops_incident_dispatches` | patrol→scene route, status lifecycle |
| `ops_cameras` | camera metadata (lat/lng per camera) |
| `ops_incident_review_queue` | AI-detected candidates awaiting human review; confidence, candidate_type |

### 4.4 RLS

`fn_scope_ok()` gates every case/narrative row to the officer's station/district/range/state scope via `app.*` GUCs set per-request.

### 4.5 Row Counts

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
  router.py            ← step 2: intent classification
  slots.py             ← step 2b: cross-turn slot merging
  orchestrator.py      ← step 3: fan-out to tools, compose/render, SSE emit
  prompts.py           ← ROUTER_SYSTEM, SQL_SYSTEM, ANSWER_SYSTEM
  tools/
    text_to_sql.py     ← LLM → SQL; demo_mode shortcut; 0-row recovery
    sql_guard.py       ← sqlglot: single SELECT, 6-table allow-list, LIMIT 200
    rule_sql.py        ← deterministic NL→SQL (demo/keyless/recovery)
    rag.py             ← BGE-M3 embed → pgvector ANN → reranker
    analytics.py       ← hotspot, ego_network, station_breakdown
```

### 5.2 Demo-mode / Keyless Operation

When `GEMINI_API_KEY` and `GROQ_API_KEY` are both empty, `demo_mode = True`:
- `rule_sql.build_sql()` generates deterministic SQL (ILIKE district/crime, year filter)
- Passes through `sql_guard.sanitize()` unchanged
- `_render_grounded()` composes Markdown tables from real DB rows
- Zero API keys required for a working demo with a seeded DB

### 5.3 Text-to-SQL Safety

1. LLM proposes SQL (or `rule_sql` generates it deterministically)
2. `sql_guard.sanitize()` → sqlglot AST: single SELECT, allow-list tables, cap LIMIT 200
3. `session.execute()` under RLS → `fn_scope_ok()` gates rows to officer's scope
4. `_mask_rows()` → PII columns redacted for clearance < L3

---

## 6. Model Layer

| Component | Model | Notes |
|-----------|-------|-------|
| Brain LLM | Gemini 2.5 Flash | Chat, routing, composition |
| SQL LLM | Gemini 2.5 Flash (default) or qwen3-coder-next | Selectable via Settings panel |
| Fallback LLM | Groq Llama-3.3-70B | `get_fallback_llm()` |
| Embedder | BGE-M3 (local, FP16) | Always local; sole embedder; 1024-dim |
| Reranker | bge-reranker-v2-m3 (local, FP16) | ~2.4 GB combined with embedder |
| TTS | Sarvam Bulbul v3 | `POST /voice/tts` |
| STT | Sarvam Saaras v3 | `POST /voice/stt` |
| Translation | Sarvam Mayura v1 | `POST /voice/translate` |
| Voice fallback | Bhashini | Free, govt |
| YOLO (ops) | YOLOv8s (COCO, 21.5 MB) | `model/yolov8s.pt`; run by global Python, not backend venv |

**Registry (`app/models/registry.py`):** All factories use `@lru_cache` — per-request engine overrides via Settings panel are efficient.

---

## 7. Voice Pipeline

### 7.1 Overview

```
Officer speaks → MediaRecorder (recorder.ts) → POST /voice/stt
  → detectLang() → Sarvam Saaras v3 (or Bhashini fallback)
  → transcript → Shell.tsx voice router
      ├─ navigation command → navigate()
      └─ query → window.dispatchEvent("satyam:voice-send")
                   → console.tsx sendMessage({ speak: true })
  → Normal pipeline → composed answer
  → speakViaSarvam(text, lang, rate) → POST /voice/tts → audio plays
  → conversation mode: auto-re-activate mic on "done"
```

Language auto-detection: counts Kannada Unicode chars (U+0C80–U+0CFF); >20% → "kn".

### 7.2 Two Independent Microphones

| Mic | Location | Purpose | Engine |
|-----|----------|---------|--------|
| **Copilot mic** | Top-right orb in `Shell.tsx` | Screen navigation + data Q&A | User-selectable: Browser or Sarvam |
| **Chat-box mic** | Red mic button in console chat textarea | Dictation into chat input only | Always Browser Web Speech API |

### 7.3 Copilot Mic Engine Toggle

Users switch in **Settings → Models → "Voice copilot mic (Speech-to-Text)"**:

| Mode | Engine | Characteristics |
|------|--------|-----------------|
| **Browser** *(default)* | Web Speech API | Lowest latency · live captions · good English |
| **Sarvam** | Sarvam Saaras v3 | Best Kannada accuracy · utterance-based · ~1.5s wait |

Stored in `EngineSettings.copilotStt` (`"browser" | "sarvam"`) in `localStorage`, independent of `voiceBackend`.

### 7.4 Chat-Box Dictation

`console.tsx` owns a `chatRecRef` + `chatDictating` state. Results go only to the chat textarea `input` state. Copilot orb and `listening` state are never touched.

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
| PS2 | Network (People / Financial / Rings) | `/network/ego`, `/api/network/rings`, `/api/network/case/{id}`, `/financial/money-trail` | ✅ Full |
| PS3 | Trends & Patterns (4 tabs) | `/api/trends`, `/api/trends/seasonal`, `/api/mo/clusters` | ✅ Full |
| PS4 | Socio Dashboard | `/api/socio/demographics`, `/api/socio/correlation`, `/api/socio/risk-index` | ✅ Full (real Pearson) |
| PS5 | Offender Profile + Browse | `/api/persons/{id}/profile`, `/api/persons/{id}/timeline`, `/api/offenders` | ✅ Full |
| PS6 | Similar Cases + Timeline | `/api/cases/{id}/similar`, `/api/cases/similar/search`, `/api/cases/{id}/timeline` | ✅ Full |
| PS7 | Financial Intelligence | `/financial/money-trail` (BFS over financial_accounts/transactions) | ✅ Full |
| PS8 | Early Warning & Forecast | `/api/forecast/hotspots`, `/api/forecast/alerts`, `/api/forecast/backtest` | ✅ Full (real PAI backtest) |
| **OPS** | **Response Ops** (4 dedicated routes) | `/api/ops/*` — risk zones, dispatch, green corridor, camera+YOLO | ✅ Full |

---

## 10. Response Ops Module (`ENABLE_RESPONSE_OPS=true`)

Feature-flagged, fully isolated. Activated via `ENABLE_RESPONSE_OPS=true` in `backend/.env`. All ops tables are `ops_*` prefixed; no existing table is altered. Open to all authenticated officers (no rank gate).

### 10.1 Four Dedicated Sidebar Routes (v1.5 — was single tabbed screen)

| Route | Screen | Component |
|-------|--------|-----------|
| `/operations` | Live Ops Map | `LiveOperationsMap` — full-bleed dark CARTO heatmap, no internal tabs |
| `/ops-predictive` | Predictive Deployment | `PredictivePanel` — forecast heat map + patrol suggestion cards |
| `/ops-dispatch` | Dispatch & Green Corridor | `DispatchPanel` — patrol dispatch + live GPS animation + signal corridor |
| `/ops-camera` | Camera Review | `ReviewPanel` — MJPEG live annotated feed + incident review queue |

Each route registered in `routeTree.gen.ts` at all required locations (imports, route constants, 3 interface maps, 3 type unions, `declare module`, `RootRouteChildren`, `rootRouteChildren`). Voice navigation in `Shell.tsx` `SCREEN_ROUTES` covers all four in English and Kannada.

### 10.2 Risk Scoring (Phase 1 — Predictive Deployment)

- `GRID_SIZE=0.01` (~1.1 km cells), `LOOKBACK_DAYS=365`
- Score = `incident_score (max 40)` + `density_score (max 30)` + `time_score (max 30)`
- Labels: Critical ≥75 / High ≥55 / Medium ≥30 / Low
- 5-min debounce prevents flooding on `?refresh=true`
- Frontend: instant patrol-car placement (no animation) — 🚓 drops at hotspot; map zooms via `fitSignal`

### 10.3 Dispatch Simulation (Phase 2)

- OSRM driving route (free public API); straight-line fallback with error key
- Simulation runs as an `asyncio.Task` — walks route coords at `TICK_SEC=0.8s`
- Broadcasts `PATROL_LOCATION` events over `/api/ops/ws` WebSocket
- Status lifecycle: `IDLE → EN_ROUTE → ON_SCENE (6s hold) → COMPLETED → IDLE`

### 10.4 Green Corridor (Phase 3)

- `ACTIVATION_RADIUS_KM=0.3` — per-tick signal activation on route
- `reset_all()` on arrival → `SIGNAL_RESET` broadcast → map dots go gray

### 10.5 Camera Review + YOLO Live Detection (Phase 4 — v1.5 redesign)

#### Backend subprocess model

```
Backend FastAPI (backend/.venv Python)
  └─ POST /camera/start
       ├─ _resolve_python()  — probes for a Python with cv2+ultralytics
       │   (backend venv lacks them; global C:\Program Files\Python310 has both)
       ├─ _free_port(8089)   — picks a guaranteed-free port (no "address in use")
       ├─ creates JWT via create_access_token() for the YOLO process to authenticate
       └─ Popen([global_python, live_cctv.py, --video, --camera, --no-display, --mjpeg-port])
            └─ _drain() thread reads stdout continuously (prevents pipe-buffer freeze)

YOLO Process (model/inference/live_cctv.py — global Python with ultralytics)
  ├─ Loads model/yolov8s.pt (COCO)
  ├─ Optional weapon model: auto-loads model/gun.pt if present
  ├─ Loops video file (cv2.CAP_PROP_POS_FRAMES=0 on end-of-file)
  ├─ Runs YOLOv8 track() with ByteTrack on each frame
  ├─ Detection logic:
  │   ├─ Fight:   ≥2 people within 80px AND speed > 6px/frame → conf 0.65–0.92
  │   ├─ Crowd:   ≥4 people in frame → conf 0.55–0.90
  │   ├─ Vehicle: stalled ≥3s → conf ramp 0.6–0.95
  │   └─ Weapon:  class name in {gun,pistol,rifle,knife,...} OR dedicated gun.pt model
  ├─ Per-type 15s cooldown prevents alert spam
  ├─ notify() → POST /api/ops/detect/notify with JWT (fire-and-forget thread)
  └─ MJPEG server (ThreadingHTTPServer, port 8089)
       ├─ Annotates frame: res.plot() + people count overlay + alert banner (2.5s)
       ├─ JPEG-encodes and pushes to _FrameBuffer (Condition-based, thread-safe)
       └─ GET /stream → multipart/x-mixed-replace; boundary=--frameboundary
```

#### Frontend: ReviewPanel

- **`<img src="http://localhost:8089/stream">`** — displays the live annotated MJPEG feed with bounding boxes, track IDs, and detection banners
- Stream port returned from `/camera/start` and `/camera/status`; stored in `streamPort` state
- "Connecting…" overlay auto-clears after 2.5s grace period (browser `onLoad` unreliable for multipart streams)
- Detection Feed — populates from WebSocket `INCIDENT_CANDIDATE` events (fight, crowd, weapon, vehicle_anomaly)
- Incident Review Queue — Confirm → files case + auto-dispatches nearest patrol; Reject → marks rejected

#### Confidence tiers

| Confidence | Action |
|-----------|--------|
| < 0.5 | Ignored |
| 0.5 – 0.8 | MEDIUM — queued for review |
| ≥ 0.8 | HIGH — auto-flagged in queue |


### 10.6 Dataset-Driven Frontend (ops screens never go blank)

| Screen | Data source | Works without ops backend? |
|--------|-------------|---------------------------|
| **Predictive Deployment** | `intelligence.getForecastAlerts()` + `getForecastHotspots()` → fallback `api.mapHotspots()` | ✅ Yes |
| **Live Operations Map** | `api.mapHotspots({mode:"by_crime"})` heatmap always; ops overlay additive | ✅ Heatmap always |

### 10.7 CrimeMap.tsx Ops Extensions

| Prop | Purpose |
|------|---------|
| `darkTiles` | CARTO dark base tiles (Predictive + Dispatch maps) |
| `lockBounds` | Suppresses auto-fitBounds during active simulation |
| `fitSignal` | Increment to trigger one-shot zoom to current route |
| `liveMarker` | Single animated 🚓 divIcon; pans map once on placement |
| `routePath` | Blue polyline (dispatch route) |
| `corridorPath` | 3-layer green glow (active signal corridor) |
| `signals` | Junction dots: green=active, gray=normal |

---

## 11. Frontend Architecture

### 11.1 Route Map

```
/                     Landing page
/login                Demo login — 14 KSP ranks
/console              PS1: Chat + Results Canvas
/network              PS2: People graph / Financial Links / Rings (3-tab)
/trends               PS3: Overview / Time Series / MO Clusters / Seasonal (4-tab)
/socio                PS4: Socio-Economic Dashboard
/profile/:personId    PS5: Offender dossier
/forecast             PS8: Early Warning + Forecast Risk Grid
/reports              Report builder + PDF print
/audit                Hash-chain audit log
/transcripts          Conversations + Voice transcripts (2-tab)
/operations           Live Ops Map (full-bleed, no tabs)
/ops-predictive       Predictive Deployment (NEW — separate route)
/ops-dispatch         Dispatch & Green Corridor (NEW — separate route)
/ops-camera           Camera Review + YOLO live feed (NEW — separate route)
/about                Project info
```

### 11.2 Key Components

| Component | Purpose |
|-----------|---------|
| `Shell.tsx` | Nav rail (12 routes) + voice command router + language toggle + theme picker |
| `CrimeMap.tsx` | Leaflet map with all ops props (see §10.7) |
| `CaseDrawer.tsx` | Sliding case detail (Summary / Persons / Timeline / Similar / Map) |
| `FinancialLinksPanel.tsx` | SVG money-trail graph (PS7) |
| `RingsPanel.tsx` | Criminal ring detection cards (PS2) |
| `ops/PredictivePanel.tsx` | Forecast heat map + instant patrol-car placement |
| `ops/DispatchPanel.tsx` | Patrol dispatch + live GPS simulation + green corridor |
| `ops/ReviewPanel.tsx` | MJPEG annotated feed + incident review queue |
| `ops/LiveOperationsMap.tsx` | Full-bleed dark ops map with ops overlay |
| `ProfileMenu.tsx` | User profile + logout (SSR-safe: localStorage read in useEffect) |
| `SettingsDialog.tsx` | Live engine overrides + DB source picker |
| `ThemePicker.tsx` | 6 professional + 8 legacy colour themes |

### 11.3 Key Libraries

```
src/lib/
  i18n.tsx              Custom i18n: I18nProvider, useI18n(), useT(), DICT (200+ EN→KN)
  tData.ts              tData(field, value, lang) — categorical DB value lookup
  conversationStore.ts  Chat history for Transcripts screen
  pdf/conversationPdf.ts exportConversationPdf() — branded print-to-PDF
  api/
    client.ts           REST + SSE streamChat()
    intelligence.ts     PS2–PS8 typed wrappers
    financial.ts        financial.moneyTrail() for PS7
    responseOps.ts      Ops typed client (opsFetch, openOpsSocket)
                        cameraStart() returns stream_port; cameraStatus() returns stream_port
  voice/
    tts.ts              speakViaSarvam(), stripMarkdown()
    recorder.ts         MediaRecorder STT + startSttSession()
    lang.ts             detectLang(), resolveLang()
locales/
  kn-data.json          Kannada lookup: 9 fields, 150+ entries (all 41 districts)
```

### 11.4 Hydration Fix (ProfileMenu)

`useState` initializers that read `localStorage` (`loadStoredAccounts`, `loadActiveId`, `getCachedUser`) were replaced with empty initial state + `useEffect` population to prevent SSR/client hydration mismatch.

---

## 12. Bilingual Support — EN + KN

### 12.1 Four-Layer Architecture

| Layer | Scope | Implementation |
|-------|-------|---------------|
| 1. Static UI strings | Nav, buttons, headers | `i18n.tsx` DICT — 200+ EN→KN entries |
| 2. Categorical DB values | crime_type, status, district, role, gender | `tData(field, value, lang)` + `kn-data.json` |
| 3. Case narratives | `narratives.body` | `?lang=kn` → backend prefers `language='kn'` row |
| 4. AI-generated answers | Chat responses | `lang_directive` injected into ANSWER_SYSTEM prompt |

---

## 13. API Reference Summary

### 13.1 Core

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/auth/login` | JWT login, 14 KSP ranks |
| `POST` | `/chat/stream` | SSE: token, citation, blocked, done events |
| `GET` | `/cases` | RLS-scoped list |
| `GET` | `/cases/{id}?lang=` | Full case + persons + narrative (lang-aware) |
| `GET` | `/cases/search?q=` | Unified person + case autocomplete |
| `POST` | `/map/hotspots` | Lat/lng heat points |
| `POST` | `/map/station-breakdown` | Station FIR table |

### 13.2 Intelligence (`/api/`)

| Path | Clearance | Notes |
|------|-----------|-------|
| `GET /offenders` | L2+ | Browse all offenders |
| `GET /persons/{id}/profile` | L2+ | Risk score + MO fingerprint + associates |
| `GET /persons/{id}/timeline` | L1 | Crime history |
| `GET /cases/{id}/similar` | L1 | RAG similarity |
| `POST /cases/similar/search` | L1 | Description-based search |
| `GET /trends` | L1 | Series + QoQ/YoY deltas |
| `GET /trends/seasonal` | L1 | True lift % vs monthly baseline |
| `GET /mo/clusters` | L1 | MO clustering |
| `GET /socio/demographics` | L3+ | Age/gender/district (real JOIN) |
| `GET /socio/correlation` | L3+ | Real Pearson vs seeded indicators |
| `GET /socio/risk-index` | L2+ | Social risk score per district |
| `GET /forecast/hotspots` | L2+ | Risk grid with PAI scoring |
| `GET /forecast/alerts` | L2+ | Early warning alerts |
| `GET /forecast/backtest` | L1 | PAI hit-rate validation |
| `GET /network/rings` | L2+ | Criminal ring detection |
| `GET /network/case/{id}` | L1 | Case co-accused graph |
| `GET /network/person/{id}` | L1 | Person ego-graph |
| `POST /financial/money-trail` | L2+ | BFS money-trail graph |

### 13.3 Voice & Health

| Path | Clearance | Notes |
|------|-----------|-------|
| `POST /voice/tts` | L1 | Text → audio |
| `POST /voice/stt` | L1 | Audio → transcript |
| `POST /voice/translate` | L1 | MT EN↔KN |
| `GET /health` | None | Liveness + demo_mode flag |
| `GET /health/models` | None | Resolved model class names |
| `GET /health/data` | Session | Row counts + `seeded` flag |

### 13.4 Response Ops (`/api/ops/` — `ENABLE_RESPONSE_OPS=true`, all ranks)

| Path | Notes |
|------|-------|
| `GET /api/ops/health` | Liveness probe |
| `GET /api/ops/risk-zones` | Scored grid zones; `?refresh=true` forces recompute |
| `GET /api/ops/suggestions` | Pending patrol pre-positioning suggestions |
| `POST /api/ops/suggestions/{id}/{action}` | accept \| dismiss |
| `GET /api/ops/patrols` | All patrol units |
| `POST /api/ops/dispatch` | Create dispatch (nearest or explicit patrol) |
| `POST /api/ops/dispatch/{id}/simulate` | Start live GPS animation |
| `GET /api/ops/dispatch/{id}/state` | Polling fallback for latest position |
| `GET /api/ops/dispatch/active` | All mid-simulation dispatches |
| `POST /api/ops/dispatch/simulate-all` | Start simulation for every pending dispatch |
| `POST /api/ops/dispatch/stop-all` | Cancel all simulations |
| `GET /api/ops/signals` | All traffic signal states |
| `GET /api/ops/corridor/state` | Current green-signal count |
| `POST /api/ops/corridor/reset` | Deactivate corridor, restore all signals |
| `POST /api/ops/detect/notify` | YOLO process posts detection candidate |
| `GET /api/ops/cameras` | Camera list |
| `GET /api/ops/review-queue` | Pending CCTV review items |
| `POST /api/ops/review-queue/{id}/confirm` | File case + auto-dispatch |
| `POST /api/ops/review-queue/{id}/reject` | Reject candidate |
| `POST /api/ops/camera/start` | Launch YOLO subprocess (returns `stream_port`) |
| `POST /api/ops/camera/stop` | Kill YOLO subprocess |
| `GET /api/ops/camera/status` | Running status + `stream_port` |
| `WS /api/ops/ws?token=` | Live event stream (PATROL_LOCATION, SIGNAL_GREEN, INCIDENT_CANDIDATE, …) |

---

## 14. Configuration & Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | local asyncpg URL | Primary DB |
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
| `VITE_API_BASE_URL` | `http://localhost:8000` | Frontend base URL |
| `VECTOR_TYPE` | `vector` | `vector` (local) \| `halfvec` (Neon) |
| `ENABLE_RESPONSE_OPS` | `false` | `true` to activate Response Ops module |
| `YOLO_PYTHON` | auto-detected | Override the Python interpreter for YOLO subprocess |
| `YOLO_MJPEG_PORT` | `8089` | Preferred MJPEG stream port (auto-adjusts if busy) |

**Demo mode:** when both `GEMINI_API_KEY` and `GROQ_API_KEY` are empty, `demo_mode = True` — `rule_sql.py` + `_render_grounded()` handle everything. No API keys required.

---

## 15. Deployment

### 15.1 Docker

```bash
cp .env.example .env   # fill GEMINI_API_KEY (optional for demo)
docker compose up --build
# frontend → http://localhost:3000  |  backend → http://localhost:8000/docs
```

### 15.2 Local Dev

```bash
# Backend
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
docker compose up db redis -d
psql "$DATABASE_URL" -f migrations/002_schema_v2.sql
python -m seed.load_seed
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && bun install && bun run dev

# YOLO inference (requires global Python with ultralytics)
# pip install ultralytics opencv-python httpx   ← in global Python, not backend venv
# The backend auto-detects the correct interpreter and launches it on Start.
```

### 15.3 Database Tracks

| Track | `DATABASE_URL` | Dataset |
|-------|---------------|---------|
| **Neon cloud** | Neon pooler + `ssl=require` | 60% (~192 MB) |
| **Local PG17** | `localhost:5432/satyam` | 100% |

---

## 16. Two-Phase Roadmap

| Layer | Phase 1 (Hackathon demo) | Phase 2 (Sovereign on-prem) |
|-------|--------------------------|------------------------------|
| Brain / chat | Gemini 2.5 Flash | Sarvam-M / Sarvam 30B |
| Text-to-SQL | Gemini 2.5 Flash + qwen3-coder-next | Qwen-Coder local |
| Voice | Sarvam → Bhashini fallback | Bhashini + Sarvam |
| Embeddings | BGE-M3 (local GPU) | BGE-M3 (local) |
| YOLO detection | YOLOv8s (COCO) + optional gun.pt | Custom-trained KSP-specific model |
| Hosting | External cloud OK (synthetic data) | Fully on-prem / India-hosted |

**Sovereignty principle:** external clouds are used only with synthetic data. For live KSP data, every component must run on-premises or India-hosted infrastructure.

---

## 17. Bug Fixes Applied

| ID | Description | Fix |
|----|-------------|-----|
| D1 | Socio-demographics filters silently ignored | Rewrote queries to JOIN persons→case_persons→cases |
| D2 | Socio-correlation fabricated indicators | Now JOINs real `district_socio_economic_indicators`; Pearson in Python |
| D3 | Trends QoQ delta split by list index not time | Collapses to `{period: count}` dict, sorts chronologically |
| D4 | Seasonal fake lift% | CTE computes `(cnt / AVG(cnt) - 1) * 100` vs real monthly baseline |
| D5 | Demo-mode echo corrupts all chat lanes | `rule_sql.py` + `_render_grounded()` + demo_mode shortcircuit |
| D6 | Console "backend unreachable" for blocked/empty | Three distinct branches: transport error / RBAC block / empty result |
| D8 | Forecast patrol always 18:00 | Uses `incident_time TEXT`: `split_part(incident_time, ':', 1)::int` |
| D9 | Similar-cases anchors to case #1 on no match | Returns `matches=[]`; deterministic `ORDER BY (ILIKE) DESC` |
| OPS-1 | Hydration error (ProfileMenu localStorage in render) | `useState` empty init + `useEffect` population |
| OPS-2 | YOLO subprocess launched with backend venv Python (no cv2) | `_resolve_python()` probes for a Python with cv2+ultralytics |
| OPS-3 | Video stops after 3s (pipe buffer fills) | `_drain()` daemon thread continuously reads subprocess stdout |
| OPS-4 | Empty SATYAM_TOKEN → 401 on every notify | Backend generates JWT via `create_access_token()` at launch |
| OPS-5 | YOLO only detected stationary vehicles (wrong for fight video) | Added fight (proximity+speed), crowd (N≥4), weapon class detection |
| OPS-6 | MJPEG server port conflict → port not listening → black feed | `_free_port()` picks guaranteed-free port; stored + returned from status API |
| OPS-7 | `onLoad` never fires for multipart streams → overlay stuck | Auto-clear overlay after 2.5s grace period via `setTimeout` |
| OPS-8 | Browser shows raw unannotated video (no bounding boxes) | MJPEG stream serves `res.plot()` annotated frames; `<video>` replaced with `<img>` |
| OPS-9 | Operations screen had internal tab bar after split to separate routes | `operations.tsx` rewritten to render only `LiveOperationsMap` |
| OPS-10 | New ops routes showed "Hello /ops-predictive!" (stale Vite cache) | `node_modules/.vite` cleared; server restarted with `--force` |

---

## Appendix — File Tree (Abridged)

```
satyam/
├── backend/
│   ├── app/
│   │   ├── api/routes/    auth, chat, cases, map, network, financial,
│   │   │                  intelligence, reports, audit, voice, settings, health, ops
│   │   ├── core/          rbac, masking, audit, security
│   │   ├── db/            models (ORM), ops_models, rls, session
│   │   ├── models/        registry + api/(gemini,groq,sarvam,bhashini,ollama_cloud)
│   │   │                          + local/(embedder_bge,reranker_bge,stubs)
│   │   ├── pipeline/      guardrails, router, slots, orchestrator, prompts
│   │   │   └── tools/     text_to_sql, sql_guard, rule_sql, rag, analytics
│   │   ├── schemas/       auth, chat, case, intelligence, map, network, financial, ops
│   │   └── services/      case, chat, intelligence, financial, map, network, report
│   │       └── ops/       risk_service, routing_service, sim_service,
│   │                      corridor_service, ws_manager
│   └── migrations/        002_schema_v2.sql
│
├── model/
│   ├── yolov8s.pt          COCO YOLOv8s weights (21.5 MB)
│   ├── gun.pt              (optional) weapon-trained model — place here to enable
│   ├── requirements.txt    ultralytics, opencv-python, httpx, numpy
│   └── inference/
│       ├── live_cctv.py    Main detector: fight/crowd/weapon/vehicle + MJPEG server
│       └── notify.py       POST candidates to /api/ops/detect/notify
│
├── frontend/src/
│   ├── routes/            console, network, forecast, trends, socio, profile.$personId,
│   │                      reports, audit, transcripts, login, index, about,
│   │                      operations, ops-predictive, ops-dispatch, ops-camera
│   ├── components/        Shell, CaseDrawer, CrimeMap(+ops-props),
│   │                      FinancialLinksPanel, RingsPanel, SimilarCaseSearch,
│   │                      ThemePicker, SettingsDialog, ProfileMenu
│   │   └── ops/           PredictivePanel, DispatchPanel, ReviewPanel,
│   │                      LiveOperationsMap, DemoSimPanel
│   ├── lib/
│   │   ├── i18n.tsx        Custom i18n DICT (200+ EN→KN keys)
│   │   ├── tData.ts        Categorical DB value translation
│   │   ├── api/            client.ts, intelligence.ts, financial.ts, responseOps.ts
│   │   └── voice/          tts.ts, recorder.ts, lang.ts
│   └── locales/            kn-data.json (150+ entries), en.json
│
└── docs/ARCHITECTURE.md   ← this file
```

---

*Last updated: 2026-06-21 · Satyam v1.5 · Datathon 2026 KSP × hack2skill*
