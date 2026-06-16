# Graph Report - Satyam  (2026-06-16)

## Corpus Check
- 188 files · ~83,688 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1379 nodes · 2072 edges · 117 communities (95 shown, 22 thin omitted)
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 379 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `eb146f8a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 116|Community 116]]
- [[_COMMUNITY_Community 117|Community 117]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 123|Community 123]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 69 edges
2. `Principal` - 46 edges
3. `get_settings()` - 27 edges
4. `Permission` - 27 edges
5. `LLM` - 23 edges
6. `useT()` - 21 edges
7. `Embedder` - 21 edges
8. `Reranker` - 21 edges
9. `SpeechToText` - 21 edges
10. `TextToSpeech` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Audit()` --calls--> `useT()`  [INFERRED]
  frontend/src/routes/audit.tsx → frontend/src/lib/i18n.tsx
- `Any` --uses--> `Principal`  [INFERRED]
  backend/app/core/masking.py → backend/app/core/rbac.py
- `Principal` --uses--> `Principal`  [INFERRED]
  backend/app/core/masking.py → backend/app/core/rbac.py
- `AsyncSession` --uses--> `Principal`  [INFERRED]
  backend/app/api/deps.py → backend/app/core/rbac.py
- `list_audit()` --calls--> `verify_chain()`  [INFERRED]
  backend/app/api/routes/audit.py → backend/app/core/audit.py

## Import Cycles
- 1-file cycle: `backend/app/main.py -> backend/app/main.py`

## Communities (117 total, 22 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.17
Nodes (8): BhashiniTranslator, Sarvam AI clients — PRIMARY voice layer (Kannada + English STT/TTS/MT).  Servi, Sarvam Translate — neural MT between Kannada and English., _SarvamBase, SarvamTranslator, get_translator(), Sarvam Translate (primary) → Bhashini NMT (fallback).     Falls back to Bhashini, Translator

### Community 1 - "Community 1"
Cohesion: 0.22
Nodes (8): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (59): dependencies, class-variance-authority, clsx, cmdk, date-fns, embla-carousel-react, @hookform/resolvers, i18next (+51 more)

### Community 3 - "Community 3"
Cohesion: 0.32
Nodes (3): reportError(), I18nProvider(), ErrorComponent()

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (38): useIsMobile(), Input, Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader() (+30 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (29): AuditLog, AsyncSession, AsyncSession, Principal, _digest(), Tamper-evident, hash-chained audit log.  Each entry stores sha256(prev_hash + ca, verify_chain(), write_audit() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (28): devDependencies, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (22): AccordionContent, AccordionItem, AccordionTrigger, Checkbox, HoverCardContent, PopoverContent, Progress, RadioGroup (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (25): Route, Route, Login(), Route, Route, Route, Route, Route (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.19
Nodes (5): Footer(), GridBg(), Header(), NB(), PipelineStep

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (25): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.26
Nodes (8): consumeLastCapturedError(), renderErrorPage(), fetch(), getServerEntry(), normalizeCatastrophicSsrResponse(), ServerEntry, errorMiddleware, startInstance

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (21): async_sessionmaker, AsyncEngine, AsyncSession, active_url(), get_db_source(), _get_engine(), get_session(), get_sessionmaker() (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (24): cn(), Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator() (+16 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (12): _BhashiniBase, Bhashini (Govt. of India) clients — PRIMARY Indic layer (Kannada STT/TTS/MT).  T, get_settings(), Application settings, loaded from environment / .env., No external model keys => run with deterministic stubs + fixtures., Settings, BaseSettings, create_access_token() (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (26): Any, Principal, AsyncSession, _coarsen_coord(), mask_case(), _mask_str(), Server-side field masking — KSP clearance-aware.  Masking tiers (never send unma, Round to ~10 km grid (1 decimal degree ≈ 110 km → 0.1° ≈ 11 km). (+18 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (6): DataActions(), defaultEngineSettings, EngineSettings, formatRemaining(), Status, Tab

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (35): 10. Hybrid search (semantic + keyword), 11. Authentication, 12. Audit log (tamper-evident hash chain), 13. Data loading, 14. Configuration (`.env`), 15. Security notes, 16. Summary of decisions, 1. Overview (+27 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (14): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (11): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (12): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (18): api, CaseDrawer(), CreateAccountDialog(), ROLE_OPTIONS, Ctx, I18nCtx, Lang, useT() (+10 more)

### Community 26 - "Community 26"
Cohesion: 0.11
Nodes (29): BhashiniSTT, BhashiniTTS, Sarvam Saaras v3 — speech-to-text for Kannada (kn-IN) and English (en-IN)., Sarvam Bulbul v3 — text-to-speech for Kannada and English., SarvamSTT, SarvamTTS, Embedder, LLM (+21 more)

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (15): [2026-06-15] — Architecture Doc Revision: Saaras v3, GPU Specs, Demo Clarification, [2026-06-15] — DATABASE.md Rewritten, [2026-06-15] — Gitignore Update: Ignore Synthetic Dataset CSVs, [2026-06-15] — Initial Setup, [2026-06-15] — Neon Cloud Database Connected, [2026-06-15] — Security Update: Robust .env Ignore Rules, Changes, Changes (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (7): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, THEMES

### Community 29 - "Community 29"
Cohesion: 0.20
Nodes (9): Environment, Hard rules (do not violate), Option A - Docker (everything), Option B - local dev, Repo layout, Satyam — Project Briefing for AI Assistants, Setup & run, Tech stack (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (9): Docker (full stack), Gemini safety notes (baked into `app/models/api/gemini.py`), Layout, Model backends, Quick start (demo mode, no keys needed), Satyam — Backend, Stack, Tests (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.17
Nodes (11): case_persons.csv (~410k rows), cases.csv (100,000 rows) — one row per FIR, Coverage (all verified PASS), How it was built, narratives.csv (200,000 rows) — bilingual, officers.csv (~6,900 rows), persons.csv (~410k rows), Satyam — Synthetic Karnataka Police Crime Dataset (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (28): get_principal(), get_scoped_session(), FastAPI dependencies: authenticated principal + RLS-scoped DB session.  The JWT, Decode the bearer JWT into a Principal. Raises 401 on any problem., Yield a transaction-scoped session stamped with the caller's RLS context., AsyncSession, Principal, AsyncSession (+20 more)

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (13): 1. High-level, 2. Request lifecycle (chat), 3. Defense in depth, 4.1 Active lanes (build now — demo), 4.2 Parked as future fallback (Phase 2 — on-prem), 4. Model & API strategy, 5. Two-phase rollout (demo → sovereign), 6. Data model (frozen day one — R8) (+5 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (34): AsyncSession, HotspotRequest, HotspotResponse, AsyncSession, BaseModel, EgoRequest, EgoResponse, LoginRequest (+26 more)

### Community 36 - "Community 36"
Cohesion: 0.20
Nodes (9): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut(), DropdownMenuSubContent (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (5): OllamaCloudLLM, Ollama Cloud client — qwen3-coder-next Text-to-SQL option.  Model: qwen3-coder, OpenAI-compatible Ollama Cloud endpoint for qwen3-coder-next., get_sql_llm(), Return the Text-to-SQL LLM.      Resolution order:       1. Explicit `engine` ar

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (7): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (5): BgeM3Embedder, _load_model(), BGE-M3 embedder (sole embedder for the whole system).  Real local inference via, Load BGE-M3 once and cache for the process lifetime (~1.3 GB FP16)., BGE-M3 dense embedder.  Registry calls BgeM3Embedder(dim=1024).

### Community 40 - "Community 40"
Cohesion: 0.50
Nodes (3): Avatar, AvatarFallback, AvatarImage

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (3): Badge(), BadgeProps, badgeVariants

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (8): [2026-06-15] — Bug Fix Sprint: 17 Bugs Fixed (SATYAM_BUG_FIXES.md — Rounds 1–4), Confirmed false positives (not touched), Critical / High (crash or security), Deleted, Docstring / stale comment, Low, Medium, Test results after all fixes

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (6): Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (3): BlockedByModel, GeminiLLM, Gemini 2.5 Flash client (primary chat / Text-to-SQL lane).  Notes baked in from

### Community 47 - "Community 47"
Cohesion: 0.27
Nodes (9): AsyncSession, ego_network(), hotspots(), offender_trail(), Geospatial + network analytics tools (RLS-scoped reads) — new schema., Ordered crime locations for one offender (role = accused/offender)., Given a victim/complainant, return the offenders (accused) across their     case, Ego network: person → shared cases → co-involved persons. (+1 more)

### Community 48 - "Community 48"
Cohesion: 0.08
Nodes (17): ApiError, authHeaders(), ChatEvent, getAuthToken(), HotspotPoint, HotspotResponse, request(), Role (+9 more)

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (5): Model strategy (3 free lanes; ML added later), Monorepo layout, Quick start, Satyam — Conversational AI for the KSP Crime Database, The pipeline (router-first, grounded)

### Community 50 - "Community 50"
Cohesion: 0.29
Nodes (7): [2026-06-15] — Full DB Rebuild + KSP RBAC + 100k Dataset Loaded, Backend code changes, Database changes, Files moved / created, Next steps, RLS verification (live test), Summary

### Community 53 - "Community 53"
Cohesion: 0.40
Nodes (3): precheck(), Input/output guardrails.   - Pre-flight: block obviously out-of-scope or prompt-, Return a refusal reason if the input should be blocked, else None.

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 57 - "Community 57"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 58 - "Community 58"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 59 - "Community 59"
Cohesion: 0.50
Nodes (3): For /graphify explain, For /graphify path, graphify reference: query, path, explain

### Community 60 - "Community 60"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 61 - "Community 61"
Cohesion: 0.19
Nodes (13): Principal, _make(), RBAC tests — updated for v2 Principal API (rank/scope/clearance)., test_dgp_everything(), test_l1_cannot_see_protected_narrative(), test_l1_masks_all(), test_l2_masks_all(), test_l3_can_see_protected_narrative() (+5 more)

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (6): [2026-06-15] — Architecture Update: Multi-Engine Support (Sarvam, Ollama Cloud, BRAIN_ENGINE, SQL_ENGINE, VOICE_BACKEND), Architectural Decisions Recorded, Backend Changes, Environment Files, Frontend Changes, Summary

### Community 67 - "Community 67"
Cohesion: 0.22
Nodes (9): 1. PostgreSQL status confirmed, [2026-06-15] — Local Database Setup: PostgreSQL 17 + pgvector 0.8.2 + Full Schema, 2. pgvector 0.8.2 — build from source (Windows, MSVC), 3. Database creation, 4. Schema applied — `backend/migrations/001_init.sql`, 5. Connectivity verified via Python (`asyncpg`), 6. Backend `.env` — no changes needed, Next steps (deferred) (+1 more)

### Community 94 - "Community 94"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 95 - "Community 95"
Cohesion: 0.33
Nodes (6): [2026-06-15] — Full DB Rebuild: Schema v2 + KSP RBAC + 100k Dataset, Data loaded (Neon + local), Files, Key backend rewrites, RLS verified live, Summary

### Community 96 - "Community 96"
Cohesion: 0.33
Nodes (6): [2026-06-15] — Neon Cloud Database Connected, Files changed, How to switch tracks, Security note, Summary, What was confirmed

### Community 97 - "Community 97"
Cohesion: 0.50
Nodes (4): [2026-06-15] — Architecture Doc Revision: Saaras v3, GPU specs for BGE-M3 + Reranker, Demo-track clarification, Architecture decisions recorded (from updated doc), Changes, Summary

### Community 98 - "Community 98"
Cohesion: 0.20
Nodes (10): [2026-06-15] — Local Model Inference: BGE-M3 + bge-reranker-v2-m3 Wired Up, `backend/app/config.py`, `backend/app/main.py`, `backend/app/models/local/embedder_bge.py` (rewritten), `backend/app/models/local/reranker_bge.py` (rewritten), `backend/.env` + `backend/.env.example`, `backend/requirements.txt`, Environment verified (+2 more)

### Community 99 - "Community 99"
Cohesion: 0.13
Nodes (12): SessionUser, Account, AccountManager(), FetchState, Account, ProfileMenu(), RELOAD_STEPS, SEED_ACCOUNTS (+4 more)

### Community 100 - "Community 100"
Cohesion: 0.22
Nodes (9): [2026-06-15] — Settings Panel: Database Source Dropdown, Backend — `backend/app/api/routes/settings.py` *(new file)*, Backend — `backend/app/config.py`, Backend — `backend/app/db/session.py` (rewritten), Backend — `backend/app/main.py`, `backend/.env` + `backend/.env.example`, Frontend — `frontend/src/components/SettingsDialog.tsx`, Frontend — `frontend/src/lib/api/client.ts` (+1 more)

### Community 101 - "Community 101"
Cohesion: 0.39
Nodes (7): Connection, Path, copy_csv(), get_url(), main(), Satyam — Bulk CSV loader for the synthetic dataset.  Usage:     # Cloud (Neon, Stream a CSV into Postgres via COPY ... FROM STDIN.

### Community 103 - "Community 103"
Cohesion: 0.29
Nodes (3): Audit(), AuditRow, Route

### Community 105 - "Community 105"
Cohesion: 0.15
Nodes (13): [2026-06-16] — E2E Frontend↔Backend Wiring (SATYAM_E2E_WIRING_FIX issues 0–6 + 9), Issue 0 — Demo jurisdiction fix (`backend/app/api/routes/auth.py`), Issue 1 — CrimeMap live hotspots (`frontend/src/components/CrimeMap.tsx`), Issue 2 — Network screen live ego graph (`frontend/src/routes/network.tsx`), Issue 3 — Console results canvas live data (`frontend/src/routes/console.tsx`), Issue 4 — CaseDrawer live data (`frontend/src/components/CaseDrawer.tsx`), Issue 5 — Reports live data (`frontend/src/routes/reports.tsx`), Issue 6 — Audit live entry count (`frontend/src/routes/audit.tsx` + `backend/app/api/routes/audit.py`) (+5 more)

### Community 108 - "Community 108"
Cohesion: 0.22
Nodes (6): BgeReranker, _load_model(), bge-reranker-v2-m3 cross-encoder reranker.  Real local inference — loads weights, Load CrossEncoder once and cache for the process lifetime (~1.1 GB weights)., bge-reranker-v2-m3 cross-encoder.  Registry calls BgeReranker()., Return document indices sorted best-first (rag.py does order[:k]).

### Community 111 - "Community 111"
Cohesion: 0.33
Nodes (4): LocalLLM, Local LLM via an OpenAI-compatible server (vLLM / Ollama). DEMO stub.  Point OPE, get_llm(), Return the brain LLM.      Resolution order:       1. Explicit `engine` arg (per

### Community 112 - "Community 112"
Cohesion: 0.06
Nodes (63): AsyncSession, Principal, AsyncSession, Principal, AsyncSession, Principal, AsyncSession, EgoRequest (+55 more)

### Community 113 - "Community 113"
Cohesion: 0.12
Nodes (11): DarkModeToggle(), ParsedVoice, SCREEN_ROUTES, Shell(), VoiceScreen, Theme, ThemePicker(), THEMES (+3 more)

### Community 116 - "Community 116"
Cohesion: 0.14
Nodes (22): configure_logging(), Structured logging setup., create_app(), lifespan(), FastAPI application factory for Satyam., AsyncSession, Principal, FastAPI (+14 more)

### Community 117 - "Community 117"
Cohesion: 0.40
Nodes (4): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 118 - "Community 118"
Cohesion: 0.31
Nodes (7): Return one L2-normalised 1024-float vector per input text., get_url(), load_embedder(), main(), Satyam — BGE-M3 narrative embedding job.  Fills narratives.embedding (vector(1, Single source of truth: reuse the SAME embedder used at query time.      This, vec_literal()

### Community 119 - "Community 119"
Cohesion: 0.29
Nodes (7): [2026-06-15] — ML Dependency Crash: Full Root-Cause + Fix (`SATYAM_NUMPY_CRASH_FIX.md`), Changes Made, Committed & Pushed, Next Steps, Root Cause (three separate but compounding issues), Summary, Verification Results

### Community 120 - "Community 120"
Cohesion: 0.40
Nodes (5): [2026-06-16] — E2E Formatting & Global Language Toggle (Issues 10 & 11), Backend Changes, Frontend Changes, Summary, Verification

### Community 122 - "Community 122"
Cohesion: 0.28
Nodes (7): AsyncSession, get_embedder(), get_reranker(), Factory that resolves the configured backend to concrete model instances.  Cache, Narrative retrieval (RAG) over pgvector, with reranking.  Embeds the query with, search_narratives(), _to_pgvector()

### Community 123 - "Community 123"
Cohesion: 0.50
Nodes (4): [2026-06-16] — Secure Auth, Live Audit, Map Trails, Victim Network & Hardcoded Values Cleanup (SATYAM_AUTH_AUDIT_MAP_NETWORK_FIX issues 1–5), Frontend Changes, Summary, Verification

## Knowledge Gaps
- **549 isolated node(s):** `Mode`, `KARNATAKA_CENTER`, `Account`, `SEED_ACCOUNTS`, `SwitchPhase` (+544 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DICT` connect `Community 112` to `Community 25`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `Principal` connect `Community 112` to `Community 16`, `Community 33`, `Community 116`, `Community 5`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Are the 37 inferred relationships involving `Principal` (e.g. with `Any` and `AsyncSession`) actually correct?**
  _`Principal` has 37 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `get_settings()` (e.g. with `get_url()` and `main()`) actually correct?**
  _`get_settings()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `Permission` (e.g. with `AsyncSession` and `Principal`) actually correct?**
  _`Permission` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Audit-log endpoint with hash-chain verification (admin/L3+ only).`, `Authentication routes.  Demo login: mints a JWT for any username/rank combo so j`, `# IMPORTANT: district and range must match real values in the synthetic dataset.` to the rest of the system?**
  _650 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03389830508474576 - nodes in this community are weakly interconnected._