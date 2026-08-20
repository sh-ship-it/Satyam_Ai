# Implementation Plan

## Overview

23 tasks in dependency order. Tasks 2 to 7 and 10 build pure functions with their tests and touch no running behaviour, so the app is unaffected. Task 8 is the additive migration. Tasks 11 to 16 wire the endpoints. Tasks 17 to 20 are the coordinated frontend edits. Tasks 21 to 23 verify.

The app stays demonstrable at every commit. Endpoint wiring emits additive fields first, so the frontend can lag. The three coordinated value changes named in the design ship with their frontend edit. The MO clusters endpoint degrades to a labelled fallback when its tables are empty or absent, so task 16 can land before task 8 is applied to any given database.

## Tasks
- [ ] 1. Set up the test harness so checks can actually run
  - Add `backend/pyproject.toml` with `[tool.pytest.ini_options] asyncio_mode = "auto"` and `markers = ["integration"]`
  - Mark `backend/tests/test_health.py::test_login_and_me` as `@pytest.mark.integration` since it needs a live seeded database and clears private session globals
  - Confirm `pytest -m "not integration"` passes green before any other change
  - _Requirements: 12.1, 12.6_

- [ ] 2. Create the analytics package with one grid definition
  - Create `backend/app/services/analytics/__init__.py` and `grid.py`
  - Implement `SUPPORTED_GRID = (0.01, 0.02, 0.05)`, `DEFAULT_GRID = 0.02`, `cell_index`, `cell_centre`, `cell_id`, `neighbours`
  - Use `floor` on both axes so the plane partitions without overlap and neighbour arithmetic is an integer offset
  - `cell_id` returns `f"{ix}_{iy}"` so it is stable across requests instead of being a row ordinal
  - Record in the module docstring that `pipeline/tools/analytics.hotspots` keeps its own 3-decimal rounding and is out of scope
  - _Requirements: 4.8, 11.1_

- [ ] 2.1 Write the grid tests
  - Assert `floor` keying partitions without overlap for adjacent coordinates
  - Assert the same coordinate pair yields the same `cell_id` on repeated calls
  - Assert `neighbours` returns exactly 8 distinct offsets and never includes the centre cell
  - _Requirements: 12.1_

- [ ] 3. Implement Getis-Ord Gi-star significance
  - Create `analytics/spatial.py` with `GiResult`, `getis_ord_gi_star`, `significance_band`, `z_to_score`
  - Compute the statistic over the 3x3 queen block including the centre cell, using numpy only for the vectorised mean and standard deviation
  - Derive the one-sided p-value with `math.erfc(z / sqrt(2)) * 0.5` so scipy is not required
  - Map p-value bands to the exact four strings `Critical`, `High`, `Medium`, `Low` at thresholds 0.01, 0.05, 0.10
  - Return an empty list when fewer than three cells are occupied or the standard deviation is zero, never raise
  - _Requirements: 1.1, 9.3, 9.6_

- [ ] 3.1 Write the Gi-star tests as property checks
  - Property 7: plant a cluster on an otherwise uniform 5x5 grid, assert the planted cell has the maximum z and `p < 0.05`
  - Property 6: assert fewer than three cells and zero-variance inputs return empty and do not raise
  - Assert a uniform grid yields no cell below `p = 0.05`
  - Assert `significance_band` only ever returns one of the four allowed strings
  - _Requirements: 12.1, 12.3_

- [ ] 4. Implement the horizon projection and the shared lift helper
  - Create `analytics/horizon.py` with `ALPHA = 0.5`, `BUCKETS = 4`, `ewma_daily_rate`, `expected_count`, `lift`
  - Bucket the trailing period into `BUCKETS` windows of `horizon_days` each so the buckets themselves change with the horizon
  - `lift` normalises both windows to a per-day rate before the ratio, and returns `(None, "emerging")` when the baseline is zero
  - This is the single implementation both the hotspots and alerts endpoints will call
  - _Requirements: 2.1, 2.2, 3.1, 3.3, 3.4_

- [ ] 4.1 Write the horizon and window tests
  - Property 1: assert `expected_count` differs between `horizon_days=3` and `horizon_days=30` on a fixture with temporal variation
  - Property 9: assert equal-length windows, and assert per-day normalisation makes unequal windows comparable
  - Property 10: assert the same counts produce the identical `(lift_pct, state)` pair regardless of caller
  - Assert a zero baseline returns `None` and never a fixed 50 or 100
  - _Requirements: 12.1, 12.2_

- [ ] 5. Implement circular hour statistics
  - Create `analytics/circular.py` with `MIN_CONCENTRATION = 0.15`, `circular_mean_hour`, `patrol_window`
  - Use `atan2(mean(sin), mean(cos))` over `theta = hour * 2 * pi / 24`, and return the resultant length as a concentration measure
  - Return `None` for the mean hour when concentration is below the threshold, and have `patrol_window` return `("", "insufficient_time_concentration")` in that case
  - No default hour is ever substituted
  - _Requirements: 5.1, 5.2, 5.6, 9.6_

- [ ] 5.1 Write the circular statistics tests
  - Property 8: assert `circular_mean_hour([23, 1])` returns 0, not 12
  - Assert a uniform spread of hours returns `None` with low concentration
  - Assert `patrol_window(None)` returns an empty string and a basis explaining why
  - _Requirements: 12.1, 12.3_

- [ ] 6. Implement multiplicative seasonal decomposition
  - Create `analytics/seasonal.py` with `decompose` and `drop_incomplete_years`
  - Divide each month by its own year mean to remove the level difference between years, then average the ratios per calendar month
  - Return all twelve months with `index`, `lift_percent` rounded to one decimal, `n_years`, `std` and `significant`
  - Set `significant` when the absolute deviation from 1.0 exceeds one standard deviation across years
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 6.1 Write the seasonal tests
  - Property 14: assert a series with pure year-on-year growth and no seasonal component flags no month significant
  - Assert a planted December spike is detected and flagged significant
  - Assert an incomplete final year is excluded from the baseline
  - Assert all twelve months are returned, including troughs below the baseline
  - _Requirements: 12.1, 12.3_

- [ ] 7. Implement the walk-forward backtest
  - Create `analytics/backtest.py` with `FOLDS = 4`, `FLAGGED_FRACTION = 0.10`, `FoldResult`, `evaluate_fold`, `random_baseline`, `aggregate`
  - Use half-open intervals so train and test cannot share a boundary instant
  - Build the fold universe from the union of train and test cell keys so cells with zero train count stay in the denominator
  - Compute `hit_rate`, `area_fraction`, `pai = hit_rate / area_fraction`, and `pei = pai / pai_max` where `pai_max` comes from an oracle flagging the same cell count by actual test counts
  - Implement `random_baseline` with `random_state = 42`
  - `aggregate` returns mean, standard deviation, per-fold values, `n_test_incidents`, `area_fraction` and `baseline_pai`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [ ] 7.1 Write the backtest tests
  - Property 2: assert `pai == hit_rate / area_fraction` within tolerance for every fold
  - Property 3: construct a cell with zero train count and positive test count, assert it is present in the denominator
  - Property 4: assert train and test intervals are disjoint for all four folds
  - Property 5: assert `baseline_pai` falls within 0.8 to 1.2 on uniformly random cell counts
  - Assert `aggregate` reports four folds and a non-null standard deviation
  - _Requirements: 12.1, 12.2, 12.3_

- [ ] 8. Write the additive migration and its rollback
  - Create `backend/migrations/009_analytics_model_integrity.sql` containing only `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` and `GRANT`
  - Create `analytics_refresh`, `mo_cluster`, `mo_cluster_member` with array columns defaulting to empty arrays, plus `idx_mo_member_case`
  - Add `idx_cases_geo` as a partial index on the geocoded rows, and `idx_cases_crime_trgm` and `idx_cases_district_trgm` as GIN trigram indexes since `pg_trgm` is already installed
  - Grant SELECT plus INSERT, UPDATE, DELETE on the three new tables to `satyam_app`
  - Do not create an HNSW index on `narratives.embedding`, and do not modify migration `002`
  - Create `backend/migrations/009_rollback.sql` dropping only the objects this migration adds
  - Verify the migration is safe to run twice
  - _Requirements: 11.1, 11.4, 11.5_

- [ ] 9. Add the ORM models and the refresh guard
  - Create `backend/app/db/analytics_models.py` with declarative models for the three new tables
  - Create `analytics/refresh.py` with `REFRESH_TTL_HOURS = 24`, `LOCK_KEY_MO_CLUSTER = 728311043`, `is_stale`, `with_refresh_lock`, `mark_complete`
  - Read staleness from `analytics_refresh` rather than a module global, which is the specific flaw in the existing `risk_service` debounce
  - `with_refresh_lock` uses `pg_advisory_xact_lock` and yields `False` when another worker holds it, so the caller serves the fallback rather than waiting
  - Record failures as `status = 'failed'` with detail, leaving any previous result intact
  - _Requirements: 11.6, 6.8_

- [ ] 10. Implement MO clustering
  - Create `analytics/mo_cluster.py` with `K_RANGE = range(4, 17)`, `SILHOUETTE_SAMPLE = 5000`, `RANDOM_STATE = 42`
  - `build_features` selects embeddings when supplied and non-empty, otherwise `TfidfVectorizer(max_features=2000, stop_words="english", min_df=5)` followed by `TruncatedSVD(n_components=128, random_state=42)`
  - Always append scaled structured features: multi-hot over the top 50 sections taken from `sections_arr` so order does not matter, one-hot crime type, and sin and cos of the circular hour
  - `choose_k` fits each candidate and scores `silhouette_score` on a fixed subsample, selecting the highest
  - `fit` uses `MiniBatchKMeans(random_state=42, n_init=3, batch_size=1024)`
  - `label_clusters` derives each label from that cluster's own top centroid terms, dominant crime type and most frequent section set
  - Return the chosen `k`, the silhouette, and the method identifier
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 10.1 Write the clustering tests
  - Property 15: assert identical input yields identical labels under the fixed seed
  - Property 16: assert two cases differing only in section ordering land in the same cluster
  - Assert `k` is selected from the candidate range and is not fixed at 10
  - Assert the silhouette is returned and the method identifier reflects the feature space actually used
  - Assert `build_features` succeeds with `embeddings=None`, which is the current state of the database
  - _Requirements: 12.1, 12.3_

- [ ] 11. Wire the forecast hotspots endpoint
  - Rewrite `get_forecast_hotspots` to use `grid`, `horizon` and `spatial`, feeding `expected_count` as the Gi-star input variable
  - Derive `risk_level` from the significance band and `risk_score` from `z_to_score`, keeping the 0 to 100 scale
  - Change the route parameter to `horizon_days: Literal[3, 7, 14, 30] = 7` so an unsupported value is a validation error
  - Add the additive fields `z_score`, `p_value`, `expected_count`, `observed_count`, `neighbour_count`, `method`, `recent_window_days`, `baseline_window_days`, `partial_period`, `total_matching` to `ForecastCell` and `ForecastHotspotsResponse`
  - Build every `why` string from the emitted window lengths rather than a hardcoded 30-day phrase
  - Degrade to `method = "density_only"` when Gi-star returns empty
  - _Requirements: 1.4, 2.1, 2.3, 2.5, 3.1, 3.2, 3.5, 3.6, 9.1, 9.2, 9.3_

- [ ] 12. Wire the forecast alerts endpoint
  - Replace the arithmetic `AVG(hour)` with the circular mean, computed in Python over fetched hours
  - Emit an empty `patrol_window` plus `patrol_window_basis` when concentration is insufficient, and never substitute 18:00
  - Change the baseline window to the immediately preceding equal-length window and use the shared `lift` helper
  - Implement the `baseline * 1.2` threshold that the docstring already claims, and rewrite the docstring to match the query
  - Add `alert_kind` set to `spike` or `persistent_volume`, and set the latter on the fallback branch
  - Remove the 30-point score floor and derive the level from the significance band so `Low` becomes reachable
  - Add `total_matching` so the fixed limit of 8 is visible as a truncation
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 3.1, 3.4, 9.2_

- [ ] 13. Wire the backtest endpoint
  - Rewrite `get_forecast_backtest` to call `analytics/backtest` with the same `grid_size` the screen requested
  - Change `metric` from `"PAI"` to `"Hit rate"` and add a genuine `pai` field alongside
  - Keep `hit_rate_top_10_percent_cells` on its 0 to 1 scale and keep `window` a non-null string
  - Add `pei`, `baseline_pai`, `folds`, `pai_std`, `per_fold`, `n_test_incidents`, `area_fraction`, `grid_size`
  - Rewrite the explanation string to name the fold count, the baseline and the flagged-area fraction
  - _Requirements: 1.5, 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 9.1, 10.3_

- [ ] 14. Wire the trends endpoint
  - Change the period key format per granularity to `IYYY-"W"IW`, `YYYY-MM` and `YYYY-"Q"Q` so keys are unique and lexically sortable
  - Compute year-over-year by deriving the key one calendar year earlier and looking it up, returning `None` when absent
  - Return `None` when the previous period count is zero instead of substituting 1
  - Keep the field name `qoq_percent` and add the additive `delta_granularity`
  - Bound `series` to the top 2000 combinations and add a `totals` object carrying `total_incidents`, `distinct_crime_types`, `distinct_districts`, `period_count` and `returned_rows` computed server-side over the unbounded set
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.2, 11.3_

- [ ] 14.1 Write the period key tests
  - Property 11: assert distinct ISO weeks never share a key at weekly granularity
  - Property 12: assert lexical sort equals chronological sort at all three granularities
  - Property 13: assert a zero previous period yields `None`
  - Assert year-over-year resolves correctly at week, month and quarter
  - _Requirements: 12.1, 12.3_

- [ ] 15. Wire the seasonal endpoint
  - Rewrite `get_seasonal` to call `analytics/seasonal.decompose`
  - Keep `seasonal_peaks` carrying only above-baseline months so the existing cards render unchanged
  - Add the additive `profile` array with all twelve months, and per-peak `n_years`, `std` and `significant`
  - Emit `recommended_action` only when `significant` is true
  - Round `lift_percent` to one decimal
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1_

- [ ] 16. Wire the MO clusters endpoint and its refresh route
  - Rewrite `get_mo_clusters` to read `mo_cluster` and `mo_cluster_member`, returning `method`, `silhouette`, `k`, `top_terms`, `built_at` and `quality_note`
  - Implement the three-level degradation: fresh precompute, empty table, and absent table caught as an undefined-relation error, with the last two serving the legacy frequency query labelled `frequency_fallback`
  - Trigger an opportunistic refresh through `refresh.is_stale` and `with_refresh_lock`, never blocking the request
  - Add an admin-only refresh route requiring clearance L4 and writing an audit row
  - Confirm the endpoint returns a correct response before the migration has been applied
  - _Requirements: 6.4, 6.8, 1.1, 9.3, 11.6_

- [ ] 17. Update the frontend response types
  - Add the new fields to `lib/api/intelligence.ts`, declaring every new field optional so a backend without them still type-checks
  - Add `TrendsTotals`, `SeasonalProfileEntry` and the new backtest fields
  - Update `BacktestResponse` to include `pai`, `pei`, `baseline_pai`, `folds`, `pai_std`
  - _Requirements: 10.6_

- [ ] 18. Update the forecast screen and the inference panel
  - In `components/ModelInferenceTheater.tsx`, rename the `Neural forecast engine` label, relabel the four `stages` to the query steps actually performed, change the `PAI` metric to `Hit rate`, and add a separate real PAI metric from the new field
  - In `routes/forecast.tsx`, change the header pill at line 514 from `PAI` to `Hit rate` and add a real PAI pill
  - Generate the window description near line 623 from `recent_window_days` and `baseline_window_days` instead of the hardcoded phrase
  - Hide the patrol row near line 151 when `patrol_window` is empty
  - Render an `alert_kind` badge so a persistent-volume alert is visually distinct from a spike
  - Show `folds`, `pai_std` and `baseline_pai` on the backtest card
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.2, 5.3, 5.6, 9.4, 9.5, 10.5_

- [ ] 19. Update the trends screen and the reports label
  - Drive the `QoQ Trend` and `QoQ Change` labels at `trends.tsx` lines 979 and 1032 from `delta_granularity`
  - Drive the `Quarter-on-quarter` label at `reports.tsx` line 878 from `delta_granularity`
  - Read the KPI block from `totals` instead of summing `series`
  - Show `method`, `k` and `silhouette` on the clusters panel, and replace the clustering heading when `method` is `frequency_fallback`
  - Render the twelve-month `profile` strip on the seasonal tab and suppress `recommended_action` when `significant` is false
  - _Requirements: 7.3, 9.1, 9.2, 9.4, 1.1, 8.3, 8.6, 10.5_

- [ ] 20. Add every new string to the translation layer
  - Add the new EN keys with KN values to the `DICT` in `lib/i18n.tsx`
  - Add every new user-facing string to `ALL_TRANSLATABLE`, otherwise it silently renders in English on the Kannada path
  - Remove or replace the now-inaccurate keys `Neural forecast engine`, `Risk model`, `Cells scored` and `PAI`
  - _Requirements: 1.1, 1.2_

- [ ] 21. Add the response contract test
  - Create `test_contract.py` asserting Properties 17, 18 and 19 across every response model in scope
  - Assert array fields default to an empty list and are never null
  - Assert `hit_rate_top_10_percent_cells` stays within 0 to 1, and `risk_score` and `lift_percent` within 0 to 100
  - Assert `risk_level` is always one of the four allowed strings
  - Assert `window` remains a string and `case_count` remains an integer
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 12.4_

- [ ] 22. Correct the documentation and the docstrings
  - Update `docs/ARCHITECTURE.md` where it describes forecasting or clustering capabilities that did not exist
  - Rewrite the `get_forecast_backtest` docstring, which currently calls a hit rate PAI
  - Rewrite the `get_forecast_alerts` docstring so the documented threshold matches the query
  - Rewrite the `get_rings` docstring reference in `intelligence_service.py` only where it describes the endpoints in this scope
  - _Requirements: 1.6_

- [ ] 23. Run the manual verification matrix
  - Verify `/forecast` in English and in Kannada at each of the four horizons, confirming the returned cells change between horizons
  - Verify `/trends` in English and in Kannada across all four tabs and all three granularities
  - Verify both screens with `mo_cluster` empty, confirming the fallback renders and is labelled `frequency_fallback`
  - Verify both screens before migration 009 is applied, confirming nothing blanks
  - Confirm the voice copilot still answers and speaks on both screens, since analytics changes must not reach the TTS path
  - _Requirements: 12.5, 6.8_

## Task Dependency Graph

```
1  test harness
│
├─ 2  grid ──────────────┬─ 3  Gi-star ─┐
│                        │              │
├─ 4  horizon + lift ────┤              │
├─ 5  circular ──────────┤              │
├─ 6  seasonal ──────────┤              │
└─ 7  backtest ──────────┘              │
                                        │
8  migration 009 ─── 9  ORM + refresh ─── 10  MO clustering
                                        │
        ┌───────────────────────────────┴──────────────────────────┐
        │                                                          │
11 hotspots   12 alerts   13 backtest   14 trends   15 seasonal   16 mo/clusters
        │           │           │            │            │            │
        └───────────┴───────────┴────────────┴────────────┴────────────┘
                                 │
                        17  frontend types
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
        18  forecast screen              19  trends + reports
                └────────────────┬────────────────┘
                                 │
                        20  translation strings
                                 │
                        21  contract test
                                 │
                        22  documentation
                                 │
                        23  manual verification
```

Execution waves. Tasks within a wave have no dependency on each other and may run in parallel.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "note": "test harness, unblocks everything" },
    { "wave": 2, "tasks": ["2", "4", "5", "6", "8"], "note": "independent pure modules plus the migration file" },
    { "wave": 3, "tasks": ["2.1", "3", "4.1", "5.1", "6.1", "7", "9"], "note": "modules depending on grid, plus refresh guard" },
    { "wave": 4, "tasks": ["3.1", "7.1", "10"], "note": "Gi-star and backtest tests, clustering implementation" },
    { "wave": 5, "tasks": ["10.1", "11", "12", "13", "14", "15", "16"], "note": "endpoint wiring, each independent of the others" },
    { "wave": 6, "tasks": ["14.1", "17"], "note": "period key tests, frontend response types" },
    { "wave": 7, "tasks": ["18", "19"], "note": "coordinated frontend edits" },
    { "wave": 8, "tasks": ["20"], "note": "translation strings, after all UI strings exist" },
    { "wave": 9, "tasks": ["21", "22"], "note": "contract test and documentation" },
    { "wave": 10, "tasks": ["23"], "note": "manual verification in EN and KN" }
  ]
}
```

Parallelisable: tasks 2 through 7 are independent of each other once task 1 is done, and each is independent of the database. Task 8 can be written at any time but should be applied before task 16 is exercised against a real database. Tasks 11 through 16 depend only on their own analytics module plus task 2. Tasks 18 and 19 can proceed in parallel after task 17.

Critical path: 1 → 2 → 3 → 11 → 17 → 18 → 20 → 21 → 23.

## Notes

**Deploy order is not task order.** Ship backend first (tasks 1 to 16), then apply migration 009, then warm the clusters, then ship frontend (tasks 17 to 20). Task 16 tolerates a missing table by design, so the backend deploy cannot break the screen.

**Contract rules apply to every endpoint task.** Before marking any of tasks 11 to 16 complete, check the field against the preserved-field table in the design: arrays stay arrays and are empty rather than null; `hit_rate` stays 0 to 1; `risk_score` and `lift_percent` stay 0 to 100; `risk_level` stays within the four allowed strings; `window` stays a string; `case_count` stays an integer; `cells[].lat` and `lng` stay numbers. The frontend performs no runtime validation, so a violation shows up as a blank panel rather than an error.

**Kannada is a separate code path.** `forecast.tsx` lines 349 to 400 and `intelligence.ts` lines 346 to 386 run their own translation pass over `why`, `recommended_action`, `fairness_note`, `explanation` and `window`. Any new user-facing string must reach `ALL_TRANSLATABLE` in task 20, or it renders in English when the UI is set to Kannada.

**Do not touch migration 002.** It opens with `DROP TABLE ... CASCADE` on `cases`, `persons`, `case_persons`, `narratives` and `audit_log`. Adding indexes there would give anyone who re-runs it a wiped database. All new schema goes in 009.

**The indexes already exist.** Earlier analysis suggested the core indexes had been dropped and never restored. Direct inspection of the live database shows `idx_cases_crime_type`, `idx_cases_district`, `idx_cases_report_dt`, `idx_cases_station`, `idx_cases_status`, `idx_cp_case`, `idx_cp_person` and others are all present, built by `load_seed.py` after loading. Task 8 therefore adds only the trigram and geospatial indexes.

**No embeddings exist.** All 71,986 narratives have a null embedding, which is why task 10 defaults to TF-IDF. The embedding branch is written but dormant. If embeddings are generated later, clustering switches feature space automatically with no code change.

**Expect a lower accuracy number.** The corrected backtest will very likely report a smaller figure than the current 41 percent, because the current denominator excludes emerging hotspots. That is the intended outcome. Reporting PAI, PEI, the random baseline and the fold spread together is what makes a modest number defensible.

**Tunables are module constants, not environment variables.** `FOLDS = 4`, `ALPHA = 0.5`, `BUCKETS = 4`, `K_RANGE = range(4, 17)`, `REFRESH_TTL_HOURS = 24`, `SILHOUETTE_SAMPLE = 5000`, `MIN_CONCENTRATION = 0.15`, `FLAGGED_FRACTION = 0.10`, `RANDOM_STATE = 42`. No new configuration and no new secrets.

**Out of scope, tracked separately.** Ring detection, offender risk scoring, socio-economic correlation, the money trail, and the dead narrative-retrieval lane caused by the missing embeddings. The last of these is a critical production bug and has its own spec.
