/**
 * Typed API wrapper for all intelligence feature endpoints (PS2/PS5/PS6/PS8/PS3/PS4).
 * All calls use the authenticated request helper from client.ts.
 */
import { API_BASE, getAuthToken, ApiError } from "./client";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type SearchResult = {
  type: "person" | "case";
  id: number;
  label: string;
  sub: string;
  gender?: string | null;
  age?: number | null;
  district?: string | null;
  case_count?: number;
  crime_types?: string;
  status?: string;
  crime_type?: string;
};

export type RingNode = { id: string; person_id: number; label: string; type: string; risk_label: string; offense_count: number; is_kingpin: boolean; community_id: string };
export type RingEdge = { source: string; target: string; type: string; shared_case_count: number; weight: number };
export type GraphResponse = { nodes: RingNode[]; edges: RingEdge[] };
export type RingSummary = { ring_id: string; label: string; member_count: number; case_count: number; severity_score: number; recency_score: number; kingpin_person_id: number | null; top_crime_types: string[]; districts: string[]; why_flagged: string[] };
export type RingsResponse = { rings: RingSummary[] };

export type SimilarCaseMatch = { case_id: number; fir_number: string | null; crime_type: string | null; district: string | null; similarity_percent: number; why_similar: string[] };
export type SimilarCasesResponse = { case_id: number; matches: SimilarCaseMatch[] };

export type TimelineEvent = { date: string | null; type: string; title: string; source_column: string };
export type CaseTimelineResponse = { case_id: number; events: TimelineEvent[] };
export type PersonTimelineEvent = { date: string | null; case_id: number; role: string; crime_type: string | null; status: string | null };
export type PersonTimelineResponse = { person_id: number; events: PersonTimelineEvent[] };

export type RiskFactor = { factor: string; score: number; reason: string };
export type RiskProfile = { score: number; label: string; breakdown: RiskFactor[]; notice: string };
export type MOFingerprint = { top_sections: string[]; top_crime_types: string[]; top_motives: string[]; time_of_day: string | null };
export type RingMembership = { ring_id: string; label: string };
export type KnownAssociate = { person_id: number; shared_case_count: number };
export type OffenderProfileResponse = { person_id: number; display_name: string; risk: RiskProfile; mo_fingerprint: MOFingerprint; ring_membership: RingMembership | null; known_associates: KnownAssociate[] };

export type ForecastCell = { cell_id: string; lat: number; lng: number; risk_score: number; risk_level: string; crime_type: string; why: string[] };
export type ForecastHotspotsResponse = { as_of_date: string; horizon_days: number; cells: ForecastCell[] };
export type ForecastAlert = { alert_id: string; crime_type: string; district: string; risk_level: string; patrol_window: string; why: string; recommended_action: string; fairness_note: string };
export type ForecastAlertsResponse = { alerts: ForecastAlert[]; as_of_date: string | null };
export type BacktestResponse = { metric: string; hit_rate_top_10_percent_cells: number; window: string; explanation: string };

export type TrendPoint = { period: string; crime_type: string; district: string; count: number };
export type TrendsResponse = { series: TrendPoint[]; deltas: { qoq_percent: number | null; yoy_percent: number | null } };
export type SeasonalPeak = { period: string; lift_percent: number; recommended_action: string };
export type SeasonalResponse = { crime_type: string; district: string; seasonal_peaks: SeasonalPeak[] };
export type MOCluster = { cluster_id: string; label: string; case_count: number; top_sections: string[]; top_crime_types: string[]; representative_case_id: number | null; action_hint: string };
export type MOClustersResponse = { clusters: MOCluster[] };

export type AgeBucket = { bucket: string; count: number };
export type GenderCount = { gender: string; count: number };
export type DistrictCount = { district: string; count: number };
export type SocioDemographicsResponse = { age_buckets: AgeBucket[]; gender: GenderCount[]; districts: DistrictCount[]; notice: string };
export type CorrelationPoint = { district: string; crime_rate: number; literacy_rate: number | null; urbanization_percent: number | null; income_index: number | null };
export type SocioCorrelationResponse = { scatter: CorrelationPoint[]; correlations: Record<string, number | null>; notice: string };
export type RiskArea = { district: string; social_risk_score: number; drivers: string[] };
export type SocialRiskIndexResponse = { areas: RiskArea[] };

// ── API functions ──────────────────────────────────────────────────────────

export const intelligence = {
  // PS2 — Network
  getNetworkRings: (limit = 10, crime_type?: string, district?: string) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (crime_type) p.set("crime_type", crime_type);
    if (district) p.set("district", district);
    return apiFetch<RingsResponse>(`/api/network/rings?${p}`);
  },
  getCaseNetwork: (caseId: number) =>
    apiFetch<GraphResponse>(`/api/network/case/${caseId}`),
  getPersonNetwork: (personId: number, depth = 1) =>
    apiFetch<GraphResponse>(`/api/network/person/${personId}?depth=${depth}`),

  // PS6 — Similar cases + timelines
  getSimilarCases: (caseId: number, limit = 5) =>
    apiFetch<SimilarCasesResponse>(`/api/cases/${caseId}/similar?limit=${limit}`),
  searchSimilarCases: (query: string, limit = 5) =>
    apiFetch<SimilarCasesResponse>("/api/cases/similar/search", {
      method: "POST", body: JSON.stringify({ query, limit }),
    }),
  getCaseTimeline: (caseId: number) =>
    apiFetch<CaseTimelineResponse>(`/api/cases/${caseId}/timeline`),
  getPersonTimeline: (personId: number) =>
    apiFetch<PersonTimelineResponse>(`/api/persons/${personId}/timeline`),

  // PS5 — Offender profile
  getPersonProfile: (personId: number) =>
    apiFetch<OffenderProfileResponse>(`/api/persons/${personId}/profile`),

  // Search — unified person + case autocomplete
  searchPersonsAndCases: (q: string, limit = 12) =>
    apiFetch<SearchResult[]>(`/api/cases/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // PS8 — Forecasting
  getForecastHotspots: (params?: URLSearchParams) =>
    apiFetch<ForecastHotspotsResponse>(`/api/forecast/hotspots${params ? "?" + params : ""}`),
  getForecastAlerts: () =>
    apiFetch<ForecastAlertsResponse>("/api/forecast/alerts"),
  getForecastBacktest: () =>
    apiFetch<BacktestResponse>("/api/forecast/backtest"),

  // PS3 — Trends & MO
  getTrends: (params?: URLSearchParams) =>
    apiFetch<TrendsResponse>(`/api/trends${params ? "?" + params : ""}`),
  getSeasonal: (crime_type?: string, district?: string) => {
    const p = new URLSearchParams();
    if (crime_type) p.set("crime_type", crime_type);
    if (district) p.set("district", district);
    return apiFetch<SeasonalResponse>(`/api/trends/seasonal?${p}`);
  },
  getMOClusters: () =>
    apiFetch<MOClustersResponse>("/api/mo/clusters"),

  // PS4 — Socio dashboard
  getSocioDemographics: (params?: URLSearchParams) =>
    apiFetch<SocioDemographicsResponse>(`/api/socio/demographics${params ? "?" + params : ""}`),
  getSocioCorrelation: () =>
    apiFetch<SocioCorrelationResponse>("/api/socio/correlation"),
  getSocialRiskIndex: () =>
    apiFetch<SocialRiskIndexResponse>("/api/socio/risk-index"),
};
