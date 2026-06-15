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
