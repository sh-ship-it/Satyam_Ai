# Satyam — Combined Build Prompt

This file combines two additive, won't-break feature build prompts:

1. **Investigation Board (AI Canvas)** — a freeform link-analysis canvas with AI scene generation.
2. **"AI Chat Model" Settings section** — pick Gemini / ChatGPT (OpenAI) / Groq Llama-3.3-70B and see which API key each uses.

---

# PART 1 — INVESTIGATION BOARD (AI CANVAS)

# Satyam — “Investigation Board” (AI Canvas) — Build Prompt

> **Hand this file to your coding agent.** It specifies a NEW, separate screen:
> an infinite canvas / link-analysis “crime board” where the user can add photos,
> draw, type sticky notes, and **tag any two objects with a visible red line**,
> plus a small **AI chatbox** that turns a typed prompt (+ optional uploaded
> photos) into a ready-made board so the user never starts from scratch.
>
> ## ⚠️ NON-NEGOTIABLE: this must NOT break the existing system
> Build it **purely additively**. Concretely:
> 1. **No edits to existing endpoints, schemas, services, or model adapters.**
>    Only NEW files + ONE nav line + ONE `include_router` line + ONE migration.
> 2. **New isolated tables** (`boards`, `board_snapshots`). No FK changes to any
>    existing table; only a *nullable* `owner_user_id` → `users`. **Not** added to
>    `seed/load_seed.py`’s TRUNCATE list, RLS, or the embeddings job.
> 3. **The heavy canvas library is imported ONLY inside `board.tsx`** so it lands
>    in that route’s own code-split chunk and cannot change the bundle or
>    behavior of any existing screen.
> 4. **Multimodal AI is self-contained** in the new board service — do **not**
>    change the shared `GeminiLLM` adapter or the `LLM` protocol.
> 5. **AI output is schema-validated** (Gemini `responseSchema` server-side +
>    `zod` client-side) so a malformed AI response can never corrupt the board.
> 6. **Reuse** existing auth/RBAC (`Permission.CHAT`), `write_audit`, `apiFetch`,
>    and i18n. Nav entry behind a simple feature flag so any failure is contained.
>
> Verified against the latest zip: migrations currently end at `004_demo_dossier.sql`
> (so the new one is **005**); `LLM.complete(..., json_schema=...)` already maps to
> Gemini `responseSchema`; `write_audit(session, *, action=, user_id=, query_text=)`;
> `Permission.CHAT` guard pattern; Shell `NAV` shape `{ to, icon, label: t(...) }`
> with an `isAdmin` conditional spread; frontend `apiFetch` in `lib/api/client.ts`.

---

## 1. Library choice (this is the main dependency risk — read carefully)

There is **no** drawing library installed today. Pick ONE:

| Option | Gives you | React 19? | Recommendation |
|---|---|---|---|
| **tldraw** | Freehand draw, shapes, text/notes, **image shapes**, bindable **arrows** (the red line), infinite pan/zoom, programmatic API to inject AI content | Needs a React-19-compatible release — **pin and test** | ✅ Primary (covers ~90% of the spec) |
| **@xyflow/react** (React Flow) | Clean node–edge link charts + auto-layout | Officially supports React 19 | Safer-compat alternative for the “graph mode” |
| SVG + `perfect-freehand` | Hand-rolled draw + lines | n/a | Zero-new-heavy-dep fallback only |

**Won’t-break rules for the dependency:**
- Install pinned: `bun add tldraw@<react19-compatible>` (this needs network access at build time — if your CI is offline, vendor it or use the React Flow / SVG fallback).
- Verify peer-deps resolve against **React ^19.2** before committing. If tldraw’s release doesn’t support React 19, use `@xyflow/react` instead — the rest of this spec is library-agnostic at the data layer (the `SceneGraph` JSON).
- Import it **only** in `board.tsx` (and its child components). Never import it from `Shell.tsx`, `__root.tsx`, or any shared module.

---

## 2. Database — new migration `005_boards.sql` (isolated, additive)

```sql
-- Investigation Board persistence. Additive & isolated.
-- No FKs to persons/cases/etc. Only a nullable owner -> users. No RLS policy.
-- Safe to drop & recreate without affecting any existing table.

CREATE TABLE IF NOT EXISTS boards (
    board_id      SERIAL PRIMARY KEY,
    owner_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,  -- nullable
    title         TEXT NOT NULL DEFAULT 'Untitled board',
    district      TEXT,                       -- optional, for jurisdiction filtering
    state_json    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- canvas snapshot (tldraw store OR SceneGraph)
    thumbnail     TEXT,                        -- optional data-URL / path
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_snapshots (
    snapshot_id   SERIAL PRIMARY KEY,
    board_id      INT NOT NULL REFERENCES boards(board_id) ON DELETE CASCADE,
    state_json    JSONB NOT NULL,
    note          TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_boards_owner ON boards(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_board_snap_bid ON board_snapshots(board_id);
```

> Do **NOT** add these tables to `load_seed.py`’s TRUNCATE list, to `db/rls.py`,
> or to `embed_narratives.py`. They live outside those systems on purpose.

ORM: put models in a NEW file `backend/app/db/board_models.py` (reuse
`from app.db.models import Base`). Do not touch `db/models.py`.

---

## 3. Backend — schema

`backend/app/schemas/board.py` (Pydantic v2, mirror existing schema style):

```python
from __future__ import annotations
from pydantic import BaseModel, Field

class BoardImage(BaseModel):
    name: str | None = None
    data_url: str          # 'data:image/png;base64,....' (cap size client-side)

class BoardGenerateRequest(BaseModel):
    prompt: str
    images: list[BoardImage] = Field(default_factory=list)
    lang: str = "en"

class SceneNode(BaseModel):
    id: str
    type: str              # 'image' | 'note' | 'entity' | 'text'
    x: float; y: float
    w: float = 220; h: float = 140
    label: str = ""
    image_ref: str | None = None   # index into request.images, or a URL
    color: str | None = None
    entity_kind: str | None = None # 'person' | 'case' | 'account' (for real imports)
    entity_id: int | None = None

class SceneEdge(BaseModel):
    source: str; target: str
    label: str = ""
    color: str = "#ef4444"        # red string by default
    style: str = "solid"          # 'solid' | 'dashed'
    kind: str = "link"            # associate|family|financial|co_accused|phone|inferred

class SceneGraph(BaseModel):
    nodes: list[SceneNode] = Field(default_factory=list)
    edges: list[SceneEdge] = Field(default_factory=list)

class BoardSaveRequest(BaseModel):
    board_id: int | None = None
    title: str = "Untitled board"
    state_json: dict
    thumbnail: str | None = None
```

---

## 4. Backend — service (`backend/app/services/board_service.py`)

The AI generator uses the **schema-constrained** brain (already supported) and a
**self-contained** multimodal call so no shared model code changes.

```python
from __future__ import annotations
import json, httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_settings
from app.models.registry import get_llm
from app.schemas.board import BoardGenerateRequest, SceneGraph
from app.db.board_models import Board, BoardSnapshot

# Gemini responseSchema (constrains the JSON the model may return)
SCENE_SCHEMA = {
  "type": "object",
  "properties": {
    "nodes": {"type": "array", "items": {"type": "object", "properties": {
        "id": {"type": "string"}, "type": {"type": "string"},
        "x": {"type": "number"}, "y": {"type": "number"},
        "w": {"type": "number"}, "h": {"type": "number"},
        "label": {"type": "string"}, "image_ref": {"type": "string"},
        "color": {"type": "string"}}, "required": ["id", "type", "x", "y"]}},
    "edges": {"type": "array", "items": {"type": "object", "properties": {
        "source": {"type": "string"}, "target": {"type": "string"},
        "label": {"type": "string"}, "color": {"type": "string"},
        "style": {"type": "string"}, "kind": {"type": "string"}},
        "required": ["source", "target"]}},
  }, "required": ["nodes", "edges"],
}

SYSTEM = (
  "You are an investigation-board planner for Karnataka State Police. "
  "Return ONLY JSON matching the schema: a scene graph of nodes and edges. "
  "Lay nodes out on a 1600x1000 canvas with no overlaps. Use red solid edges "
  "for strong/suspected links and dashed for inferred. Respond in the user's language."
)

async def generate_scene(req: BoardGenerateRequest) -> SceneGraph:
    settings = get_settings()
    prompt = f"User request ({req.lang}): {req.prompt}\nImages provided: {len(req.images)}"

    # Text-only / no-key path -> reuse the shared brain with schema constraint.
    if not req.images or not getattr(settings, 'gemini_api_key', None):
        raw = await get_llm("gemini").complete(prompt, system=SYSTEM,
                                               temperature=0.2, json_schema=SCENE_SCHEMA)
        return _parse(raw)

    # Multimodal path -> SELF-CONTAINED Gemini vision call (no adapter changes).
    parts = [{"text": SYSTEM + "\n\n" + prompt}]
    for img in req.images:
        b64 = img.data_url.split(",", 1)[-1]
        mime = img.data_url[5:img.data_url.find(";")] or "image/png"
        parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0.2,
                                 "responseMimeType": "application/json",
                                 "responseSchema": SCENE_SCHEMA}}
    model = getattr(settings, 'gemini_model', 'gemini-2.5-flash')
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.gemini_api_key}"  # base == _BASE in models/api/gemini.py
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.post(url, json=body); r.raise_for_status(); data = r.json()
    text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
    return _parse(text)

def _parse(raw: str) -> SceneGraph:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").split("\n", 1)[-1]  # strip ```json fences (brain may add them)
    try:
        return SceneGraph.model_validate_json(raw)
    except Exception:
        return SceneGraph()   # never raise -> board just stays empty, system safe

# --- CRUD (owner-scoped) ---
async def save_board(session, principal, req) -> int: ...
async def load_board(session, principal, board_id) -> dict | None: ...
async def list_boards(session, principal) -> list[dict]: ...
```

> **Confirm against your config:** the exact settings attribute names
> (`gemini_api_key` / `gemini_model`) — read `backend/app/config.py` and match
> them. If they differ, use the real names. The text-only branch already works
> with zero config because it reuses `get_llm`.

### Optional: real-entity import (Tier-1 differentiator, still additive)
Add `import_entities(session, principal, kind, id)` that **reads** via the
existing `intelligence_service` graph/network functions and returns `SceneNode`/
`SceneEdge`. It must only **read** through those already-masked, RLS-scoped
services — never query `persons`/`cases` directly — so clearance & masking are
automatically respected and nothing is duplicated.

---

## 5. Backend — route (`backend/app/api/routes/board.py`) + wiring

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_principal, get_scoped_session
from app.core.audit import write_audit
from app.core.rbac import AccessDenied, Permission, Principal, require
from app.schemas.board import BoardGenerateRequest, BoardSaveRequest, SceneGraph
from app.services import board_service as svc

router = APIRouter()

def _guard(p: Principal) -> None:
    try:
        require(p, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

@router.post("/generate", response_model=SceneGraph)
async def board_generate(req: BoardGenerateRequest,
                         session: AsyncSession = Depends(get_scoped_session),
                         principal: Principal = Depends(get_principal)) -> SceneGraph:
    _guard(principal)
    await write_audit(session, action="board.generate", user_id=principal.officer_id,
                      query_text=req.prompt[:200])
    return await svc.generate_scene(req)

@router.post("/save")
async def board_save(req: BoardSaveRequest,
                     session: AsyncSession = Depends(get_scoped_session),
                     principal: Principal = Depends(get_principal)):
    _guard(principal)
    return {"board_id": await svc.save_board(session, principal, req)}

@router.get("/list")
async def board_list(session: AsyncSession = Depends(get_scoped_session),
                     principal: Principal = Depends(get_principal)):
    _guard(principal)
    return {"boards": await svc.list_boards(session, principal)}

@router.get("/{board_id}")
async def board_load(board_id: int,
                     session: AsyncSession = Depends(get_scoped_session),
                     principal: Principal = Depends(get_principal)):
    _guard(principal)
    b = await svc.load_board(session, principal, board_id)
    if not b: raise HTTPException(404, detail="board not found")
    return b
```

Register in `backend/app/main.py` next to the other includes (ONE line, additive):

```python
from app.api.routes import board as board_routes
app.include_router(board_routes.router, prefix="/api/board", tags=["board"])
```

---

## 6. Frontend — API client (`frontend/src/lib/api/board.ts`)

Mirror `intelligence.ts`: reuse `apiFetch` / `API_BASE` / `getAuthToken` /
`ApiError` from `./client`. Export:
- `board.generate({ prompt, images, lang })` → `POST /api/board/generate`
- `board.save(payload)` / `board.list()` / `board.load(id)`

Mirror the `SceneGraph` / `SceneNode` / `SceneEdge` types in TS **and** define a
`zod` schema (`zod` is already a dep) to validate `generate()`’s response before
touching the canvas:

```ts
import { z } from "zod";
export const SceneNodeZ = z.object({ id: z.string(), type: z.string(),
  x: z.number(), y: z.number(), w: z.number().default(220), h: z.number().default(140),
  label: z.string().default(""), image_ref: z.string().nullish(), color: z.string().nullish() });
export const SceneEdgeZ = z.object({ source: z.string(), target: z.string(),
  label: z.string().default(""), color: z.string().default("#ef4444"),
  style: z.string().default("solid"), kind: z.string().default("link") });
export const SceneGraphZ = z.object({ nodes: z.array(SceneNodeZ), edges: z.array(SceneEdgeZ) });
// On generate(): const scene = SceneGraphZ.parse(await apiFetch(...))  // throws -> caught -> toast, board untouched
```

---

## 7. Frontend — screen (`frontend/src/routes/board.tsx`)

TanStack file route (same pattern as `console.tsx` / `dossier.tsx`). Layout:
- **Canvas (tldraw `<Tldraw>` or React Flow)** filling the screen — native draw,
  shapes, text/notes, image paste/drop, infinite pan/zoom.
- **Red-string tagging:** select two objects → “Link” → create a tldraw **arrow**
  bound to both shapes, styled red (`#ef4444`), with an editable label. Provide a
  legend (red solid = strong/suspected, dashed = inferred, colors per `kind`).
- **Image add:** drag-drop / paste / “Add photo” button → image shape on canvas.
- **AI chatbox (bottom-right dock):** textarea + image attach + “Generate”. On
  submit → `board.generate(...)` → `SceneGraphZ.parse(...)` → **map SceneGraph →
  canvas shapes** (image/note/text nodes + red arrows for edges) and insert them
  so the board is pre-built. Show a `sonner` toast on AI/validation failure
  (the board is never cleared on error).
- **Save / Load / New** using the board API; “Export PNG/PDF” via the existing
  print pattern or tldraw’s export.

```tsx
// SceneGraph -> tldraw shapes (sketch)
function applyScene(editor: Editor, scene: SceneGraph, images: Record<string,string>) {
  const idMap: Record<string, TLShapeId> = {};
  for (const n of scene.nodes) { /* create geo/text/image shape at n.x,n.y; idMap[n.id]=shapeId */ }
  for (const e of scene.edges) { /* create arrow bound idMap[e.source]->idMap[e.target], color e.color */ }
}
```

### Nav + i18n
In `frontend/src/components/Shell.tsx` add ONE entry to the `NAV` array (it is
**not** admin-only — unlike `/dossier`):

```tsx
{ to: "/board", icon: Workflow, label: t("Board") },
// ICON NOTE: verify `Workflow` exists in lucide-react ^0.575. If your build
// errors on the import, fall back to `Network` or `ClipboardList` — both are
// ALREADY imported in this codebase and therefore guaranteed present.
```

Also add a command-bar matcher near the others (lines ~45–55):
```ts
{ to: "/board", words: /(board|canvas|whiteboard|link chart|crime board|ಬೋರ್ಡ್)/i },
```
Add the i18n key `"Board"` (and any labels) to BOTH `lib/i18n.tsx` DICT and
`locales/kn-data.json` so the bilingual toggle keeps working.

### Code-split safety
Because tldraw/React Flow is imported **only** inside `board.tsx` and its
children, TanStack’s file-based routing already emits it as a separate chunk —
other routes’ bundles are unaffected. Do not re-export canvas components from
shared modules. (If you want extra safety, wrap the canvas in `React.lazy` +
`<Suspense>`.)

---

## 8. Safety / won’t-break guarantees baked in
- **Additive only:** new files + 1 nav line + 1 command-bar line + 1 router
  include + 1 migration. No existing file logic changed.
- **AI can’t corrupt state:** server returns schema-constrained JSON; `_parse`
  never raises (empty scene on failure); client re-validates with `zod`.
- **Security preserved:** every endpoint behind `Permission.CHAT`; generate is
  audit-logged; real-entity import (if built) only reads via existing masked,
  RLS-scoped services.
- **Data isolation:** `boards`/`board_snapshots` are new, outside seed/RLS/embed.
- **No model-layer changes:** multimodal call is self-contained; text path reuses
  `get_llm`.
- **No bundle regressions:** canvas lib confined to the `/board` chunk.

---

## 9. Acceptance criteria (works + nothing broke)
- [ ] `POST /api/board/generate` returns a valid `SceneGraph` for a text prompt;
      returns an (empty-but-valid) graph rather than 500 on a bad AI response.
- [ ] With images attached, the multimodal path runs; with no key/demo mode it
      falls back to the text path without error.
- [ ] All `/api/board/*` endpoints return **403** without `Permission.CHAT`.
- [ ] `/board` renders the canvas; user can add a photo, draw, add a note, and
      create a **red link** between two photos with a label.
- [ ] AI chatbox: prompt (+optional photos) → board auto-populates; invalid AI
      JSON → `sonner` toast, **board not cleared**.
- [ ] Save → reload → board restored from `boards.state_json`.
- [ ] **Isolation proof:** `python -m seed.load_seed` does not change
      `SELECT count(*) FROM boards`; `grep -nE "\b(persons|cases|narratives|financial_)\b" backend/app/services/board_service.py` returns nothing (no direct writes/reads of real tables).
- [ ] **No regressions:** every existing route still compiles and renders; the
      canvas library appears only in the `/board` chunk (check the build output).
- [ ] `uvicorn app.main:app` boots with the new router; `bun run build` compiles
      with the new route + icon import.
- [ ] Bilingual toggle still works (new keys in EN + `kn-data.json`).

---

## 10. Build order
1. `005_boards.sql` → apply. 2. `board_models.py` + `schemas/board.py`.
3. `board_service.py` (text path first) + `routes/board.py` + 1-line include → test 200/403.
4. Add multimodal branch → test with an image. 5. `lib/api/board.ts` (+ zod).
6. `board.tsx` canvas + red-string + AI chatbox + Save/Load. 7. Nav + command-bar + i18n.
8. (Optional) real-entity import. 9. Run the acceptance checklist (esp. isolation + no-regression).


---
---

# PART 2 — "AI CHAT MODEL" SETTINGS SECTION (+ CHATGPT/OPENAI ENGINE)

# Satyam — “AI Chat Model” Settings Section (+ ChatGPT/OpenAI engine) — Build Prompt

> **Hand this to your coding agent.** Goal: a Settings section where the user
> picks which AI model powers the chat — **Gemini**, **ChatGPT (OpenAI)**, or
> **Groq Llama-3.3-70B (cloud, fast)** — and can see **which API key each option
> uses** and whether it is configured. The user can switch the model live from
> Settings.
>
> ## ✅ Good news — most of this already exists (verified in your zip)
> - The **Models** tab in `SettingsDialog.tsx` already has a **Brain engine**
>   `<select>` with `gemini` / `groq llama-3.3-70b` / `local`, stored in
>   `localStorage` (`satyam.engine-settings`) as `EngineSettings.brainEngine`.
> - That value is already sent on every chat request as `brain_engine`
>   (`lib/api/client.ts`), received by `ChatRequest.brain_engine`, and resolved
>   in `models/registry.py` `get_llm(engine)`.
>
> So this task is mostly: **(1) add an OpenAI/ChatGPT engine end-to-end**, and
> **(2) upgrade the Brain-engine UI into a clear “AI Chat Model” section that
> shows each provider’s API key + configured status.**
>
> ## ⚠️ NON-NEGOTIABLE: do not break the system (additive only)
> - Add a NEW adapter file + NEW config fields + extend a few `Literal` unions +
>   ONE new (optional) GET endpoint + UI edits. **Do not** remove or rename any
>   existing engine, field, or function.
> - **API keys live server-side in `.env` only** — never typed into the browser,
>   never returned by any endpoint. The UI shows *configured / not configured*
>   booleans, not the secret.
> - Adding the OpenAI key must **not** change demo-mode behavior or any existing
>   default (default brain engine stays `gemini`).

---

## 1. Backend — config (`backend/app/config.py`)

Add next to the existing Gemini/Groq keys (additive):

```python
    # OpenAI (ChatGPT)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"        # or "gpt-4o-mini" for lower cost/latency
    openai_base_url: str = "https://api.openai.com/v1"
```

> Do **not** change the `demo_mode` property. It currently keys off
> `gemini_api_key`/`groq_api_key`; leaving it as-is means adding an OpenAI key
> can never accidentally flip demo mode. (Optional: include `openai_api_key` in
> that OR-check only if you want OpenAI-only deployments to exit demo mode.)

Add to `backend/.env.example`:
```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
```

---

## 2. Backend — new adapter `backend/app/models/api/openai_llm.py`

Mirror `models/api/groq.py` exactly (same `LLM` protocol: `complete` + `stream`).
OpenAI’s Chat Completions API is the same shape Groq already uses.

```python
"""OpenAI (ChatGPT) brain adapter. Mirrors the GroqLLM shape (LLM protocol).
Runs in demo mode (deterministic echo) when OPENAI_API_KEY is unset.
"""
from __future__ import annotations
from typing import AsyncIterator
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
from app.config import get_settings


class OpenAILLM:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.openai_api_key
        self._model = s.openai_model
        self._base = s.openai_base_url.rstrip("/")
        self._demo = not self._key

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=4), reraise=True)
    async def complete(self, prompt: str, *, system: str | None = None,
                       temperature: float = 0.0, json_schema: dict | None = None) -> str:
        if self._demo:
            return f"[demo:openai] {prompt[:240]}"
        messages = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": prompt}
        ]
        body: dict = {"model": self._model, "messages": messages, "temperature": temperature}
        if json_schema:
            # Structured output. Newer models accept a strict json_schema; json_object
            # is the safe, widely-supported fallback (the caller still parses/validates).
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self._base}/chat/completions",
                headers={"Authorization": f"Bearer {self._key}"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        return data["choices"][0]["message"]["content"]

    async def stream(self, prompt: str, *, system: str | None = None,
                     temperature: float = 0.0) -> AsyncIterator[str]:
        text = await self.complete(prompt, system=system, temperature=temperature)
        for word in text.split(" "):
            yield word + " "
```

> Note: when using `response_format=json_object`, prompts that ask for JSON must
> contain the word “JSON” (OpenAI requirement). Your scene/answer prompts already
> instruct JSON, so this is satisfied.

---

## 3. Backend — register the engine (`models/registry.py`)

Extend the brain `get_llm` (additive branch + widen the `Literal`):

```python
@lru_cache
def get_llm(engine: Literal["gemini", "groq", "openai", "local"] | None = None) -> LLM:
    s = get_settings()
    resolved = engine or (None if s.model_backend != "local" else "local") or s.brain_engine
    if resolved == "local":
        from app.models.local.llm_local import LocalLLM
        return LocalLLM()
    if resolved == "groq":
        from app.models.api.groq import GroqLLM
        return GroqLLM()
    if resolved == "openai":                       # NEW
        from app.models.api.openai_llm import OpenAILLM
        return OpenAILLM()
    # default: gemini
    from app.models.api.gemini import GeminiLLM
    return GeminiLLM()
```

Also widen `brain_engine` in `config.py` so it can be set via env:
```python
    brain_engine: Literal["gemini", "groq", "openai"] = "gemini"
```

---

## 4. Backend — widen the request/plumbing `Literal`s (additive, no logic change)

These are just type unions the value passes through; add `"openai"`:

- `backend/app/schemas/chat.py` → `ChatRequest.brain_engine`:
  ```python
  brain_engine: Optional[Literal["gemini", "groq", "openai", "local"]] = None
  ```
- `backend/app/pipeline/orchestrator.py` → lines ~183 and ~220:
  ```python
  brain_engine: Literal["gemini", "groq", "openai", "local"] | None = None,
  ```
  (It already calls `get_llm(brain_engine)` — no other change needed.)
- `backend/app/services/chat_service.py` → `stream_chat` (~line 44): same widening.

> The fallback lane (`get_fallback_llm`) stays Groq — do not change it.

---

## 5. Backend — NEW endpoint: provider availability (so the UI shows which key is set)

Add to the existing settings router `backend/app/api/routes/settings.py` (it is
already included at prefix `/settings/db-source`; add a sibling **GET** that
returns booleans only — never the keys):

```python
class ModelProviderStatus(BaseModel):
    default_brain_engine: str
    gemini_configured: bool
    openai_configured: bool
    groq_configured: bool
    local_available: bool

@router.get("/models", response_model=ModelProviderStatus)   # full path: /settings/db-source/models
async def model_providers(principal: Principal = Depends(get_principal)) -> ModelProviderStatus:
    try:
        require(principal, Permission.CHAT)
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    from app.config import get_settings
    s = get_settings()
    return ModelProviderStatus(
        default_brain_engine=s.brain_engine,
        gemini_configured=bool(s.gemini_api_key),
        openai_configured=bool(s.openai_api_key),
        groq_configured=bool(s.groq_api_key),
        local_available=(s.model_backend == "local"),
    )
```

> Path note: the settings router is mounted at `/settings/db-source`, so this GET
> resolves to `GET /settings/db-source/models`. If you prefer a cleaner
> `/settings/models`, add ONE additional `include_router(settings_routes.router,
> prefix="/settings", ...)` line in `main.py` (additive) — do not move the
> existing mount.

---

## 6. Frontend — add the engine + the “AI Chat Model” section

### 6a. Types (`components/SettingsDialog.tsx`)
Widen `brainEngine` in `EngineSettings` (default unchanged = `gemini`):
```ts
brainEngine: "gemini" | "openai" | "groq" | "local";
```

### 6b. Send it (`lib/api/client.ts`)
Widen the chat payload type (~line 286):
```ts
brain_engine?: "gemini" | "openai" | "groq" | "local";
```
(No other change — it already reads `satyam.engine-settings` and forwards it.)

### 6c. Replace the plain “Brain engine” `<select>` with an “AI Chat Model” card
Inside the `tab === "models"` block, swap the existing Brain-engine `Row` for a
section that lists each model, the **API key it uses**, and a **configured
badge** fetched from the new endpoint:

```tsx
// fetch once when the Models tab opens
const [providers, setProviders] = useState<ModelProviderStatus | null>(null);
useEffect(() => {
  if (tab === "models") api.modelProviders().then(setProviders).catch(() => {});
}, [tab]);

const CHAT_MODELS = [
  { id: "gemini", label: "Gemini 2.5 Flash",        hint: t("Google · multimodal · default"), envKey: "GEMINI_API_KEY", ok: providers?.gemini_configured },
  { id: "openai", label: "ChatGPT (OpenAI)",        hint: t("GPT-4o · strong reasoning"),     envKey: "OPENAI_API_KEY", ok: providers?.openai_configured },
  { id: "groq",   label: "Groq Llama-3.3-70B",      hint: t("Cloud · fastest"),               envKey: "GROQ_API_KEY",   ok: providers?.groq_configured },
] as const;
```
```tsx
<Section title={t("AI Chat Model")} subtitle={t("Choose the model that powers chat. Keys are set on the server (.env).")}>
  <div className="grid gap-2">
    {CHAT_MODELS.map((m) => (
      <button key={m.id} type="button"
        onClick={() => updateEngine("brainEngine", m.id)}
        className={"flex items-center justify-between rounded-[5px] border-2 border-foreground px-3 py-2 text-left transition " +
          (engines.brainEngine === m.id ? "bg-primary text-primary-foreground nb-shadow-sm" : "bg-secondary-background")}
      >
        <span>
          <span className="flex items-center gap-1 text-sm font-bold">
            {engines.brainEngine === m.id && <Check className="h-3 w-3" />}{m.label}
          </span>
          <span className="block text-[10px] opacity-70">{m.hint}</span>
          <span className="block text-[10px] font-mono opacity-60">{t("Uses")} {m.envKey}</span>
        </span>
        <span className={"rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold uppercase " +
          (m.ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
          {m.ok ? t("Configured") : t("No key")}
        </span>
      </button>
    ))}
  </div>
  <p className="text-[10px] text-muted-foreground">
    {t("To enable a model, add its API key to the server .env and restart. Your selection is saved on this device and used for every chat.")}
  </p>
</Section>
```

> Keep the existing **Text-to-SQL engine** and **Voice** pickers as-is. You may
> leave the old `local` brain option available by appending it to `CHAT_MODELS`
> if you still want on-prem; it’s out of scope for the three requested options.

### 6d. API client helper (`lib/api/client.ts`)
Add to the `api` object + a type:
```ts
export type ModelProviderStatus = {
  default_brain_engine: string; gemini_configured: boolean;
  openai_configured: boolean; groq_configured: boolean; local_available: boolean;
};
// inside `api`:
modelProviders: () => apiFetch<ModelProviderStatus>("/settings/db-source/models"),
```
(Match the path you chose in §5.)

### 6e. i18n
Add the new strings (`"AI Chat Model"`, `"Configured"`, `"No key"`, `"Uses"`, the
subtitle/help text) to BOTH `lib/i18n.tsx` DICT and `locales/kn-data.json`.

---

## 7. (Optional) make the Investigation Board canvas use the selected model
If you built the board feature: add `brain_engine?` to `BoardGenerateRequest`
and pass it to `get_llm(req.brain_engine)` in `board_service.generate_scene`,
and send `loadEngineSettings().brainEngine` from `board.ts`. Purely additive.

---

## 8. Acceptance criteria (works + nothing broke)
- [ ] Selecting **ChatGPT (OpenAI)** in Settings → chat requests carry
      `brain_engine: "openai"` → backend routes to `OpenAILLM`.
- [ ] With `OPENAI_API_KEY` set, OpenAI answers; unset → deterministic
      `[demo:openai]` echo (no crash), and the option shows **No key**.
- [ ] `GET /settings/db-source/models` returns the four booleans + default; it
      **never** returns any key string.
- [ ] Switching between Gemini / ChatGPT / Groq from Settings changes the model
      live (no redeploy), and the choice persists across reloads (localStorage).
- [ ] Existing engines (Gemini default, Groq, Local, Text-to-SQL, Voice) are
      unchanged; default brain engine is still `gemini`.
- [ ] `demo_mode` behavior is unchanged.
- [ ] `grep -n openai backend/app/models/registry.py backend/app/schemas/chat.py` shows the new branch/union; `uvicorn app.main:app` boots; `bun run build` compiles.
- [ ] Bilingual toggle still works (new keys added to EN + kn-data.json).

---

## 9. Build order
1. `config.py` keys + `.env.example`. 2. `openai_llm.py` adapter.
3. `registry.get_llm` branch + widen `Literal`s (chat schema, orchestrator, chat_service).
4. `/settings/.../models` GET endpoint. 5. `client.ts` type + `modelProviders()`.
6. SettingsDialog “AI Chat Model” section + widen `EngineSettings`. 7. i18n keys.
8. (Optional) board uses selected engine. 9. Run acceptance checklist.
