/**
 * Best-effort security telemetry client.
 *
 * Posts security UX events (auto-lock, presence changes, manual lock) to the
 * backend so they land in the tamper-evident audit log. This is fire-and-forget
 * telemetry: it must NEVER throw into the UI, so all errors are swallowed.
 *
 * Mirrors the auth/fetch pattern used by the other clients in this folder
 * (see client.ts for API_BASE + bearer-token header).
 */
import { API_BASE, getAuthToken } from "./client";

/**
 * Record a security event in the backend audit log. Best-effort only —
 * failures (offline, 4xx/5xx, no token) are intentionally ignored.
 */
export async function logSecurityEvent(eventType: string, detail: string): Promise<void> {
  try {
    const token = getAuthToken();
    await fetch(`${API_BASE}/security/event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ event_type: eventType, detail }),
      // Allow the request to complete even if the page is unloading.
      keepalive: true,
    });
  } catch {
    /* swallow — telemetry must never break the UI */
  }
}
