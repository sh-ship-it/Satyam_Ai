# Satyam — Project Change Log (`made_till_now.md`)

This file tracks all changes, configurations, and decisions made in the **Satyam** project.

## Log of Changes

### [2026-06-15] — Initial Setup
- **Database & Architecture Decisions Confirmed**:
  - Confirmed the database architecture: **PostgreSQL 16** (with **`pgvector`** for semantic narratives search) as the primary database, **Redis** for state/session caching, and a custom **hash-chained tamper-evident audit log**.
  - Documented configuration rules for `DATABASE_URL` under the `.env` file (using the `postgresql+asyncpg://` dialect prefix).
- **Environment Setup Verification**:
  - Inspected the current `.env` template configuration settings.
- **Created Change Log**:
  - Initialized this file (`made_till_now.md`) to maintain a persistent record of all updates and edits to the codebase.

---

### [2026-06-15] — Architecture Update: Multi-Engine Support (Sarvam, Ollama Cloud, BRAIN_ENGINE, SQL_ENGINE, VOICE_BACKEND)

#### Summary
Updated the entire codebase to match the revised `docs/ARCHITECTURE.md`. The primary changes introduce:
- **Sarvam** as the primary voice provider (Bulbul v3 TTS, Saaras v2 STT, Sarvam Translate)
- **Ollama Cloud / qwen3-coder-next** as an alternate Text-to-SQL engine
- Three new runtime config flags: `BRAIN_ENGINE`, `SQL_ENGINE`, `VOICE_BACKEND`
- Per-request engine overrides from the frontend Settings panel (sent with each chat request)

#### Backend Changes

**`backend/app/config.py`**
- Added `brain_engine: Literal["gemini", "groq"]` (default: `gemini`) — selects the LLM for chat / slots / routing.
- Added `sql_engine: Literal["gemini", "qwen3-coder-next"]` (default: `gemini`) — selects the Text-to-SQL engine.
- Added `voice_backend: Literal["sarvam", "bhashini"]` (default: `sarvam`) — selects the voice provider.
- Added `sarvam_api_key: str` — API key for Sarvam (Bulbul v3 / Saaras v2 / Sarvam Translate).
- Added Ollama Cloud vars: `ollama_cloud_url`, `ollama_cloud_api_key`, `ollama_cloud_sql_model` (default: `qwen3-coder-next:cloud`).
- Removed unused `pydantic.Field` import.

**`backend/app/models/api/sarvam.py`** *(new file)*
- `SarvamSTT` — wraps Sarvam Saaras v2 `/speech-to-text` endpoint (Kannada + English).
- `SarvamTTS` — wraps Sarvam Bulbul v3 `/text-to-speech` endpoint.
- `SarvamTranslator` — wraps Sarvam Translate `/translate` endpoint (Mayura v1).
- All three classes run in demo mode (deterministic stubs) when `SARVAM_API_KEY` is unset.

**`backend/app/models/api/ollama_cloud.py`** *(new file)*
- `OllamaCloudLLM` — OpenAI-compatible client targeting the Ollama Cloud endpoint for `qwen3-coder-next:cloud`.
- Supports the same `complete()` / `stream()` interface as `GeminiLLM` / `GroqLLM`.
- Demo mode when `OLLAMA_CLOUD_API_KEY` is unset.
- 2-attempt tenacity retry with exponential backoff.

**`backend/app/models/api/__init__.py`**
- Updated module docstring to document all five api-lane adapters: gemini, groq, sarvam, bhashini, ollama_cloud.

**`backend/app/models/registry.py`**
- `get_llm(engine?)` — now respects `BRAIN_ENGINE` env var; accepts optional per-request `engine` override (`gemini` | `groq` | `local`).
- `get_sql_llm(engine?)` *(new factory)* — resolves `SQL_ENGINE`; routes to `GeminiLLM`, `OllamaCloudLLM`, or `LocalLLM`.
- `get_stt(backend?)` / `get_tts(backend?)` / `get_translator(backend?)` — now default to **Sarvam** (primary) with Bhashini as fallback, controlled by `VOICE_BACKEND`; accept per-request override.
- All factories use `lru_cache` per argument value so per-request overrides are cached efficiently.

**`backend/app/schemas/chat.py`**
- Added three optional fields to `ChatRequest`:
  - `brain_engine: Optional[Literal["gemini", "groq"]]`
  - `sql_engine: Optional[Literal["gemini", "qwen3-coder-next"]]`
  - `voice_backend: Optional[Literal["sarvam", "bhashini"]]`
- These carry the Settings panel's live overrides to the backend on every request.

**`backend/app/pipeline/tools/text_to_sql.py`**
- `generate_sql()` and `answer_with_sql()` now accept a `sql_engine` kwarg and call `get_sql_llm(sql_engine)` instead of the hardcoded `get_llm()`.

**`backend/app/pipeline/router.py`**
- `route()` now accepts a `brain_engine` kwarg and passes it to `get_llm(brain_engine)`.

**`backend/app/pipeline/orchestrator.py`**
- `run()` now accepts `brain_engine` and `sql_engine` kwargs.
- Threads `brain_engine` to `_compose()` and to `route()`.
- Threads `sql_engine` to `answer_with_sql()`.

**`backend/app/services/chat_service.py`**
- `stream_chat()` now accepts `brain_engine` and `sql_engine` kwargs and forwards them to `orchestrator.run()`.

**`backend/app/api/routes/chat.py`**
- SSE endpoint now reads `req.brain_engine` and `req.sql_engine` from the request and passes them to `chat_service.stream_chat()`.

#### Environment Files

**`.env.example`** (root, shared by docker-compose)
- Added: `BRAIN_ENGINE=gemini`, `SQL_ENGINE=gemini`, `VOICE_BACKEND=sarvam`
- Added: `SARVAM_API_KEY=` with note about one-time free-tier credits
- Added: `OLLAMA_CLOUD_URL`, `OLLAMA_CLOUD_API_KEY`, `OLLAMA_CLOUD_SQL_MODEL`
- Reorganised sections with comments for each provider group.

**`backend/.env.example`**
- Same additions as root `.env.example`, minus Docker-compose-specific vars.

#### Frontend Changes

**`frontend/src/lib/api/client.ts`**
- `streamChat()` body type extended with three optional override fields:
  - `brain_engine?: "gemini" | "groq"`
  - `sql_engine?: "gemini" | "qwen3-coder-next"`
  - `voice_backend?: "sarvam" | "bhashini"`

**`frontend/src/components/SettingsDialog.tsx`**
- Added `EngineSettings` type and `loadEngineSettings()` / `saveEngineSettings()` helpers (persist to `localStorage` under `satyam.engine-settings`).
- Added a new **Models** tab (CPU icon) between Profile and Preferences with four controls:
  - **API model (cloud)** toggle — enable/disable cloud compute plane.
  - **Local model (on-prem)** toggle — enable/disable Phase 2 on-prem lane (falls back to API if no GPU).
  - **Brain engine** dropdown — `Gemini 2.5 Flash` | `Groq (low-latency / fallback)`.
  - **Text-to-SQL engine** dropdown — `Gemini 2.5 Flash` | `qwen3-coder-next (Ollama Cloud)`.
  - **Voice backend** dropdown — `Sarvam (Bulbul v3 TTS · Saaras v2 STT)` | `Bhashini (govt · free)`.
- Added `ModelToggle` helper component (toggle with label + description sub-text).
- Exported `loadEngineSettings` so the chat console can read overrides and include them in each `streamChat` call.
- Fixed parse error: missing `{tab === "preferences" && (` wrapper that was accidentally dropped during insertion.

#### Architectural Decisions Recorded
- **Sarvam is primary voice** (Bulbul v3 TTS, Saaras v2 STT, Sarvam Translate). Bhashini is the fallback (govt, free, no credit cap). Pre-caching scripted demo TTS recommended to conserve Sarvam one-time free-tier credits.
- **BGE-M3 remains the sole embedder** — not configurable, always local.
- **sqlglot guard applies identically** regardless of SQL_ENGINE choice — safety is engine-agnostic.
- **Per-request overrides** from the Settings panel take precedence over server-side env defaults for that session only; they do not persist on the server.
- **Phase 2 (on-prem / sovereign)** local model lane is stubbed and parked; `MODEL_BACKEND=local` still routes through the existing `LocalLLM` / `WhisperSTT` / `ParlerTTS` stubs.

---

### [2026-06-15] — Architecture Doc Revision: Saaras v3, GPU specs for BGE-M3 + Reranker, Demo-track clarification

#### Summary
`docs/ARCHITECTURE.md` was updated with more precise hardware specs, a corrected
STT model version (Saaras v3), and a clearer two-track demo honesty section.
All affected code files were updated to match.

#### Changes

**`backend/app/models/api/sarvam.py`**
- Updated module docstring: **Saaras v2 → Saaras v3**.
- Updated `SarvamSTT` class docstring: **Saaras v2 → Saaras v3**.
- Updated Sarvam API model string in `transcribe()`: `"saaras:v2"` → `"saaras:v3"`.

**`backend/app/models/local/embedder_bge.py`**
- Expanded module docstring with hardware specs from the architecture doc:
  - ~568M params, ~1.3 GB FP16 (~2.2 GB FP32).
  - Runs FP16 on demo GPU (RTX 4070, 8 GB VRAM); CPU-capable but slower.
  - Explicit note: not swappable for a hosted API without re-embedding the narratives table.

**`backend/app/models/local/reranker_bge.py`**
- Expanded module docstring with hardware specs from the architecture doc:
  - ~568M params, ~1.1 GB FP16.
  - CPU-capable; lives on demo GPU alongside BGE-M3 embedder.
  - Combined weights with embedder: ~2.4 GB FP16; peak VRAM ~4–5 GB (comfortable in 8 GB).
  - Added real replacement snippet using `sentence_transformers.CrossEncoder`.

#### Architecture decisions recorded (from updated doc)
- **Demo GPU (RTX 4070, 8 GB)** runs only the two always-local models: BGE-M3 embedder + bge-reranker-v2-m3 (both FP16, ~2.4 GB weights, ~4–5 GB peak). Brain/SQL/voice remain cloud API calls.
- **Heavy local LLMs** (Qwen-Coder 30B, Llama 3.1-8B) deferred entirely to Phase 2 on-prem build — not run on the demo laptop.
- **Two-phase rollout table** updated: Embeddings + rerank row now reads "BGE-M3 + bge-reranker (local, FP16 on GPU)" for both phases.
- **Saaras v3** is the current Sarvam STT model (not v2 as initially coded).

---

### [2026-06-15] — Security Update: Robust .env Ignore Rules

#### Summary
Updated the root `.gitignore` file to ensure all environment configuration files (`.env`, `.env.local`, `.env.production`, etc.) across both the root and all subdirectories (including `backend/` and `frontend/`) are explicitly and recursively ignored by Git, preventing any accidental credential leaks while keeping `.env.example` templates tracked.

#### Changes

**`.gitignore`** (root)
- Added comprehensive recursive patterns: `.env.*`, `**/.env`, `**/.env.*`.
- Added negative matches to ensure sample templates (`.env.example` and `**/.env.example`) remain tracked by Git.

---

### [2026-06-15] — Local Database Setup: PostgreSQL 17 + pgvector 0.8.2 + Full Schema

#### Summary
Read `DATABASE.md` and set up the complete local development database as documented.
This implements the **local track** of the dual-database strategy (local = full 100k dataset
+ GPU embeddings; cloud Neon = subset + auth, set up by teammate separately).

The setup required building pgvector from source due to two MSVC/PG17 incompatibilities
that had no prebuilt binary workaround on Windows.

---

#### 1. PostgreSQL status confirmed
- **PostgreSQL 17.7** already installed via EDB installer, running as Windows service `postgresql-x64-17`.
- Data directory: `C:\Program Files\PostgreSQL\17`.
- Runtime port: `5432` (default).
- No pgvector extension was bundled — had to build from source.

---

#### 2. pgvector 0.8.2 — build from source (Windows, MSVC)

**Why from source:** The EDB Windows installer does not ship pgvector. No prebuilt `.zip` was
downloadable (network blocked). Had to compile using VS 2022 Build Tools already on the machine.

**Build blockers hit and fixed:**

| # | Error | Root Cause | Fix Applied |
|---|-------|-----------|-------------|
| 1 | `C2196: case value '4' already used` in `tupmacs.h` | MSVC does not reduce `sizeof(Datum)` inside `case` labels when `SIZEOF_DATUM == 8` guard is present — a PG17+MSVC preprocessor bug | Created a patched `include_override/access/tupmacs.h` with `case 8:` replacing `case sizeof(Datum):` in both affected switch blocks; injected the override dir first with `/I` |
| 2 | `LNK4272: library machine type 'x64' conflicts with target machine type 'x86'` | `VsDevCmd.bat` defaults to x86 toolchain; PostgreSQL 17 ships x64 `postgres.lib` | Switched to `vcvars64.bat` (`VC\Auxiliary\Build\vcvars64.bat`) for x64 environment |

**Build flags added to `Makefile.win`:**
- `/Zc:preprocessor` — conformant MSVC preprocessor so macro guards resolve correctly.
- `/D_CRT_SECURE_NO_WARNINGS` — suppress CRT deprecation noise.

**Output:** `vector.dll` (274 KB), `vector.control`, `vector--0.8.2.sql` and upgrade scripts.

**Installation** (required admin elevation to write to `Program Files`):
- `vector.dll` → `C:\Program Files\PostgreSQL\17\lib\`
- `vector*.sql` + `vector.control` → `C:\Program Files\PostgreSQL\17\share\extension\`

**Verified:** `SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';`
returned `vector | 0.8.2`. ✓

---

#### 3. Database creation

```sql
CREATE DATABASE satyam;
```

No custom locale — used PostgreSQL default to avoid `en_US.UTF-8` availability issues on Windows.

---

#### 4. Schema applied — `backend/migrations/001_init.sql`

Ran as the `postgres` superuser against the `satyam` database. All DDL succeeded:

| Object | Type | Notes |
|--------|------|-------|
| `stations` | Table | Reference / org |
| `officers` | Table | Reference / org |
| `app_users` | Table | Auth + RBAC |
| `cases` | Table | Core; RLS enabled + forced |
| `persons` | Table | PII; masked via `persons_v` |
| `case_persons` | Table | Many-to-many |
| `narratives` | Table | RAG; `embedding vector(1024)` column |
| `audit_log` | Table | Hash-chained tamper-evident log |
| `persons_v` | View | PII masking view (`security_invoker=on`) |
| `satyam_mask_name()` | Function | Masks name field below clearance 2 |
| `idx_narratives_embedding` | Index | HNSW, `vector_cosine_ops` |
| `idx_cases_crime_type` | Index | btree |
| `idx_cases_district` | Index | btree |
| `idx_cases_jurisdiction` | Index | btree |
| `idx_case_persons_person` | Index | btree |
| `cases_select` | RLS Policy | Jurisdiction AND clearance gate (single policy, AND-joined to prevent privilege escalation) |
| `narratives_select` | RLS Policy | Exists-check via cases |
| `satyam_app` | Role | `NOSUPERUSER`, least-privilege runtime role |
| `satyam` | Role | Owner / superuser for migrations + seeding |

**Grants applied to `satyam_app`:**
- `SELECT` on `stations, officers, cases, case_persons, narratives, persons, persons_v`
- `SELECT, INSERT` on `audit_log` (append-only; no UPDATE/DELETE)
- `USAGE, SELECT` on `audit_log_id_seq`

---

#### 5. Connectivity verified via Python (`asyncpg`)

```
Tables visible to satyam_app: audit_log, case_persons, cases, narratives,
  officers, persons, persons_v, stations
pgvector version: 0.8.2
cases rows (through RLS): 0      ← empty, ready for seeding
vector_dims test: 3               ← vector type is live
All checks PASSED
```

---

#### 6. Backend `.env` — no changes needed

`backend/.env` already had the correct local connection strings from the initial setup:
```
DATABASE_URL=postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam
SEED_DATABASE_URL=postgresql+asyncpg://satyam:satyam@localhost:5432/satyam
```

---

#### Next steps (deferred)
- Run `python -m seed.seed` (via `SEED_DATABASE_URL`) once the seed generator is ready to populate the 100k synthetic FIR dataset.
- Embed narratives with BGE-M3 (FP16 on RTX 4070) → store as `vector(1024)` in `narratives.embedding`.
- Cloud (Neon) track: teammate sets up Neon project, runs same migration with `halfvec(1024)` for the embedding column, pushes a subset of the data.
- When Neon `DATABASE_URL` is available, flip `backend/.env` → `DATABASE_URL=<neon-url>` to switch tracks (no code changes required).

---

### [2026-06-15] — Neon Cloud Database Connected

#### Summary
Connected the backend to the Neon cloud PostgreSQL instance provided by the teammate.
Both `DATABASE_URL` and `SEED_DATABASE_URL` now point at Neon. The local PostgreSQL
track is preserved as commented-out lines for instant flip-back during on-prem demo.

#### What was confirmed
- **Neon endpoint:** `ep-misty-haze-ad33z23j-pooler.c-2.us-east-1.aws.neon.tech`
- **Database:** `neondb` · **Region:** `us-east-1` (AWS)
- **Server version:** PostgreSQL 16.14
- **pgvector:** 0.8.0 — already installed on Neon
- **Schema:** Full migration already applied — all 9 objects (`stations`, `officers`,
  `app_users`, `cases`, `persons`, `case_persons`, `narratives`, `audit_log`, `persons_v`)
  present and verified.

#### Files changed

**`backend/.env`** *(gitignored — credentials never committed)*
- `DATABASE_URL` → Neon pooler URL with `ssl=require`
- `SEED_DATABASE_URL` → same Neon URL (owner role, used only for migrations/seed)
- Local URLs kept as comments for easy flip-back:
  ```
  # DATABASE_URL=postgresql+asyncpg://satyam_app:satyam_app@localhost:5432/satyam
  # SEED_DATABASE_URL=postgresql+asyncpg://satyam:satyam@localhost:5432/satyam
  ```
- Also added the full new env vars from the architecture update
  (`BRAIN_ENGINE`, `SQL_ENGINE`, `VOICE_BACKEND`, `SARVAM_API_KEY`, `OLLAMA_CLOUD_*`)
  so the file is now fully in sync with `backend/.env.example`.

**`backend/app/config.py`**
- Added `seed_database_url: str` field to the `Settings` model so the seed script
  can read it via `get_settings().seed_database_url` instead of raw `os.environ`.
- Default value matches the local owner URL for local-only setups.

#### How to switch tracks
| Track | Change needed |
|-------|--------------|
| **Cloud (Neon)** — current | No change. `DATABASE_URL` = Neon URL |
| **Local (on-prem demo)** | Uncomment the two local URLs in `backend/.env`, comment out the Neon lines |

#### Security note
The Neon connection string contains real credentials. It lives **only** in
`backend/.env`, which is covered by `.gitignore` rule `**/.env`. It is never
printed in logs, never committed, and never echoed in any tracked file.

---

### [2026-06-15] — Gitignore Update: Ignore Synthetic Dataset CSVs

#### Summary
Updated the root `.gitignore` file to ensure all generated synthetic dataset CSV files inside `backend/seed/satyam_synthetic_dataset/` are ignored by Git. This prevents committing large data files (like `narratives.csv`, which is ~116MB and exceeds GitHub's limit) while ensuring the dataset generator/verifier scripts and documentation remain tracked.

#### Changes

**`.gitignore`** (root)
- Added rule to ignore all files in `backend/seed/satyam_synthetic_dataset/`:
  `backend/seed/satyam_synthetic_dataset/*`
- Added exceptions to keep `.py` and `.md` files tracked:
  `!backend/seed/satyam_synthetic_dataset/*.py`
  `!backend/seed/satyam_synthetic_dataset/*.md`


---

### [2026-06-15] — Full DB Rebuild + KSP RBAC + 100k Dataset Loaded

#### Summary
Complete rebuild of the database schema, data pipeline, and RBAC system to match the authoritative `satyam_synthetic_dataset` CSVs and the new `schema.sql`/`load_seed.sql` provided. All changes applied to **both Neon (cloud) and local PostgreSQL**.

---

#### Files moved / created

| File | Action | Notes |
|------|--------|-------|
| `schema.sql` (repo root) | → `backend/migrations/002_schema_v2.sql` | Canonical new schema |
| `load_seed.sql` (repo root) | → `backend/seed/load_seed.sql` | psql bulk-load script |
| `backend/migrations/teardown.sql` | **new** | Idempotent DROP of all old tables/views/functions |
| `backend/seed/load_seed.py` | **new** | Python asyncpg COPY bulk-loader |
| `backend/seed/embed_narratives.py` | **new** | BGE-M3 embedding job (resumable) |

---

#### Database changes

**Schema v2 (`002_schema_v2.sql`) vs v1 (`001_init.sql`)**

| Table | v1 | v2 |
|-------|----|----|
| `stations` | TEXT PK, zone/lat/lng | INTEGER PK, `station_name`, `district`, `range` (quoted keyword) |
| `officers` | TEXT PK | INTEGER PK, NOT NULL FK |
| `cases` | `fir_no` TEXT PK, `date`, `sensitivity_flag`, `jurisdiction_id` | `case_id` INT PK, `fir_number`, `fir_year`, `crime_category`, `legal_code` (IPC/BNS), `fir_type`, `report_date`, `incident_date`, `place_of_offence`, `victim_count/accused_count/arrested_count`, `is_group`, `charge_sheeted`, `convicted`; GENERATED cols: `sections_arr` |
| `persons` | TEXT PK, `role_type` | INTEGER PK, no `role_type` (roles live in `case_persons`) |
| `case_persons` | composite PK (case_id, person_id) | composite PK (case_id, person_id, **role**); role CHECK constraint |
| `narratives` | `case_id` TEXT PK, `text` | `narrative_id` INT PK, `language` (en/kn), `body`; GENERATED: `body_tsv` tsvector |
| `app_users` | v1 only | **dropped** |
| `users` | not in v1 | `user_id` SERIAL, `username`, `password_hash`, `officer_id` FK, `assigned_rank` FK |
| `rank_access` | not in v1 | **new** — 14 KSP ranks with `scope_level` + `clearance` + `gazetted` |
| `v_officer_session` | not in v1 | **new** view — resolves effective rank/scope/clearance for a user |
| RLS | `satyam.*` GUCs, jurisdiction+clearance | `app.*` GUCs (scope/range/district/station_id/clearance), `fn_scope_ok()` function |
| `persons_v` masked view | clearance-based name masking | **dropped** — masking moved to API layer (`app/core/masking.py`) |

**Data loaded (both Neon + local):**
- stations: 1,074
- officers: 6,949
- cases: 100,000
- persons: 416,616
- case_persons: 416,616
- narratives: 200,000 (embedding column NULL — run embed job when GPU available)

---

#### Backend code changes

**`backend/app/db/models.py`** — Full rewrite. All ORM classes now match v2 schema (INTEGER PKs, new columns, GENERATED columns skipped, composite PK on `CasePerson`, `AuditLog` uses `audit_id`/`at`/`row_hash`).

**`backend/app/db/rls.py`** — Switched from `satyam.*` GUCs to `app.*` GUCs matching `fn_scope_ok()` in the new schema.

**`backend/app/core/rbac.py`** — Complete rewrite. Now implements the full KSP rank model:
- 14 ranks (DGP → PC) with scope (state/range/district/station) and clearance L1–L4.
- `PROTECTED_CRIMES` frozenset (POCSO, RAPE, etc.) triggers extra access controls.
- `Principal.should_mask_pii()`, `should_coarsen_coords()`, `can_see_narrative()`.
- Removed `Role` enum; uses `rank` string matching KSP insignia.

**`backend/app/core/masking.py`** — Full rewrite. 4-tier masking (L1–L4):
- L1: all names masked, coords coarsened, PROTECTED narratives hidden.
- L2: person PII + place masked, PROTECTED narratives redacted.
- L3: only victim/complainant names masked on PROTECTED crimes.
- L4: full access. Deep-copies persons list to avoid mutating caller dict.

**`backend/app/core/audit.py`** — Updated to new `AuditLog` schema (`audit_id`, `at`, `row_hash`, `case_id`, `reason`). Legacy aliases kept for smooth transition.

**`backend/app/core/security.py`** — JWT now carries: `rank`, `scope`, `clearance`, `station_id`, `district`, `range`, `officer_id`.

**`backend/app/api/deps.py`** — `get_principal()` reads new JWT fields. `get_scoped_session()` calls updated `apply_rls_context()` with scope/range/district/station_id/clearance.

**`backend/app/api/routes/auth.py`** — Demo login now issues JWT with KSP rank instead of old app-role. `_DEMO_STATIONS` provides station/district/range for each rank. `LoginRequest` accepts `rank` field (+ `role` alias).

**`backend/app/schemas/auth.py`** — `SessionUser` now has `rank`, `scope`, `clearance`, `district`, `range_name`.

**`backend/app/schemas/case.py`** — Updated to v2 column names: `case_id` (int), `fir_number`, `crime_category`, `legal_code`, `range_name`, `report_date`, etc.

**`backend/app/services/case_service.py`** — Rewired to new columns. `get_case()` loads first English narrative. `list_cases()` supports `status` filter.

**`backend/app/api/routes/cases.py`** — `case_id: int` path param (was `fir_no: str`). Added `status` query filter.

**`backend/app/api/routes/audit.py`** — Updated for new `AuditLog` fields.

**`backend/app/pipeline/prompts.py`** — `SQL_SYSTEM` rewritten to describe v2 schema (new columns, `"range"` quoting note, no `sensitivity_flag`/`jurisdiction_id`).

**`backend/app/pipeline/tools/sql_guard.py`** — `persons_v` removed from `ALLOWED_TABLES`; replaced with `persons` (masking now in API layer).

**`backend/app/pipeline/tools/analytics.py`** — Column names updated: `latitude/longitude` (was `lat/lng`), `"range"` quoted, added `range_name` filter.

**`backend/app/pipeline/tools/rag.py`** — `narratives.text` → `narratives.body`.

**`backend/app/services/chat_service.py`** — `write_audit()` call updated to new signature.

---

#### RLS verification (live test)
- PSI at station 1 (scope=station) sees **1,029 cases** (station-scoped).
- DGP (scope=state) sees **100,000 cases** (all rows).
- RBAC: PC cannot read audit; SP (L4) can read protected crimes; PC (L1) masks all PII.

#### Next steps
- Run `python -m seed.embed_narratives` (GPU preferred) to fill `narratives.embedding` and build the HNSW index — until then, RAG falls back to full-text search.
- Implement real password auth in `users` table (currently demo JWT only).
- Push a user to `users` table and wire `user_id` into audit log rows.
