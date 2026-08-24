import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lights the border of whatever it wraps: a slow beam that travels the edge, plus
 * a brighter pool that tracks the pointer once it comes near.
 *
 * Written here rather than installed. The usage this came from imports a local
 * `./BorderGlow` that does not exist in this repo, and the palette it passes
 * (`#c084fc`, `#f472b6`, `#38bdf8`) is fixed neon, which would make this the one
 * element on screen ignoring the theme the officer picked. The colour is read
 * from `--main` instead, the token ThemePicker actually rewrites, so the effect
 * follows every theme for free.
 *
 * The glow sits *outside* the wrapped element's own border. Satyam's borders are
 * hard 2px with a hard offset shadow, and blurring that would fight the rest of
 * the UI, so the border stays exactly as it is and this adds a halo around it.
 *
 * Two CSS mechanics carry the whole thing, so there is no per-frame JavaScript:
 *
 *  - **Ring masking.** A padded box masked with `mask-composite: exclude`
 *    subtracts its own content box, leaving just the ring. Anything painted
 *    behind that mask lights only the edge.
 *  - **`@property --edge-glow-angle`.** A custom property has to be registered
 *    with an `<angle>` syntax before CSS will interpolate it; without the
 *    registration the conic gradient jumps from 0deg to 360deg in one step
 *    instead of sweeping. Registered in `styles.css` beside the classes.
 *
 * Pointer tracking writes three custom properties on `pointermove` and nothing
 * else, so the compositor does the rest.
 */
export function BorderGlow({
  children,
  className,
  /** How close, in px, the pointer must get to the box before the glow appears. */
  edgeSensitivity = 120,
  /** Radius of the pointer-tracked pool, in px. */
  glowRadius = 160,
}: {
  children: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  glowRadius?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Listening on the window, not the element: the effect is proximity-based, so
    // it has to react while the pointer is still outside the box. A listener on
    // the element itself would only fire once the pointer was already on top of
    // it, which is too late to look like an approach.
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      // Distance from the pointer to the nearest point on the box. Each axis is
      // clamped at 0 so a pointer level with the box contributes no distance on
      // that axis, which is what makes the falloff track the edge rather than the
      // centre.
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      const distance = Math.hypot(dx, dy);

      if (distance > edgeSensitivity) {
        host.style.setProperty("--glow-strength", "0");
        return;
      }
      // Linear falloff here; the easing lives in the CSS transition.
      host.style.setProperty("--glow-strength", String(1 - distance / edgeSensitivity));
      host.style.setProperty("--glow-x", `${e.clientX - r.left}px`);
      host.style.setProperty("--glow-y", `${e.clientY - r.top}px`);
    };

    // A pointer that leaves the window never sends a final position, so without
    // this the glow would stay lit wherever it was last seen.
    const onLeave = () => host.style.setProperty("--glow-strength", "0");

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [edgeSensitivity]);

  return (
    <div
      ref={hostRef}
      className={cn("edge-glow", className)}
      style={{ ["--glow-radius" as string]: `${glowRadius}px` }}
    >
      <span aria-hidden="true" className="edge-glow-beam" />
      <span aria-hidden="true" className="edge-glow-pool" />
      {children}
    </div>
  );
}
