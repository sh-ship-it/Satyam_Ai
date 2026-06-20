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
export type Patrol = { id: number; callsign: string; status: string; lat?: number | null; lng?: number | null; district?: string | null };
export type DispatchResult = {
  id: number; patrol_id: number; patrol_callsign?: string | null; case_id?: number | null;
  scene_lat: number; scene_lng: number; status: string;
  distance_km?: number | null; duration_sec?: number | null; eta_sec?: number | null;
  route: number[][];
};
export type ActiveDispatch = {
  dispatchId: number; patrolId: number; callsign?: string;
  lat: number; lng: number; status: string; phase: string;
  eta_sec: number; progress: number; sceneLat?: number | null; sceneLng?: number | null;
};
export type Signal = { id: number; junction_id: string; lat: number; lng: number; state: "NORMAL" | "GREEN" };
export type ReviewItem = {
  id: number; camera_id: string; candidate_type: string; confidence: number;
  lat?: number | null; lng?: number | null; clip_path?: string | null; frame_path?: string | null;
  status: string; created_at?: string | null;
};
export type CameraInfo = { id: number; camera_id: string; name: string; location?: string | null; lat: number; lng: number; is_active: boolean };

export const responseOps = {
  health: () => opsFetch<{ ok: boolean; module: string; rank: string }>("/health"),
  riskZones: (refresh = false) =>
    opsFetch<{ zones: RiskZone[]; recomputed: boolean; total: number }>(`/risk-zones?refresh=${refresh}`),
  suggestions: () =>
    opsFetch<{ suggestions: Suggestion[]; total: number }>("/suggestions"),
  actSuggestion: (id: number, action: "accept" | "dismiss") =>
    opsFetch<{ ok: boolean }>(`/suggestions/${id}/${action}`, { method: "POST" }),
  patrols: () => opsFetch<Patrol[]>("/patrols"),
  dispatch: (body: { scene_lat: number; scene_lng: number; case_id?: number; patrol_id?: number }) =>
    opsFetch<DispatchResult>("/dispatch", { method: "POST", body: JSON.stringify(body) }),
  simulate: (id: number) => opsFetch<{ ok: boolean }>(`/dispatch/${id}/simulate`, { method: "POST" }),
  activeDispatches: () => opsFetch<{ active: ActiveDispatch[] }>("/dispatch/active"),
  simulateAll: () => opsFetch<{ ok: boolean; started: number }>("/dispatch/simulate-all", { method: "POST" }),
  stopAll: () => opsFetch<{ ok: boolean }>("/dispatch/stop-all", { method: "POST" }),
  signals: () => opsFetch<Signal[]>("/signals"),
  cameras: () => opsFetch<CameraInfo[]>("/cameras"),
  reviewQueue: () => opsFetch<ReviewItem[]>("/review-queue"),
  confirmReview: (id: number, autoDispatch = true) =>
    opsFetch<{ ok: boolean; case_id: number; dispatch_id: number | null }>(`/review-queue/${id}/confirm?auto_dispatch=${autoDispatch}`, { method: "POST" }),
  rejectReview: (id: number) =>
    opsFetch<{ ok: boolean }>(`/review-queue/${id}/reject`, { method: "POST" }),
  corridorState: () =>
    opsFetch<{ active: boolean; count: number; signals: Signal[] }>("/corridor/state"),
  resetCorridor: () => opsFetch<{ ok: boolean }>("/corridor/reset", { method: "POST" }),
  demoActive: () =>
    opsFetch<{ active: { dispatchId: number; lat: number; lng: number; status: string; eta_sec: number }[] }>("/demo/active"),
  stopAllSims: () => opsFetch<{ stopped: number }>("/demo/stop-all", { method: "POST" }),
  cameraStart: (video = "frontend/public/total fight.mp4", camera_id = "CAM-001") =>
    opsFetch<{ ok: boolean; status: string; pid?: number | null }>(`/camera/start?video=${encodeURIComponent(video)}&camera_id=${encodeURIComponent(camera_id)}`, { method: "POST" }),
  cameraStop: () => opsFetch<{ ok: boolean; status: string }>("/camera/stop", { method: "POST" }),
  cameraStatus: () => opsFetch<{ running: boolean; pid?: number | null }>("/camera/status"),
};

/** Open the live ops WebSocket. Returns the socket; caller attaches onmessage. */
export function openOpsSocket(): WebSocket {
  const base = API_BASE.replace(/^http/, "ws");
  const token = getAuthToken() ?? "";
  return new WebSocket(`${base}/api/ops/ws?token=${encodeURIComponent(token)}`);
}
