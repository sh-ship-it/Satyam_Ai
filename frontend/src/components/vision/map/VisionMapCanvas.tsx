/** Vision map canvas: MapLibre GL basemap + deck.gl data overlay.
 *
 *  Prop-driven and imperative, matching the existing map components in this repo
 *  (CrimeMap, LiveOperationsMap). It fetches nothing; the parent owns all data.
 *
 *  View modes
 *    2d    — Web Mercator, pitch 0
 *    3d    — Web Mercator, pitch 55 (a camera change, not a projection change)
 *    earth — MapLibre *native* globe projection, base map only
 *
 *  Earth deliberately carries no data layers. deck.gl's own GlobeView is
 *  experimental and documents no pitch/bearing, no high-precision rendering
 *  above zoom 12, and known artefacts when switching between globe and map
 *  views. Rather than render police data through a projection that quietly
 *  loses accuracy at operational zoom, Earth is a labelled context view.
 *
 *  The deck overlay runs in *overlaid* mode (interleaved: false). That is a
 *  deliberate choice: overlaid needs no WebGL2 feature negotiation with the
 *  base map, and it survives `setStyle` without re-registering layers, so
 *  switching basemaps cannot drop the data.
 */
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  BASEMAPS,
  BUILDINGS_ATTRIBUTION,
  BUILDINGS_LAYER_ID,
  BUILDINGS_SOURCE_ID,
  TERRAIN_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE_ID,
  buildStyle,
  buildingsLayerSpec,
  buildingsSourceSpec,
  terrainSourceSpec,
  type BasemapId,
} from "./basemaps";
import { useMapStack } from "./useVisionMap";

/** `street3d` is rendered by Street3DCanvas (Google Photorealistic 3D), NOT by
 *  this component — it is a different renderer entirely. It appears in this union
 *  because the workspace, top bar and voice agent all switch on one mode value.
 *  When it is active this component is unmounted, so its WebGL context and the
 *  deck.gl overlay are released rather than sitting idle behind Google's globe. */
export type VisionViewMode = "2d" | "3d" | "earth" | "street3d";

export type VisionViewState = {
  lat: number;
  lng: number;
  zoom: number;
  bearing: number;
  pitch: number;
  /** Approximate camera altitude in metres, derived from zoom at this latitude. */
  altitudeM: number;
  /** [w, s, e, n] — what the parent should ask the backend for. */
  bbox: [number, number, number, number];
};

/** Karnataka, framed to fit the state on a 16:9 canvas. */
const KARNATAKA_CENTER: [number, number] = [75.7, 14.5];
const KARNATAKA_ZOOM = 6.4;
const PITCH_3D = 55;

function altitudeFor(zoom: number, lat: number): number {
  // Web Mercator ground resolution -> a rough eye altitude. Good enough for a
  // HUD readout; not used for any calculation.
  const metresPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return Math.max(0, Math.round(metresPerPixel * 800));
}

export function VisionMapCanvas({
  viewMode,
  basemap,
  layers,
  buildings3d = false,
  onViewState,
  onMapReady,
  onError,
}: {
  viewMode: VisionViewMode;
  basemap: BasemapId;
  /** Already-constructed deck.gl layer instances. Empty until data arrives. */
  layers: unknown[];
  /** Off by default. When enabled the caller is opting into a vector style. */
  buildings3d?: boolean;
  onViewState?: (vs: VisionViewState) => void;
  onMapReady?: (map: unknown) => void;
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(0);
  const { stack, error } = useMapStack();

  // The projection has to be re-applied after every setStyle: MapLibre resets it
  // to the style's default (mercator). Without this, changing basemap while in
  // Earth mode silently drops the globe and looks like the button stopped working.
  const viewModeRef = useRef<VisionViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const buildingsRef = useRef<boolean>(buildings3d);
  buildingsRef.current = buildings3d;

  /** Terrain and buildings are extra sources layered onto the active raster
   *  style, so `setStyle` wipes them and they must be re-applied every time the
   *  style settles — same hazard as the projection above.
   *
   *  Terrain follows 3D automatically rather than adding another switch: a DEM
   *  is invisible at pitch 0, and "3D" is exactly when an officer wants relief.
   *  Earth stays base-map-only by design, so neither is applied there. */
  const applyStyleExtras = (map: any) => {
    const mode = viewModeRef.current;
    const wantTerrain = mode === "3d";
    const wantBuildings = buildingsRef.current && mode !== "earth";

    try {
      if (wantTerrain) {
        if (!map.getSource(TERRAIN_SOURCE_ID)) {
          map.addSource(TERRAIN_SOURCE_ID, terrainSourceSpec() as any);
        }
        map.setTerrain({
          source: TERRAIN_SOURCE_ID,
          exaggeration: TERRAIN_EXAGGERATION,
        });
      } else {
        map.setTerrain(null);
      }
    } catch (e) {
      // A DEM failure must not take the map down; relief is an enhancement.
      // eslint-disable-next-line no-console
      console.warn("[vision] terrain unavailable:", e);
    }

    try {
      if (wantBuildings) {
        if (!map.getSource(BUILDINGS_SOURCE_ID)) {
          map.addSource(BUILDINGS_SOURCE_ID, buildingsSourceSpec() as any);
        }
        if (!map.getLayer(BUILDINGS_LAYER_ID)) {
          map.addLayer(buildingsLayerSpec() as any);
        }
      } else if (map.getLayer(BUILDINGS_LAYER_ID)) {
        map.removeLayer(BUILDINGS_LAYER_ID);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[vision] 3D buildings unavailable:", e);
    }
  };

  useEffect(() => {
    if (error && onError) onError(`Map engine failed to load: ${error.message}`);
  }, [error, onError]);

  // ── Init once, after the stack is loaded ────────────────────────────────────
  useEffect(() => {
    if (!stack || !containerRef.current || mapRef.current) return;
    let disposed = false;

    const { maplibre, deck } = stack;
    const maplibregl: any = (maplibre as any).default ?? maplibre;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(basemap) as any,
      center: KARNATAKA_CENTER,
      zoom: KARNATAKA_ZOOM,
      pitch: viewMode === "3d" ? PITCH_3D : 0,
      attributionControl: false,
      // Ops rooms and field tablets are not guaranteed to have a fast GPU;
      // capping DPR keeps the fill rate sane on a 4K wall.
      pixelRatio: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2),
    });
    mapRef.current = map;

    const overlay = new deck.mapbox.MapboxOverlay({ interleaved: false, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay as any);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    const emit = () => {
      if (disposed || !onViewState) return;
      const c = map.getCenter();
      const b = map.getBounds();
      onViewState({
        lat: c.lat,
        lng: c.lng,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        altitudeM: altitudeFor(map.getZoom(), c.lat),
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      });
    };

    const applyProjection = () => {
      const mode = viewModeRef.current;
      try {
        map.setProjection({ type: mode === "earth" ? "globe" : "mercator" });
      } catch (e) {
        onError?.(`Projection switch unavailable: ${String(e)}`);
      }
    };

    map.on("load", () => {
      if (disposed) return;
      setReady(true);
      applyProjection();
      applyStyleExtras(map);
      emit();
      onMapReady?.(map);
    });
    // setStyle resets the projection AND drops every source we added, so both
    // have to be re-asserted once the new style settles.
    map.on("styledata", () => {
      if (disposed || !map.isStyleLoaded()) return;
      applyProjection();
      applyStyleExtras(map);
    });
    map.on("move", emit);
    map.on("error", (e: any) => {
      const msg = e?.error?.message ?? String(e?.error ?? "unknown map error");
      const isTile = /tile|abort|Failed to fetch|NetworkError|load image/i.test(msg);
      if (isTile) {
        // A missing tile must not take the screen down, but silently swallowing
        // every tile error turns a blocked CDN into an unexplained black canvas.
        // Count them and let the UI say so.
        setTilesFailed((n) => n + 1);
        return;
      }
      // eslint-disable-next-line no-console
      console.warn("[vision] map error:", msg, e?.error ?? e);
      onError?.(msg);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      try {
        map.remove();
      } catch {
        /* already torn down */
      }
      mapRef.current = null;
      overlayRef.current = null;
      setReady(false);
    };
    // Init is intentionally once-only; basemap/viewMode changes are applied by
    // the effects below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);

  // ── Projection + pitch ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      if (viewMode === "earth") {
        map.setProjection({ type: "globe" });
        // Globe needs to be zoomed out far enough to read as a planet; at the
        // statewide zoom it just looks like a slightly bent flat map.
        map.easeTo({ pitch: 0, bearing: 0, zoom: 2.4, duration: 1100 });
      } else {
        map.setProjection({ type: "mercator" });
        map.easeTo({
          pitch: viewMode === "3d" ? PITCH_3D : 0,
          // Coming back from the globe the camera is at z2.4, which would leave
          // the officer looking at south Asia. Restore a usable state framing.
          zoom: Math.max(map.getZoom(), KARNATAKA_ZOOM),
          center:
            map.getZoom() < KARNATAKA_ZOOM ? KARNATAKA_CENTER : map.getCenter(),
          duration: 900,
        });
      }
    } catch (e) {
      // setProjection is MapLibre >= 5. If a future downgrade removes it, stay
      // on mercator rather than blanking the map.
      onError?.(`Projection switch unavailable: ${String(e)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, ready]);

  // ── Terrain + 3D buildings ─────────────────────────────────────────────────
  // Re-runs when the mode or the buildings toggle changes. Adding a source is
  // idempotent inside applyStyleExtras, so this is safe to call repeatedly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyStyleExtras(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, buildings3d, ready]);

  // ── Basemap swap ───────────────────────────────────────────────────────────
  // Safe with an overlaid deck overlay: deck draws to its own canvas, so
  // setStyle cannot drop the data layers. The projection is re-asserted by the
  // styledata handler above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setTilesFailed(0); // give the new provider a clean slate
    map.setStyle(buildStyle(basemap) as any, { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, ready]);

  // ── Data layers ────────────────────────────────────────────────────────────
  // Earth mode is base-map-only by design, so layers are suppressed rather than
  // reprojected onto the globe.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !ready) return;
    overlay.setProps({ layers: viewMode === "earth" ? [] : layers });
  }, [layers, viewMode, ready]);

  const meta = BASEMAPS[basemap];

  return (
    <div className="absolute inset-0 bg-[#0b0f17]">
      {/* Sizing is inline, deliberately, and must not be moved to utility classes.
       *
       * MapLibre adds its own `maplibregl-map` class to THIS element at runtime, and
       * maplibre-gl.css declares `.maplibregl-map { position: relative }`. Against
       * Tailwind's `.absolute` that is a specificity tie (one class each), so whichever
       * stylesheet is injected later wins — and the library's is. When `relative` wins,
       * `inset-0` no longer stretches the box, every child here is absolutely
       * positioned, and the height collapses to 0.
       *
       * The map then still constructs, fires `load`, reports bounds, and fetches data,
       * so nothing errors: it just paints into a zero-height box and reads as a dead
       * black canvas. Measured before this fix: parent 683x349, this element 683x0.
       *
       * An inline style outranks any stylesheet regardless of load order, so this
       * cannot regress if Tailwind's layer order or maplibre-gl.css ever changes.
       */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-[8px] border-2 border-foreground bg-background/90 px-4 py-2 text-xs font-extrabold tracking-wide backdrop-blur">
            INITIALISING MAP ENGINE…
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-[8px] border-2 border-[#ef4444] bg-background/95 px-4 py-3 text-xs backdrop-blur">
            <div className="font-extrabold text-[#ef4444]">MAP ENGINE UNAVAILABLE</div>
            <p className="mt-1 text-muted-foreground">
              WebGL could not be initialised on this device. Other Satyam screens are
              unaffected.
            </p>
          </div>
        </div>
      )}

      {/* Basemap imagery failing is a normal condition on a locked-down network,
          and it must not present as an unexplained black canvas. Data layers keep
          rendering; only the imagery underneath is missing. */}
      {ready && tilesFailed >= 4 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-[8px] border-2 border-[#f97316] bg-background/95 px-3 py-1 text-[10px] font-extrabold text-[#f97316] backdrop-blur">
          BASEMAP IMAGERY UNAVAILABLE {"\u00b7"} DATA LAYERS ACTIVE
        </div>
      )}

      {/* Building heights are overwhelmingly derived defaults, not survey data
          (1.9% of Karnataka buildings carry a real height/levels tag). Saying so
          on the canvas is the difference between a visualisation and a claim. */}
      {ready && buildings3d && viewMode !== "earth" && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-[8px] border-2 border-[#94a3b8] bg-background/95 px-3 py-1 text-[10px] font-extrabold text-[#94a3b8] backdrop-blur">
          BUILDING FOOTPRINTS OSM {"\u00b7"} HEIGHTS MOSTLY ESTIMATED {"\u00b7"} ZOOM IN PAST z14
        </div>
      )}

      {/* Attribution is a licence obligation for every provider we use, so it is
          rendered unconditionally rather than behind a collapsed control. The
          optional overlays add their own providers only while they are active. */}
      <div className="pointer-events-none absolute bottom-0 right-0 z-[400] max-w-[70%] bg-background/70 px-1.5 py-0.5 text-right text-[9px] text-muted-foreground backdrop-blur">
        {meta.attribution}
        {meta.contextOnly && ` \u00b7 max z${meta.maxNativeZoom}`}
        {viewMode === "3d" && ` \u00b7 ${TERRAIN_ATTRIBUTION} (x${TERRAIN_EXAGGERATION} vertical)`}
        {buildings3d && viewMode !== "earth" && ` \u00b7 ${BUILDINGS_ATTRIBUTION}`}
      </div>
    </div>
  );
}
