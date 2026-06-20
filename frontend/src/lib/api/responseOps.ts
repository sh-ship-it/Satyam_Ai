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

export const responseOps = {
  health: () => opsFetch<{ ok: boolean; module: string; rank: string }>("/health"),
};
