// Purely presentational UI for "War-room / Presentation mode".
//
// When War-room mode is on, the analyst is briefing a room hands-free (swiping
// to navigate, ✊ to exit). This component renders two purely visual cues and
// nothing else — it holds no app state and reads no stores, so it's safe to drop
// anywhere in the Shell:
//   1. a fixed top-center pill banner explaining how to drive the mode, and
//   2. a soft full-screen vignette/ring that signals the mode is active.
//
// All interactivity is funneled through the single `onExit` callback; the
// vignette is pointer-events:none so it never intercepts clicks.

import { Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Event name the Shell can dispatch/listen on to toggle War-room mode, exported
 * here so producers and consumers share one source of truth.
 */
export const WAR_ROOM_EVENT = "satyam:toggle-warroom";

/** Bilingual copy for the banner + exit button. */
const COPY = {
  en: {
    label: "War-room mode — swipe to navigate, ✊ to exit",
    exit: "Exit",
  },
  kn: {
    label: "ವಾರ್-ರೂಮ್ ಮೋಡ್ — ಸ್ವೈಪ್ ಮಾಡಿ, ✊ ನಿರ್ಗಮಿಸಿ",
    exit: "ನಿರ್ಗಮಿಸಿ",
  },
} as const;

export function WarRoomBanner(props: { active: boolean; lang: "en" | "kn"; onExit: () => void }) {
  const { active, lang, onExit } = props;

  // Inactive → render nothing at all.
  if (!active) return null;

  const t = COPY[lang] ?? COPY.en;

  return (
    <>
      {/* Soft full-screen vignette/ring: a non-interactive overlay that frames
          the viewport with an inset ring + dark edge glow so it's obvious the
          mode is on. pointer-events-none lets every click pass through. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[2147482999] rounded-sm ring-1 ring-primary/30 ring-inset"
        style={{
          boxShadow:
            "inset 0 0 0 2px var(--ring, rgba(99,102,241,0.35)), inset 0 0 140px 40px rgba(0,0,0,0.28)",
        }}
      />

      {/* Top-center pill banner. The wrapper is pointer-events-none so only the
          pill itself (pointer-events-auto) is interactive. */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[2147483000] flex justify-center px-4">
        <div
          role="status"
          className={cn(
            "pointer-events-auto flex items-center gap-3 rounded-full border",
            "border-border bg-background/80 px-4 py-2 shadow-lg backdrop-blur",
            "text-sm text-foreground",
          )}
        >
          <Presentation className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="whitespace-nowrap font-medium">{t.label}</span>
          <button
            type="button"
            onClick={onExit}
            className={cn(
              "ml-1 shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold",
              "bg-secondary/60 text-foreground transition hover:bg-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {t.exit}
          </button>
        </div>
      </div>
    </>
  );
}
