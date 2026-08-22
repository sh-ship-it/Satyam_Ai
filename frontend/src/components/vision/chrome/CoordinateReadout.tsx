/** HUD footer: MGRS grid reference, DMS coordinates, camera state, clock.
 *
 *  MGRS conversion uses the `mgrs` package rather than hand-rolled geodesy. A
 *  grid reference that is subtly wrong is worse than none at all on an
 *  operational map, so this is one place not to save a dependency.
 */
import { useEffect, useState } from "react";
// `mgrs` is CommonJS. A named import (`import { forward } from "mgrs"`) builds
// fine under rolldown but throws at SSR runtime in Vite's module runner:
// "Named export 'forward' not found... is a CommonJS module". A namespace import
// is the interop-safe form, and reading through both shapes keeps it working
// whether the resolver hands us the CJS exports object or an ESM default.
import * as mgrsModule from "mgrs";
import type { VisionViewState } from "../map/VisionMapCanvas";

type MgrsForward = (lonLat: [number, number], accuracy?: number) => string;
const toMgrs: MgrsForward =
  (mgrsModule as unknown as { forward?: MgrsForward }).forward ??
  (mgrsModule as unknown as { default?: { forward: MgrsForward } }).default!.forward;

function dms(value: number, posSuffix: string, negSuffix: string): string {
  const suffix = value >= 0 ? posSuffix : negSuffix;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return `${deg}\u00b0${String(min).padStart(2, "0")}'${String(sec).padStart(2, "0")}"${suffix}`;
}

function useClock(): string {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // Rendered null on the server so SSR output and first client paint agree.
  if (!now) return "--:--:--";
  return now.toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Kolkata" });
}

export function CoordinateReadout({
  view,
  layerCount,
  coordsCoarsened,
}: {
  view: VisionViewState | null;
  layerCount: number;
  coordsCoarsened: boolean;
}) {
  const clock = useClock();

  let grid = "\u2014";
  if (view) {
    try {
      // 5-digit precision = 1 m. Meaningless if coordinates were coarsened
      // server-side, so drop to 3-digit (100 m) in that case to avoid implying
      // accuracy the caller is not cleared for.
      grid = toMgrs([view.lng, view.lat], coordsCoarsened ? 3 : 5);
    } catch {
      // mgrs throws outside its valid latitude band (polar regions).
      grid = "out of MGRS band";
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t-2 border-foreground bg-background/95 px-3 py-1 font-mono text-[10px] text-muted-foreground">
      <span className="font-bold text-foreground">{grid}</span>
      {view ? (
        <>
          <span>
            {dms(view.lat, "N", "S")} {dms(view.lng, "E", "W")}
          </span>
          <span>Z {view.zoom.toFixed(2)}</span>
          <span>BRG {String(Math.round((view.bearing + 360) % 360)).padStart(3, "0")}</span>
          <span>PITCH {Math.round(view.pitch)}</span>
          <span>ALT {view.altitudeM.toLocaleString()} m</span>
        </>
      ) : (
        <span>{"awaiting camera\u2026"}</span>
      )}
      <span>LAYERS {layerCount}</span>
      {coordsCoarsened && (
        <span className="font-bold text-[#f97316]">
          {"COORDINATES COARSENED \u00b7 L1 CLEARANCE"}
        </span>
      )}
      <span className="ml-auto">{clock} IST</span>
    </div>
  );
}
