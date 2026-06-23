// Lazy singleton loaders for MediaPipe Tasks vision models.
// Uses @mediapipe/tasks-vision (current MediaPipe Tasks API) — GPU-accelerated,
// one package for both HandLandmarker (21 landmarks) and FaceDetector.
// Everything is client-only and dynamically imported so SSR never touches WASM.

import {
  MP_WASM_BASE,
  MP_HAND_MODEL,
  MP_FACE_MODEL,
  FACE_MIN_CONFIDENCE,
} from "@/config/handsFreeConfig";

// Types are intentionally loose (any) to avoid pulling the heavy module into
// the SSR/type graph; the dynamic import below provides the real runtime.
let _fileset: any | null = null;
let _hand: any | null = null;
let _face: any | null = null;
let _handPending: Promise<any> | null = null;
let _facePending: Promise<any> | null = null;

async function getFileset(): Promise<any> {
  if (_fileset) return _fileset;
  const vision = await import("@mediapipe/tasks-vision");
  _fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM_BASE);
  return _fileset;
}

/** Get (or build) the shared HandLandmarker running in VIDEO mode. */
export async function getHandLandmarker(): Promise<any> {
  if (_hand) return _hand;
  if (_handPending) return _handPending;
  _handPending = (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await getFileset();
    _hand = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_HAND_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.7,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    _handPending = null;
    return _hand;
  })();
  return _handPending;
}

/** Get (or build) the shared FaceDetector running in VIDEO mode (presence). */
export async function getFaceDetector(): Promise<any> {
  if (_face) return _face;
  if (_facePending) return _facePending;
  _facePending = (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await getFileset();
    _face = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: FACE_MIN_CONFIDENCE,
    });
    _facePending = null;
    return _face;
  })();
  return _facePending;
}

/** Release the heavy detectors (called when the master switch goes off). */
export function closeVision(): void {
  try {
    _hand?.close?.();
  } catch {
    /* noop */
  }
  try {
    _face?.close?.();
  } catch {
    /* noop */
  }
  _hand = null;
  _face = null;
}
