// Central configuration for the hands-free multimodal layer.
// Holds the gesture-classifier thresholds (ported from the reference logic),
// the timing constants for vote/hold/swipe, the CDN/model locations for
// MediaPipe Tasks, and the persisted user settings helpers.

import type { HandsFreeSettings } from "@/input/types";

// ── MediaPipe Tasks assets ──────────────────────────────────────────────────
// WASM fileset + model bundles. CDN by default (zero local setup); override via
// VITE_MP_WASM_BASE / VITE_MP_HAND_MODEL / VITE_MP_FACE_MODEL for offline demos.
export const MP_WASM_BASE =
  (import.meta as any).env?.VITE_MP_WASM_BASE ||
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
export const MP_HAND_MODEL =
  (import.meta as any).env?.VITE_MP_HAND_MODEL ||
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const MP_FACE_MODEL =
  (import.meta as any).env?.VITE_MP_FACE_MODEL ||
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

// ── Camera request (single shared stream) ───────────────────────────────────
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: 960, height: 540 },
  audio: false,
};

// ── Gesture geometry thresholds (ported from reference implementation) ───────
export const PINCH_THRESH = 0.38;
// Index + middle tip distance / palm-width below this = the two fingers are
// "joined" → the two-finger air-mouse cursor pose (vs. a spread peace/V sign).
export const TWO_FINGER_JOIN_THRESH = 0.5;
export const SWIPE_DX = 0.15;
export const SWIPE_MS = 700;
export const SWIPE_MAX_DY = 0.18;
export const SWIPE_MIN_SPEED = 0.35;
export const HOLD_MS = 400;
export const VOTE_MIN = 2;
export const VOTE_WINDOW = 5;

// ── Action latching / cooldowns ──────────────────────────────────────────────
export const GESTURE_COOLDOWN_MS = 2000; // same static gesture cannot refire
export const CLICK_COOLDOWN_MS = 300;
export const DOUBLE_CLICK_MS = 500;
// Two-finger air-mouse "dwell click": hold the cursor still over a target for
// DWELL_MS to fire a left click. DWELL_MOVE_TOL is how far (px) the cursor may
// drift while dwelling before the timer resets.
export const DWELL_MS = 1500;
export const DWELL_MOVE_TOL = 45;
export const MOUSE_SMOOTHING = 0.55;
export const CURSOR_PAD = 0.18; // dead-band so edges of frame map to screen edges

// ── Face presence ─────────────────────────────────────────────────────────────
export const FACE_MIN_CONFIDENCE = 0.5;
export const PRESENCE_POLL_MS = 400; // how often the detector runs for presence

// ── Settings persistence ──────────────────────────────────────────────────────
const KEY = "satyam.handsfree";

export const defaultHandsFree: HandsFreeSettings = {
  enabled: false,
  gestures: true,
  wakeWord: false,
  presenceLock: false,
  absenceSeconds: 20,
  showCursor: true,
  speakFeedback: false,
};

export function loadHandsFree(): HandsFreeSettings {
  if (typeof window === "undefined") return defaultHandsFree;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultHandsFree, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultHandsFree;
}

export function saveHandsFree(s: HandsFreeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    // Notify mounted controllers to re-read settings without a full reload.
    window.dispatchEvent(new CustomEvent("satyam:handsfree-settings", { detail: s }));
  } catch {
    /* ignore */
  }
}
