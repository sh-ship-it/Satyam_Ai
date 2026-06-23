// GestureController — the runtime "hand" of the hands-free layer.
//
// It owns a single hidden <video>, runs MediaPipe HandLandmarker on a
// requestAnimationFrame loop, and turns hand poses into either:
//   • a real DOM cursor + click (point / pinch), or
//   • a high-level GestureIntent dispatched on the window event bus
//     ("satyam:gesture") for the Shell to execute (navigation, scroll, etc.).
//
// Design notes
// ────────────
// • Pure classification (static poses) lives in gestureClassifier.ts; this file
//   only adds the *temporal* logic: vote-smoothing, swipe motion detection,
//   hold-to-fire latching, cooldowns, and the click sequence.
// • The camera preview is mirrored (selfie view), so the cursor X is flipped:
//   when you move your hand right, the dot moves right *as you see it*.
// • All browser work is guarded behind `typeof window` and run inside effects,
//   so this is SSR-safe under TanStack Start.
// • The rAF closure must always read the *latest* props/settings, so those are
//   mirrored into refs rather than captured directly.

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { attachVideo, releaseCamera } from "@/input/sharedCamera";
import { getHandLandmarker } from "@/input/visionLoader";
import { classifyGesture, palmCenter } from "@/input/gestureClassifier";
import { computeGestureIntent } from "@/input/gestureActions";
import type { GestureName, GestureContext, HandsFreeSettings } from "@/input/types";
import {
  SWIPE_DX,
  SWIPE_MS,
  SWIPE_MAX_DY,
  SWIPE_MIN_SPEED,
  HOLD_MS,
  VOTE_MIN,
  VOTE_WINDOW,
  GESTURE_COOLDOWN_MS,
  CLICK_COOLDOWN_MS,
  DOUBLE_CLICK_MS,
  DWELL_MS,
  DWELL_MOVE_TOL,
  MOUSE_SMOOTHING,
  CURSOR_PAD,
  loadHandsFree,
} from "@/config/handsFreeConfig";

type Props = {
  route: string;
  lang: "en" | "kn";
  presentation: boolean;
};

/** One sample of palm motion used for swipe detection. */
type SwipeSample = { x: number; y: number; t: number; gesture: GestureName };

/** Clamp a number into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Approx 30fps detection budget — MediaPipe doesn't need every rAF tick. */
const DETECT_INTERVAL_MS = 1000 / 30;

export function GestureController(props: Props): JSX.Element {
  // The hidden video the detector reads from.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The on-screen cursor dot (moved imperatively for zero re-render cost).
  const cursorRef = useRef<HTMLDivElement | null>(null);
  // The dwell-click progress ring drawn around the cursor while two fingers are
  // joined and held still (fills over DWELL_MS, then fires a left click).
  const dwellRingRef = useRef<HTMLDivElement | null>(null);

  // We only need React state for the cursor's *visibility* (a settings toggle);
  // its position is driven imperatively in the rAF loop.
  const [showCursor, setShowCursor] = useState<boolean>(false);

  // ── Latest props/settings, mirrored into refs for the rAF closure ──────────
  const routeRef = useRef(props.route);
  const langRef = useRef(props.lang);
  const presentationRef = useRef(props.presentation);
  const settingsRef = useRef<HandsFreeSettings>(loadHandsFree());
  routeRef.current = props.route;
  langRef.current = props.lang;
  presentationRef.current = props.presentation;

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let rafId = 0;

    // MediaPipe handle (loose `any` — see visionLoader). Internal only.
    let hand: any = null;

    // ── Cursor smoothing + latest position ───────────────────────────────────
    // smoothed* hold the lerped viewport position; cursor is the public latest.
    let smoothedX = window.innerWidth / 2;
    let smoothedY = window.innerHeight / 2;
    let cursor: { x: number; y: number } | null = null;
    let cursorSeeded = false;

    // ── Static-gesture vote history (last VOTE_WINDOW frames) ─────────────────
    const history: GestureName[] = [];

    // ── Swipe motion samples (palm center over the last SWIPE_MS ms) ──────────
    let swipeSamples: SwipeSample[] = [];
    let swipeCooldownUntil = 0;

    // ── Hold-to-fire latch state ──────────────────────────────────────────────
    let heldGesture: GestureName = null;
    let heldSince = 0;
    let heldFired = false; // already fired this hold? (one-shot)
    // Per-gesture cooldown so the same static gesture can't spam.
    const lastFiredAt = new Map<Exclude<GestureName, null>, number>();

    // ── Click / double-click bookkeeping ──────────────────────────────────────
    let lastClickAt = 0;
    let lastClickTarget: Element | null = null;
    let lastClickTargetAt = 0;

    // ── Two-finger dwell-click state ──────────────────────────────────────────
    // While the 'two_finger' pose is held and the cursor stays within
    // DWELL_MOVE_TOL of the anchor, the timer fills; at DWELL_MS it fires one
    // click. It won't re-fire until the cursor moves away (new anchor).
    let dwellAnchor: { x: number; y: number } | null = null;
    let dwellStart = 0;
    let dwellFired = false;

    // ── Detection throttle ─────────────────────────────────────────────────────
    let lastDetectAt = 0;

    // ── Settings live-update listener ──────────────────────────────────────────
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail as HandsFreeSettings | undefined;
      const next = detail ?? loadHandsFree();
      settingsRef.current = next;
      setShowCursor(Boolean(next.showCursor));
    };
    window.addEventListener("satyam:handsfree-settings", onSettings as EventListener);
    // Seed initial cursor visibility from persisted settings.
    setShowCursor(Boolean(settingsRef.current.showCursor));

    /**
     * Fire a high-level intent for the Shell to execute. Pinch/point are handled
     * locally and never reach here.
     */
    const dispatchIntent = (gesture: Exclude<GestureName, null>) => {
      const ctx: GestureContext = {
        route: routeRef.current,
        lang: langRef.current,
        presentation: presentationRef.current,
        cursor,
      };
      const intent = computeGestureIntent(gesture, ctx);
      if (!intent) return;
      window.dispatchEvent(
        new CustomEvent("satyam:gesture", { detail: { intent, gesture } }),
      );
    };

    /**
     * Perform a real click at the current cursor target by dispatching the full
     * pointer + mouse event sequence a genuine click produces, so React handlers
     * (which often listen on pointerdown/up or click) all fire correctly.
     * Honors the click cooldown and upgrades to dblclick on a fast repeat over
     * the same element.
     */
    const performClick = (x: number, y: number) => {
      const now = performance.now();
      if (now - lastClickAt < CLICK_COOLDOWN_MS) return;

      const target = document.elementFromPoint(x, y);
      if (!target) return;
      lastClickAt = now;

      const base: MouseEventInit & PointerEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        view: window,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
      };

      const pointer = (type: string) =>
        target.dispatchEvent(new PointerEvent(type, base));
      const mouse = (type: string) =>
        target.dispatchEvent(new MouseEvent(type, base));

      // Full sequence mirroring a physical mouse click.
      pointer("pointerover");
      pointer("pointerenter");
      pointer("pointerdown");
      mouse("mousedown");
      pointer("pointerup");
      mouse("mouseup");
      mouse("click");
      pointer("pointerout");
      pointer("pointerleave");

      // Double-click: same element pinched again within the window.
      if (target === lastClickTarget && now - lastClickTargetAt < DOUBLE_CLICK_MS) {
        target.dispatchEvent(new MouseEvent("dblclick", base));
        lastClickTarget = null;
        lastClickTargetAt = 0;
      } else {
        lastClickTarget = target;
        lastClickTargetAt = now;
      }
    };

    /** Majority vote over the recent history; null if no pose clears VOTE_MIN. */
    const voteStable = (): GestureName => {
      const counts = new Map<GestureName, number>();
      for (const g of history) counts.set(g, (counts.get(g) ?? 0) + 1);
      let top: GestureName = null;
      let topCount = 0;
      for (const [g, c] of counts) {
        if (c > topCount) {
          top = g;
          topCount = c;
        }
      }
      if (topCount < VOTE_MIN) return null;
      return top;
    };

    /**
     * Motion-based swipe detection over the palm-center samples. Returns a
     * swipe gesture when a clean, fast, mostly-horizontal motion is seen.
     */
    const detectSwipe = (now: number): GestureName => {
      if (now < swipeCooldownUntil) return null;
      if (swipeSamples.length < 2) return null;

      const first = swipeSamples[0];
      const last = swipeSamples[swipeSamples.length - 1];
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const dt = last.t - first.t;
      if (dt <= 0) return null;

      // Reject if a thumb pose snuck into the window — thumb up/down are scrolls,
      // not swipes, and the hand reshaping looks like horizontal travel.
      for (const s of swipeSamples) {
        if (s.gesture === "thumb_up" || s.gesture === "thumb_down") return null;
      }

      // Mostly horizontal only.
      if (Math.abs(dy) >= SWIPE_MAX_DY) return null;

      // Direction must be consistent across the whole window (no back-and-forth).
      const sign = Math.sign(dx);
      if (sign === 0) return null;
      let prev = first.x;
      for (let i = 1; i < swipeSamples.length; i++) {
        const step = swipeSamples[i].x - prev;
        // Allow tiny jitter against the trend, but no real reversal.
        if (Math.sign(step) === -sign && Math.abs(step) > SWIPE_DX * 0.25) {
          return null;
        }
        prev = swipeSamples[i].x;
      }

      const speed = Math.abs(dx) / (dt / 1000);
      if (speed <= SWIPE_MIN_SPEED) return null;

      if (Math.abs(dx) > SWIPE_DX && Math.abs(dy) < SWIPE_MAX_DY && speed > SWIPE_MIN_SPEED) {
        // Mirrored preview: a leftward hand motion (dx<0 in image space) reads
        // as a rightward swipe to the user. Keep this mapping as-is.
        swipeCooldownUntil = now + GESTURE_COOLDOWN_MS;
        swipeSamples = [];
        return dx < 0 ? "swipe_right" : "swipe_left";
      }
      return null;
    };

    /** The per-frame work, throttled to ~30fps. */
    const onFrame = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(onFrame);

      const video = videoRef.current;
      if (!video || !hand) return;

      const now = performance.now();
      if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
      lastDetectAt = now;

      try {
        const res = hand.detectForVideo(video, now);
        const lm = res?.landmarks?.[0] as
          | { x: number; y: number; z?: number }[]
          | undefined;

        if (!lm) {
          // No hand → decay everything so stale state can't fire on re-entry.
          history.length = 0;
          swipeSamples = [];
          heldGesture = null;
          heldFired = false;
          dwellAnchor = null;
          dwellStart = 0;
          dwellFired = false;
          if (dwellRingRef.current) dwellRingRef.current.style.opacity = "0";
          return;
        }

        // ── CLASSIFY first so the cursor can choose the right anchor ──────────
        const g = classifyGesture(lm);

        // ── CURSOR: map the fingertip anchor to the viewport ──────────────────
        // Two cursor poses are supported:
        //   • 'point'      (index only)            → anchor = index tip (lm 8)
        //   • 'two_finger' (index+middle joined)   → anchor = midpoint of tips
        //     8 & 12. The midpoint is steadier than a single tip, giving a
        //     calmer "air-mouse" feel many users prefer.
        // A dead-band (CURSOR_PAD) maps the usable center of the frame to the
        // full screen, and the edges of the frame snap to the screen edges.
        const p =
          g === "two_finger"
            ? { x: (lm[8].x + lm[12].x) / 2, y: (lm[8].y + lm[12].y) / 2 }
            : lm[8];
        const usable = 1 - 2 * CURSOR_PAD;
        const fx = clamp((p.x - CURSOR_PAD) / usable, 0, 1);
        const fy = clamp((p.y - CURSOR_PAD) / usable, 0, 1);
        // Flip X for the mirrored selfie preview.
        const targetX = (1 - fx) * window.innerWidth;
        const targetY = fy * window.innerHeight;

        if (!cursorSeeded) {
          // Jump straight to the first reading so the dot doesn't slide in from
          // the screen center on the very first frame.
          smoothedX = targetX;
          smoothedY = targetY;
          cursorSeeded = true;
        } else {
          // Exponential smoothing (lerp). MOUSE_SMOOTHING in [0,1): higher = more
          // smoothing / more lag. new = old + (1 - s) * (target - old).
          const a = 1 - MOUSE_SMOOTHING;
          smoothedX += (targetX - smoothedX) * a;
          smoothedY += (targetY - smoothedY) * a;
        }
        cursor = { x: smoothedX, y: smoothedY };

        const dot = cursorRef.current;
        if (dot && settingsRef.current.showCursor) {
          dot.style.transform = `translate(${smoothedX}px, ${smoothedY}px) translate(-50%, -50%)`;
        }

        // ── TWO-FINGER DWELL CLICK ────────────────────────────────────────────
        // When the joined two-finger pose is held still over a target for
        // DWELL_MS, fire a left click — no spread/peace gesture needed, so it
        // never conflicts with the navigate-to-Console peace sign. A ring around
        // the cursor fills to show progress.
        const ring = dwellRingRef.current;
        if (g === "two_finger" && !presentationRef.current && cursor) {
          // (Re)start the timer if this is a new dwell or the cursor drifted.
          if (
            !dwellAnchor ||
            Math.hypot(cursor.x - dwellAnchor.x, cursor.y - dwellAnchor.y) > DWELL_MOVE_TOL
          ) {
            dwellAnchor = { x: cursor.x, y: cursor.y };
            dwellStart = now;
            dwellFired = false;
          }
          const progress = clamp((now - dwellStart) / DWELL_MS, 0, 1);
          if (ring && settingsRef.current.showCursor) {
            ring.style.opacity = "1";
            ring.style.transform = `translate(${smoothedX}px, ${smoothedY}px) translate(-50%, -50%)`;
            ring.style.background = `conic-gradient(#34d399 ${progress * 360}deg, rgba(148,163,184,0.25) 0deg)`;
          }
          if (!dwellFired && progress >= 1) {
            dwellFired = true; // one click per dwell; resets when the cursor moves
            performClick(cursor.x, cursor.y);
          }
        } else {
          // Not in the dwell pose → reset the timer and hide the ring.
          dwellAnchor = null;
          dwellStart = 0;
          dwellFired = false;
          if (ring) ring.style.opacity = "0";
        }

        // ── STATIC GESTURE: majority vote over VOTE_WINDOW frames ─────────────
        history.push(g);
        if (history.length > VOTE_WINDOW) history.shift();
        const stable = voteStable();

        // ── SWIPE: track palm-center motion over the last SWIPE_MS ms ─────────
        const center = palmCenter(lm);
        swipeSamples.push({ x: center.x, y: center.y, t: now, gesture: stable });
        const cutoff = now - SWIPE_MS;
        while (swipeSamples.length && swipeSamples[0].t < cutoff) {
          swipeSamples.shift();
        }
        const swipe = detectSwipe(now);

        // A swipe overrides any static hold and fires immediately.
        if (swipe) {
          history.length = 0;
          heldGesture = null;
          heldFired = false;
          dispatchIntent(swipe as Exclude<GestureName, null>);
          return;
        }

        // ── HOLD + LATCH for static gestures ──────────────────────────────────
        // 'point' / 'two_finger' and neutral/null are cursor-only — reset the
        // latch and fire no action.
        if (stable === null || stable === "point" || stable === "two_finger") {
          heldGesture = null;
          heldFired = false;
          // cursor-only poses just drive the cursor; nothing else to do.
          return;
        }

        if (stable !== heldGesture) {
          // A new pose began — start a fresh hold timer.
          heldGesture = stable;
          heldSince = now;
          heldFired = false;
          return;
        }

        // Same pose still held — fire once after HOLD_MS, respecting cooldown.
        if (!heldFired && now - heldSince >= HOLD_MS) {
          const last = lastFiredAt.get(stable) ?? 0;
          if (now - last < GESTURE_COOLDOWN_MS) return;

          heldFired = true;
          lastFiredAt.set(stable, now);

          // ── FIRING ──────────────────────────────────────────────────────────
          if (stable === "pinch" && !presentationRef.current && cursor) {
            // Local click — does not go through the intent path.
            performClick(cursor.x, cursor.y);
            return;
          }
          // Everything else (open_palm, thumb_up, thumb_down, peace, three,
          // fist) delegates to the Shell via an intent. (Swipes handled above;
          // pinch in presentation mode has no mapped intent and is ignored.)
          dispatchIntent(stable);
        }
      } catch {
        // One bad frame must never kill the loop — just skip it.
      }
    };

    // ── Bootstrap: attach camera, load model, start the loop ───────────────────
    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        await attachVideo(video);
        if (cancelled) return;
        hand = await getHandLandmarker();
        if (cancelled) return;
        rafId = requestAnimationFrame(onFrame);
      } catch {
        // If the camera or model fails we simply render nothing; the master
        // switch / settings UI surfaces errors elsewhere.
      }
    })();

    // ── Teardown: stop loop, release camera, detach stream, drop listeners ─────
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener(
        "satyam:handsfree-settings",
        onSettings as EventListener,
      );
      releaseCamera();
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
        } catch {
          /* noop */
        }
        video.srcObject = null;
      }
    };
    // Intentionally empty deps: the loop is created once and reads live values
    // from refs. Props changes are mirrored into refs above on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The component is visually "null" — it only renders a 1px hidden video and an
  // optional cursor dot. We can't return null because we need the refs mounted,
  // so we render an inert fragment of fixed/absolute, pointer-transparent nodes.
  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden
        style={{
          position: "fixed",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          bottom: 0,
          right: 0,
        }}
      />
      {showCursor && (
        <div
          ref={dwellRingRef}
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 38,
            height: 38,
            borderRadius: "50%",
            // conic-gradient set imperatively per frame; mask cuts the centre
            // out so it reads as a thin progress ring around the cursor dot.
            background: "conic-gradient(#34d399 0deg, rgba(148,163,184,0.25) 0deg)",
            WebkitMask: "radial-gradient(farthest-side, transparent 64%, #000 66%)",
            mask: "radial-gradient(farthest-side, transparent 64%, #000 66%)",
            pointerEvents: "none",
            zIndex: 2147482999,
            opacity: 0,
            transform: "translate(-100px, -100px)",
            transition: "opacity 120ms ease",
            willChange: "transform, background",
          }}
        />
      )}
      {showCursor && (
        <div
          ref={cursorRef}
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, #7dd3fc, #0ea5e9)",
            boxShadow:
              "0 0 10px 3px rgba(14,165,233,0.7), 0 0 2px 1px rgba(255,255,255,0.9)",
            border: "1px solid rgba(255,255,255,0.85)",
            pointerEvents: "none",
            zIndex: 2147483000,
            transform: "translate(-100px, -100px)",
            willChange: "transform",
          }}
        />
      )}
    </>
  );
}
