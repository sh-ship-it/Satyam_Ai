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

export const visionApi = {
  telemetry: () => visionFetch<VisionTelemetry>("/telemetry"),

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
};
