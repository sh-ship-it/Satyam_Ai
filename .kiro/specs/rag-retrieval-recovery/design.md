# Design Document

## Overview

The fix is small and the ordering is the important part. The control-flow bug is repaired and the unsafe fallback removed **before** embeddings are generated, so the lane becomes correct first and semantic second. That way a partially completed rollout never presents unrelated cases as cited evidence.

Four changes, in dependency order:

1. Rewrite `search_narratives` so lexical retrieval is reachable, the relevance-free fallback is deleted, and the strategy used is reported.
2. Add clearance filtering to the same function, closing a live PII gap in the same edit.
3. Add coverage observability so this class of silent failure cannot recur.
4. Generate embeddings and create the vector index, which upgrades the lane from lexical to hybrid with no further code change.

Steps 1 to 3 make the lane work today with zero embeddings. Step 4 is an enhancement, not a prerequisite. That separation is what makes this safe to ship incrementally.

## Verified baseline

| Fact | Value | Consequence |
|---|---|---|
| `narratives` rows | 71,986 | enough text for lexical retrieval to be useful immediately |
| Rows with embeddings | 0 | the vector branch returns empty, not an error, which is the bug |
| `body_tsv` column | present, generated, `to_tsvector('simple', body)` | lexical path needs no schema change |
| `idx_nar_bodytsv` GIN index | present | lexical search is already indexed |
| `idx_nar_case` | present | case joins supported |
| Index on `narratives.embedding` | none | correct today, required after step 4 |
| `VECTOR_TYPE` | `vector` | literals cast to `::vector`, not `halfvec` |
| pgvector extension | installed | no extension work |
| BGE-M3 model | loads on CUDA at startup, confirmed in the boot log | embedder is functional, only the data is missing |
| `embed_narratives.py` | exists, resumable, reuses `registry.get_embedder`, creates HNSW at the end | no new job needs writing |
| `rbac.can_see_narrative`, `rbac.is_protected` | exist, unit-tested in `test_rbac.py`, zero call sites | clearance logic is available and simply unwired |

Throughput note from the job docstring: roughly 25,000 rows per minute on a GPU at FP16, so 71,986 rows is a few minutes of compute. The per-row `UPDATE` loop is one round trip per narrative, so wall-clock time against Neon over SSL will be dominated by network latency rather than by the model. A batched update is an optional improvement, recorded but not required.

## Architecture

```
backend/app/pipeline/tools/rag.py            REWRITTEN   ~63 lines to ~140
backend/app/pipeline/orchestrator.py         MODIFIED    narrative_search branch only
backend/app/api/routes/health.py             MODIFIED    embedding coverage in /health/data
backend/migrations/010_narrative_vector_index.sql  NEW    additive, index only
backend/tests/test_rag_retrieval.py          NEW         pure-function tests with a fake session
```

No schema change to `narratives`. No new dependency. No new configuration.

## Components and Interfaces

### `rag.py` public surface

```python
@dataclass(frozen=True)
class RetrievalHit:
    case_id: int
    text: str
    score: float
    strategy: str          # "vector" | "lexical" | "hybrid"
    restricted: bool       # True when content was withheld for clearance

@dataclass(frozen=True)
class RetrievalResult:
    hits: list[RetrievalHit]          # always a list, empty rather than None
    strategy: str                     # strategy actually used
    vector_available: bool
    lexical_available: bool
    withheld_count: int               # matched but clearance-restricted

async def search_narratives(
    session: AsyncSession,
    query: str,
    *,
    k: int = 5,
    principal: Principal | None = None,
) -> RetrievalResult
```

`principal` is optional so existing callers keep working, but the orchestrator passes it, and when it is `None` the function applies the most restrictive policy rather than the least.

### Internal helpers

```python
RRF_K: int = 60
DISTANCE_THRESHOLD: float = 0.60      # cosine distance ceiling for vector candidates
CANDIDATE_MULTIPLIER: int = 3         # fetch k*3 before rerank

async def _vector_candidates(session, qvec, k) -> tuple[list[Candidate], bool]
async def _lexical_candidates(session, query, k) -> tuple[list[Candidate], bool]
def _rrf_fuse(vector: list[Candidate], lexical: list[Candidate], k: int) -> list[Candidate]
def _apply_clearance(cands, principal) -> tuple[list[Candidate], int]
```

Each candidate function returns `(rows, available)`. `available` is `False` when the strategy could not run at all, which is what separates "unavailable" from "found nothing" and is the heart of the fix.

## Component 1: Reachable control flow

**The bug.** One `try/except` is used to detect two different conditions:

```python
try:
    rows = vector_query()      # returns [] when nothing is embedded, does not raise
except Exception:
    rows = lexical_query()     # unreachable in the zero-embedding case
if not rows:
    return []                  # taken instead
```

**The fix.** Each strategy reports availability explicitly, and emptiness is tested separately from failure.

```
vector_rows, vector_available   = try vector search
    available = False when the operator raises OR when no row carries an embedding
lexical_rows, lexical_available = try lexical search
    available = False only when the query raises

if neither available          -> return empty, strategy "none", log at warning
if both available             -> RRF fuse, strategy "hybrid"
if only one available         -> use it, strategy names it
if fused set is empty         -> return empty, strategy recorded, no citations
```

Embedding availability is determined cheaply. Rather than counting on every request, `_vector_candidates` inspects whether the executed query returned any row at all; a zero-row vector result with a non-zero narrative count is treated as `available = False` and logged. This costs nothing extra and needs no cached coverage state.

## Component 2: Delete the unsafe fallback

The third fallback is removed outright:

```sql
-- DELETED
SELECT case_id, body FROM narratives LIMIT :k
```

It has no relevance predicate, so its rows are arbitrary, and they were being reranked, handed to the composer as grounded data, and cited. Returning nothing is honest; citing an unrelated case is not. This is why the control-flow fix cannot ship without this deletion in the same change.

Two additional relevance guards:

- Vector candidates are filtered to `distance <= DISTANCE_THRESHOLD`, so an embedded but irrelevant narrative is not returned merely because it was the nearest of a bad set.
- Lexical candidates already require `body_tsv @@ plainto_tsquery(...)`, which is a genuine predicate and is retained.

## Component 3: Hybrid retrieval by RRF

Reciprocal Rank Fusion is chosen because it requires no score calibration between a cosine distance and a `ts_rank`, which are not comparable:

```
score(doc) = sum over strategies of 1 / (RRF_K + rank_in_that_strategy)
```

Candidates are fetched at `k * CANDIDATE_MULTIPLIER` per strategy, fused, then passed to the existing BGE reranker, then truncated to `k`. The reranker call is unchanged, so its behaviour is preserved.

Today, with zero embeddings, only the lexical arm contributes and `strategy` reports `"lexical"`. After step 4 both arms contribute and it reports `"hybrid"`. No code change is needed at the switchover.

A known limitation is recorded in the module docstring rather than fixed here: `to_tsvector('simple', body)` applies no stemming and no Kannada language configuration, so lexical recall on Kannada narratives is weak. That belongs to the out-of-scope quality work.

## Component 4: Clearance enforcement

`_apply_clearance` runs after fusion and before the result leaves the service, so nothing unfiltered can reach a prompt.

For each candidate, the crime type of the owning case is needed. The candidate query is extended to join `cases` and select `crime_type`, which is cheap and covered by the existing primary key. Then:

- `rbac.is_protected(crime_type)` and `principal.can_see_narrative(...)` decide the outcome. These are the existing, unit-tested functions; no rule is reimplemented.
- Insufficient clearance withholds the body. The hit is retained with `restricted = True` and its text replaced by a fixed notice, so the officer learns that a restricted record matched without seeing its content.
- `withheld_count` is reported.
- When `principal` is `None`, the restrictive branch is taken.

Note that RLS already scopes *which* narratives are visible by jurisdiction. This adds field-level restriction by clearance, which RLS does not and cannot express.

## Component 5: Observability

- `_vector_candidates` logs at warning when the vector arm is unavailable, naming whether it raised or returned no embedded rows.
- The strategy actually used is logged per query and returned in `RetrievalResult`.
- The orchestrator tool event changes from `f"{len(hits)} hits"` to include the strategy and the withheld count, so an SSE consumer can see `lexical, 3 hits` versus `none, 0 hits`. This distinguishes no-matches from lane-unavailable, which the current event cannot.
- `/health/data` gains `narratives_embedded` alongside the existing row counts, so zero coverage is visible without querying the database directly. The endpoint already swallows exceptions into `-1`, and that behaviour is retained for consistency.

## Data Models

No change to `narratives`. One additive migration containing a single index.

```sql
-- backend/migrations/010_narrative_vector_index.sql
-- Additive. Safe to re-run. Requires embeddings to be present to be useful.
CREATE INDEX IF NOT EXISTS idx_nar_embedding
    ON narratives USING hnsw (embedding vector_cosine_ops);
```

The index is intentionally separate from the embedding job even though `embed_narratives.py` also creates it, so that a database restored from migrations alone ends up in the same state. The `IF NOT EXISTS` clause makes running both harmless. If `VECTOR_TYPE` is ever switched to `halfvec`, the operator class becomes `halfvec_cosine_ops`; this is recorded in the migration comment.

`010_rollback.sql` drops only `idx_nar_embedding`.

## Correctness Properties

### Property 1: Lexical reachability
When the vector arm returns zero rows without raising, the lexical arm executes. This is the direct regression guard for the reported defect.
**Validates: Requirements 1.2, 1.4**

### Property 2: Exception reachability
When the vector arm raises, the lexical arm executes.
**Validates: Requirements 1.3**

### Property 3: No arbitrary rows
No code path returns a row that did not satisfy a relevance predicate. A query matching nothing yields an empty result.
**Validates: Requirements 2.1, 2.2**

### Property 4: Distance ceiling
Vector candidates with a cosine distance above the threshold are excluded.
**Validates: Requirements 2.4**

### Property 5: Empty means no citations
When the result is empty, the orchestrator emits no citation events.
**Validates: Requirements 2.3, 2.5**

### Property 6: Fusion soundness
Given two ranked lists, RRF ordering is deterministic, and a document appearing in both ranks no lower than its best single-strategy rank.
**Validates: Requirements 3.2**

### Property 7: Strategy honesty
The reported strategy matches the arms that actually contributed, and is `none` when neither was available.
**Validates: Requirements 3.3, 5.2, 5.4**

### Property 8: Protected content withheld
A protected-crime narrative requested by an insufficient clearance is returned with `restricted = True` and its body replaced.
**Validates: Requirements 4.1, 4.2, 4.3**

### Property 9: Fail closed on missing principal
When `principal` is `None`, the restrictive branch is taken.
**Validates: Requirements 4.1, 4.5**

### Property 10: Result shape
`hits` is always a list, never `None`, on every path including both failure paths.
**Validates: Requirements 1.5**

### Property 11: Existing clearance logic reused
Clearance decisions route through `rbac.is_protected` and `Principal.can_see_narrative` rather than a local reimplementation.
**Validates: Requirements 4.4**

## Error Handling

| Condition | Handling | Result |
|---|---|---|
| Zero rows embedded | vector arm marked unavailable, warning logged | lexical results, strategy `lexical` |
| pgvector operator raises | exception caught, vector arm unavailable, warning logged with the exception | lexical results, strategy `lexical` |
| Lexical query raises | exception caught, lexical arm unavailable, warning logged | vector results if available, otherwise empty |
| Both arms unavailable | warning logged naming both reasons | empty result, strategy `none`, composer states no matches |
| Query embeds to nothing, embedder raises | vector arm unavailable | lexical results |
| Reranker raises | fall back to fused order, log at warning | results still returned, order degraded |
| All candidates clearance-restricted | `hits` carries restricted entries, `withheld_count` positive | officer sees that restricted records matched, no content |
| `principal` is `None` | restrictive branch | protected content withheld |
| Index absent | vector search still functions as exact KNN, slower | correct results, slower query |
| Embedding job interrupted | job is resumable, only null rows are processed on restart | partial coverage, hybrid still works |
| Migration re-run | `IF NOT EXISTS` | no effect |

No new exception type. No path returns a partially populated result that would violate a Correctness Property.

## Testing Strategy

All unit tests use a fake session object that returns scripted rows, so the suite runs in CI with no database and no model. This matters because the defect is a control-flow fault, which is exactly what a fake session can prove.

| Test | Asserts |
|---|---|
| `test_vector_empty_falls_through` | Property 1. Vector arm scripted to return `[]` without raising; assert the lexical query is executed and its rows are returned. This is the regression guard for the reported bug. |
| `test_vector_raises_falls_through` | Property 2. Vector arm scripted to raise; assert the lexical arm runs. |
| `test_no_arbitrary_rows` | Property 3. Both arms scripted empty; assert the result is empty and that no unpredicated query was issued. Guards the deleted `LIMIT k*3` path from returning. |
| `test_distance_threshold` | Property 4. Candidates above the ceiling are dropped, those below are kept. |
| `test_rrf_fusion` | Property 6. Deterministic ordering; a document in both lists ranks no worse than its best single-strategy rank. |
| `test_strategy_reported` | Property 7. `strategy` is `hybrid`, `vector`, `lexical` or `none` matching which arms contributed. |
| `test_protected_withheld` | Property 8. A protected-crime narrative at clearance L1 returns `restricted = True` with the body replaced and `withheld_count` incremented. |
| `test_protected_visible_at_l4` | The same narrative at clearance L4 returns its body. |
| `test_missing_principal_fails_closed` | Property 9. `principal=None` withholds protected content. |
| `test_result_always_list` | Property 10. `hits` is a list on every path, including both arms unavailable. |
| `test_clearance_uses_rbac` | Property 11. Patch `rbac.is_protected` and assert it is called, proving the rule is not reimplemented locally. |

Integration checks, marked so CI can exclude them:

- With zero embeddings, issue a narrative query and assert a non-empty result with `strategy == "lexical"`.
- After the embedding job, assert `strategy == "hybrid"` and that `/health/data` reports non-zero `narratives_embedded`.

Manual verification, because the composer and the voice path are downstream:

1. Ask a narrative-style question in the console in English; confirm content is returned and cited rather than "no matching records".
2. Repeat in Kannada; confirm the answer composes and the spoken summary plays.
3. Sign in at a low clearance and query a protected-crime topic; confirm the restricted notice appears and no body text is shown.
4. Check the SSE tool event now shows the strategy, so a future failure is visible in the stream.
## Deployment

1. **Ship the code fix.** Steps 1 to 3 make the lane work using lexical retrieval on the 71,986 narratives already present. No migration, no data job, no configuration. Verifiable immediately.
2. **Apply migration 010.** Additive, idempotent, single index. Harmless before embeddings exist.
3. **Run the embedding job.** `cd backend` then `python -m seed.embed_narratives`. Resumable, so it can be interrupted. It creates the HNSW index itself if migration 010 has not been applied. Expect a few minutes of GPU compute plus network time for 71,986 rows.
4. **Confirm coverage.** `/health/data` reports `narratives_embedded`. The lane switches from `lexical` to `hybrid` automatically with no redeploy.

Rollback is a code revert. The index and the embeddings are additive and harmless if left in place.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Restoring the lane changes chat answers, including spoken ones | High, and intended | The composer receives real context instead of empty. Both screens verified in EN and KN, since the Kannada path runs its own post-translation over composed answers. |
| Lexical recall is weak on Kannada narratives | Medium | `to_tsvector('simple', ...)` has no Kannada configuration. Recorded as a known limitation; the vector arm addresses it after step 4. Not a regression, since the lane returns nothing today. |
| Distance threshold is mis-tuned and over-filters | Medium | Threshold is a documented module constant, tuned against real queries once embeddings exist. Until then only the lexical arm is active, so the threshold has no effect. |
| Clearance filtering suppresses results officers expect | Low | Restricted hits are retained with a notice and counted, so suppression is visible rather than silent. Uses the already-tested rule set. |
| Embedding job saturates the Neon connection | Low | Job is resumable and batched at 64. Run off-peak. A batched `UPDATE` is an optional improvement if the row-by-row loop proves slow. |
| Officers had adapted to empty narrative search | Low | Worth announcing that the lane now returns content, so a behaviour change is not mistaken for a new fault. |

## What this design deliberately does not do

- No chunking. Narratives are embedded and returned whole, as today. Span-level citation is out of scope.
- No query rewriting, HyDE, or multi-query expansion.
- No reranker score exposure or score-based abstention, since the `Reranker` protocol returns indices only. The distance threshold is used instead.
- No RAG evaluation harness. That requires a labelled set and belongs to its own spec.
- No change to `narratives.language`, which remains unused.
- No change to migration `002`.
