/** Owns the Vision snapshot and the live transport.
 *
 *  Transport is deliberately dual, not primary-plus-error-path. WebSocket support
 *  on the deployment target (Catalyst AppSail) is unconfirmed, so polling is a
 *  first-class citizen chosen by capability detection:
 *
 *    1. open the socket; if it stays up past a settle window, transport = "live"
 *    2. on failure or repeated drops, transport = "polling" and refetch on a timer
 *    3. if even the snapshot fetch fails, transport = "offline"
 *
 *  The active transport is surfaced in the HUD. A frozen map that silently stopped
 *  updating is far worse than one that says POLLING.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  openVisionSocket,
  visionApi,
  type DispatchPoint,
  type PatrolPoint,
  type SignalPoint,
  type VisionSnapshot,
} from "@/lib/api/vision";
import type { TransportState } from "./chrome/VisionTopBar";

const POLL_MS = 2500; // matches the cadence LiveOperationsMap already uses
const WS_SETTLE_MS = 1500; // open this long without a drop => trust it
const WS_MAX_ATTEMPTS = 3;
const BBOX_REFETCH_DEBOUNCE_MS = 600;

type OpsEvent = {
  type: string;
  dispatchId?: number;
  patrolId?: number;
  lat?: number;
  lng?: number;
  etaSec?: number;
  status?: string;
  junctionId?: string;
};

export type VisionData = {
  snapshot: VisionSnapshot | null;
  transport: TransportState;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useVisionData(
  bbox: [number, number, number, number] | null,
  district: string | null = null,
): VisionData {
  const [snapshot, setSnapshot] = useState<VisionSnapshot | null>(null);
  const [transport, setTransport] = useState<TransportState>("offline");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Latest bbox without making the fetch callback change identity on every pan.
  const bboxRef = useRef(bbox);
  bboxRef.current = bbox;
  const districtRef = useRef(district);
  districtRef.current = district;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      const snap = await visionApi.snapshot({
        ...(bboxRef.current ? { bbox: bboxRef.current } : {}),
        ...(districtRef.current ? { district: districtRef.current } : {}),
      });
      if (!mountedRef.current) return;
      setSnapshot(snap);
      setError(null);
      // Only claim OFFLINE->POLLING here; the socket owns the "live" promotion.
      setTransport((t) => (t === "offline" ? "polling" : t));
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setTransport("offline");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // ── Initial load + refetch when the viewport settles ──────────────────────
  useEffect(() => {
    const id = setTimeout(() => void fetchSnapshot(), BBOX_REFETCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // Refetch on a *coarse* bbox signature so small pans do not thrash the API.
  }, [
    fetchSnapshot,
    bbox ? bbox.map((n) => n.toFixed(1)).join(",") : "none",
    district ?? "",
  ]);

  // ── Live socket with backoff, falling back to polling ─────────────────────
  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const startPolling = () => {
      if (pollTimer || disposed) return;
      setTransport((t) => (t === "offline" ? t : "polling"));
      pollTimer = setInterval(() => void fetchSnapshot(), POLL_MS);
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    /** Patch the in-memory snapshot from a live event.
     *  Deliberately additive and tolerant: an event for an unknown id is ignored
     *  rather than triggering a full refetch, so a burst cannot stampede the API. */
    const applyEvent = (msg: OpsEvent) => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        const layers = prev.layers;
        switch (msg.type) {
          case "PATROL_LOCATION": {
            if (!layers.patrols || msg.lat == null || msg.lng == null) return prev;
            const patrols = layers.patrols.data.map((p: PatrolPoint) =>
              p.id === msg.patrolId
                ? { ...p, lat: msg.lat as number, lng: msg.lng as number, status: "EN_ROUTE" }
                : p,
            );
            const dispatches = layers.dispatches
              ? layers.dispatches.data.map((d: DispatchPoint) =>
                  d.id === msg.dispatchId
                    ? { ...d, eta_sec: msg.etaSec ?? d.eta_sec, status: "EN_ROUTE" }
                    : d,
                )
              : [];
            return {
              ...prev,
              layers: {
                ...layers,
                patrols: { ...layers.patrols, data: patrols },
                ...(layers.dispatches
                  ? { dispatches: { ...layers.dispatches, data: dispatches } }
                  : {}),
              },
            };
          }
          case "DISPATCH_STATUS": {
            if (!layers.dispatches) return prev;
            const done = msg.status === "COMPLETED" || msg.status === "CANCELLED";
            const data = done
              ? layers.dispatches.data.filter((d: DispatchPoint) => d.id !== msg.dispatchId)
              : layers.dispatches.data.map((d: DispatchPoint) =>
                  d.id === msg.dispatchId ? { ...d, status: msg.status ?? d.status } : d,
                );
            return {
              ...prev,
              layers: {
                ...layers,
                dispatches: { ...layers.dispatches, data, count: data.length },
              },
            };
          }
          case "SIGNAL_GREEN":
          case "SIGNAL_RESET": {
            if (!layers.signals) return prev;
            const data = layers.signals.data.map((s: SignalPoint) =>
              msg.type === "SIGNAL_RESET"
                ? { ...s, state: "NORMAL" }
                : s.junction_id === msg.junctionId
                  ? { ...s, state: "GREEN" }
                  : s,
            );
            return {
              ...prev,
              layers: { ...layers, signals: { ...layers.signals, data } },
            };
          }
          case "INCIDENT_CANDIDATE":
            // A new camera detection changes the review queue, which the snapshot
            // does not carry. Refetch is the honest response.
            void fetchSnapshot();
            return prev;
          default:
            return prev;
        }
      });
    };

    const connect = () => {
      if (disposed) return;
      attempt += 1;
      let socket: WebSocket;
      try {
        socket = openVisionSocket();
      } catch {
        startPolling();
        return;
      }
      ws = socket;

      socket.onopen = () => {
        // Do not trust the socket immediately: AppSail may accept the upgrade and
        // drop it moments later, which would flap the badge between LIVE and
        // POLLING. Only promote after it survives the settle window.
        settleTimer = setTimeout(() => {
          if (disposed || socket.readyState !== WebSocket.OPEN) return;
          stopPolling();
          setTransport("live");
        }, WS_SETTLE_MS);
      };

      socket.onmessage = (ev) => {
        let msg: OpsEvent;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        applyEvent(msg);
      };

      const degrade = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = null;
        if (disposed) return;
        startPolling();
        if (attempt < WS_MAX_ATTEMPTS) {
          // Exponential-ish backoff. After the cap we stay on polling for the
          // session rather than reconnecting forever against a server that has
          // shown it will not hold the socket.
          retryTimer = setTimeout(connect, 1200 * 2 ** (attempt - 1));
        }
      };

      socket.onerror = degrade;
      socket.onclose = degrade;
    };

    // Poll from the start so data flows even if the socket never opens, then let
    // a healthy socket take over and switch polling off.
    startPolling();
    connect();

    return () => {
      disposed = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (retryTimer) clearTimeout(retryTimer);
      stopPolling();
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      }
    };
  }, [fetchSnapshot]);

  return { snapshot, transport, loading, error, refetch: () => void fetchSnapshot() };
}
