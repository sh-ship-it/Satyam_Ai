# Design Document

## Overview

This design makes the Early Warning & Forecast and Trends & Patterns screens honest, and replaces two placeholders with genuine statistics, under three hard constraints:

1. **Zero new dependencies.** Everything used here is already pinned and verified importable in the project venv.
2. **Zero new infrastructure.** No cron, no worker process, no separate model service, no GPU requirement at request time.
3. **Never breaks the running app.** Every step degrades to a working screen. Deploying code before its migration, or running with an empty precompute table, must render a correct screen with an honest method label rather than a blank panel.

The two real additions are **Getis-Ord Gi\*** for spatial significance on the forecast grid, and **k-means clustering** over case text for modus-operandi grouping. Both are computed with libraries already present. Everything else in this design is correcting arithmetic and correcting labels.

A deliberate non-goal: no neural or deep forecasting model. At 0.02 degree cells over a 5-year, 36k-case dataset the counts are too sparse for a learned spatio-temporal model to beat a density baseline, and Requirement 4 forces the baseline to be reported. Building one would raise legal exposure while lowering the defensible accuracy figure.

## Verified environment baseline

Measured against the running system, not assumed. These facts drive the design.

| Fact | Value | Consequence for this design |
|---|---|---|
| Postgres | 16.15 on Neon | window functions, `FILTER`, generated columns all available |
| Extensions installed | `vector`, `pg_trgm`, `plpgsql` | trigram indexes need no extension work |
| `VECTOR_TYPE` | `vector` (not `halfvec`) | vector literals cast to `::vector` |
| Cases | 35,993 | fits comfortably in process memory for precompute |
| Cases geocoded | 35,865 (99.6 percent) | grid analytics cover effectively the whole dataset |
| Cases with `incident_time` | 35,993 (100 percent) | hour-of-day statistics are viable everywhere |
| Report date range | 2021-01-01 to 2025-12-31 | 60 months, 5 full years, supports walk-forward folds and year-over-year |
| Narratives | 71,986 | enough text for TF-IDF clustering |
| Narratives with embeddings | **0** | clustering must not require embeddings |
| `sklearn` / `numpy` / `pandas` / `networkx` | 1.5.2 / 1.26.4 / 2.2.3 / 3.4.2, all importable | `MiniBatchKMeans`, `TfidfVectorizer`, `TruncatedSVD`, `silhouette_score` available now |
| Existing indexes on `cases` | crime_type, district, report_date, station, status, legal_code, range | the earlier "indexes were dropped" concern does not apply to this database |
| Existing indexes on `case_persons` | `idx_cp_case`, `idx_cp_person` | person joins are already supported |
| Index on `narratives.embedding` | none | correct today, since there is no data to index |

Two corrections this measurement forced on the plan:

- **The embeddings do not exist.** Clustering therefore defaults to a TF-IDF feature space, with embeddings as an optional upgrade detected at runtime. This is strictly better for deployability: no GPU, no prerequisite batch job.
- **The indexes are present.** `load_seed.py` builds them after loading, so Requirement 11 reduces to adding trigram and geospatial indexes rather than restoring missing ones.

### Out of scope, but must be reported

`narratives.embedding` is null for all 71,986 rows. In `rag.py`, the vector query carries `WHERE n.embedding IS NOT NULL`, which returns zero rows **without raising**, so the `except` lexical fallback is unreachable and `if not rows: return []` fires. The narrative-search lane therefore returns nothing for every query, silently. That is a live defect on a different screen and belongs in its own spec; it is recorded here so it is not lost.

## Design principles for deployability

| Principle | How it is realised |
|---|---|
| Additive migrations only | one new file, `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` only, no `DROP`, no `ALTER` of existing columns. Migration `002` contains `DROP TABLE ... CASCADE` and is never touched. |
| Code deployable before migration | every new-table read is wrapped so a missing relation degrades to the legacy path with an honest `method` label |
| No scheduler | precompute runs opportunistically at request time behind a database-recorded staleness check plus a Postgres advisory lock, following the pattern already proven by `risk_service.recompute_if_stale` but fixing its per-process global |
| Multi-worker safe | staleness state lives in a table, not a module variable; refresh is guarded by `pg_advisory_xact_lock` |
| Bounded request cost | any computation above a fixed budget is served from the precompute table; a cold table serves the fallback rather than blocking the request |
| Reversible | a companion rollback script drops only the objects this feature adds |
| Contract-safe | response changes are additive by default; the small number of breaking changes ship in the same commit as their frontend edit |

## Architecture

Changes are confined to five backend files, one new backend module, one new migration, and five frontend files.

```
backend/
  app/services/
    intelligence_service.py        MODIFIED  forecast/trends/seasonal/mo entry points
    analytics/                     NEW package
      __init__.py
      grid.py                      NEW  single grid definition + cell keying
      spatial.py                   NEW  Getis-Ord Gi* (numpy + math.erfc)
      horizon.py                   NEW  EWMA trailing-rate projection
      backtest.py                  NEW  walk-forward folds, PAI/PEI, baseline
      circular.py                  NEW  circular mean / concentration for hour-of-day
      seasonal.py                  NEW  multiplicative decomposition
      mo_cluster.py                NEW  feature build + MiniBatchKMeans + labelling
      refresh.py                   NEW  DB-backed staleness + advisory-lock guard
  app/schemas/intelligence.py      MODIFIED  additive fields only, except two renames
  app/api/routes/intelligence.py   MODIFIED  horizon enum, new admin refresh route
  app/db/analytics_models.py       NEW  ORM for the three new tables
  migrations/
    009_analytics_model_integrity.sql        NEW  additive
    009_rollback.sql                        NEW  drops only new objects

frontend/src/
  lib/api/intelligence.ts          MODIFIED  additive types + two field updates
  routes/forecast.tsx              MODIFIED  labels, PAI vs hit rate, alert kind badge
  routes/trends.tsx                MODIFIED  delta label, totals KPI, cluster quality
  components/ModelInferenceTheater.tsx  MODIFIED  rename, honest stages, hit-rate metric
  routes/reports.tsx               MODIFIED  one delta label
  lib/i18n.tsx                     MODIFIED  affected EN keys and KN values
```

No existing module is deleted. `intelligence_service.py` keeps its current function signatures and delegates the maths to the new package, so the route layer is untouched except for the horizon enum and one new admin route.

## Component 1: One grid definition

**Problem.** Four grid resolutions coexist: 0.001 in `analytics.hotspots`, 0.02 default in `get_forecast_hotspots`, 0.02 hardcoded in the backtest, 0.01 in `risk_service`. Two use `round`, one uses `floor`. The backtest therefore does not evaluate the grid the screen serves.

**Design.** `analytics/grid.py` owns the only definition.

- `SUPPORTED_GRID = (0.01, 0.02, 0.05)` matching the Fine / Med / Coarse controls the UI already sends.
- `DEFAULT_GRID = 0.02`, unchanged, so the current screen renders identically at its default.
- One keying function, `floor`-based for both axes, returning a stable integer pair plus the cell centre. `floor` is chosen over `round` because it partitions the plane without overlap and makes neighbour arithmetic a simple integer offset, which Gi\* needs.
- `cell_id` becomes `f"{ix}_{iy}"` from the integer indices rather than the row ordinal. This is deterministic across requests and across grid sizes, so the frontend expand-state keyed on `cell_id` stays stable between refreshes instead of jumping when ordering changes.
- The backtest imports the same function and is passed the same `grid_size` the request used.

`analytics.hotspots` (the console heat map) is left on its own 3-decimal rounding for now; it is a different screen and out of scope. The duplication is recorded in the module docstring.

## Component 2: Getis-Ord Gi\* spatial significance

**Problem.** `risk_score` is `min(99, 20 + log1p(total)*10 + lift*0.3)`. The coefficients 20, 10 and 0.3 are invented, and nothing distinguishes a genuine cluster from Poisson noise. A cell with one incident still scores 20.

**Design.** `analytics/spatial.py` computes the Gi\* statistic per occupied cell.

For cell `i` with neighbourhood `W_i` (the 3x3 queen contiguity block including `i` itself):

```
numerator   = sum(x_j for j in W_i) - mean_x * |W_i|
denominator = S * sqrt( (n * |W_i| - |W_i|^2) / (n - 1) )
z_i         = numerator / denominator
```

where `n` is the count of occupied cells, `mean_x` the mean cell count, and `S = sqrt(sum(x^2)/n - mean_x^2)`.

The one-sided p-value uses the normal survival function via `math.erfc`, so **no scipy is required**:

```
p_i = 0.5 * erfc(z_i / sqrt(2))
```

Implementation notes that make this safe:

- Input is the occupied-cell aggregate already produced by the existing SQL, fetched as `(ix, iy, count)`. Typical occupied-cell count for Karnataka at 0.02 degrees is in the low thousands, so a dict lookup over 8 neighbours per cell is trivial. numpy is used for the vectorised mean and standard deviation only.
- `n < 3` or `S == 0` returns no significance rather than dividing by zero, and the endpoint falls back to reporting density only, with `method` set accordingly.
- Cells are not padded. A cell at the study-area edge simply has fewer neighbours, which the `|W_i|` term already accounts for.

**Risk level now derives from significance, not from an invented curve:**

| Condition | `risk_level` |
|---|---|
| `p < 0.01` and `z > 0` | Critical |
| `p < 0.05` and `z > 0` | High |
| `p < 0.10` and `z > 0` | Medium |
| otherwise | Low |

This keeps the exact four strings the frontend styles and filters on, satisfying Requirement 10.4 with no frontend change, while making all four reachable and giving Low a real meaning (not significant). `risk_score` is retained on its 0-100 scale for the existing bar, computed as a monotone mapping of the z-score so ordering is preserved.

New additive response fields on `ForecastCell`: `z_score`, `p_value`, `expected_count`, `observed_count`, `neighbour_count`, `method`.

## Component 3: Functional horizon

**Problem.** `horizon_days` is validated `1..30`, echoed in the response, and referenced nowhere else. Two requests differing only in horizon return byte-identical payloads. This was confirmed empirically against the running backend: 3-day and 30-day responses compared equal.

**Design.** `analytics/horizon.py` turns the horizon into an expected-count projection.

For each cell, bucket the trailing period into `N = 4` consecutive windows of `horizon_days` each, ending at the data reference date. Compute the per-day rate in each bucket, then take an exponentially weighted mean with `alpha = 0.5` weighted toward the most recent bucket:

```
rate_ewma      = sum(alpha * (1-alpha)^k * rate_k for k in 0..N-1) / sum of weights
expected_count = rate_ewma * horizon_days
```

Because the bucket boundaries are a function of `horizon_days`, the buckets themselves differ per horizon, so the projection differs. `expected_count` becomes the `x` fed to Gi\*, replacing the raw total. A 3-day horizon therefore weights the last 12 days; a 30-day horizon weights the last 120.

The route enum tightens to the four values the UI actually offers, so an unsupported horizon is a validation error rather than a silent default:

```
horizon_days: Literal[3, 7, 14, 30] = 7
```

`as_of_date` remains `MAX(report_date)` and does not move with the horizon.

## Component 4: Equal comparison windows

**Problem.** The recent window is 30 days; the baseline is `BETWEEN as_of-90 AND as_of-30`, a 60-day window. The user-facing text in both the `why` strings and the screen header says "prior 30-day". At a flat rate this biases every lift to roughly minus 50 percent. Separately, the zero-baseline case is hardcoded to `50` in hotspots and `100` in alerts, two answers for one condition.

**Design.**

- Both windows become rate-per-day before the ratio, so duration mismatch cannot bias the result even if the windows are later changed:
  `lift = (recent_per_day - baseline_per_day) / baseline_per_day`
- The default baseline becomes the immediately preceding equal-length window, and the window lengths are emitted in the response as `recent_window_days` and `baseline_window_days` so the UI text is generated from data instead of hardcoded.
- Zero baseline returns `lift_pct = None` with `lift_state = "emerging"`. One helper in `analytics/horizon.py` is the single implementation used by both hotspots and alerts, so the two endpoints cannot diverge again.
- `why` strings are built from the emitted window lengths.
- If the final period is shorter than a full window relative to the reference date, `partial_period = true` is set so a truncated period is not read as a decline.

## Component 5: Statistically valid backtest

**Problem, all four confirmed in source.** `metric="PAI"` labels a hit rate. The denominator is filtered to `train_cnt > 0`, deleting emerging hotspots from the evaluation. Train `BETWEEN as_of-60 AND as_of-30` and test `>= as_of-30` share the boundary day. One fixed split, no baseline, no variability.

**Design.** `analytics/backtest.py` performs a rolling-origin walk-forward evaluation.

For `k` in `1..FOLDS` with `FOLDS = 4`:

```
origin  = as_of - k * 30 days
train   = [origin - 60 days, origin)          exclusive upper bound
test    = [origin, origin + 30 days)          exclusive upper bound
```

Half-open intervals make train and test disjoint by construction, closing the boundary-day leak.

Per fold:

- Rank all cells by train count. Flag the top decile by **cell count**, so the flagged-area fraction is exactly known.
- `hit_rate = test incidents inside flagged cells / all test incidents in the study area`. The denominator is every cell with a test incident, **including cells whose train count is zero**, which is the fix for the tautology.
- `area_fraction = flagged cells / all cells in the study area`.
- `pai = hit_rate / area_fraction`.
- `pei = pai / pai_max`, where `pai_max` is the PAI achievable by an oracle that flags the same number of cells chosen by actual test counts. This bounds the score in `[0, 1]` and is the standard efficiency measure.
- Baseline: flag a random decile of cells with `random_state=42`. Its expected PAI is 1.0; the observed value is reported so the reader can see the null.

Reported across folds: mean, standard deviation, per-fold values, `folds`, `n_test_incidents`, `area_fraction`, `baseline_pai`, and the `grid_size` used, which is the same one the screen requested.

**Contract handling.** `hit_rate_top_10_percent_cells` keeps its name and its 0-to-1 scale, because the frontend multiplies it by 100 in three places. `metric` changes from `"PAI"` to `"Hit rate"`, and a genuine `pai` field is added alongside. `window` remains a non-null string, since `forecast.tsx` calls `.replace()` on it.

## Component 6: Alert integrity

**Problems.** `avg_hour or 18.0` invents an 18:00 to 20:00 patrol window from no data. `AVG(hour)` is an arithmetic mean on a circular variable, so 23:00 and 01:00 average to midday. Fallback volume alerts are indistinguishable from spike alerts. The docstring claims a `baseline * 1.2` threshold that is absent from the query. The 30-point score floor makes the UI Low filter unreachable.

**Design.**

- `analytics/circular.py` computes the circular mean with `atan2(mean(sin), mean(cos))` over `theta = hour * 2 * pi / 24`, plus the resultant length `R` as a concentration measure. Both are `math` only.
- If `R < 0.15` the hours are effectively uniform, so no peak exists and `patrol_window` is emitted as an empty string with `patrol_window_basis = "insufficient_time_concentration"`. The frontend hides the row when the string is empty. No default hour is ever invented.
- 100 percent of cases have `incident_time`, so this path will rarely fire on the current dataset, but it is required so the field can never be fabricated.
- `alert_kind` is added as `"spike"` or `"persistent_volume"`, and the fallback branch sets the latter. `forecast.tsx` renders a distinguishing badge.
- The documented `1.2` threshold is implemented in the query, and the docstring is rewritten to match what runs.
- The score floor is removed. Risk level derives from the same significance bands as Component 2, so Low is reachable and the filter pill works.
- `total_matching` is added so the fixed `LIMIT 8` is visible as a truncation.

## Component 7: Genuine MO clustering

**Problem.** `GROUP BY crime_type, sections ORDER BY n DESC LIMIT 10` is a frequency table. There is no feature space, no distance metric, `k` is the row limit, and `sections_arr` (which would make section order irrelevant) exists but is unused.

**Design.** `analytics/mo_cluster.py`, precomputed into tables, with a three-tier feature space chosen at runtime by what the database actually contains.

**Feature construction, in priority order:**

1. **Embeddings**, if `narratives.embedding` is non-null for a usable share of cases. Mean-pool per case, L2 normalise. Currently unavailable (zero rows), so this branch is dormant but coded, and becomes active the moment `seed.embed_narratives` is run.
2. **TF-IDF over narrative text**, the default today. `TfidfVectorizer(max_features=2000, stop_words="english", min_df=5)` then `TruncatedSVD(n_components=128, random_state=42)` for a dense LSA representation. Pure sklearn, CPU, no GPU.
3. **Structured features**, always appended and scaled: multi-hot over the top 50 sections taken from `sections_arr` (which is order-independent, fixing the `302|34` versus `34|302` split), one-hot crime type, and `sin`/`cos` of the circular hour.

**Algorithm.** `MiniBatchKMeans(random_state=42, n_init=3, batch_size=1024)`. Deterministic given identical input, which satisfies the stability requirement. At 36k rows by 128 dimensions this is seconds on CPU.

**Choosing k.** Candidate `k` in `range(4, 17)`. For each, fit and score `silhouette_score` on a fixed 5,000-row subsample with `random_state=42`. Select the highest silhouette. Both the chosen `k` and its silhouette are stored and returned, so a partition with no structure is visible as such rather than hidden.

**Labelling.** Each cluster label is derived from its own contents: the top three TF-IDF terms of the centroid, plus the dominant crime type and the most frequent section set. No label is hardcoded.

**Precompute and serving.** Two new tables hold the result, and `get_mo_clusters` reads them. `refresh.py` recomputes when the stored `last_run_at` is older than 24 hours, guarded by `pg_advisory_xact_lock` so concurrent workers cannot both rebuild. Staleness lives in a table, not in a module global, which is the specific flaw in the existing `risk_service` debounce.

**Three-level graceful degradation, which is what makes this deployable:**

| Situation | Behaviour | `method` value |
|---|---|---|
| Tables exist and are fresh | serve precomputed clusters | `kmeans_tfidf_svd` or `kmeans_embeddings` |
| Tables exist but empty, refresh in progress or over budget | serve the legacy frequency table | `frequency_fallback` |
| Tables do not exist, that is, code deployed before migration | catch the undefined-table error, serve the legacy frequency table | `frequency_fallback` |

Because the fallback reports `method: "frequency_fallback"` and the UI renders that method, the screen is honest in every state. This directly satisfies Requirement 6.8 and Requirement 1.1: the product never shows a clustering label over a frequency table without saying so.

## Component 8: Trend period arithmetic

**Problems.** `to_char(date_trunc(g, report_date), 'YYYY-MM')` collapses 4 to 5 distinct weeks into one key when `g` is `week`, and `per_period` then sums them, so weekly granularity silently returns months. `qoq_percent` holds a period-over-period delta at whatever granularity was requested, and the screen labels it QoQ while the control reads Month. `yoy` indexes `ordered[-13]`, correct only for months. `prev = ordered[-2][1] or 1` turns an undefined percentage into a finite one.

**Design.**

- Period key format per granularity, all lexically sortable so the existing `localeCompare` ordering stays correct:

| Granularity | Format | Example |
|---|---|---|
| week | `IYYY-"W"IW` | `2025-W37` |
| month | `YYYY-MM` | `2025-09` |
| quarter | `YYYY-"Q"Q` | `2025-Q3` |

- Year-over-year is computed by deriving the key for the same period one calendar year earlier and looking it up, rather than by a fixed negative offset. It returns `None` when that key is absent, which makes it correct at all three granularities.
- `prev == 0` returns `None` rather than substituting 1.
- `qoq_percent` **keeps its field name** for contract safety, and a new additive `delta_granularity` field carries `"week" | "month" | "quarter"`. The three frontend labels are driven from it, so the screen reads "Month over month" when Month is selected.

**Unbounded payload.** `get_trends` currently has no `LIMIT` and returns every period-by-crime-type-by-district row; the screenshot total of 35,993 is exactly the table row count. Simply adding a `LIMIT` would silently change the KPIs, which are summed client-side. Instead:

- `series` is bounded to the top `N = 2000` combinations by count.
- A new additive `totals` object carries `total_incidents`, `distinct_crime_types`, `distinct_districts`, `period_count` and `returned_rows`, all computed server-side over the unbounded set.
- `trends.tsx` reads the KPIs from `totals` instead of summing `series`. This ships in the same commit, and the KPI values are unchanged because the server computes what the client used to.

## Component 9: Seasonal decomposition

**Problems.** `EXTRACT(MONTH FROM report_date)` pools all five years with no detrending, so year-on-year growth reads as seasonality. `WHERE m.cnt > a.avg_cnt ... LIMIT 3` returns only above-average months, so troughs are unreportable and the full shape cannot be judged. No observation count, no significance, and `recommended_action` is attached to any peak however small.

**Design.** `analytics/seasonal.py` performs a classical multiplicative decomposition without adding statsmodels.

1. Aggregate counts per `(year, month)`.
2. Drop any year whose data is incomplete at the series end, satisfying Requirement 8.5.
3. For each year, divide each month by that year mean, giving a ratio series per year. This removes the level difference between years, which is the detrending step.
4. Average the ratios per calendar month across years to get the seasonal index, and take the standard deviation across years as the variability.
5. `lift_percent = (index - 1) * 100`, rounded to one decimal so the raw-float display bug disappears.
6. `significant = abs(index - 1) > std_across_years`, a one standard deviation screen. `recommended_action` is emitted only when `significant` is true.

**Contract handling.** `seasonal_peaks` keeps its name and continues to carry only above-baseline months, so the current cards render unchanged. A new additive `profile` array carries all twelve months with `index`, `lift_percent`, `n_years`, `std`, and `significant`, giving the full shape including troughs. The frontend adopts `profile` in the same change to render a twelve-month strip, and `period` remains a unique non-null string because it is used as a React key.

## Data Models

One additive migration, `009_analytics_model_integrity.sql`. No `DROP`, no `ALTER` of existing objects, every statement idempotent.

```sql
-- 1. Refresh bookkeeping. Replaces the per-process global in risk_service.
CREATE TABLE IF NOT EXISTS analytics_refresh (
    job_name     TEXT PRIMARY KEY,
    last_run_at  TIMESTAMPTZ,
    params_hash  TEXT,
    row_count    INTEGER,
    status       TEXT,
    detail       TEXT
);

-- 2. MO cluster header
CREATE TABLE IF NOT EXISTS mo_cluster (
    cluster_id       TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    case_count       INTEGER NOT NULL,
    top_sections     TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
    top_crime_types  TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
    top_terms        TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
    representative_case_id INTEGER,
    silhouette       DOUBLE PRECISION,
    method           TEXT NOT NULL,
    k                INTEGER,
    built_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Membership, so a case can be traced to its cluster
CREATE TABLE IF NOT EXISTS mo_cluster_member (
    cluster_id  TEXT NOT NULL REFERENCES mo_cluster(cluster_id) ON DELETE CASCADE,
    case_id     INTEGER NOT NULL,
    distance    DOUBLE PRECISION,
    PRIMARY KEY (cluster_id, case_id)
);
CREATE INDEX IF NOT EXISTS idx_mo_member_case ON mo_cluster_member (case_id);

-- 4. Indexes for Requirement 11. pg_trgm is already installed.
CREATE INDEX IF NOT EXISTS idx_cases_geo
    ON cases (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_crime_trgm
    ON cases USING gin (crime_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cases_district_trgm
    ON cases USING gin (district gin_trgm_ops);

-- 5. Least-privilege grants, matching the pattern in 002
GRANT SELECT ON mo_cluster, mo_cluster_member, analytics_refresh TO satyam_app;
GRANT INSERT, UPDATE, DELETE ON mo_cluster, mo_cluster_member, analytics_refresh TO satyam_app;
```

The HNSW index on `narratives.embedding` is deliberately **not** created here. With zero embeddings it would index nothing, and it belongs with the separate work that generates them.

`009_rollback.sql` drops only `mo_cluster_member`, `mo_cluster`, `analytics_refresh` and the three new indexes.

## Response contract changes

Classified against the three rules derived from reading every frontend call site.

### Additive only, no frontend change required

| Endpoint | New fields |
|---|---|
| forecast/hotspots | `z_score`, `p_value`, `expected_count`, `observed_count`, `neighbour_count`, `method`, `recent_window_days`, `baseline_window_days`, `partial_period`, `total_matching` |
| forecast/alerts | `alert_kind`, `patrol_window_basis`, `lift_state`, `recent_window_days`, `baseline_window_days`, `total_matching` |
| forecast/backtest | `pai`, `pei`, `baseline_pai`, `folds`, `pai_std`, `per_fold`, `n_test_incidents`, `area_fraction`, `grid_size` |
| trends | `delta_granularity`, `totals` |
| trends/seasonal | `profile`, and per-peak `n_years`, `std`, `significant` |
| mo/clusters | `method`, `silhouette`, `k`, `top_terms`, `built_at`, `quality_note` |

### Changed values, same type, requiring a coordinated frontend edit

| Field | From | To | Frontend sites |
|---|---|---|---|
| `BacktestResponse.metric` | `"PAI"` | `"Hit rate"` | `forecast.tsx:869` renders it verbatim; `forecast.tsx:514` and `ModelInferenceTheater.tsx:103,151` hardcode the string "PAI" and must switch to the new `pai` field |
| `ForecastCell.cell_id` | row ordinal `grid_0` | grid index `ix_iy` | React key and expand identity only, so behaviour improves rather than breaks |
| `ForecastAlert.patrol_window` | always populated | empty string when unsupported | `forecast.tsx:151` must hide the row on empty |

### Explicitly preserved, because the frontend would crash or mis-render

| Field | Constraint | Reason |
|---|---|---|
| `hit_rate_top_10_percent_cells` | stays 0 to 1 | multiplied by 100 in three places |
| `risk_score`, `lift_percent` | stay 0 to 100 | bar widths and threshold comparisons |
| `risk_level` | stays Critical / High / Medium / Low | object keys in `RISK_BG`, `RISK_ORDER`, `RISK_DOT`, and `===` filters |
| `window` | stays a non-null string | `.replace()` is called on it |
| `case_count` | stays an integer | `.toLocaleString()` is called on it |
| `cells[].lat`, `lng` | stay numbers | `.toFixed()` is called on them |
| every array field | array, empty not null | unguarded `.map` / `.slice` / `.length` |
| `qoq_percent`, `seasonal_peaks` | names retained | five and two consuming sites respectively |

## Frontend changes

Exact sites, so nothing is discovered late.

| File | Change |
|---|---|
| `components/ModelInferenceTheater.tsx` | rename `t("Neural forecast engine")` to a live-query label; relabel the four `stages` to the query steps actually performed, or drop the pipeline strip; change the `PAI` metric to `Hit rate` and add a separate real `PAI` metric from the new field |
| `routes/forecast.tsx:514` | header pill `PAI {..}%` becomes `Hit rate {..}%`, with a second pill for real PAI |
| `routes/forecast.tsx:623-628` | window description generated from `recent_window_days` and `baseline_window_days` instead of the hardcoded "prior 30-day baseline" |
| `routes/forecast.tsx:151` | hide the patrol row when `patrol_window` is empty |
| `routes/forecast.tsx` alert card | render the `alert_kind` badge so a persistent-volume alert is visually distinct |
| `routes/forecast.tsx` backtest card | show `folds`, `pai_std` and `baseline_pai` next to the headline number |
| `routes/trends.tsx:979,1032` | `QoQ Trend` and `QoQ Change` labels driven by `delta_granularity` |
| `routes/reports.tsx:878` | `Quarter-on-quarter` label driven by `delta_granularity` |
| `routes/trends.tsx` KPI block | read `totals` instead of summing `series` |
| `routes/trends.tsx` clusters panel | show `method`, `k` and `silhouette`; when `method` is `frequency_fallback`, show that instead of the clustering heading |
| `routes/trends.tsx` seasonal tab | render the twelve-month `profile` strip and suppress `recommended_action` when `significant` is false |
| `lib/api/intelligence.ts` | add the new response types; new fields declared optional so a backend without them still type-checks |
| `lib/i18n.tsx` | add or replace affected EN keys and their KN values, including `Neural forecast engine`, `Cells scored`, `PAI`, `Risk model` |

Kannada is a first-class path here. `forecast.tsx:349-400` and `intelligence.ts:346-386` run a separate translation pass over `why`, `recommended_action`, `fairness_note`, `explanation` and `window`. Any new user-facing string must be added to `ALL_TRANSLATABLE`, or it silently renders in English on the KN path.

## Deployment

Designed so each step is independently safe and independently reversible.

**Step order.**

1. **Deploy backend code first, before the migration.** All new-table reads are wrapped, so `mo/clusters` serves `frequency_fallback` and every other endpoint is unaffected. Nothing breaks.
2. **Run the migration.** `psql "$DATABASE_URL" -f backend/migrations/009_analytics_model_integrity.sql`. Every statement is `IF NOT EXISTS`, so re-running is safe. No table is dropped, no column altered, no data touched.
3. **Warm the clusters.** Either hit the new admin refresh route once, or let the first request to `mo/clusters` trigger the opportunistic refresh. Until it completes, the fallback continues to serve.
4. **Deploy frontend.** The coordinated label edits land. Because the backend already emits both the new and preserved fields, backend and frontend are compatible in either order for everything except the three coordinated value changes, which is why the frontend goes last.

**Docker path** is unchanged. Note that `docker-compose.yml:12` mounts only `002_schema_v2.sql` into `initdb.d`, so migration 009 must be applied manually there as well; this is an existing repo-wide condition, not something this feature introduces.

**Rollback.** Revert the frontend, revert the backend, and optionally run `009_rollback.sql`. Leaving the new tables in place is harmless because nothing else references them.

**No new environment variables and no new secrets.** Tunables live as module constants with documented defaults: `FOLDS = 4`, `ALPHA = 0.5`, `SIGNIFICANCE_BANDS = (0.01, 0.05, 0.10)`, `K_RANGE = range(4, 17)`, `REFRESH_TTL_HOURS = 24`, `SILHOUETTE_SAMPLE = 5000`.

## Testing strategy

Requirement 12 asks for checks that fail if a defect returns. Every one of these is a pure function over fixtures, so they run in CI with **no database**.

| Test | Asserts |
|---|---|
| `test_grid.py` | one cell keying function; `floor` partitions without overlap; same `cell_id` for the same coordinates across grid sizes |
| `test_spatial_gi.py` | on a synthetic 5x5 grid with one planted cluster, the planted cell has the highest z and `p < 0.05`; a uniform grid produces no significant cell; `n < 3` and zero-variance inputs return no significance rather than raising |
| `test_horizon.py` | **two horizons over the same fixture produce different `expected_count`** — the direct regression test for the defect confirmed empirically |
| `test_backtest.py` | `pai == hit_rate / area_fraction`; a cell with zero train count and positive test count **is** in the denominator; train and test intervals are disjoint; `folds == 4`; baseline PAI is near 1.0 on random data |
| `test_circular.py` | circular mean of 23 and 1 is 0, not 12; low concentration returns no peak |
| `test_windows.py` | equal-duration windows; zero baseline returns `None` and `emerging`; hotspots and alerts return the same value for the same input |
| `test_period_keys.py` | week keys are unique per ISO week; lexical sort equals chronological sort at all three granularities; zero previous period returns `None`; year-over-year resolves at week, month and quarter |
| `test_seasonal.py` | a synthetic series with pure year-on-year growth and no seasonality produces no significant month; a planted December spike is detected; a partial final year is excluded |
| `test_mo_cluster.py` | identical input yields identical assignment with the fixed seed; `302\|34` and `34\|302` land in the same cluster; silhouette is returned; k is chosen from the candidate range and not fixed at 10 |
| `test_contract.py` | for every response model, array fields default to `[]` and never `None`; `hit_rate` stays within 0 to 1; `risk_score` and `lift_percent` within 0 to 100; `risk_level` within the four allowed strings; `window` and `case_count` retain their types |

Plus one manual matrix, since the Kannada path is separate code:

1. `/forecast` in EN, then in KN, at each of the four horizons, confirming the cells change.
2. `/trends` in EN, then in KN, across all four tabs and all three granularities.
3. Both screens with the `mo_cluster` table empty, confirming the fallback renders and is labelled `frequency_fallback`.
4. Both screens before the migration is applied, confirming nothing blanks.

A `pyproject.toml` with `[tool.pytest.ini_options] asyncio_mode = "auto"` is added in the first commit, because `pytest-asyncio` is currently installed but unconfigured, so any async test silently skips today. Existing `test_health.py` requires a live seeded database and is marked so CI can exclude it.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Honest backtest reports a lower number than the current 41 percent | High, close to certain | This is the intended outcome. The design reports PAI, PEI, the random baseline and the fold spread together, so a modest PAI above 1.0 reads as a real, defensible result rather than a weak one. |
| Gi\* finds few significant cells on synthetic data | Medium | Synthetic data may be closer to uniform than real crime. The response still carries density and `expected_count`, so the screen remains informative, and `method` states what was computed. Verified during implementation against the real 35,865 geocoded cases. |
| TF-IDF clusters are weak because narratives are templated synthetic text | Medium | Silhouette is reported, so weakness is visible rather than hidden. Structured features are always appended, which gives real signal even if the text is repetitive. If silhouette is poor, `quality_note` says so and the honest option is to keep the fallback label. |
| Clustering exceeds the request budget | Low | Precomputed with a 24-hour TTL, an advisory lock, and a fallback while cold. Never computed inline on the request path. |
| A response change blanks a screen | Low | Requirement 10 rules enumerated per field above; `test_contract.py` enforces them; the three coordinated changes ship with their frontend edits. |
| Kannada path shows untranslated new strings | Medium | Every new user-facing string added to `ALL_TRANSLATABLE` with a KN value in the same commit, and both screens verified in KN. |
| Concurrent workers duplicate the refresh | Low | `pg_advisory_xact_lock` plus table-backed staleness, which also fixes the existing per-process global in `risk_service`. |
| Migration applied to a database where `pg_trgm` is absent | Low | Verified installed on the current instance. The three trigram indexes are the only statements that depend on it, and they are separable if a target lacks the extension. |

## Components and Interfaces

Every new module is a pure-function unit with no database access, except `refresh.py` and the service entry points. This is what makes the whole test suite runnable without a database.

### `analytics/grid.py`

```python
SUPPORTED_GRID: tuple[float, ...] = (0.01, 0.02, 0.05)
DEFAULT_GRID: float = 0.02

def cell_index(lat: float, lng: float, grid: float) -> tuple[int, int]
def cell_centre(ix: int, iy: int, grid: float) -> tuple[float, float]
def cell_id(ix: int, iy: int) -> str          # "ix_iy", stable across requests
def neighbours(ix: int, iy: int) -> list[tuple[int, int]]   # 8 queen neighbours
```

### `analytics/spatial.py`

```python
@dataclass(frozen=True)
class GiResult:
    ix: int; iy: int
    z_score: float
    p_value: float
    observed: float
    neighbour_count: int

def getis_ord_gi_star(cells: Mapping[tuple[int, int], float]) -> list[GiResult]
def significance_band(z: float, p: float) -> str   # Critical|High|Medium|Low
def z_to_score(z: float) -> int                    # monotone map onto 0..100
```

Returns an empty list when fewer than three cells are occupied or the standard deviation is zero. Never raises on degenerate input.

### `analytics/horizon.py`

```python
ALPHA: float = 0.5
BUCKETS: int = 4

def ewma_daily_rate(bucket_counts: Sequence[int], horizon_days: int) -> float
def expected_count(bucket_counts: Sequence[int], horizon_days: int) -> float
def lift(recent: int, recent_days: int, baseline: int, baseline_days: int)
        -> tuple[float | None, str]      # (lift_pct, state) state in computed|emerging|flat
```

`lift` is the single implementation shared by the hotspots and alerts endpoints, so the two cannot diverge on the zero-baseline case again.

### `analytics/backtest.py`

```python
FOLDS: int = 4
FLAGGED_FRACTION: float = 0.10

@dataclass(frozen=True)
class FoldResult:
    hit_rate: float; area_fraction: float; pai: float; pei: float
    n_test: int; n_flagged_cells: int; n_cells: int

def evaluate_fold(train: Mapping[Cell, int], test: Mapping[Cell, int]) -> FoldResult
def random_baseline(test: Mapping[Cell, int], n_cells: int, seed: int = 42) -> float
def aggregate(folds: Sequence[FoldResult]) -> BacktestSummary
```

`evaluate_fold` takes the union of train and test cell keys as its universe, which is the mechanism that keeps zero-train cells in the denominator.

### `analytics/circular.py`

```python
MIN_CONCENTRATION: float = 0.15

def circular_mean_hour(hours: Sequence[int]) -> tuple[float | None, float]
        # (mean_hour, resultant_length R); mean_hour is None when R < MIN_CONCENTRATION
def patrol_window(mean_hour: float | None, span_hours: int = 2) -> tuple[str, str]
        # ("", "insufficient_time_concentration") when mean_hour is None
```

### `analytics/seasonal.py`

```python
def decompose(counts_by_year_month: Mapping[tuple[int, int], int])
        -> list[SeasonalIndex]     # 12 entries: month, index, lift_percent, n_years, std, significant
def drop_incomplete_years(counts, reference_date) -> Mapping
```

### `analytics/mo_cluster.py`

```python
K_RANGE = range(4, 17)
SILHOUETTE_SAMPLE = 5000
RANDOM_STATE = 42

def build_features(cases: Sequence[CaseRow], embeddings: Mapping[int, list[float]] | None)
        -> tuple[np.ndarray, list[int], FeatureMeta]   # (X, case_ids, meta.method)
def choose_k(X: np.ndarray) -> tuple[int, float]        # (k, silhouette)
def fit(X, k) -> tuple[np.ndarray, np.ndarray]          # (labels, centroids)
def label_clusters(labels, centroids, cases, meta) -> list[ClusterDescriptor]
```

`build_features` selects the method by inspecting what it was given: embeddings when supplied, otherwise TF-IDF plus SVD, with structured features appended in both cases. The caller does not choose.

### `analytics/refresh.py`

```python
REFRESH_TTL_HOURS: int = 24
LOCK_KEY_MO_CLUSTER: int = 728_311_043     # distinct from the audit chain key

async def is_stale(session, job_name: str, ttl_hours: int = REFRESH_TTL_HOURS) -> bool
async def with_refresh_lock(session, lock_key: int) -> AsyncContextManager[bool]
async def mark_complete(session, job_name: str, row_count: int, params_hash: str) -> None
```

`with_refresh_lock` yields `False` when another worker holds the lock, so the caller serves the fallback instead of waiting. Staleness is read from `analytics_refresh`, not from a module-level variable.

### Service entry points, signatures unchanged

`intelligence_service.get_forecast_hotspots`, `get_forecast_alerts`, `get_forecast_backtest`, `get_trends`, `get_seasonal` and `get_mo_clusters` keep their current parameter lists and return the same Pydantic models with additive fields. The route layer changes only for the horizon enum and one new admin refresh route, so no other caller is affected.

## Correctness Properties

Invariants that must hold for any input. Each is asserted directly by a named test in the suite.

### Property 1: Horizon sensitivity
For any fixture containing temporal variation, `expected_count` at `horizon_days=3` differs from the value at `horizon_days=30`. Direct regression guard for the defect confirmed empirically against the running backend.
**Validates: Requirements 2.1, 2.2**

### Property 2: PAI identity
For every fold, `pai == hit_rate / area_fraction` within floating-point tolerance. PAI can never again be reported as a bare hit rate.
**Validates: Requirements 4.1, 4.2**

### Property 3: Denominator completeness
Every grid cell with a positive test-period count appears in the fold universe, including cells whose train-period count is zero.
**Validates: Requirements 4.3**

### Property 4: Fold disjointness
For every fold, the train interval and the test interval share no instant. Half-open intervals make this structural rather than incidental.
**Validates: Requirements 4.4**

### Property 5: Baseline sanity
On uniformly random cell counts, `baseline_pai` falls within 0.8 to 1.2, confirming the random-decile baseline behaves as the null it represents.
**Validates: Requirements 4.5**

### Property 6: Gi-star degeneracy safety
With fewer than three occupied cells, or zero variance across cells, `getis_ord_gi_star` returns an empty result and does not raise, and the response reports `density_only`.
**Validates: Requirements 9.3, 9.6**

### Property 7: Gi-star detection
A planted cluster on an otherwise uniform grid produces the maximum z-score at the planted cell with `p < 0.05`.
**Validates: Requirements 1.1, 9.3**

### Property 8: Circular correctness
`circular_mean_hour([23, 1])` returns 0, not 12. An arithmetic mean over hour-of-day cannot reappear.
**Validates: Requirements 5.2**

### Property 9: Window symmetry
The recent and baseline windows are of equal length, or the comparison is normalised to a per-day rate before the ratio is taken, and the emitted window lengths match the text that describes them.
**Validates: Requirements 3.1, 3.2**

### Property 10: Zero-baseline consistency
For identical counts, the hotspots and alerts endpoints return the identical `(lift_pct, state)` pair. The 50-versus-100 divergence cannot recur.
**Validates: Requirements 3.3, 3.4**

### Property 11: Period key uniqueness
At any supported granularity, one period key maps to exactly one calendar period. Distinct ISO weeks never share a key.
**Validates: Requirements 7.1, 7.2**

### Property 12: Sort equivalence
Lexical ordering of period keys equals chronological ordering at week, month and quarter granularity, so the existing client-side `localeCompare` remains correct.
**Validates: Requirements 7.6**

### Property 13: Undefined delta
A previous-period count of zero yields `None`, never a percentage computed against a substituted denominator.
**Validates: Requirements 7.5**

### Property 14: Seasonal detrending
A synthetic series with pure year-on-year growth and no seasonal component yields no month flagged significant.
**Validates: Requirements 8.1, 8.4**

### Property 15: Cluster determinism
Identical input yields an identical label assignment under the fixed random seed.
**Validates: Requirements 6.7**

### Property 16: Section order invariance
Two cases differing only in the ordering of their legal sections receive the same cluster assignment.
**Validates: Requirements 6.5**

### Property 17: Array non-nullity
Every array-typed response field is a list, empty rather than null, across all endpoints and all error paths.
**Validates: Requirements 10.1**

### Property 18: Scale preservation
`hit_rate_top_10_percent_cells` stays within 0 to 1. `risk_score`, `severity_score`, `lift_percent` and `similarity_percent` stay within 0 to 100.
**Validates: Requirements 10.3**

### Property 19: Enum closure
`risk_level` and `risk_label` are always one of Critical, High, Medium or Low, so the frontend style maps and equality filters always resolve, and every filter pill is reachable.
**Validates: Requirements 5.5, 10.4**

### Property 20: Method honesty
Whenever a frequency table is served in place of clustering, `method` equals `frequency_fallback`, and the UI renders that method rather than a clustering heading.
**Validates: Requirements 1.1, 6.8**
## Error Handling

The governing rule: a screen must always render, and must always state which method produced what it shows. Failures degrade the method, never the availability.

| Condition | Handling | User-visible result |
|---|---|---|
| `mo_cluster` table absent, code deployed before migration | catch `ProgrammingError` / undefined table, fall through to the legacy frequency query | clusters render, labelled `frequency_fallback` |
| `mo_cluster` table present but empty | serve the legacy frequency query, attempt an opportunistic refresh | clusters render, labelled `frequency_fallback` |
| Refresh lock held by another worker | `with_refresh_lock` yields `False`, no waiting | fallback this request, precomputed on the next |
| Clustering raises during refresh | mark `analytics_refresh.status = 'failed'` with the detail, leave the previous result intact | last good clusters continue to serve |
| Fewer than three occupied grid cells | `getis_ord_gi_star` returns empty | cells render with density only, `method` set to `density_only` |
| Zero variance across cells | same as above | as above |
| No parseable `incident_time` in a group | `patrol_window` empty, `patrol_window_basis` explains why | patrol row hidden, no invented hour |
| Zero baseline count | `lift_pct` is `None`, `lift_state` is `emerging` | UI shows "emerging" rather than a fabricated percentage |
| Fewer than two periods for a delta | delta is `None` | dash rendered, existing null guard already handles it |
| Fewer than two complete years for seasonality | `profile` returned with `n_years` and `significant = false` for all months | shape shown, no action recommended |
| No rows match the requested filters | empty arrays and zeroed `totals`, never absent fields | empty state renders |
| Statement timeout on an analytics query | propagates as the existing generic 500; the 5-second transaction timeout in `rls.py` still applies | existing error banner |
| Migration re-run | every statement is `IF NOT EXISTS` | no effect |

No new exception type is introduced, and no error path returns a partially populated model that would violate a Correctness Property.
## What this design deliberately does not do

- No neural or deep forecasting model. Reasoning in the Overview.
- No new dependency, service, scheduler, or environment variable.
- No change to migration `002`, which contains `DROP TABLE ... CASCADE`.
- No change to the voice or RAG pipelines. Analytics responses do not reach TTS today and this design does not introduce a path.
- No change to ring detection, offender risk scoring, socio correlation, or money trail, which are out of scope and specified separately.
- No embedding generation. The zero-embedding finding and the resulting dead RAG lane are recorded here and belong to their own spec.
