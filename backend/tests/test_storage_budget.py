"""Storage budget guard — projection arithmetic and fail-closed behaviour.

No database and no model. `read_state` is exercised through a fake session in the
same style as tests/test_rag_retrieval.py, so these run under
`pytest -m "not integration"`.

The properties under test are the ones that decide whether a backfill is allowed
to write. An off-by-one here does not raise; it silently approves an operation
that fills the database and makes every subsequent write fail.
"""
from __future__ import annotations

import pytest

from app.core import storage
from app.core.storage import StorageState, StorageUnmeasurable, project

pytestmark = pytest.mark.asyncio


# ── helpers ──────────────────────────────────────────────────────────────────

CAP = 536_870_912                  # 512 MiB, confirmed for this Neon project
PEAK = int(CAP * 93.75 / 100)      # 503,316,480
STEADY = int(CAP * 87.5 / 100)     # 469,762,048
FLOOR = int(CAP * 12.5 / 100)      # 67,108,864

# The live cloud database at the time these were written.
MEASURED_DB_BYTES = 447_397_888    # 426.7 MB


def state(
    *,
    db_bytes: int,
    datum: int = 2052,
    index: int = 2740,
    total: int = 71986,
    embedded: int = 35993,
) -> StorageState:
    return StorageState(
        db_bytes=db_bytes,
        cap_bytes=CAP,
        peak_ceiling_bytes=PEAK,
        steady_ceiling_bytes=STEADY,
        reserve_floor_bytes=FLOOR,
        total_narratives=total,
        embedded_narratives=embedded,
        embedding_bytes_per_row=datum,
        index_bytes_per_vector=index,
    )


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value

    def mappings(self):
        return self

    def first(self):
        return self._value


class FakeSession:
    """Returns scripted results in call order, or raises a scripted exception."""

    def __init__(self, results: list):
        self._results = list(results)
        self.calls = 0

    async def execute(self, *_args, **_kwargs):
        self.calls += 1
        if not self._results:
            raise AssertionError("more queries issued than scripted")
        nxt = self._results.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return FakeResult(nxt)


# ── cost arithmetic ──────────────────────────────────────────────────────────

async def test_cost_per_row_is_datum_plus_index_share():
    """4,792 B is the measured all-in cost; neither half alone is the cost."""
    s = state(db_bytes=447_397_888)
    assert s.cost_per_embedded_row == 2052 + 2740 == 4792


async def test_free_bytes_measures_against_the_cap_not_the_ceiling():
    s = state(db_bytes=400_000_000)
    assert s.free_bytes == CAP - 400_000_000


async def test_free_bytes_goes_negative_when_over_cap():
    """Over-cap must be representable, not clamped — clamping hides the breach."""
    s = state(db_bytes=CAP + 5_000_000)
    assert s.free_bytes == -5_000_000
    assert s.within_reserve is False


# ── ceiling boundaries ───────────────────────────────────────────────────────

async def test_projection_fits_just_below_the_steady_ceiling():
    s = state(db_bytes=STEADY - 4792 * 10)
    assert project(s, 10).fits is True


async def test_projection_fits_exactly_at_the_steady_ceiling():
    """The ceiling is inclusive; landing exactly on it is allowed."""
    s = state(db_bytes=STEADY - 4792)
    p = project(s, 1)
    assert p.projected_bytes == STEADY
    assert p.fits is True


async def test_projection_refused_one_row_over_the_steady_ceiling():
    s = state(db_bytes=STEADY - 4792)
    assert project(s, 2).fits is False


async def test_peak_ceiling_admits_what_steady_refuses():
    """The peak allowance exists for a single migration and must be higher."""
    s = state(db_bytes=STEADY + 1_000_000)
    assert project(s, 100, peak=False).fits is False
    assert project(s, 100, peak=True).fits is True


# ── the reserve floor binds independently of the ceiling ─────────────────────

async def test_reserve_floor_refuses_even_when_the_ceiling_is_satisfied():
    """
    Requirement 1.5. The ceiling and the floor are separate limits: with a
    configurable cap and configurable percentages, cap - floor can be stricter
    than the ceiling, and the stricter one must win.
    """
    # Derived from CAP rather than hardcoded, so changing the cap cannot silently
    # move this case to the wrong side of the line the way absolute values did.
    big_floor = CAP // 4
    strict = StorageState(
        db_bytes=(CAP - big_floor) - 4792 * 500,  # 500 rows of room under the floor
        cap_bytes=CAP,
        peak_ceiling_bytes=PEAK,
        steady_ceiling_bytes=CAP,   # ceiling deliberately not binding
        reserve_floor_bytes=big_floor,
        total_narratives=71986,
        embedded_narratives=35993,
        embedding_bytes_per_row=2052,
        index_bytes_per_vector=2740,
    )
    p = project(strict, 1000)               # asks for double the room available
    assert p.ceiling_bytes == CAP - big_floor
    assert p.fits is False
    assert p.rows_affordable == 500
    # The ceiling on its own would have allowed it; only the floor refuses.
    assert p.projected_bytes < strict.steady_ceiling_bytes


async def test_steady_ceiling_and_cap_minus_floor_are_the_same_by_construction():
    """
    87.5% + 12.5% = 100%, so "db <= steady ceiling" and "free >= reserve floor"
    are one statement, not two. Encoded so that changing one percentage without
    the other fails here rather than silently making the two disagree.
    """
    assert STEADY == CAP - FLOOR


async def test_steady_projection_is_clamped_to_cap_minus_the_steady_floor():
    s = state(db_bytes=400_000_000)
    assert project(s, 1, peak=False).ceiling_bytes <= CAP - FLOOR


async def test_peak_uses_the_transient_floor_which_is_smaller():
    """
    The peak allowance would be unreachable if clamped to the steady floor. It is
    clamped to the transient floor instead, which the peak ceiling itself defines.
    """
    s = state(db_bytes=400_000_000)
    assert s.transient_floor_bytes == CAP - PEAK
    assert s.transient_floor_bytes < s.reserve_floor_bytes
    assert project(s, 1, peak=True).ceiling_bytes == PEAK


async def test_peak_is_still_clamped_when_percentages_are_contradictory():
    """A ceiling above the cap must not be honoured just because it was configured."""
    bad = StorageState(
        db_bytes=400_000_000,
        cap_bytes=CAP,
        peak_ceiling_bytes=CAP + 50_000_000,   # nonsense: above the cap
        steady_ceiling_bytes=STEADY,
        reserve_floor_bytes=FLOOR,
        total_narratives=10,
        embedded_narratives=5,
        embedding_bytes_per_row=2052,
        index_bytes_per_vector=2740,
    )
    assert bad.transient_floor_bytes == 0
    assert project(bad, 1, peak=True).ceiling_bytes == CAP


# ── rows_affordable ──────────────────────────────────────────────────────────

async def test_rows_affordable_is_reported_even_when_the_request_fits():
    """A refused caller needs a number, and so does an approved one."""
    s = state(db_bytes=400_000_000)
    p = project(s, 1)
    assert p.fits is True
    assert p.rows_affordable > 1


async def test_rows_affordable_is_zero_when_already_past_the_limit():
    s = state(db_bytes=CAP - FLOOR + 1)
    p = project(s, 5000)
    assert p.rows_affordable == 0
    assert p.fits is False


async def test_measured_baseline_is_compliant_with_a_small_growth_budget():
    """
    The real position: 426.7 MB against a confirmed 512 MiB cap. Compliant on both
    limits, with roughly 21 MB of growth budget — about 4,600 embedded narratives,
    or 13% of the unembedded Kannada corpus. Encodes reality, not a hypothetical,
    so a cap change that breaks compliance fails here.
    """
    s = state(db_bytes=MEASURED_DB_BYTES)
    assert s.within_reserve is True
    assert s.within_steady_ceiling is True
    p = project(s, 35993)
    assert 4_000 < p.rows_affordable < 5_500
    assert p.fits is False  # the full Kannada half still does not fit


async def test_full_kannada_backfill_is_refused_at_the_baseline():
    """
    The operation this whole guard exists to stop. Still refused at the larger
    confirmed cap: 35,993 rows is ~164 MB against ~21 MB of budget, and the
    projection lands past the hard cap, not merely past the ceiling.
    """
    s = state(db_bytes=MEASURED_DB_BYTES)
    p = project(s, 35993)
    assert p.fits is False
    assert p.projected_bytes > CAP


async def test_zero_and_negative_row_requests_are_harmless():
    s = state(db_bytes=400_000_000)
    assert project(s, 0).projected_bytes == 400_000_000
    assert project(s, -5).rows_requested == 0


async def test_zero_cost_per_row_does_not_divide_by_zero():
    """A fresh database with no index and no measurable datum must not crash."""
    s = state(db_bytes=100_000_000, datum=0, index=0)
    assert project(s, 10).rows_affordable == 0


# ── rendering never changes a decision ───────────────────────────────────────

async def test_rendering_is_not_used_in_comparisons():
    """
    Requirement 1.6. Two sizes 1 byte apart straddling the ceiling render to the
    same MB string, so the verdict must come from the byte comparison.
    """
    below = state(db_bytes=STEADY - 1)
    above = state(db_bytes=STEADY + 1)
    p_below, p_above = project(below, 0), project(above, 0)
    assert storage._mb(p_below.projected_bytes) == storage._mb(p_above.projected_bytes)
    assert p_below.fits is True
    assert p_above.fits is False


async def test_explain_mentions_the_affordable_count():
    s = state(db_bytes=MEASURED_DB_BYTES)
    text_out = project(s, 35993).explain()
    assert "REFUSED" in text_out
    assert "rows that fit within budget" in text_out


# ── read_state fails closed ──────────────────────────────────────────────────

async def test_read_state_raises_when_a_query_fails():
    s = FakeSession([RuntimeError("connection reset")])
    with pytest.raises(StorageUnmeasurable):
        await storage.read_state(s)


async def test_read_state_raises_when_db_size_is_null():
    """Requirement 2.7: no substituting a default for an unmeasurable input."""
    s = FakeSession([None, {"total": 10, "embedded": 5}, 2052, 13700])
    with pytest.raises(StorageUnmeasurable):
        await storage.read_state(s)


async def test_read_state_raises_when_narratives_is_unreadable():
    s = FakeSession([447_397_888, None, 2052, 13700])
    with pytest.raises(StorageUnmeasurable):
        await storage.read_state(s)


async def test_read_state_measures_index_cost_per_vector():
    """index_bytes_per_vector is derived from the index size, not assumed."""
    s = FakeSession([447_397_888, {"total": 71986, "embedded": 35993}, 2052, 98_304_000])
    st = await storage.read_state(s)
    assert st.embedding_bytes_per_row == 2052
    assert st.index_bytes_per_vector == 98_304_000 // 35993 == 2731
    assert st.coverage_percent == 50.0


async def test_read_state_handles_embeddings_present_but_no_index():
    """A real state: rows embedded, HNSW not yet built. Cost is genuinely zero."""
    s = FakeSession([200_000_000, {"total": 100, "embedded": 100}, 2052, None])
    st = await storage.read_state(s)
    assert st.index_bytes_per_vector == 0
    assert st.cost_per_embedded_row == 2052


async def test_read_state_computes_datum_size_for_an_empty_corpus():
    """
    Nothing embedded means nothing to measure, so the datum size is computed from
    the configured dimension and vector type. halfvec(1024) = 1024*2 + 4 header.
    """
    s = FakeSession([50_000_000, {"total": 100, "embedded": 0}, None, None])
    st = await storage.read_state(s)
    assert st.embedding_bytes_per_row == 1024 * 2 + 4
    assert st.index_bytes_per_vector == 0
    assert st.coverage_percent == 0.0


# ── state-level verdicts ─────────────────────────────────────────────────────

async def test_within_reserve_boundary_is_inclusive():
    s = state(db_bytes=CAP - FLOOR)
    assert s.within_reserve is True
    assert state(db_bytes=CAP - FLOOR + 1).within_reserve is False


async def test_explain_flags_degraded_only_when_a_limit_is_breached():
    assert "OK" in state(db_bytes=MEASURED_DB_BYTES).explain()
    assert "DEGRADED" in state(db_bytes=STEADY + 1).explain()
    assert "DEGRADED" in state(db_bytes=CAP - FLOOR + 1).explain()
