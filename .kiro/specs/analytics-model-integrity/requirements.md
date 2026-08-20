# Requirements Document

## Introduction

The **Early Warning & Forecast** screen (PS8) and the **Trends & Patterns** screen (PS3) are presented to officers as predictive and clustering intelligence. A source-level verification established that neither screen is backed by a model:

- No ML library is used anywhere in the analytics path. A repo-wide search for `.fit(`, `.predict(`, `KMeans`, `DBSCAN`, `ARIMA`, `Prophet`, `RandomForest`, `LinearRegression`, `train_test_split`, `silhouette` and `cross_val` returns exactly one hit: `reranker_bge.py:67`, the BGE cross-encoder used for RAG document reranking. `intelligence_service.py` imports only `math`.
- `horizon_days` is accepted, validated `1..30` at the route, echoed in the response, and never referenced in any computation. The output for a 3-day horizon is byte-identical to a 30-day horizon.
- The backtest reports `metric="PAI"` on a value the schema itself names `hit_rate_top_10_percent_cells`, understating true PAI by roughly 10x. Its denominator is filtered to `train_cnt > 0`, which removes emerging hotspots from the evaluation.
- "MO Clusters" is `GROUP BY crime_type, sections ORDER BY n DESC LIMIT 10`, a frequency table over legal-section strings. There is no feature space, distance metric, cluster-count selection, or validation.
- The "Neural Forecast Engine" panel is a presentation component. Its counters are `useCountUp` animations (the source comment reads "Smooth count-up so the metrics feel live"), its four-stage pipeline is a hardcoded label array, and its ticker is a `setInterval` cycling already-computed cells.

The data behind both screens is genuine: 35,993 real cases queried live from Postgres under row-level security, with explanation strings that name the actual driving numbers. The defect is not fabricated data. It is fabricated *method*, plus a set of statistical errors that make the reported numbers wrong in a specific and correctable direction.

This feature makes both screens honest. Every claim the UI makes must be backed by an implementation that performs it, every statistic must be computed correctly with its uncertainty disclosed, and any capability that is not implemented must be renamed to what it actually is. Where a genuine model is warranted and cheap, it replaces the placeholder: `networkx`, `scikit-learn`, `pandas` and `numpy` are already pinned dependencies, and BGE-M3 narrative embeddings already exist in the `narratives.embedding` column.

### Scope

In scope, the six endpoints these two screens consume:

| Endpoint | Screen |
|---|---|
| `GET /api/forecast/hotspots` | Early Warning & Forecast |
| `GET /api/forecast/alerts` | Early Warning & Forecast |
| `GET /api/forecast/backtest` | Early Warning & Forecast |
| `GET /api/trends` | Trends & Patterns |
| `GET /api/trends/seasonal` | Trends & Patterns |
| `GET /api/mo/clusters` | Trends & Patterns |

Plus their frontend consumers: `routes/forecast.tsx`, `routes/trends.tsx`, `components/ModelInferenceTheater.tsx`, `components/ops/PredictivePanel.tsx`, and the response types in `lib/api/intelligence.ts`.

Out of scope for this spec: ring detection (`/api/network/rings`), offender risk scoring (`/api/persons/{id}/profile`, `/api/offenders`), socio-economic correlation (`/api/socio/*`), and money-trail traversal. These carry related defects and are tracked separately.

### Governing constraints

- `AGENTS.md`: all data stays synthetic, no individual-guilt prediction, human-in-the-loop.
- The voice pipeline must not regress. Analytics responses do not reach the TTS path today and must not begin to.
- The frontend performs no runtime response validation (`apiFetch` does `res.json() as Promise<T>`) and declares nearly every field non-optional, so response-shape changes are silent until they crash a screen.

## Requirements

### Requirement 1: Truthful capability labelling

**User Story:** As a police officer relying on this screen for deployment decisions, I want every stated capability to be one the system actually performs, so that I do not over-trust a result or misrepresent it to a superior officer.

#### Acceptance Criteria

1. WHEN any screen, panel heading, metric label, or API response field names a statistical or machine-learning technique THEN the system SHALL implement that technique, OR the label SHALL be changed to describe the computation actually performed.
2. WHEN the forecast panel is displayed AND no neural network participates in producing its values THEN the system SHALL NOT describe the panel as a neural engine.
3. WHEN a UI element implies live model inference AND the underlying value is a completed database aggregate THEN the system SHALL describe it as a query result and SHALL NOT present a synthetic progress animation as a computation pipeline.
4. WHEN a displayed timestamp is derived from `MAX(report_date)` rather than the current time THEN the system SHALL label it as the data reference date.
5. WHEN a metric is displayed THEN its label SHALL match its mathematical definition, and the Predictive Accuracy Index SHALL NOT be used as a label for a hit rate.
6. IF a capability described in `docs/ARCHITECTURE.md` or in a code docstring is not implemented THEN that document or docstring SHALL be corrected as part of this work.

### Requirement 2: Functional forecast horizon

**User Story:** As an officer choosing a 3-day versus a 30-day outlook, I want the horizon selector to change the forecast, so that the control is not misleading me about what I am looking at.

#### Acceptance Criteria

1. WHEN a request specifies `horizon_days` THEN the value SHALL participate in the computation of the returned risk scores.
2. WHEN two requests differ only in `horizon_days` AND the underlying data contains temporal variation THEN the responses SHALL differ.
3. WHEN the horizon changes THEN the returned `as_of_date` SHALL remain the data reference date and SHALL NOT shift.
4. IF a functional horizon cannot be delivered for a given analytic THEN the horizon control SHALL be removed from that screen rather than left inert.
5. WHEN `horizon_days` is outside the supported set THEN the system SHALL reject the request with a validation error rather than silently substituting a default.

### Requirement 3: Correct comparison windows and lift

**User Story:** As an officer reading "activity up 40 percent", I want that figure computed against the window the label names, so that I am not acting on a systematically biased number.

#### Acceptance Criteria

1. WHEN a lift percentage compares a recent window against a baseline window THEN both windows SHALL be of equal duration, OR the comparison SHALL be normalised to a per-day rate before the ratio is taken.
2. WHEN a comparison window is described in user-facing text THEN the described duration SHALL match the duration used in the query.
3. WHEN the baseline count is zero and the recent count is positive THEN the system SHALL represent the result as undefined-but-emerging rather than substituting a fixed percentage.
4. WHEN the same zero-baseline condition occurs in more than one endpoint THEN all affected endpoints SHALL handle it identically.
5. WHEN a lift figure appears in an explanation string THEN that string SHALL name the actual window durations used.
6. WHEN the most recent period is incomplete relative to the data reference date THEN the response SHALL indicate this so a partial period is not read as a decline.

### Requirement 4: Statistically valid backtest

**User Story:** As an officer or reviewing authority assessing whether this tool works, I want an evaluation I can defend, so that a reported accuracy figure survives scrutiny.

#### Acceptance Criteria

1. WHEN the backtest reports a metric THEN the reported field name and label SHALL match the formula used.
2. WHEN the Predictive Accuracy Index is reported THEN it SHALL be computed as hit rate divided by the fraction of area flagged.
3. WHEN the evaluation denominator is assembled THEN it SHALL include all grid cells containing test-period incidents, including cells with zero training-period incidents.
4. WHEN training and test windows are defined THEN they SHALL be disjoint, with no incident assignable to both.
5. WHEN an accuracy figure is reported THEN it SHALL be accompanied by a naive baseline computed over the same data, so the figure is interpretable.
6. WHEN an accuracy figure is reported THEN the response SHALL include the sample size and a measure of variability across evaluation folds.
7. WHEN the evaluation is performed THEN it SHALL use more than one train/test split so that a single fortunate period cannot determine the reported number.
8. WHEN the grid resolution used for evaluation differs from the resolution served to the screen THEN the system SHALL use the same resolution for both, so the evaluation validates what the officer sees.

### Requirement 5: Early warning alert integrity

**User Story:** As a station officer receiving a patrol recommendation, I want every field in that recommendation traceable to data, so that I do not deploy officers on a default value.

#### Acceptance Criteria

1. WHEN no parseable incident time exists for an alert group THEN the system SHALL omit the patrol window rather than emitting a fixed default hour.
2. WHEN a patrol window is derived from incident times THEN the system SHALL use a statistic valid for a circular variable, so that incidents clustered around midnight do not produce a midday recommendation.
3. WHEN an alert is emitted as a persistent-volume fallback rather than a detected spike THEN the response SHALL mark it as such, and the UI SHALL distinguish it from a spike alert.
4. WHEN an alert threshold is documented in a docstring THEN that threshold SHALL be present in the query.
5. WHEN a risk level is assigned THEN every level offered as a filter in the UI SHALL be reachable by the scoring function.
6. WHEN a recommended action is emitted THEN it SHALL NOT assert a time window that the data does not support.
7. WHEN alerts are limited to a fixed count THEN the response SHALL report how many groups met the alert condition in total.

### Requirement 6: Genuine modus-operandi clustering

**User Story:** As an investigator looking for behavioural patterns across cases, I want clusters formed from case content, so that I can find non-obvious groupings rather than a list of the most common legal-section strings.

#### Acceptance Criteria

1. WHEN clusters are produced THEN they SHALL be formed by a clustering algorithm operating on a defined feature representation of each case.
2. WHEN a feature representation is chosen THEN it SHALL make use of available case content, including narrative embeddings where present.
3. WHEN the number of clusters is determined THEN it SHALL be selected by a documented procedure rather than fixed by a result-row limit.
4. WHEN clusters are returned THEN the response SHALL include a cluster quality measure so that a meaningless partition is visible as such.
5. WHEN legal sections are used as a feature THEN section order SHALL NOT affect cluster assignment.
6. WHEN a cluster is labelled THEN the label SHALL be derived from the contents of that cluster.
7. WHEN clustering is recomputed on unchanged data THEN it SHALL produce a stable assignment.
8. IF clustering cannot be completed within the request budget THEN the system SHALL serve a precomputed assignment rather than degrading to a frequency table under a clustering label.

### Requirement 7: Correct trend period arithmetic

**User Story:** As an officer comparing periods, I want the period labels and deltas to mean what they say, so that I can cite them accurately.

#### Acceptance Criteria

1. WHEN a granularity is requested THEN each returned period key SHALL uniquely identify one period at that granularity.
2. WHEN weekly granularity is requested THEN distinct weeks SHALL NOT collapse into a shared period key.
3. WHEN a period-over-period delta is returned THEN its field name and its UI label SHALL describe the granularity actually compared.
4. WHEN a year-over-year delta is returned THEN it SHALL compare against the same calendar period one year earlier at any supported granularity, or SHALL be omitted where that is not determinable.
5. WHEN the previous period has a count of zero THEN the delta SHALL be reported as undefined rather than computed against a substituted value.
6. WHEN period keys are sorted for display THEN lexical ordering of the keys SHALL match chronological order.
7. WHEN the requested filters match no data THEN the response SHALL return empty collections rather than absent fields.

### Requirement 8: Valid seasonal analysis

**User Story:** As a district officer planning seasonal deployment, I want seasonal peaks separated from year-on-year growth, so that I am not told a growth trend is a seasonal pattern.

#### Acceptance Criteria

1. WHEN monthly figures are compared across multiple years THEN the comparison SHALL account for year-on-year level differences so that volume growth is not reported as seasonality.
2. WHEN a seasonal figure is reported THEN it SHALL be accompanied by the number of observations it rests on.
3. WHEN the seasonal profile is returned THEN periods below the baseline SHALL be available, so that troughs are visible and the full shape can be judged.
4. WHEN a seasonal lift is small relative to natural variation THEN the response SHALL indicate that it is not distinguishable from noise.
5. WHEN a partial period exists at the end of the series THEN it SHALL be excluded from the seasonal baseline or flagged.
6. WHEN a recommended action is attached to a seasonal peak THEN it SHALL be present only where the peak meets a stated significance condition.

### Requirement 9: Disclosed uncertainty and provenance

**User Story:** As a reviewing authority, I want to see how much data each figure rests on and how it was produced, so that I can judge whether it supports a decision.

#### Acceptance Criteria

1. WHEN a statistical figure is returned THEN the response SHALL include the sample size it was computed from.
2. WHEN a result set is truncated by a row limit THEN the response SHALL report both the returned count and the total matching count.
3. WHEN a score is returned THEN the response SHALL identify the method that produced it.
4. WHEN a caveat is required for responsible use THEN it SHALL be rendered in the UI and SHALL NOT exist only as an unread response field.
5. WHEN a figure derives from reported incidents rather than confirmed outcomes THEN that limitation SHALL be visible on the screen displaying it.
6. WHEN a value is a default, a fallback, or otherwise not derived from matching data THEN it SHALL be distinguishable from a computed value.

### Requirement 10: Non-breaking API evolution

**User Story:** As a developer changing these endpoints, I want the screens to keep working through each step, so that the project stays demonstrable at every commit.

#### Acceptance Criteria

1. WHEN a response field currently typed as an array is returned THEN it SHALL be an array, and SHALL be empty rather than null when there is nothing to report.
2. WHEN a response field currently has a method invoked on it by the frontend THEN it SHALL retain a type on which that method is valid.
3. WHEN the meaning of a numeric field is preserved THEN its scale SHALL be preserved, including the fractional 0-to-1 range of the backtest rate and the 0-to-100 range of risk, severity, similarity and lift values.
4. WHEN a risk level string is returned THEN it SHALL remain within the set the frontend styles and filters on, or every consuming site SHALL be updated in the same change.
5. WHEN a response field is renamed or removed THEN every consuming call site SHALL be updated in the same change.
6. WHEN a new field is added THEN it SHALL be additive and SHALL NOT require a frontend change for existing screens to keep functioning.
7. WHEN a per-factor score contributes to a bar rendered against a fixed maximum THEN it SHALL stay within that maximum, or the rendering SHALL be updated in the same change.

### Requirement 11: Query performance at scale

**User Story:** As an officer using these screens on the full dataset, I want them to respond promptly, so that the tool is usable during an active shift.

#### Acceptance Criteria

1. WHEN an analytics query filters or groups on a column THEN a supporting index SHALL exist for that access pattern.
2. WHEN a query performs vector similarity search THEN an approximate-nearest-neighbour index SHALL be present.
3. WHEN a response would contain an unbounded number of rows THEN the query SHALL bound it and the response SHALL report the total.
4. WHEN an index is added THEN it SHALL be delivered in a new additive migration file, and no existing migration containing destructive statements SHALL be modified.
5. WHEN a text filter uses a leading-wildcard pattern THEN either a suitable index SHALL support it or the filter SHALL be changed to a form an index can serve.
6. WHEN a computation is too expensive to perform per request THEN it SHALL be precomputed, with its staleness recorded, and SHALL be safe under multiple worker processes.

### Requirement 12: Verification and regression protection

**User Story:** As a developer, I want each corrected analytic to have a check that fails if it regresses, so that these defects cannot silently return.

#### Acceptance Criteria

1. WHEN an analytic is corrected THEN a runnable check SHALL exist that fails if the defect reappears.
2. WHEN a parameter is required to influence output THEN a check SHALL assert that two requests differing only in that parameter produce different results.
3. WHEN a metric formula is specified THEN a check SHALL assert the computed value against a known fixture.
4. WHEN a response contract rule from Requirement 10 applies to a field THEN a check SHALL assert that the field satisfies it.
5. WHEN the screens are changed THEN both SHALL be manually verified in English and in Kannada, since the Kannada path performs separate response post-processing.
6. WHEN a check is added THEN it SHALL run without a live database, or SHALL be marked so that it can be excluded from environments without one.

## Glossary

| Term | Definition |
|---|---|
| **Hit rate** | Fraction of test-period incidents that fell inside the cells flagged as high risk. |
| **PAI** | Predictive Accuracy Index. Hit rate divided by the fraction of total area flagged. Flagging 10 percent of cells and capturing 40 percent of incidents gives a PAI of 4.0, not 0.40. |
| **PEI** | Predictive Efficiency Index. Achieved PAI divided by the maximum PAI attainable for the same flagged area. |
| **Lift** | Ratio of activity in a recent window to activity in a baseline window, expressed as a percentage change. Requires equal-duration or rate-normalised windows to be meaningful. |
| **Data reference date** | `MAX(report_date)` from the `cases` table, used instead of wall-clock time so the synthetic dataset always produces current-looking output. |
| **Recent window** | The interval ending at the data reference date over which current activity is counted. |
| **Baseline window** | The earlier interval against which the recent window is compared. |
| **Grid cell** | A rectangular geographic bin produced by rounding latitude and longitude to a fixed resolution. Four different resolutions currently coexist in the codebase. |
| **Walk-forward evaluation** | Repeated train/test evaluation with a rolling origin, producing several estimates rather than one, so variability can be reported. |
| **Naive baseline** | A trivial comparison strategy, such as flagging a random selection of cells covering the same area, used to make an accuracy figure interpretable. |
| **Circular statistic** | A summary appropriate for a wrap-around variable such as hour of day, where the arithmetic mean of 23:00 and 01:00 incorrectly yields midday. |
| **Cluster quality measure** | A validation score such as silhouette, reported so a partition with no real structure is visible as such. |
| **MO** | Modus operandi. The behavioural signature of how an offence was committed. |
| **Frequency table** | A grouped count ordered by size. Distinct from clustering, which requires a feature space and a distance metric. |
| **Response contract** | The set of field names, types, nullability and numeric scales the frontend depends on. Not enforced at runtime, since `apiFetch` casts the parsed JSON without validation. |
| **Additive change** | A response change that adds fields only, requiring no frontend update for existing screens to keep working. |
| **Fallback alert** | An alert emitted because no spike was detected, ranked purely by historical volume, currently indistinguishable in the response from a genuine spike alert. |
