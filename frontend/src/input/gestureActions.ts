// The "intelligence" layer: maps a recognized gesture + the current screen +
// the active mode into a structured GestureIntent. Controllers stay dumb — they
// only classify hands and call computeGestureIntent(), then dispatch a
// "satyam:gesture" event carrying the intent. The Shell executes intents
// (navigation, voice arming, scroll, run-task) so all app state lives in one
// place and reuses the existing event bus.

import type { GestureName, GestureContext } from "@/input/types";

/** Bilingual label shown as a toast / spoken on each fired gesture. */
export type GLabel = { en: string; kn: string };

export type GestureIntent =
  | { kind: "arm_voice"; label: GLabel }
  | { kind: "nav_cycle"; dir: 1 | -1; label: GLabel }
  | { kind: "navigate"; to: string; label: GLabel }
  | { kind: "scroll"; dy: number; label: GLabel }
  | { kind: "history_back"; label: GLabel }
  | { kind: "toggle_warroom"; label: GLabel }
  | { kind: "read_screen"; label: GLabel }
  | { kind: "map_pan"; dir: "left" | "right"; label: GLabel }
  | { kind: "map_zoom"; delta: 1 | -1; label: GLabel }
  | { kind: "board_pan"; dir: "left" | "right"; label: GLabel }
  | { kind: "board_zoom"; delta: 1 | -1; label: GLabel }
  | { kind: "run_task"; route: string; actions: any[]; label: GLabel };

/** Routes that render an interactive Leaflet map (gesture pan/zoom target). */
const MAP_ROUTES = new Set(["/console", "/operations", "/ops-predictive", "/ops-dispatch"]);

// Ordered ring of primary screens for swipe-to-cycle navigation. Kept short and
// analyst-relevant; the gesture layer is for browsing dashboards, not data entry.
export const SCREEN_CYCLE: string[] = [
  "/console",
  "/network",
  "/forecast",
  "/trends",
  "/operations",
  "/board",
  "/reports",
  "/audit",
];

/** Index of the current route within the cycle (or 0 if not found). */
export function cycleIndex(route: string): number {
  const i = SCREEN_CYCLE.indexOf(route);
  return i < 0 ? 0 : i;
}

const L = (en: string, kn: string): GLabel => ({ en, kn });

/**
 * Translate a fired gesture into an app intent. Returns null for gestures that
 * the controller handles itself at the DOM level (point = cursor, pinch =
 * click, fist = right-click in normal mode).
 */
export function computeGestureIntent(
  gesture: GestureName,
  ctx: GestureContext,
): GestureIntent | null {
  if (!gesture) return null;

  // ── Presentation / War-room mode: optimized for briefing a room ──────────
  if (ctx.presentation) {
    switch (gesture) {
      case "swipe_right":
      case "open_palm":
      case "thumb_up":
        return { kind: "nav_cycle", dir: 1, label: L("Next", "ಮುಂದಿನದು") };
      case "swipe_left":
        return { kind: "nav_cycle", dir: -1, label: L("Previous", "ಹಿಂದಿನದು") };
      case "three":
        return { kind: "read_screen", label: L("Reading this screen", "ಈ ಪರದೆ ಓದಲಾಗುತ್ತಿದೆ") };
      case "thumb_down":
      case "fist":
        return { kind: "toggle_warroom", label: L("Exiting War-room", "ವಾರ್-ರೂಮ್ ನಿರ್ಗಮನ") };
      default:
        return null;
    }
  }

  // ── Normal desktop mode ──────────────────────────────────────────────────
  // open_palm / three / fist / peace are GLOBAL (same on every screen). swipe +
  // thumb are CONTEXTUAL: on a map screen they pan/zoom the map, on the board
  // they pan/zoom the canvas, everywhere else they cycle screens / scroll.
  switch (gesture) {
    case "open_palm":
      // Gesture → voice fusion: raise a palm to arm the voice copilot.
      return { kind: "arm_voice", label: L("Listening…", "ಆಲಿಸುತ್ತಿದೆ…") };
    case "fist":
      return { kind: "history_back", label: L("Going back", "ಹಿಂದಕ್ಕೆ") };
    case "peace":
      return { kind: "navigate", to: "/console", label: L("Opening Console", "ಕನ್ಸೋಲ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ") };
    case "three":
      return { kind: "toggle_warroom", label: L("War-room mode", "ವಾರ್-ರೂಮ್ ಮೋಡ್") };

    case "swipe_right":
      if (MAP_ROUTES.has(ctx.route))
        return { kind: "map_pan", dir: "right", label: L("Panning map", "ನಕ್ಷೆ ಸರಿಸಲಾಗುತ್ತಿದೆ") };
      if (ctx.route === "/board")
        return { kind: "board_pan", dir: "right", label: L("Panning canvas", "ಕ್ಯಾನ್ವಾಸ್ ಸರಿಸಲಾಗುತ್ತಿದೆ") };
      return { kind: "nav_cycle", dir: 1, label: L("Next screen", "ಮುಂದಿನ ಪರದೆ") };
    case "swipe_left":
      if (MAP_ROUTES.has(ctx.route))
        return { kind: "map_pan", dir: "left", label: L("Panning map", "ನಕ್ಷೆ ಸರಿಸಲಾಗುತ್ತಿದೆ") };
      if (ctx.route === "/board")
        return { kind: "board_pan", dir: "left", label: L("Panning canvas", "ಕ್ಯಾನ್ವಾಸ್ ಸರಿಸಲಾಗುತ್ತಿದೆ") };
      return { kind: "nav_cycle", dir: -1, label: L("Previous screen", "ಹಿಂದಿನ ಪರದೆ") };
    case "thumb_up":
      if (MAP_ROUTES.has(ctx.route))
        return { kind: "map_zoom", delta: 1, label: L("Zooming in", "ಹಿಗ್ಗಿಸಲಾಗುತ್ತಿದೆ") };
      if (ctx.route === "/board")
        return { kind: "board_zoom", delta: 1, label: L("Zooming in", "ಹಿಗ್ಗಿಸಲಾಗುತ್ತಿದೆ") };
      return { kind: "scroll", dy: -0.85, label: L("Scroll up", "ಮೇಲೆ ಸ್ಕ್ರೋಲ್") };
    case "thumb_down":
      if (MAP_ROUTES.has(ctx.route))
        return { kind: "map_zoom", delta: -1, label: L("Zooming out", "ಕಿರಿದಾಗಿಸಲಾಗುತ್ತಿದೆ") };
      if (ctx.route === "/board")
        return { kind: "board_zoom", delta: -1, label: L("Zooming out", "ಕಿರಿದಾಗಿಸಲಾಗುತ್ತಿದೆ") };
      return { kind: "scroll", dy: 0.85, label: L("Scroll down", "ಕೆಳಗೆ ಸ್ಕ್ರೋಲ್") };

    // point / pinch are handled directly by the controller (cursor + click).
    default:
      return null;
  }
}
