"""Tests for narrative retrieval.

Runs with no database and no model. The defect under repair is a control-flow
fault, so a scripted fake session is not merely sufficient, it is the right
tool: it can prove which queries were issued and in what order, which is
precisely what the bug is about.
"""
from __future__ import annotations

import pytest

from app.pipeline.tools import rag


class FakeResult:
    """Mimics the slice of the SQLAlchemy Result surface that rag.py uses."""

    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)


class FakeTransactionAborted(Exception):
    """Stands in for asyncpg's InFailedSQLTransactionError."""


class _FakeSavepoint:
    """Async context manager modelling SAVEPOINT / ROLLBACK TO SAVEPOINT."""

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        self._session.savepoints += 1
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type is not None:
            # ROLLBACK TO SAVEPOINT clears the aborted state, which is the whole
            # reason rag.py wraps each arm in one.
            self._session.aborted = False
            self._session.savepoint_rollbacks += 1
        return False  # never swallow the error


class FakeSession:
    """Scripted stand-in for AsyncSession, with Postgres transaction semantics.

    `script` is consumed in order. Each entry is either a list of row dicts to
    return, or an Exception instance to raise. When the script is exhausted,
    further calls return no rows, which models a query that ran successfully and
    matched nothing. That is the exact condition the production defect cannot
    distinguish from a failure.

    Transaction semantics matter here. A real Postgres transaction is poisoned by
    any failed statement: every later statement raises
    InFailedSQLTransactionError until the transaction is rolled back. An earlier
    version of this fake ignored that, so the suite passed while the live lane
    was dead, because the vector timeout took the lexical fallback down with it.
    Raising from the script therefore sets `aborted`, and only a savepoint
    rollback clears it.

    Every executed statement is recorded in `statements` (whitespace-normalised)
    so a test can assert which queries ran, and `params` records the bound
    parameters for each call.
    """

    def __init__(self, script=None):
        self.script = list(script or [])
        self.statements: list[str] = []
        self.params: list[dict] = []
        self.aborted = False
        self.savepoints = 0
        self.savepoint_rollbacks = 0

    def begin_nested(self):
        return _FakeSavepoint(self)

    async def execute(self, stmt, params=None):
        if self.aborted:
            # Postgres refuses the statement before it runs, so it is not
            # recorded in `statements`.
            raise FakeTransactionAborted(
                "current transaction is aborted, commands ignored until end of "
                "transaction block"
            )
        self.statements.append(" ".join(str(stmt).split()))
        self.params.append(dict(params or {}))
        if not self.script:
            return FakeResult([])
        nxt = self.script.pop(0)
        if isinstance(nxt, BaseException):
            self.aborted = True
            raise nxt
        return FakeResult(nxt)

    def issued(self, fragment: str) -> bool:
        """True when any executed statement contains `fragment`."""
        needle = " ".join(fragment.split())
        return any(needle in s for s in self.statements)

    @property
    def call_count(self) -> int:
        return len(self.statements)


def narrative_row(case_id=1, body="theft of a two-wheeler near the market", distance=0.10):
    """A row shaped like the vector query output: case_id, text, distance."""
    return {"case_id": case_id, "text": body, "distance": distance}


# --------------------------------------------------------------------------
# Scaffold self-checks. If these fail, every later test is untrustworthy.
# --------------------------------------------------------------------------

async def test_fake_session_returns_scripted_rows_in_order():
    s = FakeSession([[narrative_row(1)], [narrative_row(2)]])
    first = (await s.execute("SELECT 1")).mappings().all()
    second = (await s.execute("SELECT 2")).mappings().all()
    assert first[0]["case_id"] == 1
    assert second[0]["case_id"] == 2


async def test_fake_session_raises_scripted_exception():
    s = FakeSession([RuntimeError("operator does not exist: vector <=> vector")])
    with pytest.raises(RuntimeError):
        await s.execute("SELECT 1")


async def test_fake_session_returns_empty_when_script_exhausted():
    """Models the production condition: a query that ran and matched nothing."""
    s = FakeSession()
    rows = (await s.execute("SELECT 1")).mappings().all()
    assert rows == []


async def test_fake_session_records_statements_and_params():
    s = FakeSession([[]])
    await s.execute("SELECT case_id FROM narratives WHERE body_tsv @@ x", {"q": "abc"})
    assert s.issued("FROM narratives")
    assert s.issued("body_tsv")
    assert not s.issued("financial_transactions")
    assert s.params[0]["q"] == "abc"
    assert s.call_count == 1


# --------------------------------------------------------------------------
# RetrievalResult / RetrievalHit contract
# --------------------------------------------------------------------------

def test_retrieval_result_hits_defaults_to_empty_list():
    """Property 10: hits is always a list, never None, on every path."""
    r = rag.RetrievalResult()
    assert isinstance(r.hits, list)
    assert r.hits == []
    assert r.is_empty is True
    assert len(r) == 0


def test_retrieval_result_defaults_report_nothing_available():
    """An empty result must not claim a strategy ran."""
    r = rag.RetrievalResult()
    assert r.strategy == rag.STRATEGY_NONE
    assert r.vector_available is False
    assert r.lexical_available is False
    assert r.withheld_count == 0


def test_retrieval_result_instances_do_not_share_hits():
    """default_factory, not a shared mutable default."""
    a = rag.RetrievalResult()
    b = rag.RetrievalResult()
    a_hits = a.hits
    assert a_hits is not b.hits


def test_retrieval_result_available_but_empty_is_representable():
    """The distinction the production code cannot express.

    A strategy that ran and matched nothing must be representable as
    available-with-no-hits, separately from unavailable.
    """
    ran_but_empty = rag.RetrievalResult(
        hits=[], strategy=rag.STRATEGY_LEXICAL, lexical_available=True
    )
    could_not_run = rag.RetrievalResult(hits=[], strategy=rag.STRATEGY_NONE)
    assert ran_but_empty.is_empty and ran_but_empty.lexical_available
    assert could_not_run.is_empty and not could_not_run.lexical_available
    assert ran_but_empty.strategy != could_not_run.strategy


def test_retrieval_hit_defaults():
    h = rag.RetrievalHit(case_id=7, text="body text")
    assert h.case_id == 7
    assert h.text == "body text"
    assert h.score == 0.0
    assert h.strategy == rag.STRATEGY_NONE
    assert h.restricted is False


def test_retrieval_hit_restricted_carries_notice_not_content():
    h = rag.RetrievalHit(
        case_id=9, text=rag.RESTRICTED_NOTICE, restricted=True, strategy=rag.STRATEGY_LEXICAL
    )
    assert h.restricted is True
    assert h.text == rag.RESTRICTED_NOTICE
    assert "Restricted" in h.text


def test_strategy_constants_are_distinct():
    values = {
        rag.STRATEGY_HYBRID,
        rag.STRATEGY_VECTOR,
        rag.STRATEGY_LEXICAL,
        rag.STRATEGY_NONE,
    }
    assert len(values) == 4


def test_search_narratives_still_returns_a_list_for_now():
    """This step is additive only: the public signature is unchanged.

    Guards against accidentally switching the return type before the control-flow
    rewrite lands, which would break the orchestrator narrative_search branch.
    """
    import inspect

    sig = inspect.signature(rag.search_narratives)
    assert "session" in sig.parameters
    assert "query" in sig.parameters
    assert "k" in sig.parameters
    assert sig.return_annotation in ("list[dict]", list)

# ==========================================================================
# Fakes for the model layer. rag.py resolves get_embedder / get_reranker at
# call time from module scope, so monkeypatching the module attribute works.
# ==========================================================================

class FakeEmbedder:
    def __init__(self, vec=None, fail=False):
        self.vec = vec or [0.1] * 8
        self.fail = fail
        self.calls = 0

    async def embed(self, texts):
        self.calls += 1
        if self.fail:
            raise RuntimeError("embedder unavailable")
        return [list(self.vec) for _ in texts]


class FakeReranker:
    """Returns candidate indices. Identity order unless told otherwise."""

    def __init__(self, order=None, fail=False):
        self.order = order
        self.fail = fail
        self.calls = 0
        self.last_docs = None

    async def rerank(self, query, docs):
        self.calls += 1
        self.last_docs = list(docs)
        if self.fail:
            raise RuntimeError("reranker unavailable")
        if self.order is not None:
            return list(self.order)
        return list(range(len(docs)))


def install_fakes(monkeypatch, embedder=None, reranker=None):
    emb = embedder or FakeEmbedder()
    rr = reranker or FakeReranker()
    monkeypatch.setattr(rag, "get_embedder", lambda: emb)
    monkeypatch.setattr(rag, "get_reranker", lambda: rr)
    return emb, rr


def vec_row(narrative_id=1, case_id=100, body="accused snatched a gold chain", distance=0.10):
    """Row shaped like the vector query output."""
    return {
        "narrative_id": narrative_id,
        "case_id": case_id,
        "text": body,
        "distance": distance,
    }


def lex_row(narrative_id=2, case_id=200, body="complainant reported chain snatching", rank=0.42):
    """Row shaped like the lexical query output."""
    return {"narrative_id": narrative_id, "case_id": case_id, "text": body, "rank": rank}


VECTOR_MARKER = "n.embedding IS NOT NULL"
LEXICAL_MARKER = "body_tsv @@ plainto_tsquery"


# ==========================================================================
# Property 1: Lexical reachability
#
# The regression guard for the reported defect. The vector arm returns zero
# rows WITHOUT raising, which is what happens when no narrative is embedded.
# Before the fix, the lexical fallback lived in an `except` block and was
# therefore unreachable, so the function returned empty for every query.
# ==========================================================================

async def test_vector_empty_falls_through_to_lexical(monkeypatch):
    install_fakes(monkeypatch)
    # First execute = vector query -> no rows, no exception.
    # Second execute = lexical query -> real rows.
    s = FakeSession([[], [lex_row(2, 200), lex_row(3, 300)]])

    result = await rag.retrieve_narratives(s, "chain snatching", k=3)

    assert s.issued(VECTOR_MARKER), "vector query should have been attempted"
    assert s.issued(LEXICAL_MARKER), "lexical query MUST run when vector returns nothing"
    assert len(result) == 2
    assert result.strategy == rag.STRATEGY_LEXICAL
    assert result.vector_available is False
    assert result.lexical_available is True
    assert {h.case_id for h in result.hits} == {200, 300}


async def test_embedder_failure_falls_through_to_lexical(monkeypatch):
    """The embedder raising must not take the whole lane down either.

    Note the vector arm returns before issuing any SQL in this case, so the
    first scripted entry is consumed by the lexical query.
    """
    install_fakes(monkeypatch, embedder=FakeEmbedder(fail=True))
    s = FakeSession([[lex_row(9, 900)]])

    result = await rag.retrieve_narratives(s, "chain snatching", k=3)

    assert not s.issued(VECTOR_MARKER), "vector SQL should be skipped when embedding fails"
    assert s.issued(LEXICAL_MARKER)
    assert len(result) == 1
    assert result.strategy == rag.STRATEGY_LEXICAL
    assert result.vector_available is False


# ==========================================================================
# Property 2: Exception reachability
# ==========================================================================

async def test_vector_raises_falls_through_to_lexical(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        RuntimeError("operator does not exist: vector <=> vector"),
        [lex_row(4, 400)],
    ])

    result = await rag.retrieve_narratives(s, "chain snatching", k=3)

    assert s.issued(LEXICAL_MARKER)
    assert len(result) == 1
    assert result.hits[0].case_id == 400
    assert result.strategy == rag.STRATEGY_LEXICAL
    assert result.vector_available is False
    assert result.lexical_available is True


# ==========================================================================
# Property 3: No arbitrary rows
#
# Guards the deleted `SELECT case_id, body FROM narratives LIMIT n` path. That
# query had no relevance predicate, so its rows were arbitrary, yet they were
# reranked, handed to the composer as grounded data, and cited. Returning
# nothing is honest; citing an unrelated case is not.
# ==========================================================================

async def test_both_arms_empty_returns_empty_and_issues_no_unpredicated_query(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([[], []])

    result = await rag.retrieve_narratives(s, "no such thing anywhere", k=3)

    assert result.hits == []
    assert result.is_empty is True
    # Every statement issued must carry a relevance predicate.
    assert s.call_count == 2
    for stmt in s.statements:
        assert "WHERE" in stmt, f"unpredicated query issued: {stmt}"
    # And specifically, the deleted fallback must not have returned.
    assert not s.issued("FROM narratives LIMIT")


async def test_no_reranking_when_nothing_matched(monkeypatch):
    """A no-match result must not be dressed up by passing it to the reranker."""
    _, rr = install_fakes(monkeypatch)
    s = FakeSession([[], []])

    result = await rag.retrieve_narratives(s, "nothing", k=3)

    assert result.is_empty
    assert rr.calls == 0


# ==========================================================================
# Property 4: Distance ceiling
# ==========================================================================

async def test_vector_candidates_above_distance_threshold_are_dropped(monkeypatch):
    install_fakes(monkeypatch)
    near = vec_row(1, 101, "near match", distance=0.10)
    far = vec_row(2, 102, "far match", distance=0.95)
    s = FakeSession([[near, far], []])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert rag.DISTANCE_THRESHOLD == 0.60
    assert [h.case_id for h in result.hits] == [101]
    # The arm still RAN, so it stays available even though one row was filtered.
    assert result.vector_available is True
    assert result.strategy == rag.STRATEGY_VECTOR


async def test_distance_threshold_boundary_is_inclusive(monkeypatch):
    install_fakes(monkeypatch)
    at_ceiling = vec_row(1, 111, "exactly at ceiling", distance=rag.DISTANCE_THRESHOLD)
    s = FakeSession([[at_ceiling], []])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert [h.case_id for h in result.hits] == [111]


async def test_all_vector_rows_filtered_still_reports_available(monkeypatch):
    """Filtered-to-nothing is not the same as could-not-run."""
    install_fakes(monkeypatch)
    s = FakeSession([[vec_row(1, 121, "too far", distance=0.99)], [lex_row(5, 500)]])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert result.vector_available is True
    assert result.lexical_available is True
    # Only the lexical candidate survives, so only lexical contributed.
    assert result.strategy == rag.STRATEGY_LEXICAL
    assert [h.case_id for h in result.hits] == [500]


# ==========================================================================
# Property 10: hits is always a list
# ==========================================================================

async def test_both_arms_unavailable_returns_empty_list_not_none(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([RuntimeError("vector down"), RuntimeError("lexical down")])

    result = await rag.retrieve_narratives(s, "anything", k=3)

    assert isinstance(result.hits, list)
    assert result.hits == []
    assert result.strategy == rag.STRATEGY_NONE
    assert result.vector_available is False
    assert result.lexical_available is False


# ==========================================================================
# Strategy reporting and merge behaviour
# ==========================================================================

async def test_both_arms_contributing_reports_hybrid(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([[vec_row(1, 101)], [lex_row(2, 202)]])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert result.strategy == rag.STRATEGY_HYBRID
    assert result.vector_available is True
    assert result.lexical_available is True
    assert {h.case_id for h in result.hits} == {101, 202}


async def test_same_narrative_from_both_arms_is_not_duplicated(monkeypatch):
    install_fakes(monkeypatch)
    shared_id = 7
    s = FakeSession([
        [vec_row(shared_id, 700, "same narrative", distance=0.2)],
        [lex_row(shared_id, 700, "same narrative", rank=0.9)],
    ])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert len(result) == 1
    assert result.hits[0].case_id == 700


async def test_k_truncates_the_result(monkeypatch):
    install_fakes(monkeypatch)
    rows = [vec_row(i, 1000 + i, f"body {i}", distance=0.1) for i in range(1, 9)]
    s = FakeSession([rows, []])

    result = await rag.retrieve_narratives(s, "query", k=3)

    assert len(result) == 3


async def test_candidate_multiplier_is_used_for_the_fetch_limit(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([[vec_row()], []])

    await rag.retrieve_narratives(s, "query", k=4)

    assert rag.CANDIDATE_MULTIPLIER == 3
    assert s.params[0]["k"] == 4 * rag.CANDIDATE_MULTIPLIER


# ==========================================================================
# Reranker degradation
# ==========================================================================

async def test_reranker_failure_degrades_to_merge_order(monkeypatch):
    """Reranking is a quality step, not a correctness one."""
    install_fakes(monkeypatch, reranker=FakeReranker(fail=True))
    s = FakeSession([[vec_row(1, 101, "first"), vec_row(2, 102, "second")], []])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert [h.case_id for h in result.hits] == [101, 102]
    assert result.strategy == rag.STRATEGY_VECTOR


async def test_reranker_order_is_respected(monkeypatch):
    install_fakes(monkeypatch, reranker=FakeReranker(order=[1, 0]))
    s = FakeSession([[vec_row(1, 101, "first"), vec_row(2, 102, "second")], []])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert [h.case_id for h in result.hits] == [102, 101]


# ==========================================================================
# Backward-compatible shim
# ==========================================================================

async def test_search_narratives_shim_returns_dicts_the_orchestrator_reads(monkeypatch):
    """orchestrator.py reads h["case_id"] and passes rows to json.dumps."""
    import json

    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 555, "body text")],
        case_rows((555, "THEFT")),
    ])

    rows = await rag.search_narratives(
        s, "chain snatching", k=3, principal=make_principal(clearance=4)
    )

    assert isinstance(rows, list)
    assert rows and isinstance(rows[0], dict)
    assert rows[0]["case_id"] == 555
    assert rows[0]["text"] == "body text"
    assert rows[0]["restricted"] is False
    json.dumps(rows, default=str)  # must be serialisable for _rows_context


async def test_search_narratives_shim_returns_empty_list_when_nothing_found(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([[], []])

    rows = await rag.search_narratives(s, "nothing", k=3)

    assert rows == []

# ==========================================================================
# Property 6: Fusion soundness
#
# RRF is used instead of a weighted score blend because a cosine distance and a
# ts_rank are not on comparable scales. RRF consumes only the ordering, so no
# calibration is needed.
#
#     score(doc) = sum over strategies of 1 / (RRF_K + rank)
# ==========================================================================

def test_rrf_k_is_the_conventional_value():
    assert rag.RRF_K == 60


def test_rrf_is_deterministic():
    v = [vec_row(1, 101), vec_row(2, 102), vec_row(3, 103)]
    lx = [lex_row(3, 103), lex_row(4, 104)]

    first = [r["narrative_id"] for r in rag._rrf_fuse(v, lx)]
    second = [r["narrative_id"] for r in rag._rrf_fuse(v, lx)]

    assert first == second


def test_rrf_promotes_a_document_present_in_both_lists():
    """narrative 3 is rank 3 in vector and rank 1 in lexical.

    Appearing in both arms must not place it below its best single-strategy
    rank. Here its best single rank is 1, and fusion puts it first overall.
    """
    v = [vec_row(1, 101), vec_row(2, 102), vec_row(3, 103)]
    lx = [lex_row(3, 103), lex_row(4, 104)]

    ids = [r["narrative_id"] for r in rag._rrf_fuse(v, lx)]

    best_single_rank = 1  # rank 1 in the lexical list
    final_rank = ids.index(3) + 1
    assert final_rank <= best_single_rank
    assert ids[0] == 3


def test_rrf_score_matches_the_stated_formula():
    """A doc at rank 1 in both arms scores 2/(RRF_K+1)."""
    v = [vec_row(1, 101)]
    lx = [lex_row(1, 101)]

    fused = rag._rrf_fuse(v, lx)

    expected = round(2 * (1.0 / (rag.RRF_K + 1)), 6)
    assert len(fused) == 1
    assert fused[0]["rrf_score"] == expected


def test_rrf_score_for_single_arm_document():
    v = [vec_row(1, 101), vec_row(2, 102)]

    fused = rag._rrf_fuse(v, [])

    assert fused[0]["rrf_score"] == round(1.0 / (rag.RRF_K + 1), 6)
    assert fused[1]["rrf_score"] == round(1.0 / (rag.RRF_K + 2), 6)


def test_rrf_dedupes_across_arms():
    v = [vec_row(7, 700, "same narrative")]
    lx = [lex_row(7, 700, "same narrative")]

    fused = rag._rrf_fuse(v, lx)

    assert len(fused) == 1
    assert fused[0]["narrative_id"] == 7


def test_rrf_output_is_sorted_by_descending_score():
    v = [vec_row(1, 101), vec_row(2, 102), vec_row(3, 103)]
    lx = [lex_row(3, 103), lex_row(4, 104)]

    scores = [r["rrf_score"] for r in rag._rrf_fuse(v, lx)]

    assert scores == sorted(scores, reverse=True)


def test_rrf_single_arm_preserves_input_order():
    v = [vec_row(i, 100 + i) for i in range(1, 5)]

    ids = [r["narrative_id"] for r in rag._rrf_fuse(v, [])]

    assert ids == [1, 2, 3, 4]


def test_rrf_breaks_ties_by_first_appearance_vector_first():
    """Equal scores must resolve deterministically, vector arm ahead."""
    v = [vec_row(1, 101)]
    lx = [lex_row(2, 202)]

    ids = [r["narrative_id"] for r in rag._rrf_fuse(v, lx)]

    # Both are rank 1 in their own arm, so scores tie.
    assert ids == [1, 2]


def test_rrf_does_not_mutate_input_rows():
    v = [vec_row(1, 101)]
    lx = [lex_row(2, 202)]

    rag._rrf_fuse(v, lx)

    assert "rrf_score" not in v[0]
    assert "rrf_score" not in lx[0]


def test_rrf_handles_both_arms_empty():
    assert rag._rrf_fuse([], []) == []


def test_candidate_key_falls_back_when_narrative_id_missing():
    a = {"case_id": 5, "text": "same body"}
    b = {"case_id": 5, "text": "same body"}
    c = {"case_id": 5, "text": "different body"}

    assert rag._candidate_key(a) == rag._candidate_key(b)
    assert rag._candidate_key(a) != rag._candidate_key(c)


async def test_hybrid_result_score_carries_the_fused_score(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([[vec_row(1, 101)], [lex_row(1, 101)]])

    result = await rag.retrieve_narratives(s, "query", k=5)

    assert result.strategy == rag.STRATEGY_HYBRID
    assert result.hits[0].score == round(2 * (1.0 / (rag.RRF_K + 1)), 6)

# ==========================================================================
# Clearance enforcement (Properties 8, 9, 11)
#
# RLS already decides WHICH narratives are visible by jurisdiction. It cannot
# express which FIELDS a clearance level may read, which is why this layer
# exists. Before this change, raw narrative bodies were returned regardless of
# clearance and Principal.can_see_narrative had zero call sites.
# ==========================================================================

def make_principal(clearance=4, rank="DGP"):
    from app.core.rbac import Principal

    return Principal(
        id="u1",
        name="Test Officer",
        rank=rank,
        scope="state",
        clearance=clearance,
    )


def case_rows(*pairs):
    """Rows shaped like the crime_type lookup output."""
    return [{"case_id": cid, "crime_type": ct} for cid, ct in pairs]


CASE_LOOKUP_MARKER = "FROM cases WHERE case_id"
PROTECTED_CRIME = "POCSO"       # in rbac.PROTECTED_CRIMES
ORDINARY_CRIME = "THEFT"        # not protected


# --- Property 8: protected content withheld --------------------------------

async def test_protected_narrative_is_withheld_at_clearance_1(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement details")],
        case_rows((900, PROTECTED_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=1, rank="PC")
    )

    assert len(result) == 1
    hit = result.hits[0]
    assert hit.restricted is True
    assert hit.text == rag.RESTRICTED_NOTICE
    assert "victim statement" not in hit.text
    assert result.withheld_count == 1
    # The record is still reported, so the officer knows something matched.
    assert hit.case_id == 900


async def test_protected_narrative_is_withheld_at_clearance_2(monkeypatch):
    """can_see_narrative requires clearance >= 3 for protected crimes."""
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement details")],
        case_rows((900, PROTECTED_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=2, rank="PSI")
    )

    assert result.hits[0].restricted is True
    assert result.withheld_count == 1


async def test_protected_narrative_is_visible_at_clearance_3(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement details")],
        case_rows((900, PROTECTED_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=3, rank="PI")
    )

    assert result.hits[0].restricted is False
    assert result.hits[0].text == "victim statement details"
    assert result.withheld_count == 0


async def test_protected_narrative_is_visible_at_clearance_4(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement details")],
        case_rows((900, PROTECTED_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=4)
    )

    assert result.hits[0].restricted is False
    assert result.hits[0].text == "victim statement details"
    assert result.withheld_count == 0


async def test_ordinary_narrative_is_visible_at_clearance_1(monkeypatch):
    """Only PROTECTED crimes are restricted; ordinary narratives are not."""
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 300, "chain snatching report")],
        case_rows((300, ORDINARY_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=1, rank="PC")
    )

    assert result.hits[0].restricted is False
    assert result.hits[0].text == "chain snatching report"
    assert result.withheld_count == 0


async def test_mixed_results_withhold_only_the_protected_one(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 300, "ordinary body"), lex_row(2, 900, "protected body")],
        case_rows((300, ORDINARY_CRIME), (900, PROTECTED_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=5, principal=make_principal(clearance=1, rank="PC")
    )

    by_case = {h.case_id: h for h in result.hits}
    assert by_case[300].restricted is False
    assert by_case[300].text == "ordinary body"
    assert by_case[900].restricted is True
    assert by_case[900].text == rag.RESTRICTED_NOTICE
    assert result.withheld_count == 1


# --- Property 9: fail closed ------------------------------------------------

async def test_missing_principal_fails_closed_even_for_ordinary_crime(monkeypatch):
    """No principal means no clearance decision can be made, so withhold."""
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 300, "ordinary body")],
        case_rows((300, ORDINARY_CRIME)),
    ])

    result = await rag.retrieve_narratives(s, "query", k=3)  # no principal

    assert result.hits[0].restricted is True
    assert result.hits[0].text == rag.RESTRICTED_NOTICE
    assert result.withheld_count == 1


async def test_case_not_visible_fails_closed(monkeypatch):
    """The crime type could not be resolved, so the case row was not visible."""
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 777, "body of an invisible case")],
        [],  # crime_type lookup returns nothing for case 777
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=4)
    )

    assert result.hits[0].restricted is True
    assert result.withheld_count == 1


async def test_crime_type_lookup_failure_fails_closed(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 888, "body")],
        RuntimeError("cases table unavailable"),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=4)
    )

    assert result.hits[0].restricted is True
    assert result.withheld_count == 1


# --- Property 11: the existing rbac rule is reused, not reimplemented -------

async def test_clearance_decision_calls_rbac_is_protected(monkeypatch):
    """Proves the rule is sourced from app.core.rbac.

    Patching the rbac module attribute affects both the direct call in
    _apply_clearance and the call inside Principal.can_see_narrative, because
    that method resolves is_protected from rbac module globals at call time.
    """
    install_fakes(monkeypatch)
    seen = []
    real = rag.rbac.is_protected

    def spy(crime_type):
        seen.append(crime_type)
        return real(crime_type)

    monkeypatch.setattr(rag.rbac, "is_protected", spy)

    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement")],
        case_rows((900, PROTECTED_CRIME)),
    ])
    await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=1, rank="PC")
    )

    assert PROTECTED_CRIME in seen, "rbac.is_protected was never consulted"


async def test_protected_crime_set_comes_from_rbac(monkeypatch):
    """Sanity: the fixture crime really is in the shared protected set."""
    from app.core.rbac import PROTECTED_CRIMES, is_protected

    assert PROTECTED_CRIME in PROTECTED_CRIMES
    assert is_protected(PROTECTED_CRIME) is True
    assert is_protected(ORDINARY_CRIME) is False


# --- Ordering: clearance must be applied after reranking --------------------

async def test_reranker_sees_real_text_not_the_restricted_notice(monkeypatch):
    """Clearance runs AFTER reranking.

    If the notice were substituted first, the cross-encoder would be ranking a
    constant string instead of the narrative, which would silently destroy
    relevance ordering for every restricted result.
    """
    _, rr = install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement details")],
        case_rows((900, PROTECTED_CRIME)),
    ])

    await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=1, rank="PC")
    )

    assert rr.last_docs == ["victim statement details"]
    assert rag.RESTRICTED_NOTICE not in rr.last_docs


async def test_no_crime_type_lookup_when_nothing_matched(monkeypatch):
    """The extra query must not be issued on the empty path."""
    install_fakes(monkeypatch)
    s = FakeSession([[], []])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=4)
    )

    assert result.is_empty
    assert not s.issued(CASE_LOOKUP_MARKER)
    assert s.call_count == 2


async def test_crime_type_lookup_is_batched_for_all_returned_rows(monkeypatch):
    """One lookup for every case, not one query per row."""
    install_fakes(monkeypatch)
    rows = [lex_row(i, 400 + i, f"body {i}") for i in range(1, 4)]
    s = FakeSession([[], rows, case_rows((401, ORDINARY_CRIME), (402, ORDINARY_CRIME), (403, ORDINARY_CRIME))])

    result = await rag.retrieve_narratives(
        s, "query", k=5, principal=make_principal(clearance=4)
    )

    assert len(result) == 3
    assert s.call_count == 3, "expected vector + lexical + one batched lookup"
    assert s.issued(CASE_LOOKUP_MARKER)
    assert sorted(s.params[2]["ids"]) == [401, 402, 403]


# --- Withheld hits still count as hits -------------------------------------

async def test_withheld_hit_is_still_returned_so_the_match_is_visible(monkeypatch):
    install_fakes(monkeypatch)
    s = FakeSession([
        [],
        [lex_row(1, 900, "victim statement")],
        case_rows((900, PROTECTED_CRIME)),
    ])

    result = await rag.retrieve_narratives(
        s, "query", k=3, principal=make_principal(clearance=1, rank="PC")
    )

    assert result.is_empty is False
    assert len(result) == 1
    assert result.withheld_count == 1
    assert result.strategy == rag.STRATEGY_LEXICAL


# ---------------------------------------------------------------------------
# Property 12: a failing arm must not poison the transaction
#
# Regression guard for a live defect. Once embeddings were populated but before
# the ANN index existed, the vector query hit the 5 s statement_timeout set by
# apply_rls_context. In Postgres a failed statement aborts the whole
# transaction, so the lexical fallback then died on
# InFailedSQLTransactionError and the lane returned nothing at all — strictly
# worse than before embeddings existed, when the vector arm returned zero rows
# instantly. The earlier fake had no transaction semantics, so the suite passed
# while the live lane was dead.
# ---------------------------------------------------------------------------


async def test_vector_timeout_does_not_poison_the_lexical_arm(monkeypatch):
    """The documented live failure: vector times out, lexical must still answer."""
    install_fakes(monkeypatch)
    timeout = RuntimeError("canceling statement due to statement timeout")
    session = FakeSession([timeout, [lex_row()], [{"case_id": 200, "crime_type": "THEFT"}]])

    result = await rag.retrieve_narratives(
        session, "chain snatching", k=3, principal=make_principal(clearance=4)
    )

    assert session.issued(LEXICAL_MARKER), "lexical arm never ran"
    assert session.savepoint_rollbacks == 1, "the failed arm did not roll back a savepoint"
    assert session.aborted is False, "transaction left in an aborted state"
    assert result.vector_available is False
    assert result.lexical_available is True
    assert result.strategy == rag.STRATEGY_LEXICAL
    assert len(result) == 1


async def test_each_query_is_wrapped_in_its_own_savepoint(monkeypatch):
    """Every statement rag.py issues is individually isolated."""
    install_fakes(monkeypatch)
    session = FakeSession(
        [[vec_row()], [lex_row()], [{"case_id": 100, "crime_type": "THEFT"}]]
    )

    await rag.retrieve_narratives(
        session, "chain snatching", k=3, principal=make_principal(clearance=4)
    )

    assert session.savepoints == session.call_count, (
        f"{session.call_count} statements but only {session.savepoints} savepoints"
    )
    assert session.savepoint_rollbacks == 0, "no arm failed, nothing should roll back"


async def test_guard_fails_without_savepoint_isolation(monkeypatch):
    """Proves the two tests above are not tautological.

    Replaces _execute_isolated with a savepoint-free version equivalent to the
    pre-fix code. The lexical arm must then be unreachable, which is exactly the
    live symptom.
    """
    install_fakes(monkeypatch)

    async def unisolated(session, sql, params):
        result = await session.execute(sql, params)
        return [dict(r) for r in result.mappings().all()]

    monkeypatch.setattr(rag, "_execute_isolated", unisolated)

    timeout = RuntimeError("canceling statement due to statement timeout")
    session = FakeSession([timeout, [lex_row()], [{"case_id": 200, "crime_type": "THEFT"}]])

    result = await rag.retrieve_narratives(
        session, "chain snatching", k=3, principal=make_principal(clearance=4)
    )

    assert not session.issued(LEXICAL_MARKER), "lexical should be unreachable here"
    assert session.aborted is True
    assert result.hits == []
    assert result.strategy == rag.STRATEGY_NONE
