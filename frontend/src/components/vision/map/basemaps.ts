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
): StyleSpecification {
  return {
    version: 8,
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

export function buildStyle(id: BasemapId): StyleSpecification {
  const meta = BASEMAPS[id];
  switch (id) {
    case "street":
      return rasterStyle(
        "osm",
        ["a", "b", "c"].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
        meta.attribution,
        meta.maxNativeZoom,
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
      );
  }
}
