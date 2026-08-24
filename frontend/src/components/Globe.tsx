import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Slowly rotating dotted globe, used as a decorative backdrop.
 *
 * Rendered with `cobe` (WebGL, zero dependencies, ~5KB) rather than reusing the
 * `maplibre-gl` globe projection already in the project: MapLibre needs tiles
 * over the network and draws a photographic map, which is the wrong register for
 * a watermark and would fetch on a screen that is otherwise idle.
 *
 * Purely presentational — no markers, and `pointer-events` are left to the
 * caller, which sets them to `none` so the globe cannot steal text selection or
 * scroll gestures from the chat transcript sitting on top of it.
 *
 * Two things differ from cobe's published README, both verified against the
 * installed build (`node_modules/cobe/dist/index.esm.js`, v2.0.1):
 *
 *  1. **There is no `onRender` callback and no internal animation loop.** The
 *     option is still documented but the v2 bundle contains no reference to it,
 *     so a globe built the README's way renders exactly one frame and then sits
 *     there. Rotation is therefore driven from a `requestAnimationFrame` loop
 *     here, calling `globe.update({ phi })`, which redraws immediately.
 *
 *  2. **`createGlobe` inserts its own wrapper `<div>` around the canvas** (for
 *     CSS anchor positioning of markers) and `destroy()` does not remove it. If
 *     the canvas were a React child, React would later try to remove it from a
 *     parent it no longer belongs to and throw `NotFoundError` from
 *     `removeChild` — reliably, on every StrictMode double-mount. So React owns
 *     only the host `<div>`; the canvas is created imperatively and the host is
 *     emptied on cleanup, which takes cobe's wrapper with it.
 */

/** Radians of longitude per frame at 60fps — a full turn takes about 35s. */
const SPIN_PER_FRAME = 0.003;

/**
 * Under `prefers-reduced-motion` the spin is slowed rather than stopped.
 *
 * The vestibular problem with a spinning globe is speed, not rotation as such:
 * a slow drift reads as ambient rather than as motion demanding to be tracked.
 * Stopping it outright would also mean every reduced-motion viewer sees a dead
 * canvas and reasonably concludes the feature is broken — this project already
 * shipped that mistake once on the login badges.
 */
const REDUCED_SPIN_FACTOR = 1 / 6;

/**
 * Resolve any CSS colour token to an sRGB triple in 0..1.
 *
 * The theme tokens are written in a mix of `#hex`, `hsl()` and `oklch()`
 * (see `styles.css`), so rather than parse them, the browser's own colour
 * pipeline is used: canvas 2D `fillStyle` accepts every format the CSS parser
 * does, and `getImageData` hands back plain sRGB bytes.
 */
function cssColorToRgb(
  value: string,
  fallback: [number, number, number],
): [number, number, number] {
  const v = value.trim();
  if (!v) return fallback;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return fallback;
    // An unparseable value leaves fillStyle at its previous setting, which would
    // be indistinguishable from a legitimate colour — so seed it with a sentinel
    // and treat "unchanged" as a parse failure.
    ctx.fillStyle = "#ff00ff";
    ctx.fillStyle = v;
    if (ctx.fillStyle === "#ff00ff") return fallback;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  } catch {
    return fallback;
  }
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.classList.contains("dark");
  return {
    dark: isDark ? 1 : 0,
    diffuse: isDark ? 1.2 : 0.45,
    mapBrightness: isDark ? 5.4 : 3.6,
    baseColor: (isDark ? [0.32, 0.34, 0.4] : [1, 1, 1]) as [number, number, number],
    // No markers are drawn, but COBEOptions requires the colour.
    markerColor: cssColorToRgb(cs.getPropertyValue("--main"), [0.57, 0.77, 0.99]),
    glowColor: cssColorToRgb(
      cs.getPropertyValue("--background"),
      isDark ? [0.14, 0.15, 0.19] : [0.94, 0.96, 0.99],
    ),
  };
}

export function Globe({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let teardown: (() => void) | undefined;
    let phi = -1.35; // longitude of the front face at first paint

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Imported inside the effect so the module never loads during SSR — this
    // route is server-rendered and cobe touches `document` on construction.
    void import("cobe").then(({ default: createGlobe }) => {
      if (disposed) return;

      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:100%;height:100%;display:block";
      host.appendChild(canvas);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const sizePx = () => Math.max(host.clientWidth, 1);

      let side = sizePx();
      canvas.width = side * dpr;
      canvas.height = side * dpr;

      let colors = themeColors();
      const globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: side * dpr,
        height: side * dpr,
        phi,
        theta: 0.28,
        mapSamples: 16000,
        scale: 1,
        offset: [0, 0],
        markers: [],
        ...colors,
      });

      const ro = new ResizeObserver(() => {
        const next = sizePx();
        if (next === side) return;
        side = next;
        canvas.width = side * dpr;
        canvas.height = side * dpr;
        globe.update({ width: side * dpr, height: side * dpr });
      });
      ro.observe(host);

      // Re-read the palette only when the theme actually changes, not per frame.
      const mo = new MutationObserver(() => {
        colors = themeColors();
        globe.update(colors);
      });
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });

      const frame = () => {
        if (disposed) return;
        phi += SPIN_PER_FRAME * (reduced.matches ? REDUCED_SPIN_FACTOR : 1);
        globe.update({ phi });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      teardown = () => {
        ro.disconnect();
        mo.disconnect();
        globe.destroy();
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      teardown?.();
      // Also drops the wrapper div cobe injected around the canvas.
      host.replaceChildren();
    };
  }, []);

  return <div ref={hostRef} aria-hidden="true" className={cn("aspect-square w-full", className)} />;
}
