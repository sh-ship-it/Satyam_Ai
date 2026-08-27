import { useEffect, useRef } from "react";

import { EYE_AIM_Y, GHOST_CSS, GHOST_PATH, VIEW_H, VIEW_W, eyeOffset } from "@/lib/ghostMascot";
import { cn } from "@/lib/utils";

/**
 * Ghost mascot: floats, squashes like a liquid, colours rotate and blend, eyes follow
 * the pointer.
 *
 * Geometry, the animation CSS and the eye maths live in lib/ghostMascot.ts, including
 * why this is not the pasted `MeshGradientSVG` and why the soft edges come from
 * radial gradients rather than a blur.
 *
 * SIZING IS THE CALLER'S JOB
 * The SVG is `w-full h-auto`, so `className` decides how big it is. That is what lets
 * the same component be a 160px badge and a 60vh background without a second code
 * path — and it means the background can be sized in viewport units, which a px prop
 * could not express.
 *
 * THE EYES DO NOT USE REACT STATE
 * Pointer moves fire far faster than a useful render rate, so holding the offset in
 * state would re-render the whole SVG on every move. The handler stashes the target
 * and one rAF writes a `transform` straight onto the eye group: no re-render, one DOM
 * write per frame, and a passive listener so it cannot block scrolling.
 */
export function GhostMascot({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const eyesRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let frame = 0;
    let tx = 0;
    let ty = 0;

    const write = () => {
      frame = 0;
      eyesRef.current?.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`);
    };

    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      // Zero width means the mascot is hidden at this breakpoint; nothing to aim.
      if (r.width === 0) return;
      const next = eyeOffset(
        e.clientX - (r.left + r.width / 2),
        e.clientY - (r.top + r.height * EYE_AIM_Y),
      );
      tx = next.x;
      ty = next.y;
      if (!frame) frame = requestAnimationFrame(write);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    // Two nested wrappers on purpose: the float and the squash must sit on separate
    // elements, because a single element cannot run two animations that both write
    // `transform` — the later one would simply win.
    <div className={cn("ghost-float", className)}>
      <style>{GHOST_CSS}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        // Decorative. The sign-in form carries all the meaning on this page, so a
        // screen reader announcing a ghost would only be noise.
        aria-hidden
        focusable="false"
      >
        <defs>
          <clipPath id="ghost-clip">
            <path d={GHOST_PATH} />
          </clipPath>
          <linearGradient id="ghost-base" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8fd0f5" />
            <stop offset="55%" stopColor="#4a9bf0" />
            <stop offset="100%" stopColor="#3f7fe0" />
          </linearGradient>
          {/* Each blob fades to fully transparent at its own edge. That is where the
              softness comes from — no filter, so animating it stays cheap. */}
          {[
            ["ghost-pink", "#f3aed2"],
            ["ghost-navy", "#1d2b45"],
            ["ghost-sky", "#7cc6f7"],
            ["ghost-blue", "#3b86e8"],
          ].map(([id, colour]) => (
            <radialGradient key={id} id={id}>
              <stop offset="0%" stopColor={colour} stopOpacity="0.95" />
              <stop offset="55%" stopColor={colour} stopOpacity="0.55" />
              <stop offset="100%" stopColor={colour} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        {/* The squash wraps everything, eyes included, so the whole body deforms as
            one — eyes that held their shape while the body flexed would read as a
            sticker on top rather than part of it. */}
        <g className="ghost-squash">
          <g clipPath="url(#ghost-clip)">
            {/* Base wash first: the rotating blobs sweep past the clip edges, and this
                is what remains visible underneath instead of a gap. */}
            <rect width={VIEW_W} height={VIEW_H} fill="url(#ghost-base)" />
            <g className="ghost-swirl">
              <ellipse
                className="ghost-blob-a"
                cx="96"
                cy="86"
                rx="126"
                ry="106"
                fill="url(#ghost-pink)"
              />
              <ellipse
                className="ghost-blob-b"
                cx="56"
                cy="116"
                rx="104"
                ry="96"
                fill="url(#ghost-navy)"
              />
              <ellipse
                className="ghost-blob-c"
                cx="226"
                cy="150"
                rx="136"
                ry="120"
                fill="url(#ghost-sky)"
              />
              <ellipse
                className="ghost-blob-a"
                cx="178"
                cy="286"
                rx="130"
                ry="112"
                fill="url(#ghost-blue)"
              />
            </g>
          </g>

          {/* Eyes last so they sit above the gradient, and grouped so one transform
              moves both. */}
          <g className="ghost-eyes" ref={eyesRef}>
            <ellipse cx="118" cy="152" rx="21" ry="27" fill="#ffffff" />
            <ellipse cx="186" cy="152" rx="21" ry="27" fill="#ffffff" />
          </g>
        </g>
      </svg>
    </div>
  );
}

export default GhostMascot;
