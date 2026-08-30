# Satyam — Backend Service

FastAPI service powering the Satyam Conversational AI for police crime intelligence (KSP × hack2skill). Includes a router-first grounded pipeline, PostgreSQL 16 + pgvector database, Redis session caching, RBAC/ABAC with Postgres Row-Level Security (RLS), cryptographic hash-chained audit logging, and swappable model adapters (`MODEL_BACKEND=api|local`).

> 🛡️ **Synthetic Data Only**: Records describe reported synthetic crime data. No individual-level guilt prediction, human-in-the-loop validation, DPDP Act 2023 aligned.

---

## 🛠️ Tech Stack & Architecture

| Layer | Implementation | Notes |
| :--- | :--- | :--- |
| **API Framework** | FastAPI (asyncio) | SSE token streaming, REST endpoints, Pydantic v2 schemas |
| **Database** | PostgreSQL 16 + pgvector | Async SQLAlchemy 2.0 + asyncpg, HNSW narrative vector indexing |
| **State / Cache** | Redis 7 | Conversation state, slot memory, TTS caching |
| **Authentication** | PyJWT (HS256) | 14 KSP hierarchical ranks, 4 clearance levels, role switcher |
| **Access Control** | RBAC + ABAC + Postgres RLS | Least-privilege `satyam_app` role scopes queries by station/district |
| **Audit Logging** | Cryptographic SHA-256 Hash Chain | Immutable, tamper-evident query verification |
| **Model Lanes (API)** | Gemini 2.5/3.5 Flash · Groq Llama-3.3-70B · Sarvam AI · Bhashini | Hosted free-tier and low-latency API providers |
| **Embeddings & Reranker** | BGE-M3 (1024-dim, FP16) · bge-reranker-v2-m3 | Sole embedder (local CUDA / CPU), hybrid vector search |
| **SQL Safety** | sqlglot AST validator | Multi-table allow-listing, auto-LIMIT, single SELECT guard |

---

## ⚡ Quick Start (Offline Demo Mode)

Satyam runs fully offline without requiring third-party API keys by utilizing its deterministic demo inference engine:

```bash
cd backend

# 1. Create and activate Python virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 2. Install PyTorch & Dependencies
pip install torch --index-url https://download.pytorch.org/whl/cu121  # or /cpu for non-GPU
pip install -r requirements.txt

# 3. Copy environment configuration
cp .env.example .env

# 4. Start the FastAPI development server
uvicorn app.main:app --reload --port 8000
```
- **Interactive Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Redoc Documentation:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 🗄️ Database Setup & Migrations

PostgreSQL with `pgvector` extension and Redis must be running.

### 1. Sequential Database Migrations
Migrations in `migrations/` must be applied in sequential order using the superuser/owner role:

```bash
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

### 2. Seeding Synthetic Data

```bash
# Load 100k synthetic FIR cases, stations, officers, persons & narratives
python -m seed.load_seed

# Initialize Response-Ops tables (units, dispatch, cameras, corridors)
python -m seed.init_ops

# Seed demo dossiers for Person 360 suspect investigations
python -m seed.load_demo_dossier

# Seed socio-economic indicators and financial hawala/mule tables
python -m seed.load_new_tables --db local

# Generate BGE-M3 narrative embeddings & construct HNSW index (Required for RAG)
python -m seed.embed_narratives

# Check storage consumption and quota headroom
python -m app.core.storage
```

---

## 🧪 Testing

Run pytest unit tests across all routes, pipelines, and security layers:

```bash
# Unit test suite (runs in demo mode, no database required)
pytest -q

# Integration tests (requires active, seeded database)
pytest -m integration
```

---

## 📁 Backend Directory Layout

```
backend/
├── app/
│   ├── api/
│   │   ├── deps.py               # Dependency injection & authentication
│   │   └── routes/               # API route definitions
│   │       ├── admin.py          # Access control & clearance overrides
│   │       ├── audit.py          # Tamper-evident hash chain verification
│   │       ├── auth.py           # OIDC / JWT authentication & demo switcher
│   │       ├── board.py          # tldraw investigation canvas persistence
│   │       ├── cases.py          # Case search, details & masking
│   │       ├── chat.py           # SSE token streaming & spoken summary
│   │       ├── documents.py      # Legal document translation & sealing
│   │       ├── dossier.py        # Person 360 suspect dossier
│   │       ├── financial.py      # Hawala & mule account money trails
│   │       ├── health.py         # Health checks & data telemetry
│   │       ├── intelligence.py   # Statistical queries & socio-economic data
│   │       ├── map.py            # Geospatial incident queries & heatmaps
│   │       ├── network.py        # Graph link analysis & ego networks
│   │       ├── news.py           # OSINT crime intelligence stream
│   │       ├── ops.py            # Response-Ops dispatch & green corridor
│   │       ├── reports.py        # Verifiable intelligence reports
│   │       ├── security.py       # Zero-trust session revocation
│   │       ├── settings.py       # Dynamic database source switcher
│   │       ├── vision.py         # Tactical surveillance & telemetry
│   │       └── voice.py          # Speech-to-Text & Text-to-Speech routes
│   ├── core/                     # Security, RBAC/ABAC, audit, masking, storage guard
│   ├── db/                       # SQLAlchemy async engine, RLS context, ORM models
│   ├── models/                   # Model registry and adapters (Gemini, Groq, Sarvam, Bhashini, BGE-M3)
│   ├── pipeline/                 # Router, slots, guardrails, SQL guard, Text-to-SQL, Vector RAG
│   ├── schemas/                  # Pydantic request/response schemas
│   └── services/                 # Business logic implementations
├── migrations/                   # Sequential PostgreSQL migration scripts
├── seed/                         # Synthetic dataset loaders and embedder
└── tests/                        # Pytest unit & integration test suites
```
