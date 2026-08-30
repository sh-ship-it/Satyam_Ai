# Satyam (सत्यम्) — Conversational AI for Police Crime Intelligence

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev)
[![TanStack Router](https://img.shields.io/badge/TanStack-Router%20%26%20Start-FF4154?style=flat&logo=react-query&logoColor=white)](https://tanstack.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791?style=flat&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Bun](https://img.shields.io/badge/Bun-1.0%2B-FBF0DF?style=flat&logo=bun&logoColor=black)](https://bun.sh)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com)

> **ಸತ್ಯಮೇವ ಜಯತೇ (Satyameva Jayate) — "Truth alone triumphs"**
>
> Built for **Datathon 2026 · Karnataka State Police (KSP) × hack2skill**.
> Satyam is a bilingual (**English + Kannada**), voice-enabled conversational AI workspace designed for real-time police intelligence, investigations, crime analytics, and operational response.

---

## 📑 Table of Contents

1. [Overview & Core Philosophy](#-overview--core-philosophy)
2. [Key Capabilities & Modules](#-key-capabilities--modules)
3. [System Architecture](#-system-architecture)
4. [Tech Stack](#-tech-stack)
5. [Prerequisites & Requirements](#-prerequisites--requirements)
6. [Environment Configuration (`.env`)](#-environment-configuration-env)
7. [Quick Start Guide](#-quick-start-guide)
   - [Option A: Docker Compose (Full Stack)](#option-a-docker-compose-full-stack-recommended)
   - [Option B: Local Bare-Metal Development](#option-b-local-bare-metal-development)
8. [Database Architecture & Migrations](#-database-architecture--migrations)
   - [Dual Database Strategy (Local vs Neon Cloud)](#dual-database-strategy-local-vs-neon-cloud)
   - [Sequential Migration Order](#sequential-migration-order)
   - [Seeding Data & Storage Budget](#seeding-data--storage-budget)
9. [Frontend Application & Routes](#-frontend-application--routes)
10. [Demo Personas & Role Switcher](#-demo-personas--role-switcher)
11. [Testing & Verification](#-testing--verification)
12. [Troubleshooting & FAQs](#-troubleshooting--faqs)
13. [Project Directory Layout](#-project-directory-layout)
14. [Ethics, Safety & DPDP Act Compliance](#-ethics-safety--dpdp-act-compliance)

---

## 🌟 Overview & Core Philosophy

Police officers and investigators handle massive volumes of First Information Reports (FIRs), arrest records, crime narratives, geospatial patterns, and financial trails. **Satyam** bridges natural language to structured police databases and unstructured narratives with zero hallucination risk.

Officers ask natural language questions (typed or spoken in Kannada or English). Satyam:
1. **Auto-detects language and routes intent** to a deterministic, grounded analytical lane.
2. **Executes guarded queries**:
   - **Text-to-SQL**: Multi-layer AST parsing and allow-listing via `sqlglot` against PostgreSQL with automatic Row-Level Security (RLS) scoping.
   - **Dense Vector RAG**: High-dimensional semantic search over case narratives using local BGE-M3 embeddings, HNSW index, and cross-encoder reranking (`bge-reranker-v2-m3`).
   - **Graph Analytics & Geospatial Clustering**: Link analysis, ego networks, hawala/mule accounts, and DBSCAN hotspot clustering.
3. **Composes cited, spoken answers**: Streams responses token-by-token over Server-Sent Events (SSE) along with a synthesized spoken summary audio readout.
4. **Maintains Zero-Trust Integrity**: Enforces strict 14-rank RBAC/ABAC and logs every transaction to a **cryptographic SHA-256 tamper-evident hash chain**.

> ⚠️ **Synthetic Data Notice**: All data shipped in this repository is **100% synthetic**. Satyam **never** predicts individual guilt and mandates a human-in-the-loop for every action.

---

## 🚀 Key Capabilities & Modules

| Module | Features & Capabilities | Route |
| :--- | :--- | :--- |
| **🎙️ Bilingual Voice Agent** | Auto language detection (English/Kannada), speech-to-text (Sarvam Saaras v3 / Bhashini), text-to-speech (Sarvam Bulbul v2 `anushka` / Bhashini / Google Neural2), hands-free screen navigation & action execution. | `/console`, `/ask` |
| **🛡️ Guarded Text-to-SQL** | Natural language to PostgreSQL engine with strict AST validation (`sqlglot`), auto-LIMIT enforcement, allow-listed schema, and station/district RLS injection. | `/console` |
| **🧠 Vector RAG & FIR Search** | Hybrid dense semantic retrieval over case narratives with 1024-dim BGE-M3 embeddings (`vector` / `halfvec`), HNSW indexing, and cross-encoder reranking. | `/console`, `/documents` |
| **🕸️ Link Network & Hawala Tracking** | Interactive multi-hop entity graph (@xyflow/react, NetworkX, PageRank, Louvain community detection), crime ring discovery, co-accused mapping, and mule account tracking. | `/network` |
| **🗺️ Tactical Heatmaps & Hotspots** | Geospatial Leaflet heatmap, DBSCAN/K-Means hotspot clustering, crime trend temporal analysis, and predictive patrol allocation. | `/map`, `/trends`, `/forecast` |
| **👁️ Tactical Vision & CCTV Review** | Real-time tactical dashboard, patrol unit tracking, traffic signal monitoring, CCTV FOV simulation, and YOLOv8 crowd/fight/weapon detection. | `/vision`, `/ops-camera` |
| **🚨 Response Operations** | Real-time predictive dispatch, patrol unit deployment, and emergency green corridor traffic signal synchronization. | `/ops-predictive`, `/ops-dispatch` |
| **📋 Investigation Board** | Freeform investigative canvas powered by **tldraw v5.1.1** with AI scene generation, auto-layout engines (Dagre & ELK.js), and evidence cards. | `/board` |
| **👤 Person 360 Dossier** | High-risk suspect 360° profiling, 3-angle mugshot viewer (front/left/right), aliases, full FIR history, associated bank accounts, and family relations. | `/dossier`, `/profile/$personId` |
| **📜 Document Translation & Seal** | Bilateral Kannada ↔ English FIR / legal document translation, PDF text extraction (`pypdf`), and SHA-256 cryptographic tamper-evident sealing. | `/documents` |
| **🔒 Zero-Trust Security & Audit** | 14 KSP hierarchical ranks (Constable to DGP, L1–L4), Postgres Row-Level Security, and cryptographic SHA-256 tamper-evident hash-chained audit logging. | `/audit`, `/admin` |

---

## 🏗️ System Architecture

### Grounded Router-First Pipeline

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                   OFFICER'S WORKSPACE                   │
                    │        Voice Input (STT)  /  Text Query (EN / KN)       │
                    └────────────────────────────┬────────────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       FASTAPI BACKEND                                       │
│                                                                                             │
│  1. Safety Guardrails ──▶ 2. Intent & Language Router (English / Kannada)                   │
│                                           │                                                 │
│             ┌─────────────────────────────┼─────────────────────────────┐                   │
│             ▼                             ▼                             ▼                   │
│      [ Text-to-SQL ]               [ Vector RAG ]             [ Graph & Geospatial ]        │
│   LLM ──▶ sqlglot Guard       BGE-M3 (1024-d) Embeddings      NetworkX Link Analysis        │
│   ──▶ RLS-Scoped Postgres     ──▶ HNSW Index (pgvector)       ──▶ DBSCAN Hotspots           │
│   ──▶ Read-Only Query         ──▶ Cross-Encoder Rerank        ──▶ Hawala / Mule Money Trail │
│             │                             │                             │                   │
│             └─────────────────────────────┼─────────────────────────────┘                   │
│                                           ▼                                                 │
│                     3. Grounded Answer & Citation Composer                                  │
│                                           │                                                 │
│                     4. Cryptographic SHA-256 Hash-Chained Audit Log                         │
│                                           │                                                 │
│                     5. Token Streaming (SSE) + Synthesized Spoken Audio (TTS)                │
└───────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                            │
                                            ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │               REACT 19 + TANSTACK FRONTEND              │
                    │   Streaming Answers · Evidence Cards · Spoken Audio     │
                    │   Interactive Maps · @xyflow Graphs · tldraw Canvas     │
                    └─────────────────────────────────────────────────────────┘
```

### Tri-Model Adaptive Engine Architecture

All AI models interface through an abstract adapter layer (`backend/app/models`):

| Capability | Hosted Lane (`MODEL_BACKEND=api`) | Local / Sovereign Lane (`MODEL_BACKEND=local`) |
| :--- | :--- | :--- |
| **Brain / Orchestration** | **Gemini 2.5 / 3.5 Flash** (Primary) | **Qwen2.5-Coder / Llama-3.3** (vLLM / Ollama) |
| **Fallback LLM** | **Groq Llama-3.3-70B** (Instant Failover) | Local LLM fallback |
| **Text-to-SQL** | **Gemini 2.5 / 3.5 Flash** (or Ollama Cloud Qwen3) | **Qwen2.5-Coder-32B** |
| **Voice STT / TTS** | **Sarvam AI** (Bulbul v2 / Saaras v3) + **Bhashini** | **Whisper** + **Indic-Parler-TTS** |
| **Embeddings** | **BGE-M3 (1024-dim, FP16)** *(Sole embedder)* | **BGE-M3 (1024-dim, FP16)** *(Local CUDA)* |
| **Reranker** | **bge-reranker-v2-m3** *(Local Cross-Encoder)* | **bge-reranker-v2-m3** *(Local CUDA)* |
| **Vision / CCTV** | **YOLOv8s** (COCO + Threat Detection) | **YOLOv8s** (Local PyTorch / CUDA) |

---

## 💻 Tech Stack

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy (asyncio) + asyncpg, PostgreSQL 16 + pgvector, Redis 7, PyJWT, sqlglot, structlog, NetworkX, pypdf, Faker.
- **Frontend:** React 19, TanStack Start & Router, Vite, Tailwind CSS v4, Bun, tldraw v5.1.1, @xyflow/react v12, Leaflet + Leaflet.heat, Recharts, Lucide Icons, sonner, i18next.
- **AI & ML:** Gemini API (3.5/3.7/2.5 Flash), Groq API, Sarvam AI API, Bhashini API, Google Cloud Voice, FlagEmbedding / BGE-M3, HuggingFace Transformers, PyTorch, Ultralytics YOLOv8.
- **Infrastructure:** Docker, Docker Compose, PostgreSQL + pgvector, Redis, Neon Serverless PostgreSQL.

---

## 📦 Prerequisites & Requirements

Before setting up Satyam, ensure you have the following installed on your machine:

1. **Python 3.11+** (Tested on Python 3.11 and 3.12)
2. **Node.js (v18+)** OR **Bun (v1.0+)** (Bun recommended for fast installs)
3. **Docker & Docker Compose** (Required for Docker setup; optional for bare-metal setup)
4. **PostgreSQL 16+ with `pgvector` extension** (If running database locally without Docker)
5. **Redis 7+** (If running locally without Docker)
6. *(Optional)* **NVIDIA GPU with CUDA 12.1+** & 8GB+ VRAM (for running local BGE-M3 embeddings in FP16)

---

## ⚙️ Environment Configuration (`.env`)

Create your `.env` file in the root directory (or inside `backend/.env`):

```bash
cp .env.example .env
```

### Essential Environment Variables

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `APP_ENV` | Application environment (`development` or `production`). | `development` |
| `DATABASE_URL` | Runtime PostgreSQL connection for application. **Must connect as `satyam_app` role to enforce RLS.** | `postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam` |
| `SEED_DATABASE_URL` | Superuser/owner connection used **only** for migrations and seeding. | `postgresql+asyncpg://satyam:satyam@localhost:5432/satyam` |
| `LOCAL_DATABASE_URL` | Connection string used when selecting local database in settings. | `postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam` |
| `REDIS_URL` | Redis URL for session state and conversation caching. | `redis://localhost:6379/0` |
| `JWT_SECRET` | Secret key for signing officer JWT tokens. | `change-me-in-production` (dev only) |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins. | `http://localhost:3000,http://127.0.0.1:3000` |
| `ENABLE_RESPONSE_OPS` | Enable Response-Ops predictive dispatch and green corridor routes (`true`/`false`). | `true` |
| `ENABLE_VISION` | Enable Tactical Vision map and camera analysis routes (`true`/`false`). | `true` |
| `MODEL_BACKEND` | Model compute plane (`api` or `local`). | `api` |
| `BRAIN_ENGINE` | Primary LLM engine for orchestration and chat (`gemini` or `groq`). | `gemini` |
| `GEMINI_API_KEY` | Google Gemini API Key. | `AIzaSy...` |
| `GEMINI_MODEL` | Gemini model ID. | `gemini-3.5-flash-lite` |
| `GROQ_API_KEY` | Groq API Key for instant fallback brain. | `gsk_...` |
| `VOICE_BACKEND` | Primary voice engine (`sarvam`, `google`, or `bhashini`). | `sarvam` |
| `SARVAM_API_KEY` | Sarvam AI API Key for Bulbul v2 TTS & Saaras v3 STT. | `sk_...` |
| `BHASHINI_API_KEY` | Bhashini API Key (Govt of India free voice fallback). | *(Optional)* |
| `BHASHINI_USER_ID` | Bhashini User ID. | *(Optional)* |
| `GOOGLE_TTS_API_KEY` | Google Cloud Text-to-Speech API Key. | *(Optional)* |
| `MODEL_DEVICE` | Hardware device for local models (`cuda` or `cpu`). | `cuda` |
| `MODEL_FP16` | Halve VRAM with FP16 weights (`1` = enabled, `0` = disabled). | `1` |

> 💡 **Offline / Demo Mode**: If API keys (`GEMINI_API_KEY`, `SARVAM_API_KEY`, etc.) are left blank, Satyam automatically runs in **Deterministic Offline Demo Mode**, returning synthetic demo intelligence so you can evaluate the entire UI without spending API credits.

---

## 🚀 Quick Start Guide

### Option A: Docker Compose (Full Stack) [Recommended]

Docker Compose starts PostgreSQL (with `pgvector`), Redis, FastAPI backend, and Bun/Vite frontend in one command.

#### 1. Clone the repository and configure `.env`
```bash
git clone https://github.com/sh-ship-it/Satyam_Ai.git
cd Satyam
cp .env.example .env
```

#### 2. Start the stack
```bash
docker compose up --build
```
*Alternatively, use the Makefile shortcut:*
```bash
make up
```

#### 3. Run Database Migrations & Seed Synthetic Data
In a separate terminal, apply migrations and seed the database inside the container:
```bash
# Seed 100,000 synthetic FIR cases, stations, officers, persons & narratives
docker compose exec backend python -m seed.load_seed

# Seed Response-Ops units, corridors, cameras, and risk zones
docker compose exec backend python -m seed.init_ops

# Seed demo dossiers for Person 360 suspect investigations
docker compose exec backend python -m seed.load_demo_dossier

# Seed socio-economic indicators and financial tables
docker compose exec backend python -m seed.load_new_tables --db local

# Generate BGE-M3 embeddings & construct the HNSW vector index (Required for Vector RAG)
docker compose exec backend python -m seed.embed_narratives
```

#### 4. Access the Applications
- **Frontend Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Backend API & Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Alternative Redoc API Docs:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

### Option B: Local Bare-Metal Development

If you prefer running the backend and frontend directly on your host machine for development:

#### 1. Database & Redis Setup
Ensure PostgreSQL (with `pgvector` extension) and Redis are running locally.
```bash
# If using Docker for services only:
docker compose up -d postgres redis
```

#### 2. Backend Setup

```bash
cd backend

# Create and activate Python virtual environment
python -m venv .venv

# On Linux/macOS:
source .venv/bin/activate
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Windows (CMD):
.venv\Scripts\activate.bat

# Install PyTorch (CUDA wheel if you have an NVIDIA GPU, otherwise standard PyTorch):
# For CUDA 12.1:
pip install torch --index-url https://download.pytorch.org/whl/cu121
# Or CPU-only:
# pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install backend dependencies
pip install -r requirements.txt

# Configure backend environment
cp .env.example .env
```

#### 3. Apply Database Migrations & Seed Data

Apply migrations in sequential order against your PostgreSQL database:

```bash
# Apply migrations sequentially:
psql -U satyam -d satyam -f migrations/002_schema_v2.sql
psql -U satyam -d satyam -f migrations/003_add_ps4_ps7_tables.sql
psql -U satyam -d satyam -f migrations/003_users_extend.sql
psql -U satyam -d satyam -f migrations/004_demo_dossier.sql
psql -U satyam -d satyam -f migrations/005_boards.sql
psql -U satyam -d satyam -f migrations/006_admin_access_control.sql
psql -U satyam -d satyam -f migrations/008_local_app_grants.sql
psql -U satyam -d satyam -f migrations/010_narrative_vector_index.sql
psql -U satyam -d satyam -f migrations/011_ops_rls.sql
psql -U satyam -d satyam -f migrations/012_local_bilingual_rag.sql
```

Run seed scripts:
```bash
# 1. Load core synthetic dataset (stations, officers, cases, persons, narratives)
python -m seed.load_seed

# 2. Seed Response-Ops tables (units, dispatch events, cameras, corridors)
python -m seed.init_ops

# 3. Seed demo dossiers (suspect profiles, 3-angle photos, financial records)
python -m seed.load_demo_dossier

# 4. Seed socio-economic indicators and financial hawala/mule tables
python -m seed.load_new_tables --db local

# 5. Embed narratives with BGE-M3 and build HNSW index (Mandatory for RAG)
python -m seed.embed_narratives

# 6. Verify storage and quota budget
python -m app.core.storage
```

#### 4. Run Backend Server
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
*Backend is live at [http://localhost:8000](http://localhost:8000) (Swagger Docs at `/docs`).*

---

#### 5. Frontend Setup

In a new terminal:

```bash
cd frontend

# Install dependencies using Bun (recommended) or npm
bun install
# or: npm install

# Start Vite development server
bun run dev
# or: npm run dev
```

*Frontend is live at [http://localhost:3000](http://localhost:3000).*

---

#### 6. Optional: AI Camera & Vision Detection Module

To run the standalone YOLOv8 CCTV video stream detection module:

```bash
cd ai_camera
pip install -r requirements.txt
python detect_video.py --source 0 # or path/to/video.mp4
```

---

## 🗄️ Database Architecture & Migrations

### Dual Database Strategy (Local vs Neon Cloud)

Satyam is architected for dual operation:
1. **Local Sovereign Database**: Full 100,000 synthetic FIR records, full bilingual narrative embeddings (1024-dim `vector` in FP16), full GPU inference on-premise.
2. **Neon Cloud Database**: Serverless PostgreSQL with `pgvector` and connection pooling (`-pooler` endpoint support). Embedded with 1024-dim `halfvec` to stay comfortably within the 512 MB free tier quota.

### ⚠️ Critical Security Notice: Row-Level Security (RLS) Enforcement

| Role / URL | Connects As | `rolbypassrls` | Postgres RLS Status |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | `satyam_app` | `false` | **Enforced** (Station/District/State scoped) |
| `SEED_DATABASE_URL` | `satyam` / `neondb_owner` | `true` | **Bypassed** (Superuser used solely for seeding/migrations) |

> 🛡️ **Rule**: The live application MUST connect via `DATABASE_URL` using the least-privilege `satyam_app` role. `migrations/008_local_app_grants.sql` configures grants for `satyam_app`.

### Sequential Migration Order

Migrations in `backend/migrations/` must be applied in order:

```
migrations/
  ├── 002_schema_v2.sql               # Core schema (cases, persons, narratives, officers, stations)
  ├── 003_add_ps4_ps7_tables.sql      # Socio-economic indicators & financial money-trail tables
  ├── 003_users_extend.sql            # User authentication & KSP role extensions
  ├── 004_demo_dossier.sql            # Person 360 suspect dossier tables
  ├── 005_boards.sql                  # tldraw investigation board persistent scenes
  ├── 006_admin_access_control.sql    # RBAC/ABAC role switching and clearance levels
  ├── 008_local_app_grants.sql        # Least-privilege satyam_app user permissions
  ├── 010_narrative_vector_index.sql  # HNSW vector index on narratives.embedding
  ├── 011_ops_rls.sql                 # Row-Level Security policies for ops & surveillance tables
  └── 012_local_bilingual_rag.sql     # Bilingual English/Kannada vector retrieval functions
```

---

## 🖥️ Frontend Application & Routes

| Route | View Name | Description |
| :--- | :--- | :--- |
| `/` or `/console` | **Intelligence Console** | Main conversational interface with streaming responses, voice input/output, and citation chips. |
| `/ask` | **Ask Satyam (3D Backdrop)** | Immersive full-screen query portal with an interactive WebGL dotted globe (`cobe`). |
| `/board` | **Investigation Canvas** | Freeform investigation whiteboard with `tldraw v5.1.1`, AI scene layout, and evidence cards. |
| `/dossier` | **Person 360 Catalog** | Suspect index with risk level filtering, wanted badges, and demographic overviews. |
| `/profile/$personId` | **Suspect 360 Dossier** | Comprehensive profile with 3-angle mugshots, crime history, bank accounts, and family ties. |
| `/network` | **Network Link Analysis** | Graph analysis powered by `@xyflow/react` showing co-accused rings, money trails, and ego networks. |
| `/map` | **Tactical Geospatial Map** | Interactive Leaflet heatmap of crime incidents, station jurisdictions, and filtering. |
| `/vision` | **Tactical Surveillance & Vision** | Live patrol unit telemetry, traffic signal grid, CCTV FOV cones, and YOLO threat review. |
| `/ops-predictive` | **Predictive Patrolling** | ML-based deployment recommendations for high-risk zones and shifts. |
| `/ops-dispatch` | **Response Dispatch** | Real-time patrol unit dispatching and emergency green corridor traffic synchronization. |
| `/ops-camera` | **CCTV Incident Review** | Computer vision video review with automated bounding boxes (weapons, fights, crowds). |
| `/reports` | **Court-Ready Reports** | Structured intelligence report generator with verifiable data citations. |
| `/documents` | **Document Translation & Seal** | Bilingual FIR / legal document translation with cryptographic SHA-256 integrity seal. |
| `/audit` | **Tamper-Evident Audit Log** | Cryptographic hash-chained audit log explorer with live chain validation. |
| `/admin` | **Access Control Admin** | Role, rank, jurisdiction scope, and clearance level management (L4 officers only). |
| `/transcripts` | **Audio Logs & Transcripts** | Audio log repository with bilingual transcription playback. |
| `/news` | **OSINT Crime News** | Localized intelligence news feed with sentiment and category classification. |
| `/about` | **System Handbook & Architecture** | Complete interactive system architecture, performance reports, and model routing. |

---

## 👥 Demo Personas & Role Switcher

Satyam implements **14 hierarchical KSP ranks** mapped to **4 clearance levels**:

| Level | Rank Examples | Jurisdiction Scope | Allowed Capabilities | Demo Quick-Login |
| :--- | :--- | :--- | :--- | :--- |
| **L1** | Police Constable (PC), Head Constable (HC) | Assigned Police Station | Search cases in own station; basic queries; read-only access. | `constable_blr` |
| **L2** | Police Sub-Inspector (PSI), Police Inspector (PI) | Assigned Police Station | Case filing, suspect dossier viewing, local network links, CCTV review. | `psi_koramangala` |
| **L3** | Deputy SP (DySP), Superintendent of Police (SP) | Entire District / City | Cross-station crime ring analysis, predictive dispatch, reports generation. | `sp_bengaluru` |
| **L4** | IGP, ADGP, Director General of Police (DGP) | Statewide (Karnataka) | Statewide intelligence, green corridor authorization, audit log inspection, admin panel. | `dgp_karnataka` |

*To switch roles in development, use the role switcher in the user profile menu on the top-right header.*

---

## 🧪 Testing & Verification

### Running Backend Unit & Integration Tests

```bash
cd backend
pytest -q
```

To run integration tests (requires live database):
```bash
pytest -m integration
```

### Checking Cloud / Local Storage Budget
```bash
python -m app.core.storage
```
*Outputs current database storage consumption, table breakdowns, and remaining growth budget.*

### Frontend Code Quality
```bash
cd frontend
bun run lint      # Check linting rules
bun run format    # Format code with Prettier
```

---

## 🔧 Troubleshooting & FAQs

### 1. Windows Python Cython Import Issue (Recursion Limit)
**Issue:** Windows systems running Python 3.10/3.11 may hit recursion depth limits when importing `sentence_transformers` due to deeply nested Cython headers in `pandas`/`sklearn`.  
**Fix:** `app/main.py` explicitly sets `sys.setrecursionlimit(5000)` and pre-caches `pandas` and `sklearn` at the very top of the entrypoint.

### 2. CORS "Failed to Fetch" Error in Browser
**Issue:** Browser shows "Failed to fetch" on local dev.  
**Fix:** Browsers treat `http://localhost:3000` and `http://127.0.0.1:3000` as distinct origins. Ensure `CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000` in your `.env`.

### 3. RLS Scoping Returns All Rows or Zero Rows
**Issue:** Query returns all rows regardless of jurisdiction.  
**Fix:** Verify `DATABASE_URL` connects as `satyam_app` (least-privilege role). Connecting as `neondb_owner` or `postgres` superuser bypasses RLS policies (`rolbypassrls=true`).

### 4. Running Without API Keys (Offline Demo Mode)
**Question:** Can I run Satyam without Gemini, Groq, or Sarvam API keys?  
**Answer:** Yes! If API keys are omitted in `.env`, Satyam automatically engages its deterministic offline demo engine. All screens, maps, graphs, boards, and dossiers will function seamlessly.

---

## 📁 Project Directory Layout

```
Satyam/
├── README.md                 # Master Project Documentation & Quickstart
├── AGENTS.md                 # AI Assistant Directives & Coding Guidelines
├── DATABASE.md               # Detailed Database Schema & Storage Calculations
├── VISION.md                 # Tactical Vision & Response-Ops Specifications
├── Makefile                  # Build and orchestration shortcuts
├── docker-compose.yml        # PostgreSQL(pgvector) + Redis + Backend + Frontend
│
├── backend/                  # FastAPI Application Root
│   ├── app/
│   │   ├── api/routes/       # Endpoints (chat, cases, map, network, dossier, board, ops, audit, etc.)
│   │   ├── core/             # Security (JWT), RBAC/ABAC, audit hash chain, masking, storage guard
│   │   ├── db/               # Async SQLAlchemy engine, RLS session context, ORM models
│   │   ├── models/           # Model adapters (Gemini, Groq, Sarvam, Bhashini, BGE-M3, Local Stubs)
│   │   ├── pipeline/         # Router, Guardrails, SQL Guard, Text-to-SQL, Vector RAG, Analytics
│   │   ├── schemas/          # Pydantic validation DTOs
│   │   └── services/         # Business logic (case, map, network, dossier, report, voice)
│   ├── migrations/           # SQL database migrations (002_schema_v2 through 012_local_bilingual_rag)
│   ├── seed/                 # Synthetic data generators, loaders, and BGE-M3 narrative embedder
│   ├── tests/                # Pytest unit & integration test suites
│   ├── Dockerfile            # Backend Docker image specification
│   └── requirements.txt      # Python dependencies (pinned for stability)
│
├── frontend/                 # React 19 + TanStack Start Frontend
│   ├── src/
│   │   ├── components/       # UI Components, Canvas widgets, Network graphs, Shell voice router
│   │   ├── routes/           # TanStack file-based routing (Console, Ask, Board, Dossier, Vision, etc.)
│   │   └── lib/              # API client, SSE streaming, i18n translation tokens, theme engine
│   ├── public/               # Static assets & synthetic mugshot images
│   ├── package.json          # Frontend dependencies (React 19, tldraw, xyflow, Leaflet)
│   └── vite.config.ts        # Vite configuration
│
├── ai_camera/                # Standalone YOLOv8 CCTV threat detection script
└── docs/                     # In-depth architectural specifications & reports
    ├── ARCHITECTURE.md       # Comprehensive 32-chapter system architecture handbook
    └── PROTOTYPE_PERFORMANCE_REPORT.md  # Latency, throughput, and accuracy benchmarks
```

---

## ⚖️ Ethics, Safety & DPDP Act Compliance

1. **Synthetic Data Sovereignty**: All 100,000 FIRs, suspect identities, phone numbers, and bank accounts in this project are 100% synthetically generated. No actual citizen data or active KSP records are stored.
2. **No Individual Guilt Prediction**: Satyam strictly refuses queries requesting individual recidivism or guilt likelihood scores. Analytics focus exclusively on reported spatial-temporal patterns, link discovery, and resource allocation.
3. **Strict Human-in-the-Loop**: Automated actions (such as emergency green corridor activation or patrol dispatch) require explicit officer confirmation.
4. **Digital Personal Data Protection (DPDP) Act 2023**: Implements field-level PII masking for low-clearance tiers, zero-trust session revocation, and immutable hash-chained audit logging for constitutional compliance.

---

## 📄 License

This project was developed for the **Datathon 2026 (Karnataka State Police × hack2skill)** competition. Licensed under the [MIT License](LICENSE).
