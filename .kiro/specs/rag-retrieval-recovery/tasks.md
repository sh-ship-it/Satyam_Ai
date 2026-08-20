# Implementation Plan

## Overview

11 tasks. Tasks 1 to 6 restore the lane using lexical retrieval on the 71,986 narratives already present, and require no migration, no data job and no configuration. Tasks 7 and 8 enable semantic retrieval. Tasks 9 to 11 verify and document.

The critical ordering constraint: task 3 deletes the relevance-free fallback and must land in the same change as task 2, which makes that fallback reachable. Shipping task 2 alone would start presenting unrelated cases as cited evidence.

## Tasks

- [ ] 1. Add the retrieval result types and the test scaffold
  - Add `RetrievalHit` and `RetrievalResult` dataclasses to `app/pipeline/tools/rag.py`
  - Create `backend/tests/test_rag_retrieval.py` with a fake session object whose `execute` returns scripted rows, so every test runs with no database and no model
  - Confirm `pytest -m "not integration"` is green before changing behaviour
  - _Requirements: 1.5_

- [ ] 2. Separate strategy availability from empty results
  - Split the single `try/except` into `_vector_candidates` and `_lexical_candidates`, each returning `(rows, available)`
  - Mark the vector arm unavailable both when the operator raises and when it returns zero rows while `narratives` is non-empty, since the present defect is that the second case does not raise
  - Drive the branch on the two availability flags rather than on whether an exception occurred
  - Return an empty `RetrievalResult` with `strategy = "none"` when neither arm is available
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2.1 Write the reachability tests
  - Property 1: script the vector arm to return an empty list without raising, assert the lexical query executes and its rows are returned
  - Property 2: script the vector arm to raise, assert the lexical arm executes
  - Property 10: assert `hits` is a list on every path including both arms unavailable
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [ ] 3. Delete the relevance-free fallback and add a distance ceiling
  - Remove the `SELECT case_id, body FROM narratives LIMIT :k` query entirely
  - Add `DISTANCE_THRESHOLD = 0.60` and filter vector candidates above it
  - Retain the existing `body_tsv @@ plainto_tsquery(...)` predicate on the lexical arm, which is a genuine relevance condition
  - This task must land in the same commit as task 2
  - _Requirements: 2.1, 2.2, 2.4_

- [ ] 3.1 Write the relevance tests
  - Property 3: script both arms empty, assert the result is empty and assert no unpredicated query was issued, so the deleted path cannot silently return
  - Property 4: assert candidates above the distance ceiling are dropped and those below are kept
  - _Requirements: 2.1, 2.2, 2.4_

- [ ] 4. Implement hybrid retrieval by reciprocal rank fusion
  - Add `RRF_K = 60` and `CANDIDATE_MULTIPLIER = 3`, and implement `_rrf_fuse`
  - Fetch `k * CANDIDATE_MULTIPLIER` candidates per available arm, fuse, then pass the fused set to the existing BGE reranker unchanged, then truncate to `k`
  - Report `strategy` as `hybrid`, `vector`, `lexical` or `none` according to which arms contributed
  - Record in the module docstring that `to_tsvector('simple', body)` applies no stemming and no Kannada configuration, so lexical recall on Kannada narratives is weak
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4.1 Write the fusion tests
  - Property 6: assert RRF ordering is deterministic and that a document present in both lists ranks no worse than its best single-strategy rank
  - Property 7: assert the reported strategy matches the arms that contributed, including `none`
  - Assert the reranker is still invoked with the fused candidate set
  - _Requirements: 3.2, 3.3_

- [ ] 5. Enforce clearance on narrative content
  - Extend both candidate queries to join `cases` and select `crime_type`
  - Implement `_apply_clearance`, called after fusion and before the result leaves the service, routing decisions through the existing `rbac.is_protected` and `Principal.can_see_narrative` rather than reimplementing the rule
  - Withhold the body for insufficient clearance, retaining the hit with `restricted = True` and a fixed notice in place of the text, and increment `withheld_count`
  - Add an optional `principal` parameter, and take the restrictive branch when it is `None`
  - Pass `principal` from the `narrative_search` branch of `orchestrator.py`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 5.1 Write the clearance tests
  - Property 8: assert a protected-crime narrative at clearance L1 returns `restricted = True`, an empty body and a positive `withheld_count`
  - Assert the same narrative at clearance L4 returns its body
  - Property 9: assert `principal=None` withholds protected content
  - Property 11: patch `rbac.is_protected` and assert it is called, proving the rule is not duplicated locally
  - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [ ] 6. Make silent failure impossible
  - Log at warning when the vector arm is unavailable, naming whether it raised or returned no embedded rows
  - Log the strategy actually used for each query
  - Change the orchestrator retrieval tool event from `f"{len(hits)} hits"` to include the strategy and the withheld count, so an SSE consumer can distinguish no-matches from lane-unavailable
  - Add `narratives_embedded` to `/health/data` alongside the existing row counts, retaining the endpoint existing habit of swallowing errors into `-1`
  - Emit no citations when the result is empty
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 2.3, 2.5_

- [ ] 6.1 Verify observability end to end
  - Property 5: assert the orchestrator emits no citation event when retrieval returns empty
  - With the current zero-embedding database, call `/health/data` and confirm `narratives_embedded` reports 0
  - Issue a narrative query and confirm the log names the vector arm as unavailable with the reason
  - _Requirements: 5.1, 5.3, 2.3, 2.5_

- [ ] 7. Add the additive vector index migration
  - Create `backend/migrations/010_narrative_vector_index.sql` with a single `CREATE INDEX IF NOT EXISTS idx_nar_embedding ON narratives USING hnsw (embedding vector_cosine_ops)`
  - Note in a comment that the operator class becomes `halfvec_cosine_ops` if `VECTOR_TYPE` is switched to `halfvec`
  - Create `010_rollback.sql` dropping only that index
  - Do not modify migration `002`, which contains `DROP TABLE ... CASCADE`
  - Confirm the migration is safe to run twice and harmless before embeddings exist
  - _Requirements: 6.2, 6.4_

- [ ] 8. Generate the embeddings
  - Run `python -m seed.embed_narratives` from the `backend` directory against the target database
  - Confirm the job processes only rows with a null embedding and can be interrupted and resumed
  - Confirm it uses `registry.get_embedder`, the same embedder used at query time, so seed-time and query-time vectors share one space
  - Confirm `idx_nar_embedding` exists afterwards, whether created by the job or by migration 010
  - Confirm `/health/data` reports non-zero `narratives_embedded`
  - Confirm the lane switches from `lexical` to `hybrid` with no redeploy
  - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [ ] 9. Correct the documentation
  - Update `docs/ARCHITECTURE.md` where it describes the retrieval lane, so the description matches what runs
  - Fix the `seed.seed` command referenced in `README.md`, `AGENTS.md` and the `Makefile`, which does not exist; the real module is `seed.load_seed`
  - Document the embedding step as an operational task with its actual command
  - Update the `rag.py` module docstring, which currently describes a vector-only design
  - _Requirements: 6.6_

- [ ] 10. Run the manual verification matrix
  - Ask a narrative-style question in the console in English and confirm content is returned and cited rather than a no-records message
  - Repeat in Kannada and confirm the answer composes and the spoken summary plays, since restored context changes what the composer and the TTS path receive
  - Sign in at a low clearance, query a protected-crime topic, and confirm the restricted notice appears with no body text
  - Confirm the SSE tool event now shows the strategy
  - _Requirements: 1.1, 4.2, 5.4_

- [ ] 11. Optional: batch the embedding update
  - Only if task 8 proves slow in wall-clock time against the cloud database
  - Replace the per-row `UPDATE` loop in `embed_narratives.py` with a batched `executemany` or a `VALUES` join, keeping the job resumable
  - Leave the embedder call and the index creation unchanged
  - _Requirements: 6.1_

## Task Dependency Graph

```
1  types + test scaffold
│
├─ 2  availability split ──┐
│                          │  same commit
└─ 3  delete unsafe path ──┘
           │
      2.1, 3.1  reachability + relevance tests
           │
      4  RRF hybrid ─── 4.1  fusion tests
           │
      5  clearance ─── 5.1  clearance tests
           │
      6  observability ─── 6.1  verify
           │
      7  migration 010
           │
      8  run embedding job
           │
      9  documentation
           │
      10  manual verification
           │
      11  optional batching
```

Execution waves. Tasks within a wave have no dependency on each other.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "note": "types and fake-session scaffold" },
    { "wave": 2, "tasks": ["2", "3"], "note": "must ship in one commit; 3 removes the path 2 makes reachable" },
    { "wave": 3, "tasks": ["2.1", "3.1"], "note": "reachability and relevance regression guards" },
    { "wave": 4, "tasks": ["4"], "note": "hybrid fusion" },
    { "wave": 5, "tasks": ["4.1", "5"], "note": "fusion tests and clearance enforcement" },
    { "wave": 6, "tasks": ["5.1", "6"], "note": "clearance tests and observability" },
    { "wave": 7, "tasks": ["6.1", "7"], "note": "observability verification and the index migration" },
    { "wave": 8, "tasks": ["8"], "note": "generate embeddings, upgrades the lane to hybrid" },
    { "wave": 9, "tasks": ["9"], "note": "documentation" },
    { "wave": 10, "tasks": ["10"], "note": "manual verification in EN and KN" },
    { "wave": 11, "tasks": ["11"], "note": "optional, only if task 8 is slow" }
  ]
}
```

Critical path: 1 → 2 and 3 → 4 → 5 → 6 → 10. Tasks 7 and 8 are an enhancement and are not on the path to a working lane.

## Notes

**Tasks 2 and 3 are one commit.** Task 2 makes the lexical fallback reachable. Task 3 deletes the relevance-free query. Landing task 2 alone would activate a path that returns arbitrary narratives, reranks them, and cites them as grounded evidence. Splitting them across commits introduces a worse bug than the one being fixed.

**The lane works before embeddings exist.** After task 6, narrative search returns real lexical results over the 71,986 narratives already present. Tasks 7 and 8 upgrade it from lexical to hybrid. Treating embedding generation as an enhancement rather than a prerequisite is what makes this shippable today.

**This is a security fix as well as a functional one.** Task 5 closes a live gap: raw narrative bodies are currently returned regardless of clearance, and `Principal.can_see_narrative` has zero call sites despite being unit-tested. Restoring retrieval without task 5 would start surfacing PROTECTED-crime narrative text to L1 officers.

**Expect chat answers to change, including spoken ones.** The composer currently receives an empty context for every narrative query. After this work it receives real content, so answers on the console and the copilot will differ, and the Kannada path runs its own post-translation over composed answers. Task 10 verifies both languages deliberately.

**Kannada lexical recall is weak and that is not a regression.** `to_tsvector('simple', body)` has no stemming and no Kannada configuration. Today the lane returns nothing at all, so any lexical result is an improvement. The vector arm addresses this properly after task 8.

**Do not modify migration 002.** It opens with `DROP TABLE ... CASCADE` on the core tables. The vector index goes in 010.

**No new dependencies and no new configuration.** pgvector, `sentence-transformers` and `FlagEmbedding` are installed, the BGE-M3 model loads on CUDA at startup, and `embed_narratives.py` already exists and is correct. Tunables are module constants: `RRF_K = 60`, `DISTANCE_THRESHOLD = 0.60`, `CANDIDATE_MULTIPLIER = 3`.
