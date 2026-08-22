/** Lazy loader for the WebGL map stack.
 *
 *  Why this exists: TanStack Start server-renders every route, and both
 *  maplibre-gl and @deck.gl/* touch `window` / `WebGLRenderingContext` at module
 *  scope. A static top-level import of either one crashes SSR. The repo's
 *  established pattern is `await import()` inside an effect (see CrimeMap.tsx
 *  and input/visionLoader.ts), so we follow it.
 *
 *  The import promise is cached at module scope, so navigating away from /vision
 *  and back does not re-download or re-evaluate the (large) bundles, and two
 *  components mounting at once share one load.
 */
import { useEffect, useState } from "react";

export type MapLibreModule = typeof import("maplibre-gl");
export type DeckModules = {
  core: typeof import("@deck.gl/core");
  layers: typeof import("@deck.gl/layers");
  agg: typeof import("@deck.gl/aggregation-layers");
  mapbox: typeof import("@deck.gl/mapbox");
};

export type MapStack = { maplibre: MapLibreModule; deck: DeckModules };

let stackPromise: Promise<MapStack> | null = null;

/** Load maplibre-gl + the deck.gl subpackages we use. Client-only. */
export function loadMapStack(): Promise<MapStack> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadMapStack is client-only"));
  }
  if (!stackPromise) {
    stackPromise = Promise.all([
      import("maplibre-gl"),
      import("@deck.gl/core"),
      import("@deck.gl/layers"),
      import("@deck.gl/aggregation-layers"),
      import("@deck.gl/mapbox"),
    ]).then(([maplibre, core, layers, agg, mapbox]) => ({
      maplibre,
      deck: { core, layers, agg, mapbox },
    }));
    // Do not cache a rejection: a transient chunk-load failure on a bad network
    // would otherwise poison every later attempt for the whole session.
    stackPromise.catch(() => {
      stackPromise = null;
    });
  }
  return stackPromise;
}

/** Returns the map stack once loaded, or null while pending / on failure.
 *  `error` is exposed so the screen can say what went wrong instead of
 *  rendering an empty box. */
export function useMapStack(): { stack: MapStack | null; error: Error | null } {
  const [stack, setStack] = useState<MapStack | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMapStack().then(
      (s) => {
        if (!cancelled) setStack(s);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { stack, error };
}
