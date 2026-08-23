/** Typed client for the Vision screen.
 *
 *  Vision talks to exactly ONE client. Hotspots live in client.ts, patrols and
 *  cameras in responseOps.ts, risk cells in intelligence.ts; a screen needing all
 *  of them would otherwise make three round trips across three base paths. A bare
 *  `SELECT 1` to the managed database measures 250-500 ms from the API, so three
 *  sequential calls burn over a second before anything renders.
 */
import { API_BASE, ApiError, getAuthToken } from "./client";

async function visionFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api/vision${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `vision${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export type VisionTelemetry = {
  ok: boolean;
  module: string;
  uptime_sec: number;
  db_latency_ms: number | null;
  db_source: string;
  ops_enabled: boolean;
  ws_clients: number;
  /** False when the connected DB role bypasses row-level security. */
  rls_enforced: boolean;
  rls_note: string | null;
  coords_coarsened: boolean;
  rank: string;
  scope: string;
  clearance: number;
};

/** live | cached | seeded | derived | simulated. Mirrors the backend union. */
export type Provenance = "live" | "cached" | "seeded" | "derived" | "simulated";

export type VisionLayerEnvelope<T> = {
  provenance: Provenance;
  provider: string | null;
  count: number;
  truncated: boolean;
  note: string | null;
  /** Present only when the layer is unavailable; a reason fit to show a user. */
  degraded: string | null;
  data: T[];
};

/** Compact [lat, lng, weight] triple. Objects would roughly triple the payload
 *  at the 20k-cell cap for no extra information. */
export type CrimeCell = [number, number, number];

export type RiskZonePoint = {
  id: number;
  lat: number;
  lng: number;
  score: number;
  label: string;
  incidents: number;
  peak_hour: number | null;
  reasons: string[];
};

export type PatrolPoint = {
  id: number;
  callsign: string;
  status: string;
  lat: number;
  lng: number;
  district: string | null;
};

export type DispatchPoint = {
  id: number;
  case_id: number | null;
  patrol_id: number;
  status: string;
  scene_lat: number;
  scene_lng: number;
  eta_sec: number | null;
  distance_km: number | null;
  /** GeoJSON order: [lng, lat] pairs. deck.gl wants the same, so no flipping. */
  route: [number, number][];
};

export type SignalPoint = {
  id: number;
  junction_id: string;
  lat: number;
  lng: number;
  state: string;
};

export type CameraPoint = {
  id: number;
  camera_id: string;
  name: string;
  location: string | null;
  lat: number;
  lng: number;
  is_active: boolean;
  /** FABRICATED optics — ops_cameras has no bearing/fov/range columns yet. */
  bearing_deg: number;
  fov_deg: number;
  range_m: number;
  optics_fabricated: boolean;
};

export type VisionSnapshot = {
  bbox: [number, number, number, number] | null;
  coords_coarsened: boolean;
  layers: {
    crime_hex?: VisionLayerEnvelope<CrimeCell>;
    risk_zones?: VisionLayerEnvelope<RiskZonePoint>;
    patrols?: VisionLayerEnvelope<PatrolPoint>;
    dispatches?: VisionLayerEnvelope<DispatchPoint>;
    signals?: VisionLayerEnvelope<SignalPoint>;
    cameras?: VisionLayerEnvelope<CameraPoint>;
  };
  /** e.g. ["patrols:ops_disabled"] — machine-readable companion to the
   *  per-layer `degraded` strings. */
  degraded: string[];
};

export type VisionEntityKind = "patrol" | "camera" | "risk_zone" | "dispatch";

export type VisionEntity = {
  kind: VisionEntityKind;
  id: number;
  title: string;
  [key: string]: unknown;
};

export type SnapshotParams = {
  bbox?: [number, number, number, number];
  layers?: string[];
  crime_type?: string;
  district?: string;
};

/** Open the live event stream.
 *
 *  Points at the Response-Ops WebSocket because that is where patrol, dispatch
 *  and signal events are already broadcast; Vision does not need a second hub.
 *
 *  Two caveats worth keeping visible rather than buried:
 *   - The JWT travels in the query string because a browser WebSocket cannot set
 *     headers. Query strings land in proxy and access logs. Tracked as P4-4.
 *   - Availability on the deploy target is unconfirmed, which is exactly why the
 *     caller treats polling as an equal transport rather than an error path.
 */
export function openVisionSocket(): WebSocket {
  const base = API_BASE.replace(/^http/, "ws"); // https -> wss
  const token = getAuthToken() ?? "";
  return new WebSocket(`${base}/api/ops/ws?token=${encodeURIComponent(token)}`);
}

/** Sibling of visionFetch for routes mounted under /api rather than /api/vision.
 *
 *  The district panel reuses the existing socio endpoints instead of adding a
 *  third backend route for data that is already served. Keeping the call here
 *  rather than importing `intelligence.ts` preserves the rule that Vision talks
 *  to exactly one client — the client is allowed to know about more than one
 *  router, the *screen* is not. */
async function intelFetch<T>(path: string): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type DistrictRisk = {
  district: string;
  social_risk_score: number;
  drivers: string[];
};

export type DistrictSocio = {
  district: string;
  crime_rate: number;
  literacy_rate: number | null;
  urbanization_percent: number | null;
  income_index: number | null;
};

export type DistrictIntel = {
  district: string;
  social_risk_score: number | null;
  drivers: string[];
  crime_rate: number | null;
  literacy_rate: number | null;
  urbanization_percent: number | null;
  income_index: number | null;
};

/** Pearson coefficients the backend computes over the district table.
 *
 *  These are measured, not modelled: intelligence_service runs the correlation
 *  in SQL/Python over `district_socio_economic_indicators` joined to case counts.
 *  Null when a column has too few non-null pairs to correlate. */
export type SocioCorrelations = {
  crime_rate_vs_literacy: number | null;
  crime_rate_vs_urbanization: number | null;
  crime_rate_vs_income: number | null;
};

export type DistrictIntelResult = {
  districts: DistrictIntel[];
  /** Absent when the caller's clearance did not clear the L3 correlation endpoint. */
  correlations: SocioCorrelations | null;
  /** How many districts the coefficients were computed over — a correlation
   *  without its n is not interpretable. */
  correlationN: number;
  /** Human-readable reasons a column is missing, e.g. a clearance refusal.
   *  Rendered in the panel rather than leaving blank cells unexplained. */
  degraded: string[];
};

/** Radius choices offered in the location popup, in metres.
 *
 *  Measured against the live data to make sure each step is actually useful
 *  rather than decorative: at Bengaluru's centre 200 m returns 3 cases, 800 m
 *  returns 81, 1.5 km returns 289 and 3 km returns 1,070. In a rural district
 *  800 m typically returns 1. The backend clamps to 100..5000 m regardless. */
export const LOCATION_RADIUS_CHOICES = [200, 400, 800, 1500, 3000] as const;
export const LOCATION_RADIUS_DEFAULT_M = 800;

export type LocationCrimeType = { crime_type: string; count: number };

export type LocationCase = {
  case_id: number;
  fir_number: string;
  fir_year: number | null;
  crime_type: string;
  status: string | null;
  station_name: string | null;
  district: string | null;
  place_of_offence: string | null;
  incident_date: string | null;
  distance_m: number;
};

export type VisionLocation = {
  lat: number;
  lng: number;
  radius_m: number;
  coords_coarsened: boolean;
  /** Taken from the nearest recorded case, not a gazetteer — there is no reverse
   *  geocoder in this stack, so these are null when nothing is recorded nearby. */
  district: string | null;
  station_name: string | null;
  place_label: string | null;
  total_cases: number;
  crime_types: LocationCrimeType[];
  status_breakdown: Record<string, number>;
  peak_hours: number[];
  recent: LocationCase[];
  truncated: boolean;
  note: string | null;
};

export const visionApi = {
  telemetry: () => visionFetch<VisionTelemetry>("/telemetry"),

  /** District intelligence, joined from the two existing socio endpoints.
   *
   *  They carry different clearance floors — risk-index needs L2, correlation
   *  needs L3 — so a mid-clearance officer legitimately gets one and not the
   *  other. `allSettled` keeps the panel useful in that case instead of failing
   *  whole, and the refusal is reported in `degraded` rather than silently
   *  presenting as empty columns. */
  districtIntel: async (): Promise<DistrictIntelResult> => {
    const [riskRes, socioRes] = await Promise.allSettled([
      intelFetch<{ areas: DistrictRisk[] }>("/socio/risk-index"),
      intelFetch<{ scatter: DistrictSocio[]; correlations?: SocioCorrelations }>(
        "/socio/correlation",
      ),
    ]);

    const degraded: string[] = [];
    const byDistrict = new Map<string, DistrictIntel>();

    const ensure = (district: string): DistrictIntel => {
      let row = byDistrict.get(district);
      if (!row) {
        row = {
          district,
          social_risk_score: null,
          drivers: [],
          crime_rate: null,
          literacy_rate: null,
          urbanization_percent: null,
          income_index: null,
        };
        byDistrict.set(district, row);
      }
      return row;
    };

    if (riskRes.status === "fulfilled") {
      for (const a of riskRes.value.areas ?? []) {
        const row = ensure(a.district);
        row.social_risk_score = a.social_risk_score;
        row.drivers = a.drivers ?? [];
      }
    } else {
      const e = riskRes.reason;
      degraded.push(
        e instanceof ApiError && e.status === 403
          ? "Social risk index needs clearance L2."
          : "Social risk index unavailable.",
      );
    }

    let correlations: SocioCorrelations | null = null;
    let correlationN = 0;

    if (socioRes.status === "fulfilled") {
      for (const s of socioRes.value.scatter ?? []) {
        const row = ensure(s.district);
        row.crime_rate = s.crime_rate;
        row.literacy_rate = s.literacy_rate;
        row.urbanization_percent = s.urbanization_percent;
        row.income_index = s.income_index;
      }
      correlations = socioRes.value.correlations ?? null;
      correlationN = (socioRes.value.scatter ?? []).length;
    } else {
      const e = socioRes.reason;
      degraded.push(
        e instanceof ApiError && e.status === 403
          ? "Socio-economic indicators need clearance L3."
          : "Socio-economic indicators unavailable.",
      );
    }

    // Ordered by crime rate, not by social_risk_score. The score is a log
    // function of raw case count, which at this data scale saturates — every
    // district in the top-10 currently returns 99, so sorting by it produces an
    // arbitrary order. crime_rate is per-capita and has real spread, and it
    // covers all 40 districts rather than only the 10 that carry a score.
    const districts = [...byDistrict.values()].sort(
      (a, b) => (b.crime_rate ?? -1) - (a.crime_rate ?? -1),
    );
    return { districts, correlations, correlationN, degraded };
  },

  snapshot: (params: SnapshotParams = {}) => {
    const q = new URLSearchParams();
    if (params.bbox) q.set("bbox", params.bbox.join(","));
    if (params.layers?.length) q.set("layers", params.layers.join(","));
    if (params.crime_type) q.set("crime_type", params.crime_type);
    if (params.district) q.set("district", params.district);
    const qs = q.toString();
    return visionFetch<VisionSnapshot>(`/snapshot${qs ? `?${qs}` : ""}`);
  },

  entity: (kind: VisionEntityKind, id: string | number) =>
    visionFetch<VisionEntity>(`/entity/${kind}/${encodeURIComponent(String(id))}`),

  /** What is recorded near one clicked point. */
  location: (lat: number, lng: number, radiusM = LOCATION_RADIUS_DEFAULT_M) => {
    const q = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius_m: String(radiusM),
    });
    return visionFetch<VisionLocation>(`/location?${q.toString()}`);
  },
};
