# Graph Report - Satyam  (2026-06-15)

## Corpus Check
- 175 files · ~62,755 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1114 nodes · 1705 edges · 101 communities (81 shown, 20 thin omitted)
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 340 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3b537c0f`
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
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
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

## God Nodes (most connected - your core abstractions)
1. `cn()` - 69 edges
2. `Principal` - 46 edges
3. `Permission` - 29 edges
4. `LLM` - 23 edges
5. `AccessDenied` - 23 edges
6. `get_settings()` - 22 edges
7. `Embedder` - 21 edges
8. `Reranker` - 21 edges
9. `SpeechToText` - 21 edges
10. `TextToSpeech` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Any` --uses--> `Principal`  [INFERRED]
  backend/app/core/masking.py → backend/app/core/rbac.py
- `Principal` --uses--> `Principal`  [INFERRED]
  backend/app/core/masking.py → backend/app/core/rbac.py
- `Audit()` --calls--> `useT()`  [INFERRED]
  frontend/src/routes/audit.tsx → frontend/src/lib/i18n.tsx
- `MapScreen()` --calls--> `useT()`  [INFERRED]
  frontend/src/routes/map.tsx → frontend/src/lib/i18n.tsx
- `Reports()` --calls--> `useT()`  [INFERRED]
  frontend/src/routes/reports.tsx → frontend/src/lib/i18n.tsx

## Import Cycles
- 1-file cycle: `backend/app/main.py -> backend/app/main.py`

## Communities (101 total, 20 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.19
Nodes (11): _BhashiniBase, BhashiniSTT, BhashiniTranslator, BhashiniTTS, Bhashini (Govt. of India) clients — PRIMARY Indic layer (Kannada STT/TTS/MT).  T, Embedder, faster-whisper / IndicConformer STT. DEMO stub., WhisperSTT (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (73): get_scoped_session(), Yield a transaction-scoped session stamped with the caller's RLS context., AsyncSession, Principal, AsyncSession, Principal, AsyncSession, Principal (+65 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (56): dependencies, class-variance-authority, clsx, cmdk, date-fns, embla-carousel-react, @hookform/resolvers, input-otp (+48 more)

### Community 3 - "Community 3"
Cohesion: 0.20
Nodes (11): Sarvam AI clients — PRIMARY voice layer (Kannada + English STT/TTS/MT).  Servi, Sarvam Saaras v2 — speech-to-text for Kannada (kn-IN) and English (en-IN)., Sarvam Bulbul v3 — text-to-speech for Kannada and English., Sarvam Translate — neural MT between Kannada and English., _SarvamBase, SarvamSTT, SarvamTranslator, SarvamTTS (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (38): useIsMobile(), Input, Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader() (+30 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (31): Any, AuditLog, AsyncSession, Principal, AsyncSession, Principal, _digest(), Tamper-evident, hash-chained audit log.  Each entry stores sha256(prev_hash + ca (+23 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (17): AccordionContent, AccordionItem, AccordionTrigger, Avatar, AvatarFallback, AvatarImage, Checkbox, HoverCardContent (+9 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (25): Route, Route, Route, Route, Route, Transcript, Transcripts(), getRouter() (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (13): CaseDrawer(), useT(), AiMsg(), ChatMessage, Console(), Conversation, EDGES, GROUP_COLOR (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (25): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (16): ApiError, authHeaders(), ChatEvent, getAuthToken(), request(), Role, SessionUser, streamChat() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (17): BaseModel, LoginRequest, LoginResponse, SessionUser, CaseDetail, CaseSummary, PersonRef, ChatRequest (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (20): cn(), Badge(), BadgeProps, badgeVariants, Button, ButtonProps, buttonVariants, Calendar() (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (11): configure_logging(), Structured logging setup., create_app(), lifespan(), FastAPI application factory for Satyam., FastAPI, Audit-log endpoint with hash-chain verification badge (admin-only)., Conversational endpoint: grounded answers streamed over SSE.  The response is a (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (16): AsyncSession, Exception, test_allows_simple_select_and_adds_limit(), test_blocks_delete(), test_blocks_multiple_statements(), test_blocks_unknown_table(), test_clamps_large_limit(), Text-to-SQL guardrail.  The LLM is never trusted to produce safe SQL. Every cand (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (18): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (18): Account, AccountManager(), FetchState, DarkModeToggle(), Account, ProfileMenu(), RELOAD_STEPS, SEED_ACCOUNTS (+10 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (7): Footer(), GridBg(), Header(), NB(), PipelineStep, Route, Route

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
Cohesion: 0.15
Nodes (5): BENGALURU_HOTSPOTS, CrimeMap(), Hotspot, Mode, MapScreen()

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (12): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.18
Nodes (8): reportError(), Ctx, DICT, I18nCtx, I18nProvider(), Lang, _MemoryStore, ErrorComponent()

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (8): Embedder, LLM, Abstract model interfaces shared by the api and local backends., Reranker, SpeechToText, TextToSpeech, Translator, Protocol

### Community 27 - "Community 27"
Cohesion: 0.13
Nodes (6): DataActions(), defaultEngineSettings, EngineSettings, formatRemaining(), Status, Tab

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
Cohesion: 0.20
Nodes (9): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut(), DropdownMenuSubContent (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.31
Nodes (8): async_sessionmaker, AsyncEngine, AsyncSession, get_engine(), get_session(), get_sessionmaker(), Async SQLAlchemy engine + session, with graceful demo fallback., FastAPI dependency yielding a transactional session.

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (13): 1. High-level, 2. Request lifecycle (chat), 3. Defense in depth, 4.1 Active lanes (build now — demo), 4.2 Parked as future fallback (Phase 2 — on-prem), 4. Model & API strategy, 5. Two-phase rollout (demo → sovereign), 6. Data model (frozen day one — R8) (+5 more)

### Community 35 - "Community 35"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, build:dev, dev, format, lint (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (8): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (7): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 39 - "Community 39"
Cohesion: 0.20
Nodes (7): AsyncSession, BgeM3Embedder, BGE-M3 embedder (sole embedder for the whole system).  DEMO stub: deterministic, get_embedder(), Narrative retrieval (RAG) over pgvector, with reranking.  Embeds the query with, search_narratives(), _to_pgvector()

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 44 - "Community 44"
Cohesion: 0.16
Nodes (13): GroqLLM, OllamaCloudLLM, OpenAI-compatible Ollama Cloud endpoint for qwen3-coder-next., LLM, get_fallback_llm(), get_llm(), get_sql_llm(), Factory that resolves the configured backend to concrete model instances.  Cache (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (6): Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (3): BlockedByModel, GeminiLLM, Gemini 2.5 Flash client (primary chat / Text-to-SQL lane).  Notes baked in from

### Community 47 - "Community 47"
Cohesion: 0.40
Nodes (5): AsyncSession, ego_network(), hotspots(), Geospatial + network analytics tools (RLS-scoped reads)., Build an ego network: person -> shared cases -> co-involved persons.

### Community 48 - "Community 48"
Cohesion: 0.18
Nodes (6): api, Login(), Route, Item, Reports(), Route

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (5): Model strategy (3 free lanes; ML added later), Monorepo layout, Quick start, Satyam — Conversational AI for the KSP Crime Database, The pipeline (router-first, grounded)

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (5): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants

### Community 51 - "Community 51"
Cohesion: 0.17
Nodes (7): get_principal(), FastAPI dependencies: authenticated principal + RLS-scoped DB session.  The scop, Decode the bearer JWT into a Principal. Raises 401 on any problem., get_settings(), create_access_token(), decode_token(), JWT issuing / verification.

### Community 52 - "Community 52"
Cohesion: 0.40
Nodes (4): AsyncSession, apply_rls_context(), Row-Level Security helpers.  Every request runs as the Postgres role `satyam_app, Stamp the current transaction with the caller's security context.

### Community 53 - "Community 53"
Cohesion: 0.40
Nodes (3): precheck(), Input/output guardrails.   - Pre-flight: block obviously out-of-scope or prompt-, Return a refusal reason if the input should be blocked, else None.

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 55 - "Community 55"
Cohesion: 0.40
Nodes (4): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

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

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (5): ParlerTTS, Indic-Parler-TTS. DEMO stub., get_tts(), Sarvam Bulbul v3 (primary) → Bhashini (fallback) → local Parler-TTS.      Resolu, TextToSpeech

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (3): _keyword_intent(), Intent router. Uses the LLM with a JSON schema, with a cheap keyword fallback so, route()

### Community 67 - "Community 67"
Cohesion: 0.20
Nodes (9): [2026-06-15] — Architecture Update: Multi-Engine Support (Sarvam, Ollama Cloud, BRAIN_ENGINE, SQL_ENGINE, VOICE_BACKEND), [2026-06-15] — Initial Setup, Architectural Decisions Recorded, Backend Changes, Environment Files, Frontend Changes, Log of Changes, Satyam — Project Change Log (`made_till_now.md`) (+1 more)

### Community 93 - "Community 93"
Cohesion: 0.22
Nodes (5): Groq client — low-latency fallback lane (short prompts, TPM-limited).  Used when, Ollama Cloud client — qwen3-coder-next Text-to-SQL option.  Model: qwen3-coder, Application settings, loaded from environment / .env., health(), Liveness / readiness probe.

### Community 94 - "Community 94"
Cohesion: 0.50
Nodes (3): TabsContent, TabsList, TabsTrigger

### Community 95 - "Community 95"
Cohesion: 0.29
Nodes (3): Audit(), DEMO_ROWS, Route

### Community 96 - "Community 96"
Cohesion: 0.61
Nodes (7): Principal, LoginRequest, LoginResponse, login(), me(), Authentication routes.  DEMO login: in development the role switcher mints a JWT, SessionUser

### Community 97 - "Community 97"
Cohesion: 0.36
Nodes (6): main(), Load synthetic data into Postgres and compute narrative embeddings.  Usage:  pyt, _seed_engine(), _vec_literal(), generate(), Synthetic KSP-style crime data generator.  IMPORTANT (spec risk R4): this is SYN

### Community 98 - "Community 98"
Cohesion: 0.40
Nodes (4): BgeReranker, bge-reranker-v2-m3 (cross-encoder). DEMO stub: lexical overlap scoring.  Replace, get_reranker(), Reranker

### Community 99 - "Community 99"
Cohesion: 0.40
Nodes (3): No external model keys => run with deterministic stubs + fixtures., Settings, BaseSettings

### Community 100 - "Community 100"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

## Knowledge Gaps
- **419 isolated node(s):** `1. High-level`, `2. Request lifecycle (chat)`, `3. Defense in depth`, `4.1 Active lanes (build now — demo)`, `4.2 Parked as future fallback (Phase 2 — on-prem)` (+414 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_MemoryStore` connect `Community 25` to `Community 1`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `Principal` connect `Community 1` to `Community 96`, `Community 5`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 41 inferred relationships involving `Principal` (e.g. with `Any` and `AsyncSession`) actually correct?**
  _`Principal` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `Permission` (e.g. with `AsyncSession` and `Principal`) actually correct?**
  _`Permission` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `LLM` (e.g. with `BhashiniSTT` and `BhashiniTranslator`) actually correct?**
  _`LLM` has 20 INFERRED edges - model-reasoned connections that need verification._
- **What connects `1. High-level`, `2. Request lifecycle (chat)`, `3. Defense in depth` to the rest of the system?**
  _498 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.057631257631257635 - nodes in this community are weakly interconnected._