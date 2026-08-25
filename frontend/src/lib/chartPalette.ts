import { useEffect, useState } from "react";
import { cssColorToRgb } from "@/lib/utils";

/**
 * Shared chart palette + SSR mount gate for recharts screens.
 *
 * Extracted from `routes/graphs.tsx` once a second screen needed it. Both the
 * Graphs gallery and the merged Early Warning & Forecast screen resolve the same
 * tokens and both have to hold recharts back until the client has mounted, so
 * this is one implementation rather than two copies that drift.
 */

const PALETTE_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-muted",
  "--chart-up",
  "--chart-down",
  "--warning",
  "--border",
  "--muted-foreground",
] as const;

export type Palette = {
  /** Six categorical series colours. Index 0 tracks the theme accent. */
  series: string[];
  /** Opaque neutral for "everything else" slices and comparison baselines. */
  muted: string;
  /** Signed change: crime volume rising is bad news, so `up` is red. */
  up: string;
  down: string;
  /**
   * Midpoint of an ordered severity ramp, from `--warning`.
   *
   * Severity is a *sequential* scale, so it needs green → yellow → orange → red.
   * Borrowing a categorical series colour for the middle stop breaks that: cyan
   * for "Medium" reads as more prominent than orange for "High".
   */
  warn: string;
  /** Gridline colour, from `--border`. */
  grid: string;
  /** Axis tick colour, from `--muted-foreground`. */
  axis: string;
};

export const FALLBACK: Palette = {
  series: ["#4b83c4", "#e8871a", "#0f9d76", "#7c5cf0", "#d64550", "#0891b2"],
  muted: "rgb(195, 200, 210)",
  up: "#d64550",
  down: "#0f9d76",
  warn: "#e8a11a",
  grid: "rgba(0,0,0,0.12)",
  axis: "#6b7280",
};

/**
 * Resolve the `--chart-*` tokens to concrete `rgb()` strings.
 *
 * Recharts writes colours into SVG presentation attributes, and the tokens are
 * authored with `color-mix()` and `var()`, so handing the raw token text straight
 * to a `fill` prop is not reliable. Instead each token is resolved through a
 * throwaway probe element — `getComputedStyle().color` always returns a resolved
 * colour — and then normalised to sRGB bytes with the existing canvas-based
 * helper, which copes with `oklch`/`oklab` output.
 *
 * Re-resolved when the theme changes, so charts follow the theme picker like
 * everything else on screen.
 */
export function useChartPalette(): Palette {
  const [palette, setPalette] = useState<Palette>(FALLBACK);

  useEffect(() => {
    const read = () => {
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      document.body.appendChild(probe);

      const resolved: Record<string, string> = {};
      for (const token of PALETTE_TOKENS) {
        probe.style.color = "";
        probe.style.color = `var(${token})`;
        const computed = getComputedStyle(probe).color;
        const [r, g, b] = cssColorToRgb(computed, [0.4, 0.4, 0.4]);
        // Alpha is dropped deliberately: a semi-transparent SVG fill layered over
        // gridlines reads as a different colour in every chart. This is why
        // `--chart-muted` must be authored opaque — see the note in styles.css.
        resolved[token] =
          `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      }
      probe.remove();

      setPalette({
        series: [
          resolved["--chart-1"],
          resolved["--chart-2"],
          resolved["--chart-3"],
          resolved["--chart-4"],
          resolved["--chart-5"],
          resolved["--chart-6"],
        ],
        muted: resolved["--chart-muted"],
        up: resolved["--chart-up"],
        down: resolved["--chart-down"],
        warn: resolved["--warning"],
        grid: resolved["--border"],
        axis: resolved["--muted-foreground"],
      });
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
}

/**
 * True only after the first client render.
 *
 * Recharts measures its container to lay out, so it renders nothing meaningful on
 * the server and the markup it produces after hydration does not match. Every
 * route here is server-rendered, so charts are held back until the client has
 * mounted and a skeleton is shown in the meantime.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
