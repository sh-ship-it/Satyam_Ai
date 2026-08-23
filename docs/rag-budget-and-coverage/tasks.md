# Implementation Plan

## Overview

16 tasks in three independent tracks.

**Track A, tasks 1 to 4** — make the budget real and close the live hazard. No measurement, no model, no risk, and no dependency on anything else in this plan. Ships first regardless of how the rest resolves.

**Track B, tasks 5 to 12** — measure, then decide. Tasks 11 and 12 are **conditional**: the gate at task 9 may legitimately resolve them to "not required", and that is a completed outcome, not a skipped one.

**Track C, tasks 13 to 14** — Kannada routing and the fabricated similarity score. Neither touches storage. Can run at any point, including before Track B, if either becomes urgent.

Tasks 15 and 16 close out whatever actually happened.

The one irreversible step is task 11, the cloud index rebuild. It is deliberately last among the storage work.

## Tasks

### Track A — budget enforcement and hazard closure

- [x] 1. Confirm the cap and add the budget controls to Settings
  - Open the Neon console and confirm the project's actual storage limit; record the confirmed figure and its date in the spec
  - IF the confirmed limit is not 512 MB THEN recompute all three controls at the same percentages (93.75 / 87.5 / 12.5) and update the requirements table before proceeding
  - Add four byte-valued fields to `app/config.py` Settings: cap, peak ceiling, steady ceiling, reserve floor
  - Store and compare in bytes only; megabytes are for rendered messages
  - Grep for `512` across `seed/`, `docs/` and `AGENTS.md` and replace any literal with a reference to the setting
  - _Requirements: 1.1, 1.2, 1.6_

- [x] 2. Build `app/core/storage.py`
  - Add `StorageState` and `read_state(session)`, reading db size, narrative counts, and both per-row costs from the live database
  - Derive `embedding_bytes_per_row` from `avg(pg_column_size(embedding))` and `index_bytes_per_vector` from `pg_relation_size('idx_nar_embedding') / count(embedding)` — no hardcoded constants
  - Add `Projection` and `project(state, rows, peak=False)`, always computing `rows_affordable` even when the projection fits
  - `explain()` renders current size, projection, the ceiling breached, and affordable rows
  - Raise from `read_state` when a cost cannot be measured; do not substitute a default
  - Add a `__main__` entry so headroom can be checked without invoking a data operation
  - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.6, 2.7_

- [x] 2.1 Unit-test the projection arithmetic
  - Use the fake-session pattern already in `tests/test_rag_retrieval.py`; no database, no model
  - Assert behaviour at, just below and just above each of the three ceilings
  - Assert `rows_affordable` is correct including the zero case and the already-over-budget case
  - Assert a reserve-floor violation refuses even when the steady ceiling is satisfied
  - Assert byte/MB rendering never changes a comparison outcome
  - Assert `read_state` raises rather than defaulting when a cost query returns NULL
  - _Requirements: 1.3, 1.5, 1.6, 2.2, 2.7_

- [x] 3. Wire the guard into the backfill and invert the flag default
  - Call `project()` in `seed/embed_narratives.py` before the first write; exit non-zero and write nothing when it does not fit
  - Make one-per-case selection the **default**; move unrestricted selection behind an explicit `--all-narratives` flag that remains subject to the projection
  - Correct the setup command in `AGENTS.md` and `README.md`, and remove the claim that the unflagged command is the one to run
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 9.6_

- [x] 3.1 Verify the hazard is closed
  - Run the documented setup command against the cloud database at the measured baseline and confirm it stays within the steady ceiling
  - Run `--all-narratives` and confirm it is refused, with a message naming the 512 MB cap and the affordable row count
  - Confirm no row was written in the refused case
  - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 4. Report storage position on `/health/data`
  - Add db size in bytes, the three controls, and free space against the reserve floor
  - Add total and embedded narrative counts so coverage and capacity read from one place
  - Report a degraded state when free space is below the reserve floor
  - Retain the endpoint's existing habit of reporting a sentinel rather than failing when a figure cannot be read
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4.1 Integration-check the reporting
  - Marked `integration`: assert `read_state` against a live database returns plausible measured costs
  - Assert `/health/data` reports degraded when free space is forced below the floor
  - Confirm the existing `rag` tool event still reports strategy and withheld count
  - _Requirements: 3.1, 3.3, 3.5_

### Track B — measure, then decide

- [ ] 5. Build the evaluation set
  - Create `seed/eval/retrieval_set.json`, committed and version-controlled
  - Pair each query with the case identifiers known to be relevant
  - Cover English and Kannada, and include both descriptive queries and identifier lookups (FIR number, vehicle registration, phone)
  - For the cross-lingual pairs, use the self-labelling construction: the Kannada body of case X is a query whose correct answer is X's English narrative
  - Include both query forms per case: the full Kannada body truncated to 300 characters, labelled explicitly as an upper bound, and a short 5-to-12-word Kannada question
  - Confirm the set contains no real personal data
  - Record the sample size; it will be quoted with every figure
  - _Requirements: 5.1, 5.2, 5.7, 6.1_

- [ ] 6. Build `seed/eval_retrieval.py`
  - Operational job in the same family as `embed_narratives.py`, run with the API server stopped
  - Use `registry.get_embedder` so it measures the embedder that serves queries
  - Report recall@k and MRR, and record the strategy that produced each result so a vector regression cannot be concealed by lexical recall
  - Fail with the RAM/GPU diagnosis and the instruction to stop the API server, not a generic OOM
  - Fail rather than silently measuring nothing when the evaluation set is missing or unparseable
  - Record embedder, index configuration, vector type, database size and sample size alongside every result
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 6.5_

- [ ] 7. Mirror local Postgres to the cloud configuration
  - Confirm local is populated, then switch `narratives.embedding` to `halfvec(1024)` so local and cloud differ only in size
  - Embed all 71,986 narratives locally, including the 35,993 Kannada rows, since local has no cap
  - IF the halfvec switch proves impractical THEN measure the fp32-versus-fp16 recall delta on a sample and carry it as a stated correction rather than ignoring it
  - Record local's row counts, vector type and size for the equivalence caveat
  - _Requirements: 5.3, 6.5_

- [ ] 8. Record the baseline
  - Run the harness against the current index configuration before changing anything
  - Record recall@k and MRR for English and Kannada, per query form
  - Commit the results so a later run is comparable
  - _Requirements: 5.3, 5.6_

- [ ] 9. Measure cross-lingual retrieval and evaluate the gate
  - Issue each Kannada query and record the rank at which the case's English narrative is retrieved
  - Run the English form of each query against the same ground truth and report the paired difference, not the absolute
  - State the tolerance for Requirement 7.4 **before** reading the result
  - Record the outcome and the resulting decision: embed no Kannada rows, or proceed to reclamation
  - Update any place in the codebase that describes cross-lingual behaviour so it says measured rather than implied
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.4_

- [ ] 10. Measure the reclamation variants on local
  - Build the candidate index variants side by side under distinct names and query each explicitly, rather than trying to hint the planner
  - Candidates: HNSW at reduced `m`, an alternative index type, and dimensionality reduction if it survives a first check
  - For dimensionality: verify empirically whether BGE-M3 tolerates truncation; its dense head is not documented as Matryoshka-trained, so reject on measured recall loss rather than on reputation
  - Report each variant's storage saving **and** its recall effect; neither alone is a result
  - Record the reason any variant is rejected, so a later reader does not re-evaluate it from scratch
  - Retain `idx_nar_bodytsv` unless Kannada lexical recall is shown to be replaceable
  - Require any decision to turn on a difference large enough to be visible at the recorded sample size, or enlarge the sample first
  - _Requirements: 4.1, 4.2, 4.3, 4.6, 5.4_

- [ ] 11. **Conditional** — rebuild the winning index on cloud
  - Only if task 10 selected a variant smaller than the current index; if the winner is larger, the correct outcome is keeping the status quo and this task is closed as not required
  - Re-run the projection against live figures immediately before building; abandon if it exceeds the peak ceiling
  - Create the replacement under a new name, verify, drop the original, then rename — both indexes coexist so the lane stays queryable with no uncovered window
  - Add `migrations/011_*.sql` plus its rollback; do not modify migration `002`
  - Confirm the database is at or below the steady ceiling on completion
  - Recompute and record the post-reclamation growth budget
  - _Requirements: 1.4, 4.5, 9.6_

- [ ] 12. **Conditional** — embed the Kannada subset
  - Only if the task 9 gate called for it; zero rows is a valid completed outcome
  - Compute the affordable row count from the post-reclamation budget and state it as a number
  - State and justify the selection rule for the subset
  - Run through the task 3 guard like any other backfill; no exemption
  - Confirm the steady ceiling and reserve floor both hold afterwards
  - _Requirements: 4.4, 6.4, 2.1_

### Track C — independent of storage

- [ ] 13. Fix bilingual intent routing
  - Add Kannada examples for each intent to `ROUTER_SYSTEM` in `prompts.py`, mirroring the existing English ones
  - Add Kannada terms to `_STRONG_SQL`, `_KEYWORDS` and `_GREETINGS` in `router.py`
  - Note in a comment that the keyword lane already defaults unmatched input to `narrative_search`, so these additions exist to stop Kannada *aggregation* questions being misrouted, not to fix Kannada narrative search
  - _Requirements: 7.1, 7.2_

- [ ] 13.1 Test both routing lanes separately
  - Unit-test `_keyword_intent` on Kannada aggregation, greeting and narrative phrasings; pure function, no network
  - Live-probe the LLM lane and confirm a Kannada narrative question now routes to `narrative_search`, since that is the lane that produced the measured misroute and it cannot be unit-tested
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 14. Rewrite Similar Cases onto retrieval
  - Rewrite `similar_cases_search` in `intelligence.py` to embed the caller's description and delegate to `rag.retrieve_narratives`, mapping hits to cases
  - Do not issue a second vector query; delegation is what inherits RLS scoping and clearance withholding
  - Delete the `40 + 30 + 20 + 10` arithmetic and the `ORDER BY RANDOM()`; either derive `similarity_percent` from the retrieval score or remove the field
  - Preserve the existing D9 empty-result behaviour: no anchor returns empty, never case_id 1
  - Leave `get_similar_cases(case_id)` attribute logic in place, but ensure it is described as attribute overlap rather than as a similarity percentage
  - Align the `search_similar` action description in `screen_agent.py` and the `SimilarCaseSearch` component with the corrected capability
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 14.1 Verify clearance survives the new path
  - Confirm a low-clearance principal receives the restricted notice through the rewritten endpoint
  - Confirm an out-of-jurisdiction caller sees no rows, proving RLS still applies
  - _Requirements: 8.4, 9.1, 9.2_

### Close-out

- [ ] 15. Run the manual verification matrix
  - Kannada question end-to-end on `/ask`: composes in Kannada, speaks in Kannada, voice toggle still respected
  - English narrative question still returns cited results with the lane disclosure showing the strategy
  - `pytest -m "not integration"` green; frontend typecheck at its 56-error baseline
  - `audit_log` hash chain still verifies
  - `/health/data` reports the real post-change position
  - _Requirements: 7.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 16. Reconcile the documentation with what actually happened
  - Update `AGENTS.md` and `docs/ARCHITECTURE.md` so embedding coverage, languages covered, and the storage constraint that produced that coverage all match reality
  - IF Kannada parity was not achieved within budget THEN document the limitation at the point the bilingual capability is advertised, not in a spec file a user will never open
  - Record the final budget position: size, free space, and the growth budget that remains
  - Tick the checkboxes in this file as work lands, so the plan does not drift from the code the way the predecessor spec's did
  - _Requirements: 6.6, 7.6, 9.6_

## Task Dependency Graph

```
TRACK A (no dependencies, ships first)
1  budget constants
│
2  storage.py ─── 2.1  unit tests
│
3  guard + flag default + docs ─── 3.1  hazard closed
│
4  /health/data ─── 4.1  integration check

TRACK B (depends on A only for the guard in task 12)
5  eval set
│
6  harness
│
7  local mirrored to halfvec
│
8  baseline recorded
│
9  cross-lingual measured ──── GATE ────┐
│                                       │
10  reclamation measured                │ within tolerance:
│                                       │ 11 and 12 not required
11  cloud rebuild (conditional)         │
│                                       │
12  Kannada subset (conditional) ───────┘

TRACK C (fully independent)
13  bilingual routing ─── 13.1  both lanes tested
14  Similar Cases ─────── 14.1  clearance verified

CLOSE-OUT
15  manual matrix   (needs whatever shipped)
16  documentation   (needs 15)
```

Execution waves. Tasks within a wave have no dependency on each other.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "note": "confirm the cap first; every other number derives from it" },
    { "wave": 2, "tasks": ["2", "13"], "note": "storage module and bilingual routing are unrelated" },
    { "wave": 3, "tasks": ["2.1", "13.1", "14"], "note": "unit tests, routing verification, Similar Cases rewrite" },
    { "wave": 4, "tasks": ["3", "14.1"], "note": "guard wired in; clearance verified on the new path" },
    { "wave": 5, "tasks": ["3.1", "4"], "note": "hazard closed and reported" },
    { "wave": 6, "tasks": ["4.1", "5"], "note": "reporting verified; evaluation set built" },
    { "wave": 7, "tasks": ["6"], "note": "harness, run with the API server stopped" },
    { "wave": 8, "tasks": ["7"], "note": "local mirrored to halfvec and fully embedded" },
    { "wave": 9, "tasks": ["8"], "note": "baseline recorded before any change" },
    { "wave": 10, "tasks": ["9"], "note": "cross-lingual gate evaluated; decides 11 and 12" },
    { "wave": 11, "tasks": ["10"], "note": "reclamation variants measured on local" },
    { "wave": 12, "tasks": ["11"], "note": "conditional; the only irreversible step" },
    { "wave": 13, "tasks": ["12"], "note": "conditional; zero rows is a valid outcome" },
    { "wave": 14, "tasks": ["15"], "note": "manual verification" },
    { "wave": 15, "tasks": ["16"], "note": "documentation reconciled" }
  ]
}
```

Critical path to a safe database: 1 → 2 → 3 → 3.1. Four tasks, no measurement, no model, no cloud write.

Critical path to a Kannada decision: 5 → 6 → 7 → 8 → 9.

## Notes

**Tasks 1 to 3.1 are the only ones that matter urgently.** They close a documented command that projects to 591 MB against a 512 MB cap. Everything after that is quality work on a lane that already functions in English. If this spec stalls, it should stall after task 3.1, not before it.

**Task 1 gates every number in the plan.** The 512 MB figure comes from a docstring in `embed_narratives.py`, not from the provider. Confirm it before the three controls are treated as authoritative, because if the real limit differs, every projection in tasks 3, 11 and 12 is wrong by the same proportion.

**Tasks 11 and 12 may correctly do nothing.** If cross-lingual retrieval is within tolerance, the right answer is that Kannada coverage costs zero and no index is rebuilt. Closing them as not-required is success. The failure mode to guard against is treating a passing gate as a reason to spend the budget anyway.

**The reserve floor is not an adjustable parameter.** No task lowers it. If a measurement shows the desired coverage does not fit, the outcome is a documented limitation (task 16) rather than a smaller reserve. This is the constraint the whole spec exists to hold.

**Task 7 needs the API server stopped, and so does task 6.** Measured on the development machine: 15.6 GB RAM with 3.6 GB free and 4.2 GB of an 8.2 GB GPU already held by the running server. A second BGE-M3 load is OS-killed. Do not spend time debugging this as an OOM bug; it is expected and the harness reports it as such.

**Recall transfers between local and cloud; byte counts do not.** Local is fp32 `vector` unless task 7 switches it, cloud is fp16 `halfvec`. Any result that mixes the two is wrong. Storage figures come from cloud, quality figures from local.

**Sample size is quoted with every figure.** A 2-point recall difference on 25 cases is noise. Task 10 requires decisions to rest on differences visible at the recorded sample size, or on a larger sample.

**No new dependencies and no new models.** pgvector, `halfvec`, HNSW, BGE-M3 and the BGE reranker are all installed and working. `AGENTS.md` forbids adding hosted embedders, and BGE-M3 stays the sole one.

**Do not modify migration `002_schema_v2.sql`.** It opens with `DROP TABLE ... CASCADE`. The index rebuild goes in `011`.
