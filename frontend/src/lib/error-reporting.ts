// Lightweight client-side error reporting hook.
// Wire this to your own observability sink (e.g. an OpenTelemetry collector or
// the Langfuse browser SDK). Kept vendor-neutral on purpose.

export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  // TODO: forward to the Satyam telemetry backend.
  console.error("[satyam] client error", {
    error,
    route: window.location.pathname,
    ...context,
  });
}
