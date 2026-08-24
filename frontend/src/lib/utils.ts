import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
/**
 * Resolve any CSS colour token to an sRGB triple in 0..1.
 *
 * The theme tokens are written in a mix of `#hex`, `hsl()` and `oklch()`
 * (see `styles.css`), so rather than parse them, the browser's own colour
 * pipeline is used: canvas 2D `fillStyle` accepts every format the CSS parser
 * does, and `getImageData` hands back plain sRGB bytes.
 *
 * Lifted out of `components/Globe.tsx`, which needed the same thing first — any
 * decorative layer that wants to follow the officer's chosen theme has to read
 * `--main` / `--background` at runtime, and those arrive in whichever format the
 * theme author wrote them in.
 *
 * Browser-only: touches `document`. Call it from an effect, never during render.
 */
export function cssColorToRgb(
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

/** Linear sRGB-space blend, `t = 0` -> `a`, `t = 1` -> `b`. */
export function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
