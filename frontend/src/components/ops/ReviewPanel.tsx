import { useEffect, useRef, useState } from "react";
import {
  Video, Play, Square, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Camera, Activity,
} from "lucide-react";
import { responseOps, openOpsSocket, type ReviewItem } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

// Crime type → label shown in the summary card.
// You can extend this map with your own types later.
const CRIME_LABELS: Record<string, string> = {
  weapon: "Weapon / Firearm",
  gun: "Firearm Detected",
  fight: "Physical Altercation",
  crowd: "Crowd Disturbance",
  vehicle_anomaly: "Suspicious Vehicle",
  accident: "Road Accident",
  theft: "Theft / Snatching",
};

type FeedItem = { id: string; text: string; ts: string; type: string; confidence: number };

export function ReviewPanel() {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [streamPort, setStreamPort] = useState(8089);
  const [streamReady, setStreamReady] = useState(false);
  // Bumping this key forces the <img> to remount and retry the MJPEG URL.
  const [streamKey, setStreamKey] = useState(0);
  const [detections, setDetections] = useState<FeedItem[]>([]);
  const [queueItems, setQueueItems] = useState<ReviewItem[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Check if YOLO is already running on mount ────────────────────────────
  useEffect(() => {
    responseOps.cameraStatus().then((s) => {
      setRunning(s.running);
      if (s.running && s.stream_port) setStreamPort(s.stream_port);
    }).catch(() => {});
  }, []);

  // When running starts (or port changes), begin retrying the MJPEG stream
  // every 1.5 s until it connects. This handles the race-condition where the
  // MJPEG server hasn't fully bound its socket yet when the <img> first loads.
  useEffect(() => {
    if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
    if (!running) { setStreamReady(false); return; }
    // Immediately bump key so a fresh <img> mounts right away.
    setStreamKey((k) => k + 1);
    setStreamReady(false);
    // Retry every 1.5 s if the stream hasn't connected yet.
    retryRef.current = setInterval(() => {
      setStreamKey((k) => k + 1);
    }, 1500);
    // Chrome doesn't reliably fire onLoad for multipart MJPEG streams.
    // After a 4-second grace period, assume the stream is live and clear
    // the "Connecting…" overlay so the video frame shows through.
    const graceTimer = setTimeout(() => {
      setStreamReady(true);
      if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
    }, 4000);
    return () => {
      clearTimeout(graceTimer);
      if (retryRef.current) clearInterval(retryRef.current);
    };
  }, [running, streamPort]);

  // If onLoad fires before the grace timer, clear the overlay immediately
  // and stop retrying.
  useEffect(() => {
    if (streamReady && retryRef.current) {
      clearInterval(retryRef.current);
      retryRef.current = null;
    }
  }, [streamReady]);

  // ── Poll camera/status while running ────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (running) {
      pollRef.current = setInterval(() => {
        responseOps.cameraStatus()
          .then((s) => { if (!s.running) { setRunning(false); } })
          .catch(() => {});
      }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [running]);

  // ── WebSocket — receive INCIDENT_CANDIDATE live ──────────────────────────
  useEffect(() => {
    const ws = openOpsSocket();
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "INCIDENT_CANDIDATE") {
          const label = CRIME_LABELS[msg.candidateType ?? "vehicle_anomaly"] ?? msg.candidateType ?? "Incident";
          const conf = Math.round((msg.confidence ?? 0) * 100);
          setDetections((prev) => [
            {
              id: `${Date.now()}-${Math.random()}`,
              text: `${label} detected at ${msg.cameraId ?? "CAM"} (${conf}% confidence)`,
              ts: new Date().toLocaleTimeString(),
              type: msg.candidateType ?? "vehicle_anomaly",
              confidence: msg.confidence ?? 0,
            },
            ...prev,
          ].slice(0, 20));
          // Refresh the review queue so the card appears.
          loadQueue();
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, []);

  async function loadQueue() {
    setQueueBusy(true);
    try { setQueueItems(await responseOps.reviewQueue()); }
    finally { setQueueBusy(false); }
  }
  useEffect(() => { loadQueue(); }, []);

  async function startCamera() {
    setStatusBusy(true);
    try {
      const res = await responseOps.cameraStart("frontend/public/total fight.mp4", "CAM-001");
      if (res.stream_port) setStreamPort(res.stream_port);
      setStreamReady(false);
      setRunning(true);
      setDetections([]);
    } catch (err: any) {
      alert(err?.message ?? "Could not start the YOLO detector. Check that frontend/public/total fight.mp4 exists and the backend is running.");
    } finally { setStatusBusy(false); }
  }

  async function stopCamera() {
    setStatusBusy(true);
    try { await responseOps.cameraStop(); } catch { /* ignore */ }
    finally { setRunning(false); setStreamReady(false); setStatusBusy(false); }
  }

  async function confirmItem(id: number) {
    const res = await responseOps.confirmReview(id, true);
    setQueueItems((p) => p.filter((i) => i.id !== id));
    if (res.dispatch_id) {
      try { await responseOps.simulate(res.dispatch_id); } catch { /* best-effort */ }
    }
  }
  async function rejectItem(id: number) {
    await responseOps.rejectReview(id);
    setQueueItems((p) => p.filter((i) => i.id !== id));
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      {/* LEFT: video feed placeholder + controls */}
      <div className="flex flex-col gap-3">
        {/* Camera control bar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-extrabold">
            <Camera className="h-4 w-4" /> {t("Live CCTV Feed")}
          </div>
          <div className={`inline-flex h-2 w-2 rounded-full ${running ? "animate-pulse bg-[#00C896]" : "bg-muted-foreground/40"}`} />
          <span className="text-[11px] font-bold text-muted-foreground">{running ? t("YOLO RUNNING") : t("STOPPED")}</span>
          <div className="ml-auto flex gap-2">
            {!running ? (
              <button
                onClick={startCamera}
                disabled={statusBusy}
                className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--success,#00C896)] px-3 py-1.5 text-xs font-bold text-foreground disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" /> {statusBusy ? t("Starting…") : t("Start")}
              </button>
            ) : (
              <button
                onClick={stopCamera}
                disabled={statusBusy}
                className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground disabled:opacity-50"
              >
                <Square className="h-3.5 w-3.5" /> {statusBusy ? t("Stopping…") : t("Stop")}
              </button>
            )}
          </div>
        </div>

        {/* Video preview area — live annotated MJPEG stream from YOLO */}
        <div className="relative flex h-[340px] items-center justify-center overflow-hidden rounded-[8px] border-2 border-foreground bg-black">
          {running ? (
            <>
              <img
                key={`mjpeg-${streamPort}-${streamKey}`}
                src={`http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:${streamPort}/stream`}
                alt="Live YOLO detection stream"
                onLoad={() => setStreamReady(true)}
                onError={() => setStreamReady(false)}
                className="h-full w-full object-contain"
              />
              <div className="absolute left-2 top-2 flex items-center gap-1 rounded-[4px] bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE · YOLO
              </div>
              {!streamReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 animate-spin opacity-50" />
                  <p className="text-xs">{t("Connecting to detection stream…")}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Video className="h-10 w-10 opacity-30" />
              <p className="text-xs">{t("Press Start to run YOLO on the preloaded video")}</p>
              <p className="text-[10px] text-muted-foreground/60">{t("total fight.mp4 · loops until stopped")}</p>
            </div>
          )}
        </div>

        {/* Live detection feed */}
        <div className="rounded-[8px] border-2 border-foreground p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-extrabold">
            <Activity className="h-4 w-4" /> {t("Detection Feed")}
            {detections.length > 0 && <span className="ml-auto text-[11px] font-normal text-muted-foreground">{detections.length} {t("events")}</span>}
          </div>
          {detections.length === 0 ? (
            <p className="text-xs text-muted-foreground">{running ? t("Waiting for detections…") : t("Start the detector to see events here.")}</p>
          ) : (
            <ul className="flex max-h-[160px] flex-col gap-1 overflow-y-auto">
              {detections.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 border-b border-foreground/10 pb-1 text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className={`h-3 w-3 shrink-0 ${d.confidence >= 0.8 ? "text-destructive" : "text-warning"}`} />
                    {d.text}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{d.ts}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* RIGHT: incident review queue */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-extrabold">
            <Video className="h-4 w-4" /> {t("Incident Review Queue")}
          </h3>
          <button onClick={loadQueue} disabled={queueBusy}
            className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground px-2 py-1 text-xs font-bold hover:bg-muted">
            <RefreshCw className={`h-3.5 w-3.5 ${queueBusy ? "animate-spin" : ""}`} /> {t("Refresh")}
          </button>
        </div>

        {queueItems.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {running ? t("YOLO is scanning. Flagged incidents will appear here.") : t("No candidates awaiting review.")}
          </p>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto">
          {queueItems.map((it) => {
            const conf = Math.round(it.confidence * 100);
            const isHigh = it.confidence >= 0.8;
            const label = CRIME_LABELS[it.candidate_type] ?? it.candidate_type;
            return (
              <div key={it.id} className="rounded-[8px] border-2 border-foreground bg-background p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-extrabold">
                    <AlertTriangle className="h-4 w-4" /> {it.camera_id}
                  </span>
                  <span className={`rounded-[4px] px-2 py-0.5 text-[10px] font-bold ${isHigh ? "bg-destructive text-destructive-foreground" : "bg-warning text-foreground"}`}>
                    {isHigh ? t("High") : t("Medium")} · {conf}%
                  </span>
                </div>
                <div className="mb-1 text-xs font-semibold">{label}</div>
                {it.frame_path ? (
                  <img src={it.frame_path} alt="frame" className="mb-2 h-24 w-full rounded-[4px] border-2 border-foreground object-cover" />
                ) : (
                  <div className="mb-2 flex h-16 items-center justify-center rounded-[4px] border-2 border-foreground bg-muted text-[11px] text-muted-foreground">{t("No preview")}</div>
                )}
                {it.lat && <div className="mb-2 text-[10px] text-muted-foreground">{it.lat.toFixed(4)}, {it.lng?.toFixed(4)}</div>}
                <div className="flex gap-2">
                  <button onClick={() => confirmItem(it.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--success,#00C896)] px-2 py-1 text-xs font-bold text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t("Confirm → file case")}
                  </button>
                  <button onClick={() => rejectItem(it.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold hover:bg-muted">
                    <XCircle className="h-3.5 w-3.5" /> {t("Reject")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
