import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Floating voice orb — a looping video clipped to a circle, present on every screen.
 *
 * Purely presentational. It owns nothing except its own drag position and the
 * <video> element; all voice state is passed in and every interaction is a
 * callback, so Shell.tsx remains the single owner of the capture session. That
 * split matters here: two things holding microphone state is how you end up with
 * two live recognition sessions fighting each other.
 *
 * WHY A VIDEO AND NOT A CANVAS OR CSS GRADIENT
 * A <video> with `loop muted playsInline autoPlay` is decoded by the compositor
 * and costs no main-thread time, so it keeps animating smoothly while the map,
 * the force graph or a streaming answer are all busy. It also means the artwork
 * is swappable without touching code.
 *
 * THE SOURCE CLIP IS 4:5, NOT SQUARE
 * `object-fit: cover` centre-crops it into the circle, which discards roughly the
 * top and bottom 10% of the frame. That is deliberate and lossless to the visible
 * result — but if the artwork is ever re-exported, 1:1 is the ratio that shows
 * every pixel.
 */

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const POSITION_KEY = "satyam.orb.position";

/**
 * Per-state presentation. `rate` drives the video's playbackRate so tempo
 * conveys state without needing four separate clips: calm when idle, urgent
 * while listening. `ring` is a Tailwind colour used for the border and halo, so
 * state stays legible even for a viewer who cannot perceive the speed change.
 */
const STATES: Record<
  OrbState,
  { rate: number; size: number; ring: string; halo: string; label: string }
> = {
  idle: {
    rate: 0.55,
    size: 92,
    ring: "border-foreground",
    halo: "rgba(99,102,241,0.22)",
    label: "Tap to speak",
  },
  listening: {
    rate: 1.5,
    size: 112,
    ring: "border-emerald-500",
    halo: "rgba(16,185,129,0.42)",
    label: "Listening — tap to send",
  },
  thinking: {
    rate: 1.15,
    size: 100,
    ring: "border-amber-500",
    halo: "rgba(251,191,36,0.34)",
    label: "Thinking…",
  },
  speaking: {
    rate: 0.95,
    size: 104,
    ring: "border-cyan-500",
    halo: "rgba(34,211,238,0.34)",
    label: "Speaking…",
  },
};

/** Drag further than this and the gesture is a move, not a click. */
const CLICK_SLOP_PX = 4;

export function VoiceOrb({
  state,
  onToggle,
  hidden = false,
}: {
  state: OrbState;
  /** Click (not drag) on the orb. Shell decides what listening means. */
  onToggle: () => void;
  /** Suppressed while the full-screen copilot overlay owns the screen. */
  hidden?: boolean;
}) {
  const t = useT();
  const cfg = STATES[state];

  const videoRef = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const dragging_ = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const base = useRef({ x: 0, y: 0 });
  const live = useRef({ x: 0, y: 0 });

  // Restore the saved position, but only if it still lands on screen. A position
  // saved on a wide monitor would otherwise strand the orb off-canvas on a laptop
  // with no way to retrieve it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(POSITION_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (
        p &&
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        Math.abs(p.x) < window.innerWidth &&
        Math.abs(p.y) < window.innerHeight
      ) {
        setPos(p);
        base.current = p;
        live.current = p;
      } else {
        sessionStorage.removeItem(POSITION_KEY);
      }
    } catch {
      sessionStorage.removeItem(POSITION_KEY);
    }
  }, []);

  // Tempo conveys state. Set imperatively because playbackRate is a property of
  // the media element, not an attribute React can render.
  useLayoutEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = cfg.rate;
  }, [cfg.rate]);

  // Autoplay can still be refused (a background tab, or a policy that ignores
  // `muted`). Retrying on the first pointer gesture anywhere is enough, and a
  // stalled poster is better than a thrown promise.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => void v.play().catch(() => {});
    tryPlay();
    window.addEventListener("pointerdown", tryPlay, { once: true });
    return () => window.removeEventListener("pointerdown", tryPlay);
  }, []);

  const endDrag = useCallback(() => {
    if (!dragging_.current) return;
    dragging_.current = false;
    base.current = live.current;
    setDragging(false);
    setPos({ ...base.current });
    try {
      sessionStorage.setItem(POSITION_KEY, JSON.stringify(base.current));
    } catch {
      /* position is a convenience, not state worth failing over */
    }
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging_.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (Math.abs(dx) > CLICK_SLOP_PX || Math.abs(dy) > CLICK_SLOP_PX) moved.current = true;
      live.current = { x: base.current.x + dx, y: base.current.y + dy };
      setPos(live.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    dragging_.current = true;
    moved.current = false;
    setDragging(true);
    start.current = { x: e.clientX, y: e.clientY };
  }

  function onClick() {
    // A drag that ends over the orb also fires click; ignore it, or the orb
    // starts listening every time it is repositioned.
    if (moved.current) {
      moved.current = false;
      return;
    }
    onToggle();
  }

  if (hidden) return null;

  const isLive = state === "listening";

  return (
    <div
      onPointerDown={onPointerDown}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, touchAction: "none" }}
      className={`fixed bottom-8 right-8 z-[9998] flex select-none flex-col items-center gap-2 ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      <div className="relative grid place-items-center">
        {/* Ambient halo. Breathes slowly at rest and quickly while listening, so
            peripheral vision registers the state without reading the label. */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            inset: -18,
            background: `radial-gradient(circle, ${cfg.halo} 0%, transparent 70%)`,
            animation: `orbHalo ${isLive ? "0.9s" : "2.6s"} ease-in-out infinite`,
          }}
        />

        {/* Expanding rings while capturing — the clearest "the mic is open" cue. */}
        {isLive && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-500"
              style={{ animation: "orbPing 1.1s cubic-bezier(0,0,0.2,1) infinite" }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-emerald-400/50"
              style={{
                inset: -10,
                animation: "orbPing 1.1s cubic-bezier(0,0,0.2,1) 0.35s infinite",
              }}
            />
          </>
        )}

        <button
          type="button"
          onClick={onClick}
          aria-pressed={isLive}
          aria-label={isLive ? t("Stop listening and send") : t("Start voice input")}
          title={t(cfg.label)}
          className={`nb-press relative grid place-items-center overflow-hidden rounded-full border-2 ${cfg.ring} bg-secondary-background nb-shadow-sm transition-all duration-300`}
          style={{ width: cfg.size, height: cfg.size }}
        >
          <video
            ref={videoRef}
            src="/voice-orb.mp4"
            poster="/video-poster.svg"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden
            className="h-full w-full object-cover"
            style={{ pointerEvents: "none" }}
          />
          {/* Thinking is the one state with no audio and no user action, so it
              gets an explicit spinner rather than relying on tempo alone. */}
          {state === "thinking" && (
            <span
              aria-hidden
              className="absolute rounded-full border-2 border-amber-400/30 border-t-amber-400"
              style={{ inset: -7, animation: "orbSpin 1.1s linear infinite" }}
            />
          )}
        </button>
      </div>

      <span
        className={`rounded-[5px] border-2 border-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider nb-shadow-sm ${
          isLive ? "bg-emerald-500 text-white" : "bg-secondary-background text-muted-foreground"
        }`}
      >
        {t(cfg.label)}
      </span>

      <style>{`
        @keyframes orbHalo { 0%,100% { opacity:.35; transform:scale(.86); } 50% { opacity:1; transform:scale(1.14); } }
        @keyframes orbPing { 0% { transform:scale(1); opacity:.85; } 100% { transform:scale(2.3); opacity:0; } }
        @keyframes orbSpin { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes orbHalo { 0%,100% { opacity:.6; transform:none; } }
          @keyframes orbPing { 0%,100% { opacity:0; } }
        }
      `}</style>
    </div>
  );
}
