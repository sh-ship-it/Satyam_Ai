// Face-presence auto-lock controller.
//
// Watches the (shared) webcam via the MediaPipe FaceDetector. When no officer
// face has been seen for `absenceSeconds`, it locks the session: it dispatches
// a window "satyam:session-lock" event (the LockOverlay blurs PII + blocks the
// UI) and records a tamper-evident audit entry. If a face reappears while
// locked it only announces presence ("satyam:session-present") — it never
// auto-unlocks, because resuming a privileged session must be an explicit human
// action. The locked flag re-arms only when an explicit "satyam:session-unlock"
// event arrives (dispatched by the overlay's Resume button).
//
// Client-only: all detector/camera work runs inside effects so SSR never
// touches WASM or getUserMedia.

import { useEffect, useRef } from "react";

import { attachVideo, releaseCamera } from "@/input/sharedCamera";
import { getFaceDetector } from "@/input/visionLoader";
import { PRESENCE_POLL_MS } from "@/config/handsFreeConfig";
import { logSecurityEvent } from "@/lib/api/security";

export function FacePresenceController(props: {
  absenceSeconds: number;
  lang: "en" | "kn";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Latest props in refs so the long-lived interval always reads fresh values
  // without being torn down/recreated on every prop change.
  const absenceSecondsRef = useRef(props.absenceSeconds);
  const langRef = useRef(props.lang);
  absenceSecondsRef.current = props.absenceSeconds;
  langRef.current = props.lang;

  // Presence bookkeeping. Refs (not state) — these change every poll and must
  // not trigger re-renders.
  const lastSeenAtRef = useRef<number>(Date.now());
  const lockedRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let detector: any = null;

    // Re-arm the lock when the session is explicitly unlocked from the overlay.
    const onUnlock = () => {
      lockedRef.current = false;
      lastSeenAtRef.current = Date.now();
    };
    window.addEventListener("satyam:session-unlock", onUnlock as EventListener);

    (async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        await attachVideo(video);
        detector = await getFaceDetector();
      } catch {
        // Camera/model unavailable — fail open (no lock) rather than break UI.
        return;
      }
      if (cancelled) return;

      // Seed the timer so we don't lock instantly before the first detection.
      lastSeenAtRef.current = Date.now();

      intervalId = setInterval(() => {
        const v = videoRef.current;
        if (!v || !detector) return;

        let facePresent = false;
        try {
          const res = detector.detectForVideo(v, performance.now());
          facePresent = !!res && Array.isArray(res.detections) && res.detections.length >= 1;
        } catch {
          // Transient detector error — treat as no reading this tick.
          return;
        }

        const now = Date.now();

        if (facePresent) {
          lastSeenAtRef.current = now;
          // A face is back while the session is locked: announce presence so
          // the overlay can hint "welcome back", but DO NOT auto-unlock.
          if (lockedRef.current) {
            window.dispatchEvent(
              new CustomEvent("satyam:session-present", { detail: {} }),
            );
          }
          return;
        }

        // No face this tick: check whether the absence threshold elapsed.
        const absenceMs = absenceSecondsRef.current * 1000;
        if (!lockedRef.current && now - lastSeenAtRef.current >= absenceMs) {
          lockedRef.current = true;
          window.dispatchEvent(
            new CustomEvent("satyam:session-lock", { detail: { reason: "absence" } }),
          );
          void logSecurityEvent(
            "auto_lock",
            `No officer detected for ${absenceSecondsRef.current}s — session locked`,
          );
        }
      }, PRESENCE_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
      window.removeEventListener("satyam:session-unlock", onUnlock as EventListener);
      try {
        releaseCamera();
      } catch {
        /* noop */
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, []);

  return (
    <video
      ref={videoRef}
      aria-hidden="true"
      muted
      playsInline
      style={{
        position: "fixed",
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
        top: 0,
        left: 0,
      }}
    />
  );
}
