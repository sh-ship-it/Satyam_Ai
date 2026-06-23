// Pure, framework-free static-gesture classifier.
//
// Given the 21 MediaPipe HandLandmarker points (normalized to [0,1], origin at
// the top-left of the image), this module decides which *static* hand pose the
// user is holding. It is deliberately stateless and side-effect free so it can
// be unit-tested and reused from any controller.
//
// NOTE: swipe gestures are NOT detected here — those are motion-based and are
// computed over time by the GestureController. This module only sees a single
// frame and returns one of the static GestureName poses (or null).
//
// All geometry is done in normalized image space. We scale every distance by
// the hand's "palm width" so the thresholds stay roughly invariant to how close
// the hand is to the camera (a hand near the lens has large pixel distances; a
// far hand has small ones, but the *ratios* to palm width stay stable).

import type { Landmark, GestureName } from "@/input/types";

// MediaPipe HandLandmarker landmark indices (see API docs).
const WRIST = 0;
const THUMB_MCP = 2;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

import {
  PINCH_THRESH,
  TWO_FINGER_JOIN_THRESH,
} from "@/config/handsFreeConfig";

/** 2-D Euclidean distance in normalized image space. */
function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Average of the wrist + the four finger MCP (knuckle) joints. This is a stable
 * "center of the palm" used as the tracking anchor for swipe motion (the index
 * tip jitters too much to track translation reliably).
 */
export function palmCenter(landmarks: Landmark[]): { x: number; y: number } {
  const pts = [
    landmarks[WRIST],
    landmarks[INDEX_MCP],
    landmarks[MIDDLE_MCP],
    landmarks[RING_MCP],
    landmarks[PINKY_MCP],
  ];
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

/**
 * Classify a single frame of hand landmarks into a static gesture.
 *
 * Returns null when there is no hand, the landmark array is incomplete, or the
 * pose doesn't match any known gesture.
 */
export function classifyGesture(landmarks: Landmark[]): GestureName {
  // Guard: need the full 21-point hand to do reliable geometry.
  if (landmarks == null || landmarks.length < 21) return null;

  const wrist = landmarks[WRIST];
  const thumbMcp = landmarks[THUMB_MCP];
  const thumbTip = landmarks[THUMB_TIP];
  const indexMcp = landmarks[INDEX_MCP];
  const indexPip = landmarks[INDEX_PIP];
  const indexTip = landmarks[INDEX_TIP];
  const middlePip = landmarks[MIDDLE_PIP];
  const middleTip = landmarks[MIDDLE_TIP];
  const ringPip = landmarks[RING_PIP];
  const ringTip = landmarks[RING_TIP];
  const pinkyMcp = landmarks[PINKY_MCP];
  const pinkyPip = landmarks[PINKY_PIP];
  const pinkyTip = landmarks[PINKY_TIP];

  // Palm width: span across the knuckles. The +1e-3 avoids divide-by-zero when
  // the hand is edge-on and the knuckles project onto the same point.
  const palm = dist(indexMcp, pinkyMcp) + 1e-3;

  // A finger is "extended" when its tip is meaningfully farther from the wrist
  // than its PIP joint is. The palm*0.15 margin rejects half-curled fingers.
  const fingerExt = (tip: Landmark, pip: Landmark): boolean =>
    dist(tip, wrist) > dist(pip, wrist) + palm * 0.15;

  const indexExt = fingerExt(indexTip, indexPip);
  const middleExt = fingerExt(middleTip, middlePip);
  const ringExt = fingerExt(ringTip, ringPip);
  const pinkyExt = fingerExt(pinkyTip, pinkyPip);

  // Thumb is geometrically different (it sticks out sideways), so it gets its
  // own heuristics. thumbExtRatio: how far the tip is from the index knuckle.
  // thumbReach: how far the tip is from its own MCP (how "open" the thumb is).
  const thumbExtRatio = dist(thumbTip, indexMcp) / palm;
  const thumbReach = dist(thumbTip, thumbMcp) / palm;
  const thumbExt = thumbExtRatio > 1.1;
  const thumbPoseExt = thumbExt || thumbReach > 0.65;

  // Pinch: thumb tip and index tip nearly touching (scaled by palm width).
  const pinchDist = dist(thumbTip, indexTip) / palm;

  // For thumb-up/down we want the four fingers mostly curled into a fist with
  // only the thumb sticking out.
  const extendedCount =
    (indexExt ? 1 : 0) +
    (middleExt ? 1 : 0) +
    (ringExt ? 1 : 0) +
    (pinkyExt ? 1 : 0);
  const mostlyFingersCurled = extendedCount <= 1;

  // Thumb vertical orientation relative to its own MCP and the index knuckle.
  // Remember origin is top-left, so a *smaller* y means *higher* on screen.
  const thumbDeltaY = thumbTip.y - thumbMcp.y;
  const thumbUpRaw =
    thumbDeltaY < -palm * 0.45 && thumbTip.y < indexMcp.y - palm * 0.15;
  const thumbDownRaw =
    thumbDeltaY > palm * 0.45 && thumbTip.y > indexMcp.y + palm * 0.15;

  // "Three" can be expressed several ways depending on which three fingers the
  // user raises, so we accept a few equivalent shapes.
  const extCount = extendedCount;
  const threeNonThumb = extCount === 3;
  const threeWithThumb =
    thumbExt && indexExt && middleExt && !ringExt && !pinkyExt;
  const loveYouSign =
    thumbExt && indexExt && !middleExt && !ringExt && pinkyExt;

  // ── Classification order: return the first matching pose. ──────────────────

  // 1) Pinch wins over everything (it's the click gesture and must be snappy).
  if (pinchDist < PINCH_THRESH) return "pinch";

  // 2) Thumb up / down — only when the rest of the hand is balled up.
  if (mostlyFingersCurled && thumbPoseExt) {
    if (thumbUpRaw) return "thumb_up";
    if (thumbDownRaw) return "thumb_down";
  }

  // 3) Open palm — all five digits extended.
  if (indexExt && middleExt && ringExt && pinkyExt && thumbExt) {
    return "open_palm";
  }

  // 4) Three fingers (several accepted variants).
  if (threeNonThumb || threeWithThumb || loveYouSign) return "three";

  // 4.5) Two-finger "air-mouse" — index + middle EXTENDED and JOINED (their
  // tips close together). This is a deliberate cursor-control pose, distinct
  // from the spread peace/victory sign handled next. The controller uses the
  // midpoint of the two tips as a steadier cursor anchor.
  const twoFingerJoin = dist(indexTip, middleTip) / palm;
  if (indexExt && middleExt && !ringExt && !pinkyExt && twoFingerJoin < TWO_FINGER_JOIN_THRESH) {
    return "two_finger";
  }

  // 5) Peace / victory — index + middle only (spread apart).
  if (indexExt && middleExt && !ringExt && !pinkyExt) return "peace";

  // 6) Point — index only (drives the cursor).
  if (indexExt && !middleExt && !ringExt && !pinkyExt) return "point";

  // 7) Fist — nothing extended at all.
  if (!indexExt && !middleExt && !ringExt && !pinkyExt && !thumbExt) {
    return "fist";
  }

  // 8) Ambiguous pose.
  return null;
}
