/** Vision basemap style factories.
 *
 *  Every URL here is HTTPS and key-free, which is a deployment requirement:
 *  the deployed origin is HTTPS, so any http:// tile would be blocked as mixed
 *  content, and any keyed provider would put a secret in the browser bundle.
 *
 *  Tiles are fetched browser -> CDN directly. They are never proxied through
 *  FastAPI, which keeps the backend off the map's hot path.
 *
 *  `import type` only — maplibre-gl must never be imported for real at module
 *  scope, because TanStack Start server-renders every route and maplibre-gl
 *  touches `window` on import. Types are erased at compile time, so this is safe.
 */
import type { StyleSpecification } from "maplibre-gl";

export type BasemapId = "dark" | "street" | "satellite" | "nightlights";

export type BasemapMeta = {
  id: BasemapId;
  label: string;
  attribution: string;
  /** Highest zoom the provider actually serves. Beyond this MapLibre overzooms
   *  (stretches the last tile) rather than showing blank space. */
  maxNativeZoom: number;
  /** True when the imagery is too coarse for street-level work and should only
   *  be offered as wide-area context. Surfaced in the UI, not hidden. */
  contextOnly: boolean;
};

const CARTO_DARK_SUBDOMAINS = ["a", "b", "c", "d"];

// ─── Optional 3D overlays, added onto whichever basemap is active ────────────
//
// Both are key-free HTTPS, same rule as the basemaps. They are added as extra
// sources on top of the existing raster style rather than by switching to a
// vector basemap: that keeps the dark tactical look, and means neither costs a
// single tile request until it is actually switched on.

/** Terrarium-encoded DEM, public on S3, no key. Real measured elevation. */
export const TERRAIN_SOURCE_ID = "satyam-terrain-dem";
export const TERRAIN_ATTRIBUTION = "Elevation: Mapzen / AWS Terrain Tiles";
/** Karnataka is plateau (~900 m) rising to the Western Ghats (~1900 m). At
 *  statewide zoom true-scale relief is invisible, so it is exaggerated to read
 *  as terrain. That makes it a visual aid, not a measurement — hence the label
 *  in the UI. */
export const TERRAIN_EXAGGERATION = 1.5;

export function terrainSourceSpec() {
  return {
    type: "raster-dem" as const,
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium" as const,
    tileSize: 256,
    maxzoom: 15,
    attribution: TERRAIN_ATTRIBUTION,
  };
}

/** OpenFreeMap vector tiles (OpenMapTiles schema) for building footprints. */
export const BUILDINGS_SOURCE_ID = "satyam-ofm-vector";
export const BUILDINGS_LAYER_ID = "satyam-buildings-3d";
export const BUILDINGS_ATTRIBUTION =
  "Buildings: OpenFreeMap \u00b7 OpenMapTiles \u00b7 \u00a9 OpenStreetMap";

/** The building layer only carries `render_height`, `render_min_height`,
 *  `hide_3d` and `colour` — there is no raw `height` tag in the tile, so it is
 *  not possible to tell a surveyed height from a generated default here.
 *
 *  Measured for Karnataka via Overpass, central Bengaluru (~6x8 km):
 *  57,569 buildings mapped, 1,093 with a real `height` or `building:levels`
 *  tag — 1.9 percent. So the great majority of these extrusions stand at a
 *  derived default, which is why the UI labels the layer rather than presenting
 *  it as survey data. On a screen that drives deployment decisions, an
 *  unlabelled fabricated skyline is the failure mode to avoid.
 */
export const BUILDINGS_TAGGED_PERCENT = 1.9;

export function buildingsSourceSpec() {
  return {
    type: "vector" as const,
    // TileJSON, so the dated tile path resolves server-side and keeps working
    // as OpenFreeMap republishes the planet.
    url: "https://tiles.openfreemap.org/planet",
    attribution: BUILDINGS_ATTRIBUTION,
  };
}

export function buildingsLayerSpec() {
  return {
    id: BUILDINGS_LAYER_ID,
    type: "fill-extrusion" as const,
    source: BUILDINGS_SOURCE_ID,
    "source-layer": "building",
    // The source tops out at z14; below z14 there is nothing to draw, and a
    // statewide carpet of boxes would be unreadable anyway.
    minzoom: 14,
    // OpenMapTiles marks building parts that must not be extruded.
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-base": ["get", "render_min_height"],
      "fill-extrusion-height": ["get", "render_height"],
      // Cool slate rather than the upstream warm grey: this sits on a dark
      // tactical basemap under coloured data layers, and must not compete with
      // the crime hexbins for attention.
      "fill-extrusion-color": "#8b9bb4",
      "fill-extrusion-opacity": 0.65,
    },
  };
}

/** NASA GIBS serves generic XYZ tiles with **row before column**, i.e.
 *  .../{TileMatrixSet}/{z}/{y}/{x}.{fmt} — so the MapLibre template is
 *  {z}/{y}/{x}, not {z}/{x}/{y}. Getting this backwards yields a silently
 *  scrambled map rather than an error. */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

export const BASEMAPS: Record<BasemapId, BasemapMeta> = {
  dark: {
    id: "dark",
    label: "Dark",
    attribution: "\u00a9 OpenStreetMap \u00a9 CARTO",
    maxNativeZoom: 19,
    contextOnly: false,
  },
  street: {
    id: "street",
    label: "Street",
    attribution: "\u00a9 OpenStreetMap contributors",
    maxNativeZoom: 19,
    contextOnly: false,
  },
  satellite: {
    id: "satellite",
    label: "Satellite",
    attribution: "Imagery courtesy NASA EOSDIS GIBS",
    // GIBS BlueMarble tops out at GoogleMapsCompatible_Level8. That is regional
    // detail, not street detail — see contextOnly.
    maxNativeZoom: 8,
    contextOnly: true,
  },
  nightlights: {
    id: "nightlights",
    label: "Night lights",
    attribution: "VIIRS Black Marble \u2014 NASA EOSDIS GIBS",
    maxNativeZoom: 8,
    contextOnly: true,
  },
};

function rasterStyle(
  id: string,
  tiles: string[],
  attribution: string,
  maxzoom: number,
  background = "#0b0f17",
  globe = false,
): StyleSpecification {
  return {
    version: 8,
    // Declared IN the style, not applied afterwards with setProjection().
    //
    // Projection is part of the style spec in MapLibre 5, so `setStyle` replaces
    // it — a style without this key silently reverts to mercator. That is what
    // flattened the globe whenever the basemap was switched while in EARTH mode:
    // the imperative re-assert in the `styledata` handler is gated on
    // `isStyleLoaded()` and loses the race. Declaring it here cannot lose a race.
    projection: { type: globe ? "globe" : "mercator" },
    // No glyphs/sprite declared on purpose: these styles have no symbol layers,
    // so MapLibre never needs a font or icon endpoint. One less remote
    // dependency to fail on a conference network.
    sources: {
      [id]: { type: "raster", tiles, tileSize: 256, attribution, maxzoom },
    },
    layers: [
      // Painted underneath so an unreachable tile CDN degrades to the tactical
      // background instead of white gaps. Data layers keep rendering regardless.
      { id: "bg", type: "background", paint: { "background-color": background } },
      { id, type: "raster", source: id, paint: { "raster-opacity": 1 } },
    ],
  };
}

/** @param globe render on a sphere rather than flat. Must be passed on every
 *  `setStyle`, or switching basemap drops the globe. */
export function buildStyle(id: BasemapId, globe = false): StyleSpecification {
  const meta = BASEMAPS[id];
  switch (id) {
    case "street":
      return rasterStyle(
        "osm",
        ["a", "b", "c"].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
        meta.attribution,
        meta.maxNativeZoom,
        "#0b0f17",
        globe,
      );
    case "satellite":
      return rasterStyle(
        "gibs-bluemarble",
        [
          `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
        ],
        meta.attribution,
        meta.maxNativeZoom,
        "#01050f",
        globe,
      );
    case "nightlights":
      return rasterStyle(
        "gibs-blackmarble",
        [
          `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
        ],
        meta.attribution,
        meta.maxNativeZoom,
        "#01050f",
        globe,
      );
    case "dark":
    default:
      return rasterStyle(
        "carto-dark",
        CARTO_DARK_SUBDOMAINS.map(
          (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`,
        ),
        meta.attribution,
        meta.maxNativeZoom,
        "#0b0f17",
        globe,
      );
  }
}
