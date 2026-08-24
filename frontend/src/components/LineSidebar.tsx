import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Vertical chapter nav with proximity-reactive tick marks.
 *
 * Written here rather than installed: the usage this came from imports a local
 * `./LineSidebar` that is not in this repo. The prop surface below is kept
 * compatible with that call site, with two deliberate differences.
 *
 * 1. **Colours default to the theme, not to fixed hex.** The original call passes
 *    `accentColor="#A855F7"`, `textColor="#c4c4c4"`, `markerColor="#6c6c6c"`,
 *    which would make this the one component on the page ignoring the palette the
 *    officer selected. All three props are optional here and fall back to
 *    `--main` and mixes of `--foreground`, so the rail tracks every theme and both
 *    light and dark. Passing an explicit colour still wins, so the documented API
 *    is intact.
 * 2. **`activeIndex` is accepted as a controlled prop** alongside `defaultActive`.
 *    The About page drives the active chapter from scroll position, and a purely
 *    self-managed active item cannot be told that the reader has scrolled.
 *
 * The proximity effect runs on one `requestAnimationFrame` loop that writes
 * inline styles directly, rather than through React state. At 60fps a state
 * update per frame would re-render the whole list and its parent for a purely
 * visual property.
 */

/** Roman numerals for the index gutter. Falls back to decimal past the list. */
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function romanFor(i: number) {
  return ROMAN[i] ?? String(i + 1);
}

export type LineSidebarProps = {
  items: string[];
  /** Colour of the active item and its tick. Defaults to the theme's `--main`. */
  accentColor?: string;
  /** Colour of inactive labels. Defaults to a mix of `--foreground`. */
  textColor?: string;
  /** Colour of inactive ticks. Defaults to a fainter mix of `--foreground`. */
  markerColor?: string;
  /** Show the roman-numeral gutter. */
  showIndex?: boolean;
  /** Show the tick mark to the left of each label. */
  showMarker?: boolean;
  /** Vertical distance, in px, within which the pointer moves an item. */
  proximityRadius?: number;
  /** Maximum horizontal displacement, in px, at zero distance. */
  maxShift?: number;
  /** Shape of the displacement curve away from the pointer. */
  falloff?: "linear" | "smooth";
  /** Tick length in px at full proximity. */
  markerLength?: number;
  /** Gap in px between tick and label. */
  markerGap?: number;
  /** Tick length at rest, as a fraction of `markerLength`. */
  tickScale?: number;
  /** Grow the tick toward `markerLength` as the pointer approaches. */
  scaleTick?: boolean;
  /** Vertical gap between items, in px. */
  itemGap?: number;
  /** Label size in rem. */
  fontSize?: number;
  /** 0-100. Higher follows the pointer more slowly. */
  smoothing?: number;
  /** Initial active index when `activeIndex` is not supplied. */
  defaultActive?: number;
  /** Controlled active index. When set, the component stops tracking its own. */
  activeIndex?: number;
  onItemClick?: (index: number, label: string) => void;
  className?: string;
};

export function LineSidebar({
  items,
  accentColor,
  textColor,
  markerColor,
  showIndex = false,
  showMarker = false,
  proximityRadius = 40,
  maxShift = 30,
  falloff = "smooth",
  markerLength = 60,
  markerGap = 0,
  tickScale = 0.5,
  scaleTick = false,
  itemGap = 20,
  fontSize = 1.1,
  smoothing = 80,
  defaultActive = 0,
  activeIndex,
  onItemClick,
  className,
}: LineSidebarProps) {
  const hostRef = useRef<HTMLElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [uncontrolledActive, setUncontrolledActive] = useState(defaultActive);

  const active = activeIndex ?? uncontrolledActive;

  // Read into refs so the animation loop is not a dependency of every prop and
  // does not need tearing down and rebuilding as the parent re-renders.
  const cfg = useRef({
    proximityRadius,
    maxShift,
    falloff,
    markerLength,
    tickScale,
    scaleTick,
    smoothing,
  });
  cfg.current = {
    proximityRadius,
    maxShift,
    falloff,
    markerLength,
    tickScale,
    scaleTick,
    smoothing,
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Target and current displacement per row, in px. Two arrays so the loop can
    // ease toward a moving target instead of snapping to it.
    let targets: number[] = [];
    const current: number[] = [];
    let pointerY: number | null = null;
    let raf = 0;

    const weightFor = (distance: number) => {
      const { proximityRadius: r, falloff: f } = cfg.current;
      if (distance >= r) return 0;
      const linear = 1 - distance / r;
      // Smoothstep, so items ease in near the edge of the radius rather than
      // starting to move the instant they cross it.
      return f === "smooth" ? linear * linear * (3 - 2 * linear) : linear;
    };

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      return rowRefs.current.map((row) => {
        if (!row) return 0;
        const r = row.getBoundingClientRect();
        return r.top - hostRect.top + r.height / 2;
      });
    };

    const frame = () => {
      const centers = measure();
      const {
        maxShift: max,
        smoothing: s,
        markerLength: len,
        tickScale: ts,
        scaleTick: st,
      } = cfg.current;

      targets = centers.map((cy) =>
        pointerY === null ? 0 : weightFor(Math.abs(pointerY - cy)) * max,
      );

      // Higher `smoothing` means a smaller step per frame, so the rail trails the
      // pointer instead of tracking it rigidly.
      const alpha = Math.min(Math.max(1 - s / 100, 0.04), 1);
      let settled = true;

      rowRefs.current.forEach((row, i) => {
        if (!row) return;
        const from = current[i] ?? 0;
        const to = targets[i] ?? 0;
        const next = from + (to - from) * alpha;
        current[i] = Math.abs(to - next) < 0.01 ? to : next;
        if (current[i] !== to) settled = false;

        row.style.setProperty("--ls-shift", `${current[i].toFixed(2)}px`);
        if (st) {
          const w = max === 0 ? 0 : current[i] / max;
          row.style.setProperty("--ls-tick", `${(len * (ts + (1 - ts) * w)).toFixed(2)}px`);
        }
      });

      // Stop once everything has come to rest and the pointer has left, so an
      // idle page is not running a loop forever.
      if (!settled || pointerY !== null) raf = requestAnimationFrame(frame);
      else raf = 0;
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      pointerY = e.clientY - host.getBoundingClientRect().top;
      kick();
    };
    const onLeave = () => {
      pointerY = null;
      kick();
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const select = useCallback(
    (i: number, label: string) => {
      if (activeIndex === undefined) setUncontrolledActive(i);
      onItemClick?.(i, label);
    },
    [activeIndex, onItemClick],
  );

  return (
    <nav
      ref={hostRef}
      className={cn("line-sidebar", className)}
      style={
        {
          "--ls-accent": accentColor ?? "var(--main)",
          "--ls-text": textColor ?? "color-mix(in oklab, var(--foreground) 60%, transparent)",
          "--ls-marker": markerColor ?? "color-mix(in oklab, var(--foreground) 32%, transparent)",
          "--ls-gap": `${itemGap}px`,
          "--ls-font": `${fontSize}rem`,
          "--ls-marker-gap": `${markerGap}px`,
          "--ls-tick": `${scaleTick ? markerLength * tickScale : markerLength}px`,
        } as React.CSSProperties
      }
    >
      <ul>
        {items.map((label, i) => (
          <li
            key={label}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            className={i === active ? "is-active" : undefined}
          >
            <button
              type="button"
              onClick={() => select(i, label)}
              aria-current={i === active ? "true" : undefined}
            >
              {showMarker && <span aria-hidden="true" className="ls-tick" />}
              {showIndex && <span className="ls-index">({romanFor(i)})</span>}
              <span className="ls-label">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
