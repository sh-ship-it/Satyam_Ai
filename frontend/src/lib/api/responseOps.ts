/** Typed API wrapper for the Response-Ops module (predictive deployment,
 *  dispatch, green corridor, camera review). Isolated from existing clients. */
import { API_BASE, getAuthToken, ApiError } from "./client";

export async function opsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api/ops${path}`, {
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

export type RiskZone = {
  id: number; grid_key: string; center_lat: number; center_lng: number;
  risk_score: number; risk_label: string; incident_count: number;
  peak_hour?: number | null; reasons: string[];
};
export type Suggestion = {
  id: number; risk_zone_id: number; patrol_id?: number | null; patrol_callsign?: string | null;
  from_lat?: number | null; from_lng?: number | null; to_lat: number; to_lng: number;
  distance_km?: number | null; response_improve_sec?: number | null; status: string; reasons: string[];
};

export const responseOps = {
  health: () => opsFetch<{ ok: boolean; module: string; rank: string }>("/health"),
  riskZones: (refresh = false) =>
    opsFetch<{ zones: RiskZone[]; recomputed: boolean; total: number }>(`/risk-zones?refresh=${refresh}`),
  suggestions: () =>
    opsFetch<{ suggestions: Suggestion[]; total: number }>("/suggestions"),
  actSuggestion: (id: number, action: "accept" | "dismiss") =>
    opsFetch<{ ok: boolean }>(`/suggestions/${id}/${action}`, { method: "POST" }),
};
