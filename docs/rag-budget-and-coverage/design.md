# Design Document

## Overview

This design turns the storage budget into enforced code, then uses a measurement environment that is not subject to that budget to answer the questions the budget makes expensive.

The central move is architectural, not incremental: **all retrieval-quality and index-cost experiments run against local Postgres, and the cloud database receives only the winning configuration.** The 512 MB cap is a property of the Neon free tier, not of the schema. `LOCAL_DATABASE_URL` already exists, `migrations/008_local_app_grants.sql` already provisions it, and `DB_SOURCE=local` already switches the application onto it. Local has no cap, so it can hold all 71,986 embeddings — including the 35,993 Kannada rows that will never fit in the cloud. That makes the upper bound on Kannada retrieval measurable for free, which is the one number that determines whether any cloud spend is justified at all.

Without that, every experiment costs cloud headroom we have 21.3 MB of, and a rejected experiment costs it permanently.

## Constraints carried from the requirements

| | |
|---|---|
| Peak ceiling (one migration) | 480 MB / 503,316,480 B |
| Steady-state ceiling | 448 MB / 469,762,048 B |
| Reserved headroom floor | 64 MB / 67,108,864 B |
| Measured current size | 426.7 MB / 447,397,888 B |
| Steady growth budget | 21.3 MB |
| All-in cost per embedded narrative | 4,792 B |

## Newly measured constraint: the harness cannot load its own model

Measured on the development machine: 15.6 GB RAM with 3.6 GB free, and an 8.2 GB GPU with 4.2 GB already resident from the running API server's BGE-M3 plus BGE-reranker. Two attempts to load a second BGE-M3 copy in a separate process were killed by the OS, on CPU and on GPU.

This is a hard constraint on the design of the evaluation harness, and it rules out the obvious shape (a standalone script that imports `registry.get_embedder` and runs alongside the server).

**Decision: the harness runs as a standalone process with the API server stopped.** It is an operational job in the same family as `seed/embed_narratives.py`, which has the same property and the same requirement.

Rejected: adding an internal embedding endpoint so the harness could reuse the server's warm model. It would put an unauthenticated compute primitive into a police application to save an operator one `Ctrl-C`, and it would need RBAC, rate limiting and audit coverage to be acceptable — all of that to serve a job that runs a handful of times.

Rejected: loading the model at reduced precision to fit alongside the server. The harness must measure the embedder that serves production queries; changing its precision to make it fit changes the thing being measured.

## Architecture decisions

### D1. Budget constants live in `Settings`, not in a new module

`app/config.py` and `get_settings()` are the project's established single source of truth, and `seed/` scripts already import from it. The three controls plus the cap become settings fields with the measured defaults, satisfying Requirement 1.2 without introducing a parallel configuration path.

Values are stored and compared **in bytes**. Megabytes appear only in rendered messages. Requirement 1.6 exists because a check that rounds to MB and a document that rounds differently will eventually disagree by a megabyte and the disagreement will be resolved in favour of whichever one is easier to read.

### D2. One guard module, three consumers

`app/core/storage.py` is a new module holding the measurement and projection logic, imported by the `/health/data` route, by `seed/embed_narratives.py`, and runnable directly for the standalone check Requirement 2.6 asks for.

```python
@dataclass(frozen=True)
class StorageState:
    db_bytes: int
    cap_bytes: int
    steady_ceiling_bytes: int
    peak_ceiling_bytes: int
    reserve_floor_bytes: int
    free_bytes: int
    embedded_narratives: int
    total_narratives: int
    embedding_bytes_per_row: int      # measured, not assumed
    index_bytes_per_vector: int       # measured, not assumed
    @property
    def cost_per_embedded_row(self) -> int: ...
    @property
    def within_reserve(self) -> bool: ...

async def read_state(session) -> StorageState: ...

@dataclass(frozen=True)
class Projection:
    rows_requested: int
    rows_affordable: int
    projected_bytes: int
    ceiling_bytes: int
    fits: bool
    def explain(self) -> str: ...

def project(state: StorageState, rows: int, *, peak: bool = False) -> Projection: ...
```

`embedding_bytes_per_row` comes from `avg(pg_column_size(embedding))` and `index_bytes_per_vector` from `pg_relation_size('idx_nar_embedding') / count(embedding)`, both read live. Requirement 2.7 forbids a hardcoded constant here for a specific reason: the measured 2,052 B is a property of `halfvec(1024)` and would be silently wrong by 2× if the column type or dimension ever changed, which is precisely one of the changes this spec contemplates.

`rows_affordable` is always computed, including when `fits` is true, because the useful message when a backfill is refused is not "no" but "12.6% of what you asked".

### D3. The guard is a pre-flight projection, and it fails closed

`project()` is called before the first write. `embed_narratives.py` gains a mandatory call, and Requirement 2.4 is satisfied by making `--one-per-case` the **default** rather than an opt-in flag, with the unrestricted behaviour moved behind an explicit `--all-narratives` flag that is itself still subject to the projection.

This inverts the current hazard: today the safe path requires a flag the documentation omits. After this change the documented command is the safe one, and the dangerous one cannot be reached by accident or by following stale instructions.

If the measurement of per-row cost fails, `read_state` raises rather than substituting a default, and the backfill refuses to run. A guard that cannot measure must not approve.

### D4. Local Postgres is the measurement environment

| Concern | Measured where | Transfers to cloud? |
|---|---|---|
| Recall@k, MRR, cross-lingual gap | local | yes, subject to D5 |
| Index bytes, table bytes, per-row cost | cloud | no — local is fp32 `vector`, cloud is fp16 `halfvec` |
| Kannada-embedded upper bound | local only | never affordable on cloud |

Recall transfers between the two databases; byte counts do not. Any statement in the eventual results that mixes them is wrong.

### D5. Local must be configured to `halfvec` to mirror the cloud

`config.vector_type` is `vector` for local and `cloud_vector_type` is `halfvec`. fp16 quantisation is itself capable of costing recall, so recall measured on fp32 locally is an **upper bound** on cloud behaviour, not an estimate of it.

The design therefore requires local to be switched to `halfvec(1024)` before the baseline is recorded, so the two environments differ only in size. If that proves impractical, the fp32/fp16 delta must be measured separately on a sample and reported as a correction, not ignored.

### D6. The cross-lingual measurement is self-labelling

Requirement 5.1 asks for queries paired with known-relevant case identifiers. Manual annotation is avoidable here because the corpus already contains the labels: every case has an English narrative and a Kannada narrative describing the same incident, so for case *X* the Kannada body **is** a Kannada query whose correct answer is *X*'s English narrative.

Two query forms are used, because one of them flatters the model:

- **Full Kannada body, truncated to 300 characters.** A long, information-dense query. This is an upper bound and must be labelled as such — it is not what an officer types.
- **Short Kannada question, 5 to 12 words.** Realistic. Derived from the case's `crime_type`, `place_of_offence` and a salient phrase from the narrative, phrased as a question.

Reporting only the first would overstate cross-lingual capability, which is the specific failure this requirement exists to prevent.

The English form of each query runs against the same ground truth, giving the paired comparison Requirement 6.2 requires. The gap between them, not the absolute number, is the decision input.

### D7. Reclamation is measured before it is applied, on local, side by side

Index variants are built alongside each other on local under distinct names and compared on the same evaluation set. This avoids the planner-hinting problem: rather than trying to force Postgres to choose a particular index, the harness issues the ANN query against each variant explicitly by building each in its own schema or by dropping to a direct index scan per variant, and records recall per variant.

Cloud receives exactly one rebuild, of the winner, sequenced under the peak ceiling:

```
current                                        426.7 MB
CREATE INDEX idx_nar_embedding_v2 (winner)   + ~47 MB  ->  ~474 MB   < 480 peak ceiling
DROP INDEX idx_nar_embedding                 -  94 MB  ->  ~380 MB
RENAME idx_nar_embedding_v2 -> idx_nar_embedding        ->  ~380 MB   < 448 steady ceiling
```

The projection is re-run against live figures immediately before the build rather than trusting the numbers above, and the build is abandoned if the projection exceeds the peak ceiling. Between `CREATE` and `DROP` both indexes exist and the lane stays queryable throughout; there is no window without an index.

If the winner turns out to be larger than the current index, the sequence is invalid and the rebuild is not attempted — that case is a decision to keep the status quo, not a smaller migration.

### D8. Kannada coverage is decided by gate, not chosen in advance

```
                    cross-lingual gap measured (D6)
                                 |
        +------------------------+------------------------+
        |                                                 |
   within tolerance                              outside tolerance
        |                                                 |
   embed NO Kannada rows                    reclaim first (D7), then:
   cost: 0 MB                               affordable = budget / cost_per_row
   document as measured                              |
                                        +------------+------------+
                                        |                         |
                              affordable covers a               affordable is
                              useful, statable subset           not useful
                                        |                         |
                              embed that subset,            embed none; document
                              selection rule stated         the limitation at the
                                                            point of advertisement
                                                            (Requirement 7.6)
```

No branch permits lowering the 64 MB reserve. That is the constraint the user set and the reason Requirement 4 orders reclamation before spend.

If a subset is embedded, the selection rule must be stated and defensible. Recency is the likely candidate — the newest cases are the ones under active investigation — but the rule is chosen when the gate is reached, from the measured gap, not now.

### D9. Bilingual routing is fixed in both lanes, because they fail differently

Requirement 7.3 separates them because the mechanisms are unrelated:

- **LLM lane.** `ROUTER_SYSTEM` in `prompts.py` gains Kannada examples for each intent, mirroring the existing English ones. This is a prompt change and is verified by live probe, not unit test.
- **Keyword lane.** `_keyword_intent` in `router.py` gains Kannada terms in `_STRONG_SQL`, `_KEYWORDS` and `_GREETINGS`. This is pure-function and fully unit-testable with no network and no database.

The keyword lane has a subtlety worth recording. Its current default for unmatched input is `narrative_search`, so Kannada text accidentally lands on the *correct* lane today by matching nothing. Adding Kannada terms is therefore not what fixes Kannada narrative search in the fallback path — it is what stops Kannada *aggregation* questions ("how many", "top") from being misrouted to narrative search once the fallback is actually exercised. The measured misroute came from the LLM lane, which is the one that runs in practice.

### D10. Similar Cases delegates to `rag.retrieve_narratives`

`POST /api/cases/similar/search` is rewritten to embed the caller's description, retrieve narratives, and map hits to cases. Requirement 8.4 forbids issuing its own vector query: reusing the retrieval function inherits RLS scoping, clearance withholding and the RRF fusion for free, and a second vector query path would be a second place for the clearance gap to reopen.

`similarity_percent` is either derived from the retrieval score or removed. The attribute-equality arithmetic (`40 + 30 + 20 + 10`) is deleted either way, and `ORDER BY RANDOM()` goes with it.

`get_similar_cases(case_id)` — the case-to-case variant — keeps its attribute logic for now, since "same crime type, same district" is a defensible explanation of relatedness when it is *described* as that rather than as a similarity percentage. Its `why_similar` strings are already honest; only the number is not.

The empty-result behaviour from the existing D9 fix is preserved: no anchor means an empty response, never case_id 1.

## Components

| Path | Change | Requirement |
|---|---|---|
| `app/config.py` | add cap and three budget controls as byte-valued settings | 1.2, 1.6 |
| `app/core/storage.py` | **new** — `StorageState`, `read_state`, `Projection`, `project`, `__main__` entry | 1.3-1.5, 2.1-2.3, 2.6-2.7 |
| `seed/embed_narratives.py` | mandatory pre-flight projection; `--one-per-case` becomes default; add `--all-narratives` | 2.1-2.4 |
| `app/api/routes/health.py` | `/health/data` reports budget, free space, coverage, degraded state | 3.1-3.4 |
| `seed/eval_retrieval.py` | **new** — evaluation harness, runs with the server stopped | 5.1-5.6, 6.1-6.5 |
| `seed/eval/retrieval_set.json` | **new** — committed, version-controlled evaluation set | 5.2, 5.7 |
| `app/pipeline/prompts.py` | Kannada examples in `ROUTER_SYSTEM` | 7.1 |
| `app/pipeline/router.py` | Kannada terms in the keyword lane | 7.2 |
| `app/api/routes/intelligence.py` | rewrite `similar_cases_search` onto retrieval | 8.1-8.5 |
| `AGENTS.md`, `README.md` | correct the setup command | 2.5, 9.6 |
| `migrations/011_*.sql` | index rebuild, only if D7 selects a winner | 4.5 |

No new dependency. No new model. `halfvec`, HNSW, BGE-M3 and the reranker are all already present.

## Error handling

| Condition | Behaviour |
|---|---|
| Per-row cost unmeasurable | `read_state` raises; backfill refuses; `/health/data` reports the sentinel per Requirement 3.4 |
| Projection exceeds ceiling | non-zero exit, no writes, message states current, projected, ceiling, affordable rows |
| Free space already below reserve | refuse all backfills; `/health/data` reports degraded |
| Index build fails midway | partial index dropped; original untouched and still serving |
| Harness cannot load the embedder | fail with the RAM/GPU diagnosis and the instruction to stop the API server, not a generic OOM |
| Evaluation set missing or unparseable | fail rather than silently measuring nothing |

## Testing strategy

Unit, no database and no model, following the fake-session pattern already established in `tests/test_rag_retrieval.py`:

- `project()` arithmetic at, just below and just above each of the three ceilings
- `rows_affordable` correctness, including zero and negative-headroom cases
- reserve-floor violation refuses even when the ceiling is satisfied
- byte/MB rendering never changes a comparison outcome
- `_keyword_intent` on Kannada aggregation, greeting and narrative phrasings

Integration, marked `integration`:

- `read_state` against a live database returns plausible measured costs
- `/health/data` reports degraded when free space is forced below the floor

Manual, and required before the cloud rebuild:

- the documented setup command on a database at the baseline stays within the steady ceiling
- a Kannada narrative question routes to `narrative_search` on the live LLM lane
- a Kannada question end-to-end on `/ask` still composes and speaks in Kannada
- a low-clearance principal still receives the restricted notice through the rewritten Similar Cases path

`pytest -m "not integration"` stays green and the frontend typecheck stays at 56.

## Sequencing

1. Budget constants, `app/core/storage.py`, unit tests. No behaviour change, no risk.
2. Guard wired into `embed_narratives.py`; flag default inverted; `AGENTS.md` and `README.md` corrected. **Closes the live hazard.**
3. `/health/data` reporting.
4. Evaluation set and harness. Local switched to `halfvec`. Baseline recorded.
5. Cross-lingual measurement (D6). **Decision gate D8 evaluated here.**
6. Reclamation variants measured on local (D7).
7. Cloud rebuild of the winner, if any, under the peak ceiling.
8. Kannada subset embedded, if the gate calls for it, sized by the post-reclamation budget.
9. Bilingual routing.
10. Similar Cases rewrite.
11. Documentation reconciled with measured reality.

Steps 1 to 3 are independent of every measurement and remove the hazard, so they ship first regardless of how anything else resolves. Steps 9 and 10 are independent of the storage work entirely and could be reordered ahead of it if Kannada routing or the fabricated similarity score becomes urgent.

## Risks

**The measurement environment may not be equivalent.** D5 addresses fp32 versus fp16; local may also differ in row count or vacuum state. Mitigation: record local's size, row counts and vector type alongside every result, per Requirement 6.5.

**The cloud rebuild is the only irreversible step.** Mitigation: it is sequenced last among the storage work, the projection is re-run immediately beforehand, both indexes coexist during the build, and the original is dropped only after the replacement exists.

**The cross-lingual gate may return an unwelcome answer.** If Kannada retrieval is poor and unaffordable, the honest outcome is documenting a limitation rather than shipping a fix. Requirement 7.6 makes that an acceptable completion, which is deliberate — the alternative is quietly lowering the reserve to buy coverage, and that is the thing the budget exists to prevent.

**Evaluation on 15 to 50 cases has wide error bars.** A 2-point recall difference on 25 cases is noise. Mitigation: state the sample size with every figure, and require reclamation decisions to turn on differences large enough to be visible at that sample size, or enlarge the sample before deciding.
