// Satyam backend API client.
//
// Talks to the FastAPI service defined in /backend (our own architecture).
// Replaces the previous managed-backend integration. Auth is a bearer JWT
// issued by the backend /auth/login endpoint (demo role switcher in dev).

export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8000";

const TOKEN_KEY = "satyam.token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
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
  role: Role;
  station_id?: string | null;
  jurisdiction_id?: string | null;
};

export const api = {
  // --- auth ---
  async login(username: string, role?: Role): Promise<{ token: string; user: SessionUser }> {
    const out = await request<{ token: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, role }),
    });
    setAuthToken(out.token);
    return out;
  },
  me(): Promise<SessionUser> {
    return request<SessionUser>("/auth/me");
  },
  logout() {
    setAuthToken(null);
  },

  // --- read APIs (grounded; backed by Postgres + RLS) ---
  cases(params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request(`/cases${q ? `?${q}` : ""}`);
  },
  caseById(caseId: string) {
    return request(`/cases/${encodeURIComponent(caseId)}`);
  },
  mapHotspots(body: Record<string, unknown>) {
    return request("/map/hotspots", { method: "POST", body: JSON.stringify(body) });
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
};

// --- chat streaming (Server-Sent Events) ---
// The backend streams grounded answers token-by-token over SSE.
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; status: "start" | "end"; detail?: string }
  | { type: "citation"; ref: string; label: string }
  | { type: "blocked"; reason: string }
  | { type: "done"; conversation_id: string }
  | { type: "error"; message: string };

export async function streamChat(
  body: { message: string; conversation_id?: string; lang?: "en" | "kn" },
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
