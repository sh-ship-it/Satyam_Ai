// Satyam backend API client.
//
// Talks to the FastAPI service defined in /backend (our own architecture).
// Replaces the previous managed-backend integration. Auth is a bearer JWT
// issued by the backend /auth/login endpoint (demo role switcher in dev).

export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

const TOKEN_KEY = "satyam.token";
const USER_KEY  = "satyam.user";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getCachedUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch { return null; }
}

export function setCachedUser(user: SessionUser | null) {
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders((init.headers as Record<string, string>) ?? {}),
  });
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, `Request failed: ${res.status}`, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Role = "admin" | "investigator" | "analyst" | "viewer";

export type SessionUser = {
  id: string;
  name: string;
  rank: string;
  scope: "state" | "range" | "district" | "station";
  clearance: 1 | 2 | 3 | 4;
  station_id?: number | null;
  district?: string;
  range_name?: string;
};

// Map types
export type HotspotPoint = { lat: number; lng: number; weight: number; label?: string | null };
export type HotspotResponse = { mode: string; points: HotspotPoint[]; total: number };

export type StationRow = {
  station: string;
  firs: number;
  cleared: number;
  top_legal_code: string | null;
  trend: number[];
};
export type StationBreakdownResponse = { rows: StationRow[]; total: number };

export const api = {
  // --- auth ---
  async login(username: string, rank?: string, password = ""): Promise<{ token: string; user: SessionUser }> {
    const out = await request<{ token: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, rank, password }),
    });
    setAuthToken(out.token);
    setCachedUser(out.user);
    return out;
  },
  async register(body: {
    name: string;
    email: string;
    role: string;
    password: string;
    photo_b64?: string;
  }): Promise<{ token: string; user: SessionUser }> {
    const out = await request<{ token: string; user: SessionUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setAuthToken(out.token);
    setCachedUser(out.user);
    return out;
  },
  me(): Promise<SessionUser> {
    return request<SessionUser>("/auth/me");
  },
  logout() {
    setAuthToken(null);
    setCachedUser(null);
  },


  // --- read APIs (grounded; backed by Postgres + RLS) ---
  cases(params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/cases${q ? `?${q}` : ""}`);
  },
  caseById(caseId: string, lang = "en") {
    return request(`/cases/${encodeURIComponent(caseId)}?lang=${encodeURIComponent(lang)}`);
  },
  mapHotspots(body: Record<string, unknown>): Promise<HotspotResponse> {
    return request<HotspotResponse>("/map/hotspots", { method: "POST", body: JSON.stringify(body) });
  },
  stationBreakdown(body: Record<string, unknown>): Promise<StationBreakdownResponse> {
    return request<StationBreakdownResponse>("/map/station-breakdown", { method: "POST", body: JSON.stringify(body) });
  },
  offenderTrail(body: { person_id?: string; entity_name?: string }): Promise<{ person_id: string; label: string; points: { lat: number; lng: number; date?: string; fir_number?: string; crime_type?: string; station?: string }[] }> {
    return request("/map/offender-trail", { method: "POST", body: JSON.stringify(body) });
  },
  network(body: Record<string, unknown>) {

    return request("/network/ego", { method: "POST", body: JSON.stringify(body) });
  },
  buildReport(body: Record<string, unknown>) {
    return request("/reports/build", { method: "POST", body: JSON.stringify(body) });
  },
  audit(params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/audit${q ? `?${q}` : ""}`);
  },

  /** Switch the active database source on the backend for this session.
   *  "cloud" → Neon (DATABASE_URL), "local" → localhost Postgres. */
  setDbSource(source: "cloud" | "local"): Promise<{ db_source: string }> {
    return request("/settings/db-source", {
      method: "POST",
      body: JSON.stringify({ source }),
    });
  },
};

export type TtsResult = { audio_base64: string; mime: string; provider: string };
export type SttResult = { transcript: string; detected_lang: string | null; provider: string };

/** Synthesize speech via the backend voice provider (Sarvam by default). */
export async function ttsSynthesize(
  text: string,
  lang: "en" | "kn",
  backend?: "sarvam" | "google" | "bhashini",
): Promise<TtsResult> {
  // TASK 1 verification: log the provider actually being used for TTS.
  console.debug("[tts] ttsSynthesize provider=", backend ?? loadEngineSettingsForDebug(), "lang=", lang);
  return request<TtsResult>("/voice/tts", {
    method: "POST",
    body: JSON.stringify({ text, lang, backend }),
  });
}

/** Transcribe a recorded audio blob via the backend voice provider.
 *  Sends lang="auto" so Saaras v3 auto-detects the spoken language. */
export async function sttTranscribe(
  audio: Blob,
  lang: "en" | "kn" | "auto" = "auto",
): Promise<SttResult> {
  const fd = new FormData();
  // Use the actual MIME type as filename hint so Sarvam/Google can sniff format.
  const ext = audio.type.includes("webm") ? "webm"
    : audio.type.includes("ogg") ? "ogg"
    : audio.type.includes("mp4") ? "mp4"
    : "wav";
  fd.append("file", audio, `audio.${ext}`);
  fd.append("lang", lang);
  const token = getAuthToken();
  // No content-type header — browser sets the multipart boundary.
  const res = await fetch(`${API_BASE}/voice/stt`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new ApiError(res.status, `STT failed: ${res.status}`);
  return (await res.json()) as SttResult;
}

/** Internal: read voiceBackend from localStorage for debug logging only. */
function loadEngineSettingsForDebug(): string {
  try {
    const raw = localStorage.getItem("satyam.engine-settings");
    if (raw) return JSON.parse(raw).voiceBackend ?? "sarvam";
  } catch {}
  return "sarvam";
}
// The backend streams grounded answers token-by-token over SSE.
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; status: "start" | "end"; detail?: string }
  | { type: "citation"; ref: string; label: string }
  | { type: "blocked"; reason: string }
  | { type: "done"; conversation_id: string }
  | { type: "error"; message: string };

export async function streamChat(
  body: {
    message: string;
    conversation_id?: string;
    lang?: "en" | "kn";
    brain_engine?: "gemini" | "groq" | "local";
    sql_engine?: "gemini" | "qwen3-coder-next" | "local";
    voice_backend?: "sarvam" | "google" | "bhashini";
  },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Chat stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as ChatEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
