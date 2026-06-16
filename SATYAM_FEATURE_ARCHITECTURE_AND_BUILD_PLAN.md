# Satyam AI — Feature Architecture & Build Plan

**Goal:** turn the remaining PS gaps into a judge-winning, connected intelligence platform — not scattered dashboards.

This document defines:

1. What we are building.
2. Where each feature lives in the UI.
3. Backend architecture and endpoints.
4. Frontend architecture and screen wiring.
5. Data/schema additions.
6. How chat/voice should deep-link into screens.
7. What **not** to do.
8. Final frontend-backend connection checklist.

---

## 0. Winning principle

The hackathon-winning story is not: “we added many features.”

The winning story is:

> An officer can ask in natural language or Kannada voice, the AI grounds the request in real FIR data, automatically opens the correct investigation screen, visualizes the network/timeline/risk/forecast, explains why, obeys RBAC/PII masking, and audit-logs every sensitive action.

Everything must feel like **one connected investigation system**.

---

## 1. Current strengths to protect

Already strong and must not be broken:

- Conversational multilingual interface.
- Gemini as the brain.
- Sarvam for translation/STT/TTS.
- SQL guard / allow-listed DB access.
- Grounded answers referencing DB records.
- JWT authentication.
- Postgres RLS / jurisdiction-based access.
- Server-side PII masking.
- Hash-chained audit log.
- Existing `cases`, `persons`, `case_persons`, `narratives`, `stations`, `officers` schema.
- Existing BGE-M3 embeddings in `narratives.embedding`.
- Existing NetworkX pipeline/tooling.

These are the trust layer. New features must reuse them, not bypass them.

---

## 2. Final feature roadmap

### P1 — highest demo value

| PS | Feature | Status after build | Main screen |
|---|---|---|---|
| PS2 | Organized-crime / repeat-offender network clustering | Done | Network screen |
| PS6 | Similar-case RAG + investigation timeline | Done | Case Drawer + chat |
| PS8 | Predictive hotspot forecasting + early-warning alerts | Done | Map / Forecast panel |

### P2 — completes strong analytics stack

| PS | Feature | Status after build | Main screen |
|---|---|---|---|
| PS5 | Offender profiling + risk scoring | Done | New Offender Profile screen |
| PS3 | MO clustering + trends + seasonal analysis | Done | New Trends & Patterns screen |
| PS4 | Demographic + socio-economic dashboard | Done | Reports + new Socio Dashboard |

### P3 — only if time remains

| PS | Feature | Status after build | Main screen |
|---|---|---|---|
| PS7 | Financial transactions + money trail | Optional | Network / Financial Links |

---

## 3. Existing screens vs new screens

## 3.1 Build on already-existing screens

### Network screen

Add:

- Top-N organized-crime rings.
- Case-specific subgraph: `/network?case=<case_id>`.
- Person ego graph: `/network?person=<person_id>`.
- Community colors.
- Pulsing kingpin node.
- Repeat-offender side panel.
- Ring-member badges.
- Node mini-cards.

Why: this screen already represents relationships. Upgrade it into the visual showpiece.

---

### Case Drawer

Add:

- “Similar cases” tab.
- Case-lifecycle timeline.
- Person rows with:
  - risk badge,
  - ring badge,
  - “View profile”,
  - “View network”.

Why: investigators naturally start from a case.

---

### Map / Hotspot screen

Add:

- Predictive grid heatmap.
- Forecast overlay.
- Early-warning alert markers.
- Forecast explanation drawer.
- PAI/backtest badge.

Why: forecasting is spatial and should be seen on the map.

---

### Reports screen

Add:

- Embedded demographics and socio-economic charts.
- Summary cards for trends, forecasts, and similar-case reports.

Why: gives fast access and prevents the product from feeling fragmented.

---

### Chat / Voice interface

Add agentic commands:

- “Show network for this case.”
- “Find similar cases.”
- “Profile this offender.”
- “Show theft trends in Bengaluru.”
- “Show victim demographics for assault.”
- “Show forecast hotspots for next week.”

The AI should not only answer — it should navigate and load the right screen.

---

### Audit/Admin screen

Add audit visibility for:

- network graph views,
- offender profile views,
- forecast views,
- socio dashboard exports,
- similar-case queries.

Why: reinforces PS9/PS10 trust.

---

## 3.2 New first-class screens

### Offender Profile screen

Route:

```txt
/profile/person/:personId
```

Contains:

- Risk gauge.
- Low / Medium / High / Critical label.
- Explainable breakdown chips.
- MO fingerprint.
- Person crime-history timeline.
- Known associates.
- Ring membership badge.
- View in network button.

---

### Trends & Patterns screen

Route:

```txt
/trends
```

Contains:

- MO clusters.
- Trend charts by crime type and district.
- YoY / QoQ deltas.
- Seasonal decomposition.
- Action cards.
- Drill-down into real cases.

---

### Socio Dashboard screen

Route:

```txt
/socio
```

Contains:

- Accused/victim demographic charts.
- Age/gender/district distribution.
- Socio-economic correlation scatter charts.
- Social risk area index.
- Correlation ≠ causation label.
- SP+ RBAC gate.

Also embed a lightweight version inside Reports.

---

### Early Warning Center / Forecast panel

Preferred route:

```txt
/forecast
```

Or strong right-side panel on Map:

```txt
/map?layer=forecast
```

Contains:

- Forecast alerts.
- Grid-cell heatmap summary.
- Patrol-window recommendation.
- Why alert fired.
- Backtest PAI badge.

---

## 4. Backend architecture

Recommended backend structure:

```txt
backend/app/
  api/routes/
    intelligence_network.py
    similar_cases.py
    timelines.py
    offender_profiles.py
    forecasting.py
    trends_patterns.py
    socio_dashboard.py
  services/
    network_service.py
    similar_case_service.py
    timeline_service.py
    offender_profile_service.py
    forecasting_service.py
    trends_service.py
    socio_service.py
    audit_service.py
  schemas/
    intelligence_network.py
    similar_cases.py
    timelines.py
    offender_profiles.py
    forecasting.py
    trends_patterns.py
    socio_dashboard.py
```

### Architecture rule

Routes should be thin.

Routes should:

1. Authenticate user.
2. Read request params.
3. Call service.
4. Return typed response.
5. Trigger audit log where needed.

Services should contain business logic.

---

## 5. Backend endpoint contracts

## 5.1 PS2 — Network clustering endpoints

### `GET /api/network/rings`

Purpose: load top-N organized-crime rings.

Query params:

```txt
limit=10
crime_type=optional
district=optional
```

Response:

```json
{
  "rings": [
    {
      "ring_id": "ring_3",
      "label": "Ring #3",
      "member_count": 7,
      "case_count": 18,
      "severity_score": 82,
      "recency_score": 74,
      "kingpin_person_id": 1234,
      "top_crime_types": ["Chain Snatching", "Robbery"],
      "districts": ["Bengaluru Urban"],
      "why_flagged": [
        "7 co-accused connected across 18 cases",
        "Repeated robbery pattern",
        "Recent activity within 30 days"
      ]
    }
  ]
}
```

---

### `GET /api/network/rings/{ring_id}/graph`

Purpose: render selected ring graph.

Response:

```json
{
  "nodes": [
    {
      "id": "person_123",
      "person_id": 123,
      "label": "Masked / role-safe name",
      "type": "person",
      "risk_label": "High",
      "offense_count": 6,
      "is_kingpin": true,
      "community_id": "ring_3"
    }
  ],
  "edges": [
    {
      "source": "person_123",
      "target": "person_456",
      "type": "co_accused",
      "shared_case_count": 3,
      "weight": 0.84
    }
  ]
}
```

---

### `GET /api/network/case/{case_id}`

Purpose: graph for one case.

Used by:

```txt
/network?case=<case_id>
```

Must show:

- accused,
- victims,
- witnesses,
- complainants,
- linked cases if same accused appears elsewhere.

---

### `GET /api/network/person/{person_id}`

Purpose: 1-hop ego graph for one person.

Used by:

```txt
/network?person=<person_id>
```

Optional param:

```txt
depth=1 | 2
```

Default must be `depth=1` to avoid graph hairball.

---

## 5.2 PS6 — Similar case RAG endpoints

### `GET /api/cases/{case_id}/similar`

Query params:

```txt
limit=5
```

Response:

```json
{
  "case_id": 101,
  "matches": [
    {
      "case_id": 202,
      "fir_number": "123/2025",
      "crime_type": "Chain Snatching",
      "district": "Bengaluru Urban",
      "similarity_percent": 91,
      "why_similar": [
        "Shared section 379",
        "Similar two-wheeler snatching MO",
        "Same evening time window"
      ],
      "citation": {
        "case_id": 202,
        "source": "FIR narrative"
      }
    }
  ]
}
```

Retrieval logic:

1. Vector KNN over `narratives.embedding`.
2. Lexical search over `body_tsv` / trigram.
3. Structured boosts: crime type, sections, district, motive, time window.
4. Merge candidate pool.
5. BGE rerank.
6. Return similarity percentage and why chips.

---

### `POST /api/cases/similar/search`

Purpose: chat-driven similar-case search when query is text, not fixed case id.

Request:

```json
{
  "query": "cases like chain snatching near Majestic",
  "limit": 5
}
```

Response: same match shape as above.

---

## 5.3 PS6 — Timeline endpoints

### `GET /api/cases/{case_id}/timeline`

Response:

```json
{
  "case_id": 101,
  "events": [
    {
      "date": "2026-01-10",
      "type": "incident",
      "title": "Incident occurred",
      "source_column": "incident_date"
    },
    {
      "date": "2026-01-11",
      "type": "fir_registered",
      "title": "FIR registered",
      "source_column": "report_date"
    },
    {
      "date": "2026-01-11",
      "type": "io_assigned",
      "title": "IO assigned: masked/authorized IO name",
      "source_column": "io_name"
    }
  ]
}
```

Important: do not invent events. Only use real columns.

---

### `GET /api/persons/{person_id}/timeline`

Purpose: person crime-history timeline.

Response:

```json
{
  "person_id": 123,
  "events": [
    {
      "date": "2025-09-12",
      "case_id": 77,
      "role": "Accused",
      "crime_type": "Robbery",
      "status": "Charge Sheeted"
    }
  ]
}
```

---

## 5.4 PS5 — Offender profile endpoints

### `GET /api/persons/{person_id}/profile`

Response:

```json
{
  "person_id": 123,
  "display_name": "Masked/authorized name",
  "risk": {
    "score": 82,
    "label": "High",
    "breakdown": [
      { "factor": "Frequency", "score": 24, "reason": "6 accused cases" },
      { "factor": "Recency", "score": 18, "reason": "Last offense 11 days ago" },
      { "factor": "Severity", "score": 20, "reason": "2 heinous cases" },
      { "factor": "Group offending", "score": 12, "reason": "Connected to Ring #3" },
      { "factor": "Outcomes", "score": 8, "reason": "2 charge-sheeted cases" }
    ],
    "notice": "Risk Indicator — investigative use only"
  },
  "mo_fingerprint": {
    "top_sections": ["379", "392"],
    "top_crime_types": ["Chain Snatching", "Robbery"],
    "top_motives": ["Financial gain"],
    "time_of_day": "Evening"
  },
  "ring_membership": {
    "ring_id": "ring_3",
    "label": "Ring member"
  },
  "known_associates": [
    { "person_id": 456, "shared_case_count": 3 }
  ]
}
```

Risk formula signals:

1. Frequency.
2. Recency.
3. Severity.
4. Escalation.
5. Group offending.
6. Outcomes.

Do **not** use age or gender in individual risk scoring.

---

## 5.5 PS8 — Forecasting endpoints

### `GET /api/forecast/hotspots`

Query params:

```txt
crime_type=optional
district=optional
horizon_days=7
grid_size=0.02
```

Response:

```json
{
  "as_of_date": "2026-06-15",
  "horizon_days": 7,
  "cells": [
    {
      "cell_id": "grid_12_44",
      "lat": 12.9716,
      "lng": 77.5946,
      "risk_score": 87,
      "risk_level": "High",
      "crime_type": "Burglary",
      "why": [
        "Forecast 42% above 4-week baseline",
        "Recent density increased in neighboring cells",
        "Evening incidents are rising"
      ]
    }
  ]
}
```

Important:

- `as_of_date` should use `MAX(report_date)` from DB, not system wall-clock.
- This feels realtime but never fails on fixed synthetic data.

---

### `GET /api/forecast/alerts`

Response:

```json
{
  "alerts": [
    {
      "alert_id": "alert_1",
      "crime_type": "Burglary",
      "district": "Bengaluru Urban",
      "risk_level": "High",
      "patrol_window": "18:00-21:00",
      "why": "Forecast is 42% above the 4-week baseline",
      "recommended_action": "Increase evening patrols in highlighted grid cells",
      "fairness_note": "Decision support only; based on reported incidents, not arrests."
    }
  ]
}
```

---

### `GET /api/forecast/backtest`

Response:

```json
{
  "metric": "PAI",
  "hit_rate_top_10_percent_cells": 0.71,
  "window": "last_month",
  "explanation": "71% of actual incidents fell inside top 10% predicted risk cells during backtest."
}
```

---

## 5.6 PS3 — Trends and MO clustering endpoints

### `GET /api/trends`

Query params:

```txt
crime_type=optional
district=optional
granularity=month|quarter|week
```

Response:

```json
{
  "series": [
    {
      "period": "2026-01",
      "crime_type": "Theft",
      "district": "Bengaluru Urban",
      "count": 245
    }
  ],
  "deltas": {
    "qoq_percent": 12.5,
    "yoy_percent": 18.2
  }
}
```

---

### `GET /api/trends/seasonal`

Response:

```json
{
  "crime_type": "Theft",
  "district": "Bengaluru Urban",
  "seasonal_peaks": [
    {
      "period": "October",
      "lift_percent": 30,
      "recommended_action": "Increase patrols near commercial areas during festival season"
    }
  ]
}
```

---

### `GET /api/mo/clusters`

Response:

```json
{
  "clusters": [
    {
      "cluster_id": "mo_7",
      "label": "Two-wheeler chain snatching",
      "case_count": 214,
      "top_sections": ["379", "392"],
      "top_crime_types": ["Chain Snatching"],
      "representative_case_id": 1007,
      "action_hint": "Review evening patrol coverage near markets"
    }
  ]
}
```

---

## 5.7 PS4 — Socio dashboard endpoints

### `GET /api/socio/demographics`

Query params:

```txt
role=Accused|Victim
crime_type=optional
district=optional
```

Response:

```json
{
  "age_buckets": [
    { "bucket": "18-25", "count": 1200 },
    { "bucket": "26-35", "count": 900 }
  ],
  "gender": [
    { "gender": "Male", "count": 1800 },
    { "gender": "Female", "count": 400 }
  ],
  "districts": [
    { "district": "Bengaluru Urban", "count": 500 }
  ],
  "notice": "Aggregate-only demographic view. Not used for individual risk scoring."
}
```

---

### `GET /api/socio/correlation`

Response:

```json
{
  "scatter": [
    {
      "district": "Bengaluru Urban",
      "crime_rate": 42.1,
      "literacy_rate": 88.5,
      "urbanization_percent": 92.0,
      "income_index": 0.74
    }
  ],
  "correlations": {
    "crime_rate_vs_literacy": -0.21,
    "crime_rate_vs_urbanization": 0.43,
    "crime_rate_vs_income": 0.12
  },
  "notice": "Correlation does not imply causation. For planning use only."
}
```

---

### `GET /api/socio/risk-index`

Response:

```json
{
  "areas": [
    {
      "district": "Bengaluru Urban",
      "social_risk_score": 78,
      "drivers": [
        "High crime density",
        "High urbanization",
        "Repeat-offender concentration"
      ]
    }
  ]
}
```

---

## 6. Data and schema additions

## 6.1 Required small addition for PS4

Add table:

```sql
CREATE TABLE district_socio_economic_indicators (
    district TEXT PRIMARY KEY,
    population INTEGER,
    literacy_rate DOUBLE PRECISION,
    urbanization_percent DOUBLE PRECISION,
    income_index DOUBLE PRECISION,
    unemployment_proxy DOUBLE PRECISION
);
```

Seed about 30 Karnataka district rows.

Use only for aggregate dashboards.

Do not use in individual risk scoring.

---

## 6.2 Optional additions for PS7 later

Only if time remains:

```sql
CREATE TABLE financial_accounts (
    account_id BIGSERIAL PRIMARY KEY,
    person_id INTEGER REFERENCES persons(person_id),
    account_type TEXT,
    bank_name TEXT,
    district TEXT
);

CREATE TABLE financial_transactions (
    transaction_id BIGSERIAL PRIMARY KEY,
    from_account_id BIGINT REFERENCES financial_accounts(account_id),
    to_account_id BIGINT REFERENCES financial_accounts(account_id),
    amount NUMERIC,
    transaction_time TIMESTAMPTZ,
    channel TEXT,
    case_id INTEGER REFERENCES cases(case_id)
);
```

Do not build PS7 before P1/P2 unless the main features are stable.

---

## 7. Frontend architecture

Recommended structure:

```txt
frontend/src/
  lib/api/
    client.ts
    intelligence.ts
  types/
    intelligence.ts
  components/
    network/
      RingGraph.tsx
      RingSidePanel.tsx
      RepeatOffenderPanel.tsx
    case/
      SimilarCasesTab.tsx
      CaseTimeline.tsx
    profile/
      RiskGauge.tsx
      RiskBreakdown.tsx
      MOFingerprint.tsx
      KnownAssociates.tsx
    forecast/
      ForecastHeatLayer.tsx
      ForecastAlertPanel.tsx
      PAIBacktestBadge.tsx
    trends/
      TrendChart.tsx
      SeasonalCard.tsx
      MOClusterExplorer.tsx
    socio/
      DemographicCharts.tsx
      CorrelationScatter.tsx
      SocialRiskIndex.tsx
  pages/
    Network.tsx
    OffenderProfile.tsx
    TrendsPatterns.tsx
    SocioDashboard.tsx
    Forecast.tsx
```

If your project uses a different routing structure, keep the same logical split.

---

## 8. Frontend API client requirements

Create a single typed intelligence API wrapper.

Example:

```ts
// frontend/src/lib/api/intelligence.ts
import { apiFetch } from "./client";

export async function getNetworkRings(limit = 10) {
  return apiFetch(`/api/network/rings?limit=${limit}`);
}

export async function getCaseNetwork(caseId: number) {
  return apiFetch(`/api/network/case/${caseId}`);
}

export async function getPersonNetwork(personId: number, depth = 1) {
  return apiFetch(`/api/network/person/${personId}?depth=${depth}`);
}

export async function getSimilarCases(caseId: number, limit = 5) {
  return apiFetch(`/api/cases/${caseId}/similar?limit=${limit}`);
}

export async function getCaseTimeline(caseId: number) {
  return apiFetch(`/api/cases/${caseId}/timeline`);
}

export async function getPersonProfile(personId: number) {
  return apiFetch(`/api/persons/${personId}/profile`);
}

export async function getForecastHotspots(params: URLSearchParams) {
  return apiFetch(`/api/forecast/hotspots?${params.toString()}`);
}

export async function getForecastAlerts() {
  return apiFetch(`/api/forecast/alerts`);
}

export async function getTrends(params: URLSearchParams) {
  return apiFetch(`/api/trends?${params.toString()}`);
}

export async function getMOClusters() {
  return apiFetch(`/api/mo/clusters`);
}

export async function getSocioDemographics(params: URLSearchParams) {
  return apiFetch(`/api/socio/demographics?${params.toString()}`);
}
```

Do not call raw `fetch()` randomly across components. Centralize endpoint calls.

---

## 9. Agentic navigation design

The AI/chat layer should support structured UI actions.

Recommended event shape:

```ts
type NavigateAction =
  | { type: "open_network_case"; caseId: number }
  | { type: "open_network_person"; personId: number }
  | { type: "open_profile"; personId: number }
  | { type: "open_similar_cases"; caseId: number }
  | { type: "open_forecast"; crimeType?: string; district?: string }
  | { type: "open_trends"; crimeType?: string; district?: string }
  | { type: "open_socio"; role?: string; crimeType?: string; district?: string };
```

Chat response can include:

```json
{
  "answer": "I found the case. Opening the network view.",
  "ui_action": {
    "type": "open_network_case",
    "caseId": 101
  }
}
```

Frontend handler:

```ts
function handleUiAction(action: NavigateAction) {
  switch (action.type) {
    case "open_network_case":
      navigate(`/network?case=${action.caseId}`);
      break;
    case "open_network_person":
      navigate(`/network?person=${action.personId}`);
      break;
    case "open_profile":
      navigate(`/profile/person/${action.personId}`);
      break;
    case "open_forecast":
      navigate(`/forecast`);
      break;
    case "open_trends":
      navigate(`/trends`);
      break;
    case "open_socio":
      navigate(`/socio`);
      break;
  }
}
```

Important:

- The brain must resolve names/cases to real IDs through SQL.
- Never hallucinate IDs.
- If ambiguous, ask the user to choose.
- If no record found, show a graceful “not found” message.

---

## 10. Frontend-backend connection rules

After adding each backend endpoint, immediately connect it to frontend.

For every feature, follow this order:

1. Add backend route.
2. Add backend service.
3. Add backend schema/response model.
4. Test endpoint with curl.
5. Add frontend API wrapper.
6. Add TypeScript type.
7. Add screen/component.
8. Connect loading/error/empty states.
9. Verify browser network tab returns 200.
10. Verify UI renders real backend data, not mock data.
11. Add chat/voice deep-link if required.
12. Add audit log if sensitive.

---

## 11. Required connection verification matrix

| Feature | Backend endpoint | Frontend API wrapper | Screen/component | Connected? |
|---|---|---|---|---|
| PS2 rings | `/api/network/rings` | `getNetworkRings()` | Network screen | Must verify |
| PS2 case graph | `/api/network/case/:id` | `getCaseNetwork()` | `/network?case=` | Must verify |
| PS2 person graph | `/api/network/person/:id` | `getPersonNetwork()` | `/network?person=` | Must verify |
| PS6 similar cases | `/api/cases/:id/similar` | `getSimilarCases()` | Case Drawer tab | Must verify |
| PS6 case timeline | `/api/cases/:id/timeline` | `getCaseTimeline()` | CaseTimeline | Must verify |
| PS6 person timeline | `/api/persons/:id/timeline` | `getPersonTimeline()` | Profile timeline | Must verify |
| PS5 profile | `/api/persons/:id/profile` | `getPersonProfile()` | Offender Profile | Must verify |
| PS8 hotspots | `/api/forecast/hotspots` | `getForecastHotspots()` | Map/Forecast | Must verify |
| PS8 alerts | `/api/forecast/alerts` | `getForecastAlerts()` | Alert panel | Must verify |
| PS8 backtest | `/api/forecast/backtest` | `getForecastBacktest()` | PAI badge | Must verify |
| PS3 trends | `/api/trends` | `getTrends()` | Trends screen | Must verify |
| PS3 seasonal | `/api/trends/seasonal` | `getSeasonal()` | Seasonal card | Must verify |
| PS3 MO clusters | `/api/mo/clusters` | `getMOClusters()` | MO explorer | Must verify |
| PS4 demographics | `/api/socio/demographics` | `getSocioDemographics()` | Reports/Socio | Must verify |
| PS4 correlation | `/api/socio/correlation` | `getSocioCorrelation()` | Socio Dashboard | Must verify |
| PS4 risk index | `/api/socio/risk-index` | `getSocialRiskIndex()` | Socio Dashboard | Must verify |

---

## 12. Minimum endpoint tests

Create a script:

```txt
scripts/verify_intelligence_endpoints.sh
```

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}
TOKEN=${TOKEN:-}
AUTH=()
if [ -n "$TOKEN" ]; then AUTH=(-H "Authorization: Bearer $TOKEN"); fi

curl -fsS "${BASE}/api/network/rings?limit=3" "${AUTH[@]}" | jq . >/dev/null
curl -fsS "${BASE}/api/forecast/alerts" "${AUTH[@]}" | jq . >/dev/null
curl -fsS "${BASE}/api/trends" "${AUTH[@]}" | jq . >/dev/null
curl -fsS "${BASE}/api/mo/clusters" "${AUTH[@]}" | jq . >/dev/null
curl -fsS "${BASE}/api/socio/demographics?role=Victim" "${AUTH[@]}" | jq . >/dev/null

echo "All intelligence endpoints returned valid JSON"
```

Run this after backend changes.

---

## 13. Frontend integration tests / manual QA

For each feature:

1. Open screen.
2. Check browser Network tab.
3. Confirm endpoint is called.
4. Confirm endpoint returns 200.
5. Confirm response is not mock data.
6. Confirm loading state.
7. Confirm error state by temporarily stopping backend.
8. Confirm empty state by using unlikely filter.
9. Confirm RBAC restrictions.
10. Confirm audit log row created for sensitive view.

---

## 14. Build order recommendation

### Step 1 — PS2 network showpiece

Why first:

- Highest visual impact.
- Existing NetworkX pipeline helps.
- Creates graph and associate data reused by PS5.

Build:

1. Backend graph service.
2. `/api/network/rings`.
3. `/api/network/case/:id`.
4. `/api/network/person/:id`.
5. Frontend Network screen upgrade.
6. Chat deep-link.

---

### Step 2 — PS6 similar cases + timeline

Why second:

- Cheapest.
- Uses existing embeddings.
- Strengthens Case Drawer.

Build:

1. Similar-case service.
2. Timeline service.
3. Case Drawer tabs.
4. Network jump.

---

### Step 3 — PS5 offender profile

Why third:

- Reuses PS2 graph and PS6 timeline.
- Creates powerful dossier demo.

Build:

1. Risk scoring service.
2. Profile endpoint.
3. Offender Profile screen.
4. Deep-link from cards/network/chat.

---

### Step 4 — PS8 forecasting

Why fourth:

- Headline feature but needs careful validation.
- Build after core UI is stable.

Build:

1. Forecast service.
2. Alerts endpoint.
3. Backtest endpoint.
4. Map heat layer.
5. Early-warning panel.

---

### Step 5 — PS3 trends + MO clusters

Why fifth:

- Shares baseline with PS8.
- Adds analytics depth.

Build:

1. Trend endpoint.
2. Seasonal endpoint.
3. MO clusters endpoint.
4. Trends & Patterns screen.

---

### Step 6 — PS4 socio dashboard

Why sixth:

- Requires small new seed table.
- Important but less core to the main investigation flow.

Build:

1. Socio table + seed.
2. Demographics endpoint.
3. Correlation endpoint.
4. Risk index endpoint.
5. Reports embed.
6. Dedicated Socio Dashboard.

---

## 15. What NOT to do

## 15.1 Do not build disconnected mock screens

Bad:

- New page shows fake data.
- No backend endpoint.
- No RBAC.
- No audit.
- No chat connection.

Good:

- Every screen uses real endpoint data.
- Every sensitive action respects RLS/PII.
- Every feature has a chat/voice path.

---

## 15.2 Do not bypass RBAC/RLS

Never query raw DB from feature code in a way that bypasses existing jurisdiction restrictions.

Every service must run under the same authenticated context / scope rules.

---

## 15.3 Do not use demographics for individual risk scoring

Allowed:

- aggregate demographic dashboard,
- district-level policy planning.

Not allowed:

- age/gender directly increasing a person’s risk score.

This is a judge/ethics failure if done wrong.

---

## 15.4 Do not claim causation from socio-economic correlation

Use:

> Correlation does not imply causation. Planning support only.

Do not say:

> Low literacy causes crime.

---

## 15.5 Do not hallucinate graph/risk/similarity results

The AI must not invent:

- person IDs,
- case IDs,
- ring membership,
- risk factors,
- timeline events,
- similar-case explanations.

If the record is not found or ambiguous, ask the user to choose.

---

## 15.6 Do not dump full 100k graphs into frontend

Always use:

- top-N rings,
- 1-hop ego graph,
- case subgraph,
- optional expand to 2 hops.

Never render the entire graph.

---

## 15.7 Do not over-model when rules are better

For hackathon reliability:

- Use rule-based alerts first.
- Use explainable weighted risk formula.
- Use HDBSCAN/Louvain only where it creates real value.
- Avoid training heavy black-box models during final demo week.

---

## 15.8 Do not leave frontend/backend unconnected

A feature is not done if:

- backend exists but UI uses mock data,
- UI exists but endpoint not implemented,
- endpoint path differs from frontend client,
- auth header missing,
- CORS breaks,
- response shape mismatches TypeScript type.

Every feature must pass the connection matrix.

---

## 16. Definition of done for each feature

A feature is done only when:

1. Backend endpoint exists.
2. Endpoint returns typed JSON.
3. Endpoint respects auth/RBAC/PII.
4. Endpoint is curl-tested.
5. Frontend API wrapper exists.
6. Frontend type exists.
7. UI renders real endpoint data.
8. Loading/error/empty states exist.
9. Chat/voice deep-link works where planned.
10. Sensitive view is audit-logged.
11. No mock data remains in production path.
12. Demo path is rehearsed.

---

## 17. Demo script after implementation

1. Officer logs in.
2. Voice: “Show me the network for this chain-snatching case.”
3. App opens Network screen with case subgraph.
4. Ring detected, kingpin highlighted.
5. Click offender → Offender Profile opens.
6. Risk gauge shows High with factor breakdown.
7. Click Similar Cases in Case Drawer.
8. AI shows 5 similar FIRs with why chips.
9. Open Map forecast.
10. Forecast heatmap shows high-risk grid + alert explanation.
11. Open Trends & Patterns.
12. Show MO cluster and seasonal trend with action card.
13. Open Socio Dashboard.
14. Show aggregate demographics + correlation note.
15. Open Audit/Admin.
16. Show sensitive actions logged.

Closing line:

> This is not just a chatbot. It is a governed, explainable investigation intelligence platform.

---

## 18. Final frontend-backend wiring checklist

Before final zip/demo, run this checklist:

- [ ] Backend starts without import errors.
- [ ] Frontend starts without TypeScript errors.
- [ ] API base URL is correct in frontend env.
- [ ] Auth token is sent by every new API wrapper.
- [ ] CORS allows frontend origin.
- [ ] All new endpoints return valid JSON.
- [ ] All frontend screens call the correct endpoints.
- [ ] No screen uses stale mock data.
- [ ] Browser Network tab shows 200 for each feature.
- [ ] Error states render on 401/403/500.
- [ ] Empty states render on no data.
- [ ] RBAC works for restricted screens.
- [ ] PII masking works in profile/network/similar cases.
- [ ] Audit logs are created for profile/network/forecast/socio views.
- [ ] Chat/voice navigation resolves real IDs.
- [ ] Ambiguous chat result asks user to choose.
- [ ] Demo data path has at least one strong ring, profile, forecast alert, similar-case list, trend, and socio chart.

---

## 19. Final build philosophy

Build fewer things completely rather than many things halfway.

Priority if time is tight:

1. PS2 network graph.
2. PS6 similar cases + timeline.
3. PS5 offender profile.
4. PS8 forecast alerts.
5. PS3 trends/MO.
6. PS4 socio dashboard.

But every built feature must be connected end-to-end:

```txt
Database → Backend service → API route → Frontend client → UI component → Chat/voice deep-link → Audit log
```

If any link is missing, the feature is not complete.
