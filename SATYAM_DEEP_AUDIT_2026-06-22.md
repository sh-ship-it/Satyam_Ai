# Satyam — Deep Project Audit

> **Date:** 2026-06-22
> **Scope:** Full backend (FastAPI/Python), YOLO inference, frontend (React/TS), config, security
> **Method:** Static analysis (`tsc`, `eslint`), AST review, manual verification of every CRITICAL/HIGH finding against source
> **Status:** Report only — no code was changed in this pass

---

## Executive Summary

| Severity | Count | Headline items |
|----------|-------|----------------|
| 🔴 CRITICAL | 2 | Audit hash-chain race condition; no-op `_guard()` on write-capable ops endpoints |
| 🟠 HIGH | 5 | Default JWT secret; blocking subprocess on event loop; user_id↔officer_id RLS confusion; alias-bypass PII masking; `confirm_item` null-coord 500 |
| 🟡 MEDIUM | 9 | Audit rollback on disconnect; sim task exception swallow; `_yolo_proc` race; `_latest` memory leak; hardcoded URLs; orchestrator masks all errors as "safety filter"; WS token in query; OSRM public default; blocking socket wait |
| 🔵 LOW | 10 | Unauthenticated MJPEG; unbounded track dicts; dead code/unused imports; silent fallbacks; passwordless demo login; misc |

**Compile status:** `npx tsc --noEmit` → **0 errors**. Frontend eslint reports only Prettier-formatting + `no-explicit-any` style issues (no functional bugs).

**Two hard-rule items to note:**
1. *"Never weaken the audit hash chain"* — the chain is **not concurrency-safe** (CRITICAL #1).
2. *"Text-to-SQL targets the masked `persons_v` view"* — `persons_v` was **deliberately removed** in the v2 schema and masking moved to the API layer (documented in `made_till_now.md`). The `AGENTS.md` rule text is now stale; the replacement (`_mask_rows`) is brittle (HIGH #4).

---

## 🔴 CRITICAL

### C1 — Audit hash-chain is not concurrency-safe
- **File:** `backend/app/core/audit.py:36–66` (write), `:69–89` (verify)
- **Evidence:** `write_audit()` does `SELECT … ORDER BY audit_id DESC LIMIT 1` to fetch `prev_hash`, then `INSERT` a row chained to it. Each request runs in its own RLS transaction (`deps.py:48–66`). No `FOR UPDATE`, advisory lock, or single-writer serialization.
- **Impact:** Two concurrent requests (two SSE chats, or chat + intelligence) read the same `prev_hash` and both write rows pointing at it → the chain **forks**. `verify_chain()` walks `audit_id ASC` and will report tamper under normal concurrent load. Directly weakens the tamper-evident guarantee.
- **Fix:** Serialize audit writes — wrap read+insert in `pg_advisory_xact_lock(<const>)`, or chain via a DB trigger/sequence-guarded function, or a dedicated single-writer queue.

### C2 — `_guard()` is a no-op on write/side-effecting ops endpoints
- **File:** `backend/app/api/routes/ops.py:25–27`
- **Evidence:** `def _guard(principal): pass`. Every ops endpoint calls it, but it gates nothing.
- **Impact:** Any authenticated principal — including clearance-L1 `viewer` — can: file a real `Case` (`confirm_item`), insert review items (`detect/notify`), create/simulate dispatches, and **spawn an OS subprocess** (`camera/start`). The imports `AccessDenied, Permission, require` (`ops.py:11`) are unused as a result.
- **Note:** The user explicitly chose to open Response-Ops to all officers in a prior session, so the *read* endpoints being open is intentional. The risk is specifically the **write + process-spawn** endpoints having zero clearance check.
- **Fix:** Keep reads open, but require a minimum clearance (e.g. L2 `RUN_ANALYTICS`) on `confirm_item`, `dispatch*`, `detect/notify`, and `camera/start|stop`.

---

## 🟠 HIGH

### H1 — Weak default JWT secret, no production guard
- **File:** `backend/app/config.py:30`
- **Evidence:** `jwt_secret: str = "change-me-in-production"`. No startup assertion that it changed.
- **Impact:** If `JWT_SECRET` is unset, every token is signed with a public, well-known string → anyone can forge any officer/rank token and bypass all RBAC/RLS.
- **Fix:** Fail fast at startup when `app_env == "production"` and `jwt_secret` is the default.

### H2 — Blocking `subprocess.run` probes on the async event loop
- **File:** `backend/app/api/routes/ops.py:_resolve_python` (~513–517), called from async `camera_start`
- **Evidence:** Up to several synchronous `subprocess.run([py, "-c", "import cv2, ultralytics"], timeout=30)` calls execute on the loop thread; each imports heavy CV libs.
- **Impact:** The entire event loop (all requests, all SSE streams) stalls for seconds whenever a camera is started.
- **Fix:** `await anyio.to_thread.run_sync(...)` for the probes, and cache the resolved interpreter in a module global so it only runs once.

### H3 — `user_id` reused as RLS `officer_id`
- **File:** `backend/app/api/routes/auth.py:191` (`officer_id = db_user.user_id`), `_build_token_and_user:73–89`, `deps.py:60–65`, `db/rls.py`
- **Evidence:** Login bakes `officer_id = users.user_id` into the JWT; `get_scoped_session` stamps `app.officer_id` from it.
- **Impact:** Any RLS policy / `fn_scope_ok()` that compares `app.officer_id` to an `officers.officer_id` (a different table's PK) compares the wrong identifier → potential scope leak or wrongful denial on officer-scoped rows. Audit FK (`audit_log.user_id → users.user_id`) is correct; the bug is reusing that value as the officer identity.
- **Fix:** Carry `user_id` (audit FK) and the real `officers.officer_id` (RLS) as separate JWT claims.

### H4 — PII masking in the SQL lane is alias-based and bypassable
- **File:** `backend/app/pipeline/tools/text_to_sql.py:_mask_rows (37–50)`, `_PII_COLUMNS (~30–35)`; `sql_guard.py:21–24`
- **Evidence:** `persons` (raw) is in `ALLOWED_TABLES`; there is no `persons_v` (deliberately dropped in v2 — see `made_till_now.md`). The only PII protection for L1/L2 callers is `_mask_rows()`, which masks by **exact result-column name** against a fixed set.
- **Impact:** A query that aliases or computes a column — `SELECT p.name AS subject`, `SELECT UPPER(name) …`, `SELECT name AS x` — returns unmasked PII to sub-L3 callers. Real masking-bypass for the most sensitive data.
- **Fix:** Either restore a masked view as the SQL target, or mask by resolved column provenance (sqlglot lineage) rather than output alias name. Also update the stale `AGENTS.md` hard-rule text.

### H5 — `confirm_item` auto-dispatch can pass a null longitude → 500
- **File:** `backend/app/api/routes/ops.py:~440–456` (verified)
- **Evidence:** `min((p for p in idle if p.lat is not None), …)` filters only `lat`, not `lng`. `routing_service.get_route` raises `ValueError` on any null coord (`routing_service.py:36–37`). The `dispatch` endpoint guards both lat and lng; `confirm_item` does not.
- **Impact:** A patrol with `lat` set but `lng` NULL crashes case confirmation with an unhandled 500 (and the case row may already be flushed).
- **Fix:** Filter `p.lat is not None and p.lng is not None` in the generator (match the `dispatch` guard).

---

## 🟡 MEDIUM

### M1 — Audit row can roll back on client disconnect
- **File:** `backend/app/services/chat_service.py:30–49` + `api/routes/chat.py:24–49`
- **Detail:** The chat audit row is written at stream start, but the RLS session commits only when the SSE generator finishes. If the client disconnects mid-stream, the generator is cancelled and the transaction rolls back — the audited query is lost even though tokens were streamed.
- **Fix:** Commit the audit entry in its own short transaction before streaming begins.

### M2 — Fire-and-forget sim tasks swallow exceptions
- **File:** `backend/app/services/ops/sim_service.py:start (~126–132)`
- **Detail:** `asyncio.create_task(_run(...))` keeps no done-callback. A DB error in `_load_meta`/`_persist_status` before the `finally` is never retrieved → silent failure + "Task exception was never retrieved" warning, dispatch left stale.
- **Fix:** Attach `task.add_done_callback(...)` that logs exceptions.

### M3 — `_yolo_proc` global has no lock (double-spawn race)
- **File:** `backend/app/api/routes/ops.py:467, ~533–657`
- **Detail:** Two near-simultaneous `camera/start` calls can both pass the `poll()` check and spawn two detectors; the first `Popen` handle is overwritten and orphaned (zombie + bound MJPEG port). `camera_stop` only terminates the last handle.
- **Fix:** Guard start/stop with an `asyncio.Lock` (or `threading.Lock`).

### M4 — `_latest` registry grows unbounded
- **File:** `backend/app/services/ops/sim_service.py:40, ~90–122`
- **Detail:** COMPLETED/CANCELLED states are written to `_latest` and never removed (only filtered at read time). Memory leak over a long-running process.
- **Fix:** Delete the entry in the `finally` block, or cap with a TTL.

### M5 — Orchestrator reports every error as a "safety filter"
- **File:** `backend/app/pipeline/orchestrator.py:236–242`
- **Detail:** A broad `except Exception` wraps the grounded lane and renders all failures (DB error, Gemini/OSRM failure, KeyError) via `guardrails.safety_fallback()`, telling the user a safety filter fired — while swallowing the real error with no logging.
- **Fix:** Narrow the handler; log unexpected exceptions; only show the safety message for actual guardrail blocks.

### M6 — Hardcoded `http://localhost:8000` callback URL
- **File:** `backend/app/api/routes/ops.py:~588`
- **Detail:** The YOLO subprocess env sets `SATYAM_URL=http://localhost:8000`, hardcoded — breaks in Docker / non-default-port deployments.
- **Fix:** Derive from settings / request base URL.

### M7 — WebSocket auth token in query string
- **File:** `backend/app/api/routes/ops.py:~236–260` (`/ws?token=`)
- **Detail:** JWTs in query strings are captured in access/proxy logs. Acceptable for a demo; the rebuilt Principal also omits station/district/range (fine only because the WS does no scoped reads).
- **Fix:** Move to a subprotocol/header handshake if WS ever does scoped DB reads.

### M8 — Public OSRM demo server as default
- **File:** `backend/app/services/ops/routing_service.py:9`
- **Detail:** `OSRM_BASE_URL` defaults to `http://router.project-osrm.org` (public, rate-limited, plaintext, no SLA) → routing intermittently degrades to straight-line.
- **Fix:** Document/require a self-hosted OSRM for production; log fallbacks.

### M9 — Blocking socket connect in async port-wait
- **File:** `backend/app/api/routes/ops.py:~606–619` (`_wait_for_port`)
- **Detail:** `socket.create_connection(..., timeout=0.15)` is synchronous on the loop; minor per-iteration stalls during camera start.
- **Fix:** Use `asyncio.open_connection`.

---

## 🔵 LOW

| ID | File:Line | Issue | Fix |
|----|-----------|-------|-----|
| L1 | `model/inference/live_cctv.py` `_MJPEGHandler` (~98–151) | Annotated camera feed served on `0.0.0.0` with `Access-Control-Allow-Origin: *`, **no auth** | Bind to `127.0.0.1`; or proxy through the authenticated backend |
| L2 | `model/inference/live_cctv.py` `stopped_since`/`prev_center`/`prev_speed` (~310–330) | Track-ID dicts never pruned → unbounded growth on long streams | Evict track IDs not seen for N frames |
| L3 | `backend/app/api/routes/ops.py:11` | `AccessDenied, Permission, require` imported but unused (because `_guard` is a no-op) | Remove or wire into a real guard |
| L4 | `backend/app/api/routes/auth.py:92–110` | `_get_or_create_officer` defined but never referenced | Remove dead code |
| L5 | `backend/app/services/ops/routing_service.py:39–56` | Broad `except` falls back to straight-line; only stashes `error`, no logging | Log OSRM failures |
| L6 | `backend/app/api/deps.py:31` | Bare `except Exception` on token decode (un-logged) | Log at debug; intentional 401 is fine |
| L7 | `backend/app/api/routes/ops.py:84–108` (`act_on_suggestion`) | `UPDATE` on nonexistent `sug_id` no-ops but still returns `{"ok": true}` | 404 when no row matched |
| L8 | `backend/app/api/routes/auth.py:~180–188` | Demo login accepts empty password when `app_env != production` | Intentional for judges; gate behind explicit `DEMO_MODE` flag |
| L9 | `backend/app/pipeline/tools/rule_sql.py:_q/_place_clause/build_sql` | Inline f-string SQL (re-validated by `sanitize()`, so safe in practice) | Prefer bound params for defense-in-depth |
| L10 | Frontend (many files) | `eslint` reports widespread Prettier-format drift + `@typescript-eslint/no-explicit-any` | Run `bun run format`; type the `any`s in `CaseDrawer.tsx` etc. |

---

## What is NOT a bug (verified, for the record)

- **SQL guard is structurally enforced.** Every executed statement passes `sql_guard.sanitize()` (single SELECT, allow-list, `LIMIT 200`, write/DDL rejected via sqlglot AST). The weakness is the masking layer (H4), not the guard itself.
- **`persons_v` "missing" is intentional.** v2 schema dropped the masked view on purpose and moved masking to `text_to_sql._mask_rows()` (`made_till_now.md:392`, `sql_guard.py:13–16`). The `AGENTS.md` hard-rule text is stale, not the code.
- **`get_route` null-coord handling** is correct by design (raises `ValueError`, callers must guard) — the bug is the one caller (`confirm_item`, H5) that forgot to guard `lng`.
- **`tsc --noEmit` passes with 0 errors** across the frontend.
- **Recent YOLO/MJPEG fixes verified working** (interpreter resolution, free-port selection, pipe draining, annotated stream).

---

## Recommended Fix Order

1. **C1** audit hash-chain lock — protects the core integrity guarantee.
2. **C2 + H5** clearance gate on ops write endpoints + `confirm_item` lng guard — both touch case creation.
3. **H1** JWT secret startup check — one-line, high security value.
4. **H2** thread the `_resolve_python` probe + cache it — removes an event-loop stall users will feel.
5. **H3 / H4** RLS identity split + provenance-based masking — correctness + PII safety.
6. MEDIUM batch (M1–M9), then LOW cleanup.

---

## Verification Commands Used

```
# Frontend
cd frontend && npx tsc --noEmit          # → 0 errors
cd frontend && npx eslint . --quiet      # → Prettier/any style only

# Backend (per file)
backend\.venv\Scripts\python.exe -m py_compile <file>
```

*Audit generated 2026-06-22. No source files were modified during this pass.*

---

## Resolution Log — fixes applied 2026-06-22

| ID | Status | What changed |
|----|--------|--------------|
| **C1** | ✅ Fixed | `core/audit.py`: `pg_advisory_xact_lock(_AUDIT_CHAIN_LOCK_KEY)` taken before read-prev-hash → insert. Serializes all chain appends; auto-releases at txn end. |
| **C2** | ✅ Fixed | `ops.py`: added `_guard_write()` (requires `RUN_ANALYTICS`/L2+, raises 403). Applied to `dispatch`, `simulate`, `simulate-all`, `stop-all`, `corridor/reset`, `demo/stop-all`, `detect/notify`, `review-queue` clear/reject/confirm, `camera/start`, `camera/stop`, `suggestions/{id}/{action}`. Reads stay open. |
| **H1** | ✅ Fixed | `main.py` lifespan: refuses to boot when `app_env=="production"` and `jwt_secret` is the default. |
| **H2** | ✅ Fixed | `ops.py`: `_resolve_python()` now cached in `_yolo_python` and invoked via `await asyncio.to_thread(...)` — no longer blocks the event loop. |
| **H3** | 📝 Noted | Verified `app.officer_id` is **unused** by any RLS policy (`fn_scope_ok` keys on scope/range/district/station). Added a doc note in `rls.py`; no functional change needed until a policy uses it. |
| **H4** | ⚠️ Partial | Documented as design drift (`persons_v` deliberately dropped in v2). Alias-bypass masking left as-is for now — flagged for a follow-up (provenance-based masking or restored view). Not changed to avoid altering SQL-lane behavior mid-demo. |
| **H5** | ✅ Fixed | `ops.py confirm_item`: nearest-patrol filter now requires `p.lat is not None and p.lng is not None`. |
| **M1** | ✅ Fixed | `chat_service.py`: audit row written in its own committed transaction (`_audit_query`) — survives mid-stream client disconnect. |
| **M2** | ✅ Fixed | `sim_service.py`: `task.add_done_callback(_on_done)` logs non-cancel exceptions. |
| **M3** | ✅ Fixed | `ops.py`: `camera_start` body wrapped in `async with _yolo_lock` — no double-spawn. |
| **M4** | ✅ Fixed | `sim_service.py`: `_on_done` pops `_latest[dispatch_id]` on task completion. |
| **M5** | ✅ Fixed | `orchestrator.py`: except block now logs unexpected errors and shows a generic message; only `reason`-bearing guardrail blocks show the safety message. |
| **M6** | ✅ Fixed | New `config.self_base_url`; YOLO subprocess `SATYAM_URL` now derived from it. |
| **M9** | ✅ Fixed | `ops.py`: port-wait uses `asyncio.open_connection` instead of blocking `socket.create_connection`. |
| **L2** | ✅ Fixed | `live_cctv.py`: per-track dicts pruned every 300 frames against `seen_tids`. |
| **L3** | ✅ Fixed | `AccessDenied/Permission/require` now used by `_guard_write` (no longer dead imports). |
| **L5** | ✅ Fixed | `routing_service.py`: OSRM fallback now logged via `log.warning`. |
| **L7** | ✅ Fixed | `ops.py act_on_suggestion`: returns 404 when `rowcount == 0`. |

**Deferred (intentional / low-risk):**
- **M7** (WS token in query), **M8** (public OSRM default), **L1** (MJPEG on 0.0.0.0 — kept for LAN demo visibility), **L4** (dead `_get_or_create_officer`), **L6/L8/L9** — left as documented; either demo-acceptable or out of scope for this pass.

**Verification:** all 10 modified backend files `py_compile` clean; `import app.main` succeeds; `npx tsc --noEmit` → 0 errors; frontend reformatted with Prettier (L10).
