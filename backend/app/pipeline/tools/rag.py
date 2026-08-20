"""Narrative retrieval (RAG) over pgvector, with a reachable lexical fallback.

Two strategies are attempted per query and each reports its own availability:

  vector   ANN search on narratives.embedding via the pgvector cosine operator
  lexical  Postgres full-text search on the body_tsv generated column, served
           by the existing idx_nar_bodytsv GIN index

Both run in the RLS-scoped session, so retrieval respects the caller
jurisdiction. Field-level clearance restriction on narrative bodies is a
separate concern and is not yet applied here.

Why the availability flags exist
-------------------------------
The previous implementation used a single try/except to detect two different
conditions:

    try:
        rows = vector_query()   # returns [] when nothing is embedded, no raise
    except Exception:
        rows = lexical_query()  # therefore UNREACHABLE in that case
    if not rows:
        return []               # taken instead

Because "no row carries an embedding" returns zero rows without raising, the
lexical fallback could never run, and the function returned empty for every
query with no exception, no log and no metric. All 71,986 narratives currently
have a NULL embedding, so this lane was returning nothing at all.

Each candidate function now returns (rows, available). `available` is False only
when the strategy could not run. A strategy that ran and matched nothing is
available with no candidates. That distinction is what makes the fallback
reachable.

Distinguishing the two without an extra query
---------------------------------------------
The vector SQL carries no relevance predicate beyond IS NOT NULL, so
ORDER BY distance LIMIT n returns rows whenever ANY visible embedded row exists.
A zero-row result therefore means exactly "nothing is embedded" and cannot mean
"no matches". That is why the distance ceiling is applied in Python rather than
in SQL: adding a WHERE distance <= threshold clause would make a zero-row result
ambiguous again and reintroduce the original confusion.

Removed: the unpredicated fallback
----------------------------------
A third fallback previously ran `SELECT case_id, body FROM narratives LIMIT n`
with no relevance predicate at all. Those arbitrary rows were reranked, handed
to the composer as grounded data, and cited. It has been deleted. Returning
nothing is honest; citing an unrelated case is not. Fixing the control flow
without deleting it would have activated that path.

Hybrid fusion
-------------
Both arms are combined by Reciprocal Rank Fusion rather than one being a
failure-only fallback. Today, with zero embedded narratives, only the lexical
arm contributes and the reported strategy is "lexical". Once embeddings exist
both contribute and it becomes "hybrid", with no code change at the switchover.

Known limitation: Kannada lexical recall
----------------------------------------
The lexical arm searches `body_tsv`, which is generated as
`to_tsvector('simple', body)`. The `simple` configuration applies no stemming
and no language-specific processing, and `plainto_tsquery` ANDs every term, so
all terms must appear literally for a match. Recall on Kannada narratives is
therefore weak, and `narratives.language` is not consulted at all. This is not a
regression, since this lane returned nothing whatsoever before; the vector arm
addresses it properly once embeddings are generated.

Supports both `vector(1024)` (local, fp32) and `halfvec(1024)` (Neon, fp16) via
the `VECTOR_TYPE` config setting.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core import rbac
from app.models.registry import get_embedder, get_reranker

log = logging.getLogger("satyam.rag")

# Strategy identifiers reported in RetrievalResult.strategy. "none" means no
# candidate was produced; the availability flags say whether that was because no
# strategy could run, or because both ran and matched nothing.
STRATEGY_HYBRID = "hybrid"
STRATEGY_VECTOR = "vector"
STRATEGY_LEXICAL = "lexical"
STRATEGY_NONE = "none"

# Shown in place of a narrative body the caller is not cleared to read.
RESTRICTED_NOTICE = "[Restricted: protected-crime narrative. Insufficient clearance.]"

# Cosine distance ceiling for vector candidates. Applied in Python, not SQL, so
# a zero-row vector result keeps its unambiguous meaning. 0.60 is a starting
# value to be tuned against real queries once embeddings exist; until then the
# vector arm is unavailable and this constant has no effect.
DISTANCE_THRESHOLD = 0.60

# Candidates fetched per strategy before fusion, reranking and truncation to k.
CANDIDATE_MULTIPLIER = 3

# Reciprocal Rank Fusion constant. The conventional value is 60; it damps the
# influence of top ranks so a single strategy cannot dominate the fused order.
RRF_K = 60


@dataclass(frozen=True)
class RetrievalHit:
    """One narrative returned to the caller.

    `restricted` is True when the record matched but its body was withheld for
    clearance reasons, in which case `text` holds RESTRICTED_NOTICE. The hit is
    still returned so the officer learns that a restricted record matched,
    without seeing its content.
    """

    case_id: int
    text: str
    score: float = 0.0
    strategy: str = STRATEGY_NONE
    restricted: bool = False


@dataclass(frozen=True)
class RetrievalResult:
    """Outcome of one retrieval call.

    `hits` is always a list and never None, on every path, including both
    strategies being unavailable.

    `vector_available` and `lexical_available` are False ONLY when that strategy
    could not run at all. A strategy that ran and matched nothing is available
    with no hits.
    """

    hits: list[RetrievalHit] = field(default_factory=list)
    strategy: str = STRATEGY_NONE
    vector_available: bool = False
    lexical_available: bool = False
    withheld_count: int = 0

    def __len__(self) -> int:
        return len(self.hits)

    @property
    def is_empty(self) -> bool:
        return not self.hits


def _to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


async def _execute_isolated(session: AsyncSession, sql, params) -> list[dict]:
    """Run one read-only query inside a SAVEPOINT and return mapped rows.

    Postgres aborts the entire transaction on a failed statement, so without this
    the first arm to fail takes every later arm down with it: the vector query
    times out, and the lexical fallback then dies on
    InFailedSQLTransactionError instead of answering. That turns a degraded lane
    into a dead one, which is the exact failure mode this module exists to
    prevent. Observed against the live database once embeddings were populated
    but before the ANN index existed.

    A savepoint rather than session.rollback() is deliberate. apply_rls_context
    stamps the caller's jurisdiction with set_config(..., true), i.e.
    transaction-local, so a plain rollback would silently discard the RLS scope
    and the statement_timeout cap. Settings made before a savepoint survive
    ROLLBACK TO SAVEPOINT, so this clears the error and keeps the security
    context intact.
    """
    async with session.begin_nested():
        result = await session.execute(sql, params)
        return [dict(r) for r in result.mappings().all()]


async def _vector_candidates(
    session: AsyncSession, query: str, k: int
) -> tuple[list[dict], bool]:
    """Return (candidates, available) for the vector strategy.

    available is False when the strategy could not run at all: the embedder
    failed, the pgvector operator raised, or no visible narrative carries an
    embedding. Each case is logged with its reason so this can never fail
    silently again.
    """
    try:
        [qvec] = await get_embedder().embed([query])
    except Exception as exc:  # noqa: BLE001
        log.warning("rag.vector_unavailable reason=embedder_failed err=%s", exc)
        return [], False

    vt = get_settings().vector_type  # "vector" | "halfvec"
    vec_literal = _to_pgvector(qvec)

    sql = text(
        f"""
        SELECT n.narrative_id, n.case_id, n.body AS text,
               (n.embedding <=> (:qvec)::{vt}) AS distance
        FROM narratives n
        WHERE n.embedding IS NOT NULL
        ORDER BY n.embedding <=> (:qvec)::{vt}
        LIMIT :k
        """
    )
    try:
        rows = await _execute_isolated(
            session, sql, {"qvec": vec_literal, "k": k * CANDIDATE_MULTIPLIER}
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("rag.vector_unavailable reason=query_failed err=%s", exc)
        return [], False

    if not rows:
        # No relevance predicate in the SQL, so zero rows can only mean that no
        # visible narrative is embedded. This is the exact condition the old
        # try/except could not detect.
        log.warning("rag.vector_unavailable reason=no_embedded_narratives")
        return [], False

    kept = [
        r
        for r in rows
        if r.get("distance") is None or float(r["distance"]) <= DISTANCE_THRESHOLD
    ]
    if len(kept) < len(rows):
        log.info(
            "rag.vector_filtered kept=%d of=%d threshold=%s",
            len(kept),
            len(rows),
            DISTANCE_THRESHOLD,
        )
    return kept, True


async def _lexical_candidates(
    session: AsyncSession, query: str, k: int
) -> tuple[list[dict], bool]:
    """Return (candidates, available) for the lexical strategy.

    Uses body_tsv and its existing GIN index. available is False only when the
    query raises; a query that ran and matched nothing is available with no
    candidates.
    """
    sql = text(
        "SELECT narrative_id, case_id, body AS text, "
        "       ts_rank(body_tsv, plainto_tsquery('simple', :q)) AS rank "
        "FROM narratives "
        "WHERE body_tsv @@ plainto_tsquery('simple', :q) "
        "ORDER BY rank DESC "
        "LIMIT :k"
    )
    try:
        rows = await _execute_isolated(
            session, sql, {"q": query, "k": k * CANDIDATE_MULTIPLIER}
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("rag.lexical_unavailable reason=query_failed err=%s", exc)
        return [], False
    return rows, True


def _candidate_key(row: dict):
    """Stable identity for de-duplicating a candidate across strategies.

    Prefers narrative_id, which both queries select. Falls back to
    (case_id, text) so a row from some other shape still de-duplicates rather
    than appearing twice.
    """
    key = row.get("narrative_id")
    if key is None:
        key = (row.get("case_id"), row.get("text"))
    return key


def _rrf_fuse(
    vector_rows: list[dict], lexical_rows: list[dict], *, rrf_k: int = RRF_K
) -> list[dict]:
    """Combine two ranked candidate lists by Reciprocal Rank Fusion.

        score(doc) = sum over strategies of 1 / (rrf_k + rank)

    RRF is used rather than a weighted blend of the raw scores because a cosine
    distance and a ts_rank are not on comparable scales, and calibrating them
    would need tuning data this project does not have. RRF consumes only the
    ordering, so no calibration is required.

    Ranks are 1-based. Ties break by first appearance with the vector arm first,
    so the output is deterministic for identical input. The fused score is
    attached to each returned row as `rrf_score`; input rows are copied rather
    than mutated.
    """
    scores: dict = {}
    rows_by_key: dict = {}
    first_seen: dict = {}

    for strategy_rows in (vector_rows, lexical_rows):
        for rank, row in enumerate(strategy_rows, start=1):
            key = _candidate_key(row)
            if key not in rows_by_key:
                rows_by_key[key] = row
                first_seen[key] = len(first_seen)
            scores[key] = scores.get(key, 0.0) + 1.0 / (rrf_k + rank)

    fused_keys = sorted(rows_by_key, key=lambda key: (-scores[key], first_seen[key]))

    out: list[dict] = []
    for key in fused_keys:
        row = dict(rows_by_key[key])
        row["rrf_score"] = round(scores[key], 6)
        out.append(row)
    return out


async def _crime_types_for(
    session: AsyncSession, case_ids: set[int]
) -> dict[int, str | None]:
    """Batch-resolve crime_type per case_id, for the clearance decision.

    A separate batched lookup rather than a JOIN in the candidate queries, for
    two reasons:

    1. An INNER JOIN would break the invariant that a zero-row vector result
       means "nothing is embedded". With a join, zero rows could also mean "no
       visible case rows", and that ambiguity is the exact confusion this module
       was rewritten to remove.
    2. A LEFT JOIN would fail OPEN. An unmatched case row yields crime_type
       NULL, and is_protected(None) is False, so a narrative whose case is not
       visible would be treated as unrestricted.

    Absence from the returned mapping is therefore meaningful: the case row was
    not visible to this caller, and the narrative must be treated as restricted.
    """
    if not case_ids:
        return {}
    try:
        rows = await _execute_isolated(
            session,
            text("SELECT case_id, crime_type FROM cases WHERE case_id = ANY(:ids)"),
            {"ids": list(case_ids)},
        )
        return {int(r["case_id"]): r["crime_type"] for r in rows}
    except Exception as exc:  # noqa: BLE001
        # Fail closed: an empty mapping marks every row restricted.
        log.warning("rag.crime_type_lookup_failed err=%s - failing closed", exc)
        return {}


def _apply_clearance(
    rows: list[dict],
    principal: "rbac.Principal | None",
    crime_types: dict[int, str | None],
) -> tuple[list[dict], int]:
    """Withhold narrative bodies the caller is not cleared to read.

    Every decision routes through the existing, unit-tested helpers in
    app.core.rbac rather than reimplementing the rule:

        rbac.is_protected(crime_type)
        principal.can_see_narrative(crime_type)   -> clearance >= 3 if protected

    A restricted row is KEPT, with `restricted` set and its text replaced by
    RESTRICTED_NOTICE, so the officer learns that a restricted record matched
    without seeing its content.

    Fails closed in two cases: no principal was supplied, or the case row was
    not visible so the crime type could not be resolved.

    Note this is field-level restriction by clearance. RLS already decides WHICH
    narratives are visible by jurisdiction; it cannot express which FIELDS a
    clearance level may read.
    """
    out: list[dict] = []
    withheld = 0
    for row in rows:
        case_id = int(row["case_id"])
        resolved = case_id in crime_types
        crime_type = crime_types.get(case_id)

        if principal is None:
            allowed = False
            reason = "no_principal"
        elif not resolved:
            allowed = False
            reason = "case_not_visible"
        else:
            allowed = principal.can_see_narrative(crime_type)
            reason = "protected_crime" if not allowed else ""

        new_row = dict(row)
        new_row["crime_type"] = crime_type
        new_row["protected"] = rbac.is_protected(crime_type) if resolved else None
        if allowed:
            new_row["restricted"] = False
        else:
            new_row["restricted"] = True
            new_row["text"] = RESTRICTED_NOTICE
            withheld += 1
            log.info(
                "rag.withheld case_id=%s reason=%s clearance=%s",
                case_id,
                reason,
                getattr(principal, "clearance", None),
            )
        out.append(new_row)
    return out, withheld


def _strategy_for(vector_rows: list[dict], lexical_rows: list[dict]) -> str:
    """Name the arms that actually contributed candidates."""
    if vector_rows and lexical_rows:
        return STRATEGY_HYBRID
    if vector_rows:
        return STRATEGY_VECTOR
    if lexical_rows:
        return STRATEGY_LEXICAL
    return STRATEGY_NONE


async def retrieve_narratives(
    session: AsyncSession,
    query: str,
    *,
    k: int = 5,
    principal: "rbac.Principal | None" = None,
) -> RetrievalResult:
    """Retrieve narratives for `query`, returning a RetrievalResult.

    Both strategies are attempted. Emptiness is tested separately from failure,
    so the lexical arm runs when the vector arm returns nothing as well as when
    it raises. No path returns a row that did not satisfy a relevance predicate.

    `principal` drives field-level clearance restriction on narrative bodies. It
    is optional so existing callers keep working, but when it is omitted the
    restrictive branch is taken: bodies are withheld rather than exposed.
    """
    vector_rows, vector_ok = await _vector_candidates(session, query, k)
    lexical_rows, lexical_ok = await _lexical_candidates(session, query, k)

    if not vector_ok and not lexical_ok:
        log.warning(
            "rag.no_strategy_available query_len=%d - retrieval lane is down, "
            "not merely empty",
            len(query or ""),
        )
        return RetrievalResult(
            hits=[],
            strategy=STRATEGY_NONE,
            vector_available=False,
            lexical_available=False,
        )

    merged = _rrf_fuse(vector_rows, lexical_rows)
    strategy = _strategy_for(vector_rows, lexical_rows)

    if not merged:
        log.info(
            "rag.no_matches vector_available=%s lexical_available=%s",
            vector_ok,
            lexical_ok,
        )
        return RetrievalResult(
            hits=[],
            strategy=strategy,
            vector_available=vector_ok,
            lexical_available=lexical_ok,
        )

    try:
        order = await get_reranker().rerank(query, [r["text"] for r in merged])
        ordered = [merged[i] for i in order[:k]]
    except Exception as exc:  # noqa: BLE001
        # Reranking is a quality step, not a correctness one. Degrade to the
        # merge order rather than losing results.
        log.warning("rag.rerank_failed err=%s - using merge order", exc)
        ordered = merged[:k]

    # Clearance is applied AFTER reranking, so the cross-encoder ranks the real
    # narrative text rather than the restricted-notice placeholder, and only for
    # the k rows actually being returned.
    crime_types = await _crime_types_for(session, {int(r["case_id"]) for r in ordered})
    ordered, withheld = _apply_clearance(ordered, principal, crime_types)

    hits = [
        RetrievalHit(
            case_id=int(row["case_id"]),
            text=row["text"],
            score=float(row.get("rrf_score") or row.get("distance") or row.get("rank") or 0.0),
            strategy=strategy,
            restricted=bool(row.get("restricted", False)),
        )
        for row in ordered
    ]
    log.info(
        "rag.retrieved strategy=%s hits=%d withheld=%d",
        strategy,
        len(hits),
        withheld,
    )
    return RetrievalResult(
        hits=hits,
        strategy=strategy,
        vector_available=vector_ok,
        lexical_available=lexical_ok,
        withheld_count=withheld,
    )


async def search_narratives(
    session: AsyncSession,
    query: str,
    *,
    k: int = 5,
    principal: "rbac.Principal | None" = None,
) -> list[dict]:
    """Backward-compatible wrapper returning list[dict].

    Kept so the orchestrator narrative_search branch is unaffected by this
    change. The dicts carry the `case_id` and `text` keys that branch reads.
    It is replaced by a direct `retrieve_narratives` call when the clearance
    filter and the richer tool event land.
    """
    result = await retrieve_narratives(session, query, k=k, principal=principal)
    return [
        {
            "case_id": h.case_id,
            "text": h.text,
            "score": h.score,
            "strategy": h.strategy,
            "restricted": h.restricted,
        }
        for h in result.hits
    ]