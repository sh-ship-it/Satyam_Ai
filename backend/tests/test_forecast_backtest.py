"""Metric arithmetic for the forecast backtest.

No database. The SQL is exercised against the live database separately; what is
pinned here is the part that turns fold rows into a published number, because
every failure mode is silent: a wrong denominator, an averaged-instead-of-pooled
rate, or a hit rate relabelled as PAI all return a plausible-looking figure that
overstates how well the forecast works.

`_risk_score` is pinned too. `_RISK_SCORE_SQL` in the service transcribes it into
SQL so the backtest scores the same formula the hotspots screen serves; if the
Python side is changed without the SQL, the backtest quietly starts validating a
model nobody is looking at.
"""
from __future__ import annotations

import pytest

from app.services.intelligence_service import (
    _lift_percent,
    _risk_score,
    _wilson_ci,
    get_forecast_backtest,
)

# No module-level asyncio mark: pyproject sets asyncio_mode = "auto", and marking
# the sync tests in this file would warn on every one of them.


# ── helpers ──────────────────────────────────────────────────────────────────

def fold_row(
    fold: int,
    *,
    hits: int,
    test_incidents: int,
    cells_selected: int = 10,
    cells_study_area: int = 100,
    cells_rankable: int = 100,
    hits_max: int | None = None,
    train_incidents: int = 1000,
    test_unrankable: int = 0,
) -> dict:
    return {
        "fold": fold,
        "origin": f"2025-0{fold + 1}-01",
        "test_end": f"2025-0{fold + 2}-01",
        "cells_study_area": cells_study_area,
        "cells_rankable": cells_rankable,
        "test_incidents": test_incidents,
        "test_unrankable": test_unrankable,
        "train_incidents": train_incidents,
        "cells_selected": cells_selected,
        "hits": hits,
        "hits_max": hits if hits_max is None else hits_max,
    }


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class FakeSession:
    """Returns one scripted row set; the backtest issues exactly one query."""

    def __init__(self, rows):
        self._rows = rows
        self.calls = 0
        self.params: dict | None = None

    async def execute(self, _sql, params=None):
        self.calls += 1
        self.params = params
        return FakeResult(self._rows)


# Two folds of deliberately unequal size. Pooling and averaging disagree by a
# lot here, which is the point: 60/100 and 10/900 pool to 7% but average to 31%.
LOPSIDED = [
    fold_row(0, hits=60, test_incidents=100, hits_max=80, train_incidents=1000,
             cells_rankable=100, test_unrankable=5),
    fold_row(1, hits=10, test_incidents=900, hits_max=200, train_incidents=500,
             cells_rankable=50, test_unrankable=20),
]


# ── the scorer under test ────────────────────────────────────────────────────

def test_lift_percent_treats_a_cold_start_as_a_spike():
    # No prior baseline but recent activity: fixed +50%, not a divide by zero.
    assert _lift_percent(recent=4, baseline=0) == 50
    assert _lift_percent(recent=0, baseline=0) == 0


def test_lift_percent_truncates_toward_zero_on_a_decline():
    # -33.33% must truncate to -33, not floor to -34: the SQL side uses trunc().
    assert _lift_percent(recent=2, baseline=3) == -33
    assert _lift_percent(recent=3, baseline=2) == 50


@pytest.mark.parametrize(
    "total,recent,baseline,expected",
    [
        # floor only: log1p(1)*10 = 6.93 -> 6
        (1, 0, 0, 20 + 6),
        # density grows with the log of all-time count
        (100, 0, 0, 20 + 46),
        # density term caps at 50 (needs total > e^5 - 1 = 147)
        (10_000_000, 0, 0, 20 + 50),
        # a decline never subtracts: lift_score floors at 0
        (100, 2, 30, 20 + 46),
        # cold start: lift 50% -> int(50*0.3) = 15
        (100, 5, 0, 20 + 46 + 15),
        # lift caps at 30 (needs lift_pct >= 100)
        (100, 500, 1, 20 + 46 + 30),
        # overall cap at 99
        (10_000_000, 500, 1, 99),
    ],
)
def test_risk_score_matches_the_published_formula(total, recent, baseline, expected):
    assert _risk_score(total, recent, baseline) == expected


def test_risk_score_never_leaves_the_published_range():
    for total in (0, 1, 7, 150, 5_000, 10_000_000):
        for recent, baseline in ((0, 0), (1, 0), (0, 9), (9, 1), (400, 1)):
            assert 20 <= _risk_score(total, recent, baseline) <= 99


# ── Wilson interval ─────────────────────────────────────────────────────────

def test_wilson_upper_bound_at_zero_hits_is_not_zero():
    """The normal approximation collapses to a zero-width interval here."""
    lo, hi = _wilson_ci(0, 10)
    assert lo == 0.0
    assert hi == pytest.approx(0.2775, abs=5e-4)


def test_wilson_stays_inside_the_unit_interval_at_the_extremes():
    lo, hi = _wilson_ci(10, 10)
    assert hi <= 1.0
    assert hi == pytest.approx(1.0)
    assert lo == pytest.approx(0.7225, abs=5e-4)


def test_wilson_narrows_as_the_sample_grows():
    narrow = _wilson_ci(440, 1000)
    wide = _wilson_ci(44, 100)
    assert (narrow[1] - narrow[0]) < (wide[1] - wide[0]) / 2


def test_wilson_on_an_empty_sample_does_not_divide_by_zero():
    assert _wilson_ci(0, 0) == (0.0, 0.0)


# ── pooling and the derived metrics ─────────────────────────────────────────

async def test_hit_rate_pools_incidents_rather_than_averaging_fold_rates():
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    # 70 of 1000, not the 30.6% mean of 60% and 1.1%.
    assert r.hits == 70
    assert r.test_incidents == 1000
    assert r.hit_rate_top_10_percent_cells == pytest.approx(0.07)


async def test_pai_is_a_ratio_against_the_area_share_not_a_percentage():
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    assert r.area_share_percent == pytest.approx(10.0)
    assert r.baseline_hit_rate == pytest.approx(0.10)
    # 7% of incidents from 10% of the area is worse than random.
    assert r.pai == pytest.approx(0.70)
    assert r.pai != r.hit_rate_top_10_percent_cells


async def test_pai_above_one_means_better_than_random():
    rows = [fold_row(0, hits=44, test_incidents=100, cells_selected=10, cells_study_area=100)]
    r = await get_forecast_backtest(FakeSession(rows))
    assert r.pai == pytest.approx(4.4)


async def test_pei_is_measured_against_the_best_achievable_selection():
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    # 70 hits against the 280 an oracle picking the same cell count would get.
    assert r.pei == pytest.approx(0.25)
    assert 0.0 <= r.pei <= 1.0


async def test_a_perfect_selection_scores_pei_one():
    rows = [fold_row(0, hits=50, test_incidents=100, hits_max=50)]
    r = await get_forecast_backtest(FakeSession(rows))
    assert r.pei == pytest.approx(1.0)


async def test_unrankable_cells_stay_in_the_denominator():
    """The bug this replaced: excluding no-history cells inflated the hit rate."""
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    assert r.excluded_incidents == 25
    # The denominator is every held-out incident, exclusions included.
    assert r.test_incidents == 1000
    assert any("stay in the denominator" in c for c in r.caveats)


async def test_per_fold_detail_is_reported_so_a_single_window_is_not_mistaken_for_the_estimate():
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    assert [f.fold for f in r.per_fold] == [0, 1]
    assert r.per_fold[0].hit_rate == pytest.approx(0.60)
    assert r.per_fold[1].hit_rate == pytest.approx(0.0111, abs=1e-4)
    assert r.per_fold[0].pai == pytest.approx(6.0)


async def test_empty_result_set_reports_zeroes_instead_of_dividing_by_zero():
    r = await get_forecast_backtest(FakeSession([]))
    assert (r.hits, r.test_incidents, r.pai, r.pei) == (0, 0, 0.0, 0.0)
    assert r.hit_rate_top_10_percent_cells == 0.0


# ── caveats fire on the conditions that make the number unreadable ──────────

async def test_a_sparse_grid_is_flagged():
    # 120 training incidents over 100 rankable cells: ranking counts near 1.
    rows = [fold_row(0, hits=44, test_incidents=100, train_incidents=120, cells_rankable=100)]
    r = await get_forecast_backtest(FakeSession(rows), grid_size=0.02)
    assert r.mean_train_incidents_per_cell == pytest.approx(1.2)
    assert any("Sparse grid" in c for c in r.caveats)


async def test_a_dense_grid_is_not_flagged_as_sparse():
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    assert r.mean_train_incidents_per_cell == pytest.approx(10.0)
    assert not any("Sparse grid" in c for c in r.caveats)


async def test_a_small_sample_is_flagged_with_its_interval():
    rows = [fold_row(0, hits=44, test_incidents=107)]
    r = await get_forecast_backtest(FakeSession(rows))
    assert any("95% interval of" in c for c in r.caveats)
    # The interval on n=107 is wide enough to swallow most claimed improvements.
    assert (r.hit_rate_ci_high - r.hit_rate_ci_low) > 0.15


async def test_a_large_sample_is_not_flagged_as_small():
    r = await get_forecast_backtest(FakeSession(LOPSIDED))
    assert not any("95% interval of" in c for c in r.caveats)


# ── parameters reach the query ──────────────────────────────────────────────

async def test_filters_and_grid_are_bound_into_the_query():
    s = FakeSession(LOPSIDED)
    await get_forecast_backtest(s, crime_type="Theft", district="Bengaluru", grid_size=0.05)
    assert s.params is not None
    assert s.params["grid"] == 0.05
    assert s.params["ct"] == "%Theft%"
    assert s.params["dist"] == "%Bengaluru%"


async def test_absent_filters_bind_null_so_the_predicate_matches_everything():
    s = FakeSession(LOPSIDED)
    await get_forecast_backtest(s)
    assert s.params is not None
    assert s.params["ct"] is None and s.params["dist"] is None


async def test_fold_and_window_counts_are_clamped_to_a_sane_range():
    s = FakeSession(LOPSIDED)
    r = await get_forecast_backtest(s, folds=999, test_days=1)
    assert s.params is not None
    assert s.params["folds"] == 24
    assert s.params["test_days"] == 7
    # The window label has to describe what actually ran, not what was asked for.
    assert r.window == "rolling_origin_24x7d"
