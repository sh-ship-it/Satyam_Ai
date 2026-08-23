# Requirements Document

## Introduction

RAG works, in one lane, in one language, and the database that holds it is at 83% of a hard cap. This spec makes the storage budget an enforced constraint first, then defines retrieval quality and Kannada parity as things that must be measured against that budget rather than assumed.

The predecessor spec `rag-retrieval-recovery` restored the lane: `app/pipeline/tools/rag.py` now performs hybrid vector + lexical retrieval fused by Reciprocal Rank Fusion, reranked by BGE, with clearance-based body withholding and per-arm availability flags. That work is substantially implemented in code even though its `tasks.md` checkboxes were never ticked. This spec does not revisit it.

What remains is a coverage and capacity problem, and one live hazard.

**The hazard, and the reason this is a requirements document rather than a backlog note.**

`AGENTS.md` documents the setup step as:

```
python -m seed.embed_narratives   # narratives.embedding + HNSW index; RAG is dead without it
```

with no `--one-per-case` flag. That script's filter is `WHERE embedding IS NULL`, which today matches exactly the 35,993 unembedded Kannada narratives. Following the documented instruction adds an estimated 164.5 MB to a database that has 85.3 MB of free space, breaching the 512 MB cap by roughly 79 MB. Neon places a project over its storage limit into a restricted state, so the documented setup command can take the application down. No code is wrong; the instruction is, and nothing currently prevents it from being followed.

**The capacity position, measured.**

`narratives` is 354 MB of a 427 MB database. Its HNSW index alone (94 MB) is larger than every other table combined. Half the corpus is embedded: all 35,993 English rows, none of the 35,993 Kannada rows. That split is not an oversight — `embed_narratives.py --one-per-case` embeds `min(narrative_id) GROUP BY case_id`, and because every case carries exactly one English and one Kannada narrative with English always holding the lower id, the result is full case coverage in English only. It was the only configuration that fit.

**The quality position, measured.**

An English narrative question returns real cited results (`vector, 5 hits`). A Kannada narrative question does not reach the lane at all: `"ಸರಗಳ್ಳತನ ಪ್ರಕರಣಗಳು"` was routed to `sql_query` and executed `crime_type ILIKE '%robbery%'`. `ROUTER_SYSTEM` carries English-only examples and every keyword list in `_keyword_intent` is English-only. Separately, whether a Kannada query retrieves the English twin of the same case through BGE-M3's multilingual space is **unverified**. It is plausible and it is the cheapest possible answer to Kannada coverage, which is exactly why it must be measured rather than assumed.

Finally, one consumer advertises a capability it does not have. `POST /api/cases/similar/search` is described as finding similar cases by description, ignores the description, selects one anchor case by `crime_type ILIKE`, returns rows matching on `crime_type OR district` ordered by `RANDOM()`, and reports a `similarity_percent` computed as `40 + 30 + 20 + 10`. The embeddings that would make that number real already exist.

### Measured baseline

All figures from the live cloud database. Any later assertion in this spec that contradicts a re-measurement of these must be treated as stale, not as authority.

| Metric | Value |
|---|---|
| Storage cap — **confirmed** 512 MB / 536,870,912 B | 512 MB |
| Database size | 426.7 MB (447,397,888 B) |
| Free space | 85.3 MB |
| `narratives` total | 354 MB |
| — heap / TOAST | 141 MB / 95 MB |
| — `idx_nar_embedding` (HNSW, `m=16`, `halfvec_cosine_ops`) | 94 MB |
| — `idx_nar_bodytsv` (GIN) | 18 MB |
| — pkey + `idx_nar_case` | 6 MB |
| Narratives total / embedded | 71,986 / 35,993 (50.0%) |
| English rows / embedded | 35,993 / 35,993 |
| Kannada rows / embedded | 35,993 / **0** |
| `pg_column_size(embedding)` | 2,052 B, uniform |
| HNSW cost per vector | 2,740 B (94 MB ÷ 35,993) |
| **All-in cost per embedded narrative** | **4,792 B (~4.8 KB)** |
| Body size, English / Kannada | 461 B / 670 B average |
| `audit_log` | 1,540 rows @ 268 B/row |
| `persons` | 249,972 rows, 24 MB |
| Reclaimable bloat | none — vacuumed 2026-08-20, 2,407 dead tuples |

Derived, and the reason a budget requirement has to come first:

| Scenario | Estimated delta | Resulting size | Verdict |
|---|---|---|---|
| Backfill all 35,993 Kannada rows | +164.5 MB | 591.2 MB | breaches the 512 MB cap by 79.2 MB |
| Backfill within current free space only | +85.3 MB max | 512.0 MB | reaches the cap exactly, zero headroom |
| Backfill within the ceiling this spec sets | +21.3 MB max | 448.0 MB | ~4,550 rows, 12.6% of the Kannada corpus |

### Scope

In scope: a numeric storage budget with an enforcing guard; the pre-flight estimate in `seed/embed_narratives.py`; storage reporting on `/health/data`; the `AGENTS.md` and `README.md` setup commands; a retrieval evaluation set and a recorded baseline; bilingual intent routing in `app/pipeline/router.py` and `app/pipeline/prompts.py`; and the `POST /api/cases/similar/search` consumer.

Out of scope, deferred to the design document: which index type or parameters to use, whether vector dimensionality can be reduced, and how many Kannada rows to embed. Those are choices the budget and the measurements constrain; committing to them here would be deciding the design inside the requirements.

Out of scope entirely: chunking strategy, query rewriting, upgrading the Neon tier, moving embeddings to an external vector store, and the `[SPEAK]` tag leak in `orchestrator._extract_speak` (a separate defect, tracked independently).

### Governing constraints

- Storage cap is 512 MB as stated in `embed_narratives.py` and the project documentation. Requirement 1.1 requires this be confirmed against the Neon console before the budget is treated as authoritative, since provider tier limits change.
- BGE-M3 remains the sole embedder. `AGENTS.md` forbids adding hosted embedding models, and seed-time and query-time vectors must continue to share one embedder via `registry.get_embedder`.
- No new dependencies. pgvector, `sentence-transformers` and the local BGE-M3 and BGE-reranker weights are already present.
- RLS scoping, the audit hash chain, and the clearance withholding added by the predecessor spec must not be weakened. All data remains synthetic.
- Migration `002_schema_v2.sql` opens with `DROP TABLE ... CASCADE` and must not be modified.
- The voice path consumes composed chat answers, so any change to what retrieval returns must be verified in both English and Kannada on both `/ask` and `/console`.

## Requirements

### Requirement 1: The storage budget is a stated, numeric, enforced constraint

**User Story:** As the operator of a capped database, I want a written ceiling below the provider limit with reserved headroom, so that the application cannot be taken offline by a routine data operation.

The budget is defined as three numbers against the 512 MB cap. The steady-state ceiling is what the database may occupy at rest. The reserved headroom floor is free space that must never be consumed. The peak ceiling is a higher, temporary allowance for the duration of a single migration, because an index rebuild that creates a replacement before dropping the original needs both resident at once.

| Control | Value | % of cap | Rationale |
|---|---|---|---|
| Provider cap | 512 MB | 100% | breach places the project in a restricted state |
| **Peak ceiling** (during one migration) | **480 MB** | 93.75% | admits a ~47 MB index rebuilt beside a 94 MB original |
| **Steady-state ceiling** | **448 MB** | 87.5% | at-rest limit |
| **Reserved headroom floor** | **64 MB** | 12.5% | ~250,000 audit rows of runway at 268 B/row, plus WAL, temp sort files and vacuum working space |

At the measured 426.7 MB this yields a steady growth budget of 21.3 MB and a transient migration budget of 53.3 MB.

The 64 MB floor is chosen so the reserve remains an availability control rather than a rounding allowance. It is not to be lowered to make a backfill fit; Requirement 4 exists so that capacity is created by reclamation instead.

**CONFIRMED.** The cap is 512 MB = 536,870,912 bytes. Neon's public documentation
phrases the Free plan allowance as "0.5 GB", which read as decimal would be
500,000,000 bytes — 36.9 MB less, and more than the growth budget it governs. The
binary reading is the correct one for this project. `NEON_STORAGE_CAP_BYTES`
overrides it if the plan ever changes.

#### Acceptance Criteria

1. WHEN the budget is first established THEN the 512 MB cap SHALL be confirmed against the Neon console and the confirmed figure recorded, and IF it differs from 512 MB THEN all three controls SHALL be recomputed from the confirmed value at the same percentages. **(Met: confirmed 512 MB / 536,870,912 B.)**
2. WHEN the three control values are defined THEN they SHALL exist as named constants in one location and SHALL NOT be duplicated as literals across scripts, migrations or documentation.
3. WHEN the database is at rest THEN its total size SHALL NOT exceed the steady-state ceiling.
4. WHEN a migration or backfill is in progress THEN total size SHALL NOT exceed the peak ceiling, and on completion the database SHALL be at or below the steady-state ceiling.
5. WHEN an operation would leave free space below the reserved headroom floor THEN the operation SHALL be refused rather than completed.
6. WHEN the budget is expressed THEN it SHALL be stated in bytes as well as megabytes, so that a check cannot disagree with the document through rounding.

### Requirement 2: A pre-flight guard makes breaching the budget impossible

**User Story:** As a developer following the setup instructions, I want a command that would overfill the database to refuse to start, so that I discover the limit before the application is down rather than after.

Detection after the fact is not sufficient. By the time size is observed to have exceeded the ceiling, the rows are written and the space is consumed. The guard must therefore estimate the cost of an operation from its row count and the measured per-row cost, and compare that projection against the budget before writing anything.

#### Acceptance Criteria

1. WHEN a backfill or index build is invoked THEN it SHALL compute a projected final size from the number of rows it will affect and the measured per-row cost, before performing any write.
2. WHEN the projection exceeds the applicable ceiling THEN the operation SHALL exit with a non-zero status and SHALL NOT write any row.
3. WHEN the operation is refused THEN the message SHALL state the current size, the projection, the ceiling breached, and the number of rows that would fit within budget.
4. WHEN `seed/embed_narratives.py` is invoked with no arguments THEN it SHALL NOT be capable of breaching the cap, either by defaulting to a budget-safe row selection or by refusing to run without an explicit acknowledged row limit.
5. WHEN the setup commands in `AGENTS.md` and `README.md` are followed literally on a database at the measured baseline THEN the result SHALL remain within the steady-state ceiling.
6. WHEN the guard is available THEN it SHALL also be runnable standalone, so that current headroom can be checked without invoking a data operation.
7. WHEN the per-row cost used by the projection is stated THEN it SHALL be derived from measurement of the live database rather than from a hardcoded constant that can drift from reality.

### Requirement 3: Storage position is observable

**User Story:** As an operator, I want the application to report how close it is to its storage ceiling, so that the limit is visible before it is reached.

#### Acceptance Criteria

1. WHEN `/health/data` is requested THEN it SHALL report database size in bytes, the three budget controls, and free space against the reserved headroom floor.
2. WHEN `/health/data` is requested THEN it SHALL report total and embedded narrative counts, so coverage and capacity are read from one place.
3. WHEN free space is below the reserved headroom floor THEN the response SHALL indicate a degraded state rather than reporting success.
4. WHEN a storage figure cannot be read THEN the endpoint SHALL retain its existing habit of reporting a sentinel rather than failing the health check.
5. WHEN retrieval executes THEN the existing `rag` tool event SHALL continue to report the strategy actually used and the withheld count.

### Requirement 4: Capacity is reclaimed before it is spent

**User Story:** As a reviewer, I want reclamation measured before any new storage is committed, so that coverage decisions are made against real capacity rather than against the smallest reserve someone is willing to accept.

The measured baseline makes the ordering material. The HNSW index is 94 MB, or 2,740 B per vector at default parameters — roughly 57% of the all-in cost of an embedded narrative. Any reduction in index cost therefore frees more capacity than the entire remaining growth budget of 21.3 MB. A rebuild at reduced parameters that halved it would take the database to approximately 380 MB and the growth budget to approximately 68 MB, which changes what Kannada coverage is affordable by a factor of three. Spending the 21.3 MB first would forfeit that.

#### Acceptance Criteria

1. WHEN a change would consume steady-state budget for new embeddings THEN the reclamation options SHALL first have been measured and their results recorded.
2. WHEN a reclamation option is evaluated THEN both its storage saving and its effect on retrieval quality SHALL be measured, and neither SHALL be reported alone.
3. WHEN a reclamation option is rejected THEN the reason SHALL be recorded, so a later reader does not re-evaluate it from scratch.
4. WHEN the reclaimed capacity is known THEN the number of Kannada rows that can be embedded within the steady-state ceiling SHALL be computed from it and stated as a number.
5. WHEN reclamation requires an index rebuild THEN the sequence SHALL be verified to stay within the peak ceiling at every point, and SHALL leave the lane queryable or state explicitly the window in which it is not.
6. WHEN `idx_nar_bodytsv` is considered for removal THEN it SHALL be retained unless Kannada lexical recall is shown to be replaceable, since it is currently the only arm with any Kannada capability.

### Requirement 5: Retrieval quality is measured, not asserted

**User Story:** As an officer relying on retrieved evidence, I want changes to the index proven not to degrade results, so that a storage optimisation does not quietly make search worse.

No baseline currently exists, so any change to the index is presently unfalsifiable. The evaluation set need not be large; it needs to be labelled, fixed, and recorded before the first change.

#### Acceptance Criteria

1. WHEN the evaluation set is created THEN it SHALL contain queries paired with case identifiers known to be relevant, SHALL cover both English and Kannada, and SHALL include descriptive queries and identifier lookups.
2. WHEN the evaluation set is created THEN it SHALL be committed and version-controlled, so a later run is comparable to an earlier one.
3. WHEN the baseline is recorded THEN it SHALL be measured against the current index configuration before any change to that configuration.
4. WHEN a change to index type, parameters or dimensionality is proposed THEN recall at k and mean reciprocal rank SHALL be measured before and after, and the change SHALL be rejected if quality falls below a tolerance stated in advance.
5. WHEN the evaluation runs THEN it SHALL use `registry.get_embedder`, so it measures the embedder that serves queries.
6. WHEN retrieval quality is reported THEN the strategy that produced each result SHALL be recorded, so a vector regression is not concealed by lexical recall.
7. WHEN the evaluation set is built THEN it SHALL contain no real personal data, consistent with the project-wide synthetic-data rule.

### Requirement 6: The cross-lingual assumption is quantified before it is relied upon

**User Story:** As a reviewer weighing a 164.5 MB backfill against a free alternative, I want the free alternative measured, so that the cheapest option is chosen on evidence rather than on the reputation of the model.

Every case has an embedded English narrative and an unembedded Kannada twin describing the same incident. If a Kannada query reliably retrieves that English twin, Kannada coverage costs nothing. If it does not, no affordable amount of Kannada embedding closes the gap and the design must say so plainly.

#### Acceptance Criteria

1. WHEN the measurement is performed THEN a Kannada query SHALL be issued for cases whose relevant English narrative is known, and the rank at which that narrative is retrieved SHALL be recorded.
2. WHEN cross-lingual retrieval is reported THEN it SHALL be compared against the same query in English on the same cases, so the gap is expressed as a difference rather than an absolute.
3. WHEN cross-lingual retrieval meets the tolerance in Requirement 7 THEN embedding Kannada rows SHALL NOT be required to claim Kannada retrieval, and the storage saving SHALL be recorded.
4. WHEN cross-lingual retrieval fails the tolerance THEN the shortfall SHALL be stated numerically and the design SHALL either propose an affordable partial-coverage option or record that Kannada retrieval parity is unachievable within the budget.
5. WHEN the measurement is reported THEN the embedder, index configuration and database size at the time SHALL be recorded alongside it.
6. WHEN this assumption is documented anywhere in the codebase THEN it SHALL be described as measured or unmeasured according to its actual status, and SHALL NOT be stated as a property of the model.

### Requirement 7: Kannada parity is defined numerically and is reachable

**User Story:** As a Kannada-speaking officer, I want a narrative question in Kannada to reach narrative retrieval and return the same case my English colleague would get, so that the bilingual claim holds in the lane that answers descriptive questions.

Parity has two independent failure points and both are currently open. Retrieval quality is one. Reaching retrieval at all is the other, and it fails first: the measured Kannada query never entered the lane.

#### Acceptance Criteria

1. WHEN a narrative-style question is asked in Kannada THEN the router SHALL classify it into the same intent as the equivalent English question.
2. WHEN the LLM routing lane is unavailable THEN the keyword fallback SHALL classify Kannada input on Kannada terms rather than defaulting on the absence of English matches.
3. WHEN routing behaviour is verified THEN it SHALL be tested for both the LLM lane and the keyword lane, since they classify by different mechanisms and only the keyword lane is unit-testable without a network call.
4. WHEN Kannada parity is claimed THEN it SHALL be expressed as a maximum acceptable difference in recall at k between the Kannada and English forms of the same question, with that tolerance stated before measurement.
5. WHEN a Kannada question reaches retrieval and the corpus can answer it THEN the composed answer SHALL be in Kannada and the spoken summary SHALL be in Kannada, preserving the behaviour verified on `/ask`.
6. WHEN parity is not achieved within the budget THEN the limitation SHALL be documented in the same place the bilingual capability is advertised, rather than left for a user to discover.

### Requirement 8: No consumer claims precision it does not have

**User Story:** As an officer shown a similarity score, I want that number to come from a measurement, so that I do not weigh a fabricated figure as evidence.

`similarity_percent` is currently `40 + 30 + 20 + 10` over attribute equality, ordered by `RANDOM()`, on an endpoint documented as searching by description while never reading the description.

#### Acceptance Criteria

1. WHEN a similarity figure is displayed THEN it SHALL be derived from a computed measure, or SHALL NOT be displayed.
2. WHEN results are described as similar by description THEN the ranking SHALL be computed from the narrative text, or the description SHALL NOT be part of the stated capability.
3. WHEN result ordering is non-deterministic THEN it SHALL NOT be presented as a ranking.
4. WHEN this consumer is wired to retrieval THEN it SHALL reuse `rag.retrieve_narratives` rather than issuing its own vector query, so clearance withholding and RLS scoping apply identically.
5. WHEN this consumer returns no relevant result THEN it SHALL return empty rather than anchoring to an arbitrary case, preserving the existing D9 fix.
6. WHEN the change lands THEN the `search_similar` action in `screen_agent.py` and the `SimilarCaseSearch` component SHALL behave consistently with the corrected capability description.

### Requirement 9: Existing guarantees survive the change

**User Story:** As a reviewer, I want the security and integrity properties already established to be unaffected, so that a capacity exercise does not reopen a closed gap.

#### Acceptance Criteria

1. WHEN retrieval is invoked from any consumer THEN clearance withholding SHALL apply, and a missing principal SHALL take the restrictive branch.
2. WHEN any query executes THEN it SHALL run in the RLS-scoped session, and jurisdiction scoping SHALL NOT be bypassed.
3. WHEN any operation writes to `audit_log` THEN the hash chain SHALL remain verifiable.
4. WHEN embeddings are generated or regenerated THEN they SHALL come from `registry.get_embedder`, so seed-time and query-time vectors share one space.
5. WHEN the work is complete THEN `pytest -m "not integration"` SHALL pass, and the frontend typecheck SHALL remain at its 56-error baseline.
6. WHEN documentation describes the retrieval lane THEN it SHALL match what runs, including embedding coverage, the languages covered, and the storage constraint that produced that coverage.

## Open questions for the design document

These are deliberately unresolved. Each is a decision the budget constrains and the measurements inform, and pre-empting them here would be writing the design.

1. Which reclamation lever is taken: HNSW parameter reduction, a different index type, dimensionality reduction, or a combination. Requirement 5 gates all of them on measured recall.
2. Whether dimensionality reduction is available at all. BGE-M3's dense head is not documented as Matryoshka-trained, so truncation may lose more quality than the storage is worth. This must be measured, not inferred.
3. How many Kannada rows are embedded, if any, and how they are selected if the answer is a subset. Requirement 6 may make the answer zero.
4. Whether the Kannada body text itself is retained. It is roughly 24 MB of the corpus at 670 B per row and is currently searched only by a `simple` text-search configuration that applies no stemming.
5. Whether the storage guard runs in CI. The repository has no `.github` directory today, and the git policy forbids push-triggered workflows.
