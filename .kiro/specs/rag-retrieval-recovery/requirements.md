# Requirements Document

## Introduction

The narrative retrieval lane is completely non-functional and fails silently. `AGENTS.md` lists RAG over case narratives as one of three grounded lanes, and `docs/ARCHITECTURE.md` and the answer system prompt both advertise semantic search over case narratives using BGE-M3 embeddings. None of it works.

**Root cause, two independent faults compounding.**

First, a data gap. All 71,986 rows in `narratives` have `embedding IS NULL`. The embedding job `seed/embed_narratives.py` exists, is resumable and is correct, but has never been run against this database.

Second, and more seriously, a control-flow bug in `app/pipeline/tools/rag.py`. The vector query carries `WHERE n.embedding IS NOT NULL`. With no embedded rows it returns zero rows **without raising**, so the `except` branch that implements the lexical fallback is unreachable. Execution then reaches `if not rows: return []` and the function exits empty. The `try/except` conflates two different conditions: "the vector operator is unavailable", which raises, and "no rows are embedded", which does not.

The consequence is that `search_narratives` returns an empty list for every query, on every call, with no exception, no log line and no metric. The orchestrator receives zero hits, passes an empty context to the composer, and the officer is told no matching records were found. A reasonable operator concludes the data is missing rather than that the retrieval lane is broken.

**Three further defects in the same 63-line function, found during the same review.**

- The third fallback is `SELECT case_id, body FROM narratives LIMIT k*3` with no relevance predicate at all. Those arbitrary rows are then reranked, handed to the composer as grounded data, and cited. Fixing only the control flow would activate this path and start presenting unrelated cases as evidence, which is worse than returning nothing.
- No clearance filtering. Raw `narratives.body` is returned regardless of the caller's clearance. `Principal.can_see_narrative` and `is_protected` exist and are unit-tested, and have zero call sites. So an L1 constable searching narratives can surface PROTECTED-crime narrative text verbatim. By contrast the SQL lane masks PII before rows reach the prompt.
- Retrieval is vector-only. The `body_tsv` generated column and its `idx_nar_bodytsv` GIN index already exist and are used only inside the unreachable `except` branch, so there is no lexical recall for FIR numbers, vehicle registrations, phone numbers or names, which are the highest-value officer queries.

This spec restores the lane, makes silent failure impossible, and closes the clearance gap in the same change. The order matters: the control-flow and safety fixes land before embeddings are generated, so that the lane is correct whether or not embeddings exist.

### Scope

In scope: `app/pipeline/tools/rag.py`, the `narrative_search` branch of `app/pipeline/orchestrator.py`, `app/api/routes/health.py` coverage reporting, one additive migration for the vector index, and running `seed/embed_narratives.py`.

Out of scope: chunking strategy, query rewriting, reranker score exposure, and RAG evaluation harnesses. These are quality improvements on a lane that first has to function.

### Governing constraints

- No new dependencies. `sentence-transformers`, `FlagEmbedding` and pgvector are already installed, and the BGE-M3 model loads on CUDA at startup.
- Seed-time and query-time embeddings must share one embedder, which `embed_narratives.load_embedder` already guarantees by importing `registry.get_embedder`.
- Migration `002_schema_v2.sql` contains `DROP TABLE ... CASCADE` and must not be modified.
- The voice pipeline consumes chat answers. Restoring this lane changes what the composer receives, so both screens must be verified in English and Kannada.

## Requirements

### Requirement 1: Retrieval returns results whenever retrievable content exists

**User Story:** As an officer searching case narratives, I want a query that matches stored text to return that text, so that the search function is usable at all.

#### Acceptance Criteria

1. WHEN narrative content matching a query exists in the caller scope THEN retrieval SHALL return at least one result.
2. WHEN no rows carry embeddings THEN retrieval SHALL fall through to lexical search rather than returning empty.
3. WHEN the vector operator is unavailable and raises THEN retrieval SHALL fall through to lexical search.
4. WHEN a code path distinguishes an error condition from an empty result THEN it SHALL test for each separately and SHALL NOT rely on an exception to detect an empty result.
5. WHEN retrieval returns no results THEN it SHALL be because no content matched, and never because a fallback was unreachable.

### Requirement 2: No unrelated content is ever presented as evidence

**User Story:** As an officer reading a cited answer, I want every citation to be a record that actually matched my query, so that I never act on fabricated grounding.

#### Acceptance Criteria

1. WHEN a retrieval result is returned THEN it SHALL have satisfied a relevance predicate.
2. WHEN no result satisfies a relevance predicate THEN the system SHALL return an empty result rather than arbitrary rows.
3. WHEN retrieval returns empty THEN the composer SHALL state that no matching narratives were found, and SHALL NOT emit citations.
4. WHEN a relevance score is available THEN results below a stated threshold SHALL be excluded.
5. WHEN a citation is emitted THEN it SHALL correspond to a retrieved record.

### Requirement 3: Hybrid retrieval

**User Story:** As an officer searching for an FIR number, a vehicle registration or a name, I want exact-match terms found, so that identifier lookups work as well as descriptive queries.

#### Acceptance Criteria

1. WHEN a query is executed THEN both a lexical and a vector strategy SHALL be attempted where each is available.
2. WHEN both strategies return candidates THEN results SHALL be combined by a documented fusion method.
3. WHEN only one strategy is available THEN retrieval SHALL proceed with that strategy and SHALL record which one was used.
4. WHEN a query contains an exact identifier token THEN lexical matching SHALL be capable of retrieving it.
5. WHEN the existing full-text index is present THEN the lexical path SHALL use it rather than an unindexed scan.

### Requirement 4: Clearance enforcement on narrative content

**User Story:** As a supervising officer, I want narrative text restricted by clearance the way structured PII already is, so that the retrieval lane is not a hole in the access model.

#### Acceptance Criteria

1. WHEN narrative content is returned THEN the caller clearance SHALL be evaluated before the content leaves the service.
2. WHEN a narrative belongs to a protected-crime case AND the caller clearance is insufficient THEN the content SHALL be withheld or redacted.
3. WHEN content is withheld THEN the response SHALL indicate that a restricted record was matched, without disclosing its content.
4. WHEN clearance logic already exists as a tested function THEN the retrieval path SHALL call it rather than reimplementing the rule.
5. WHEN narrative content is placed into a model prompt THEN it SHALL already have passed the same clearance evaluation.

### Requirement 5: Silent failure is impossible

**User Story:** As a developer or operator, I want a broken retrieval lane to be visible, so that a total functional failure cannot sit undetected.

#### Acceptance Criteria

1. WHEN the vector path yields zero candidates THEN the system SHALL emit a log record naming the reason.
2. WHEN retrieval falls back to a secondary strategy THEN the strategy actually used SHALL be recorded.
3. WHEN embedding coverage is below a usable share of rows THEN that fact SHALL be observable through a health endpoint.
4. WHEN the pipeline emits a tool event for retrieval THEN the event SHALL distinguish no-matches from strategy-unavailable.
5. WHEN a lane advertised in the system prompt is non-functional THEN it SHALL be detectable without reading the database directly.

### Requirement 6: Embedding generation and index

**User Story:** As an operator deploying this system, I want a documented, resumable, repeatable way to populate embeddings, so that semantic retrieval can be enabled without guesswork.

#### Acceptance Criteria

1. WHEN the embedding job is run THEN it SHALL populate only rows lacking embeddings and SHALL be safe to interrupt and resume.
2. WHEN the embedding job completes THEN an approximate-nearest-neighbour index SHALL exist on the embedding column.
3. WHEN embeddings are generated THEN they SHALL come from the same embedder used at query time.
4. WHEN the index is created by migration THEN the migration SHALL be additive and SHALL NOT modify an existing migration file.
5. WHEN embeddings are absent THEN the system SHALL remain functional through lexical retrieval, so embedding generation is an enhancement and not a prerequisite.
6. WHEN the job is documented THEN the documented command SHALL be the command that exists.

## Glossary

| Term | Definition |
|---|---|
| **Retrieval lane** | The `narrative_search` intent path: embed the query, search `narratives`, rerank, hand results to the composer as grounded context. |
| **Vector search** | Approximate nearest-neighbour search over pgvector cosine distance on `narratives.embedding`. |
| **Lexical search** | Postgres full-text search against the `body_tsv` generated column, served by the existing `idx_nar_bodytsv` GIN index. |
| **Hybrid retrieval** | Running both strategies and combining their rankings, rather than treating one as a failure-only fallback. |
| **RRF** | Reciprocal Rank Fusion. Combines ranked lists by summing `1 / (k + rank)` per document, requiring no score calibration between strategies. |
| **Relevance predicate** | A condition a row must satisfy to be considered a match, such as a full-text match or a distance below a threshold. A bare `LIMIT` is not a relevance predicate. |
| **Silent failure** | A fault producing a plausible empty result with no exception, log or metric. The present defect. |
| **Embedding coverage** | The share of `narratives` rows with a non-null embedding. Currently zero of 71,986. |
| **Protected crime** | The crime set for which victim identity is restricted, already classified by `rbac.is_protected` and enforced nowhere in this lane. |
| **Abstention** | Returning no result when nothing is relevant, preferred over returning arbitrary rows. |
