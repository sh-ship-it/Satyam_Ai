/** Constructs the deck.gl layer set from a Vision snapshot.
 *
 *  One module rather than six files: these layers share colour constants, the
 *  metres-to-degrees helper and the same data envelope, and splitting them would
 *  spread that agreement across the filesystem for no gain.
 *
 *  Coordinate order rule: deck.gl wants [lng, lat]. The snapshot gives crime
 *  cells as [lat, lng, weight] and dispatch routes already as [lng, lat] (GeoJSON
 *  order, straight from the stored route_geometry). Getting this wrong yields a
 *  map that renders happily somewhere off the coast of Somalia, so every accessor
 *  below is explicit about which it is doing.
 */
import type { DeckModules } from "./useVisionMap";
import type {
  CameraPoint,
  CrimeCell,
  DispatchPoint,
  PatrolPoint,
  RiskZonePoint,
  SignalPoint,
  VisionSnapshot,
} from "@/lib/api/vision";
import type { LayerId } from "../layerRegistry";

type RGBA = [number, number, number, number];

/** Matches the swatches in layerRegistry so the sidebar and the map agree. */
const PATROL_STATUS_COLOR: Record<string, RGBA> = {
  IDLE: [168, 85, 247, 220],
  EN_ROUTE: [0, 230, 168, 235],
  ON_SCENE: [249, 115, 22, 235],
  OFFLINE: [100, 116, 139, 160],
};

const SIGNAL_STATE_COLOR: Record<string, RGBA> = {
  GREEN: [0, 230, 168, 240],
  NORMAL: [34, 211, 238, 190],
};

const RISK_LABEL_COLOR: Record<string, RGBA> = {
  Critical: [239, 68, 68, 210],
  High: [249, 115, 22, 200],
  Medium: [251, 191, 36, 190],
  Low: [59, 130, 246, 170],
};

/** Blue -> amber -> orange -> red, matching the existing Leaflet heat gradient
 *  on /operations so the two screens read as the same product. */
const DENSITY_RAMP: RGBA[] = [
  [59, 130, 246, 180],
  [251, 191, 36, 195],
  [249, 115, 22, 210],
  [239, 68, 68, 225],
];

const METRES_PER_DEG_LAT = 111320;

export type HexOptions = {
  /** Bin radius in metres, or "auto" to derive it from the zoom level. */
  radiusM: number | "auto";
  /** Multiplier on pillar height. */
  elevationScale: number;
  extruded: boolean;
};

export const HEX_RADIUS_CHOICES = ["auto", 100, 500, 1000, 5000] as const;

/** Bin radius that is actually visible at a given zoom.
 *
 *  This exists because a fixed radius is wrong at almost every zoom. Ground
 *  resolution at latitude 14 is roughly 1,200 m per pixel at zoom 6, so the
 *  original fixed 500 m default rendered every hexagon at under half a pixel:
 *  4,860 bins were being drawn and none of them were visible. The map looked
 *  broken when it was merely sub-pixel.
 *
 *  Values are chosen to keep a bin around 6-10 px across, which reads as a
 *  hexagon rather than a speck.
 */
export function autoHexRadius(zoom: number): number {
  if (zoom < 7) return 6000;
  if (zoom < 8.5) return 3000;
  if (zoom < 10) return 1500;
  if (zoom < 11.5) return 700;
  if (zoom < 13) return 350;
  if (zoom < 14.5) return 180;
  return 90;
}

export function effectiveHexRadius(hex: HexOptions, zoom: number): number {
  return hex.radiusM === "auto" ? autoHexRadius(zoom) : hex.radiusM;
}

export type BuildLayersArgs = {
  deck: DeckModules;
  snapshot: VisionSnapshot | null;
  visible: Record<LayerId, boolean>;
  hex: HexOptions;
  /** Current camera zoom — drives the automatic bin radius. */
  zoom: number;
  onPick?: (kind: "patrol" | "camera" | "risk_zone" | "dispatch", id: string | number) => void;
};

/** Wedge polygon approximating a camera's field of view.
 *
 *  FABRICATED GEOMETRY. The bearing/fov/range driving this are derived from a
 *  hash of the camera id server-side because ops_cameras stores no optics. Every
 *  surface that shows this must label it `simulated`.
 */
function fovWedge(cam: CameraPoint, segments = 12): [number, number][] {
  const latScale = 1 / METRES_PER_DEG_LAT;
  const lngScale = 1 / (METRES_PER_DEG_LAT * Math.cos((cam.lat * Math.PI) / 180) || 1);
  const half = cam.fov_deg / 2;
  const start = cam.bearing_deg - half;
  const pts: [number, number][] = [[cam.lng, cam.lat]];
  for (let i = 0; i <= segments; i++) {
    const deg = start + (cam.fov_deg * i) / segments;
    const rad = (deg * Math.PI) / 180;
    // Bearing is clockwise from north, so north is +lat and east is +lng.
    pts.push([
      cam.lng + Math.sin(rad) * cam.range_m * lngScale,
      cam.lat + Math.cos(rad) * cam.range_m * latScale,
    ]);
  }
  pts.push([cam.lng, cam.lat]);
  return pts;
}

function layerData<T>(env: { data: T[]; degraded: string | null } | undefined): T[] {
  // A degraded layer carries an empty array already, but be explicit: never
  // render geometry for a layer the backend said it could not provide.
  if (!env || env.degraded) return [];
  return env.data;
}

export function buildLayers({
  deck,
  snapshot,
  visible,
  hex,
  zoom,
  onPick,
}: BuildLayersArgs): unknown[] {
  if (!snapshot) return [];

  const { ScatterplotLayer, PathLayer, PolygonLayer } = deck.layers;
  const { HexagonLayer } = deck.agg;
  const out: unknown[] = [];

  // ── Crime density: 3D hexagonal bins ──────────────────────────────────────
  // Binning happens here, on the GPU/CPU, not in Postgres. That is why no
  // PostGIS or H3 extension is needed, and why changing the radius does not
  // require a server round trip.
  const cells = layerData<CrimeCell>(snapshot.layers.crime_hex);
  if (visible.crime_hex && cells.length) {
    out.push(
      new HexagonLayer({
        id: "vision-crime-hex",
        data: cells,
        // Snapshot order is [lat, lng, weight]; deck wants [lng, lat].
        getPosition: (d: CrimeCell) => [d[1], d[0]],
        getColorWeight: (d: CrimeCell) => d[2],
        getElevationWeight: (d: CrimeCell) => d[2],
        colorAggregation: "SUM",
        elevationAggregation: "SUM",
        radius: effectiveHexRadius(hex, zoom),
        extruded: hex.extruded,
        // Pillar height only means anything when the camera is tilted. Flat-on it
        // just makes bins overlap and read as noise.
        elevationScale: hex.extruded ? hex.elevationScale : 0,
        colorRange: DENSITY_RAMP.map(([r, g, b]) => [r, g, b]) as [number, number, number][],
        opacity: 0.75,
        pickable: false,
        material: false,
        // Re-bin when the radius changes; without this deck.gl keeps the old
        // aggregation because `data` is referentially unchanged.
        updateTriggers: {
          getColorWeight: [hex.radiusM, zoom],
          getElevationWeight: [hex.radiusM, zoom],
        },
      }),
    );
  }

  // ── Risk zones ────────────────────────────────────────────────────────────
  const zones = layerData<RiskZonePoint>(snapshot.layers.risk_zones);
  if (visible.risk_zones && zones.length) {
    out.push(
      new ScatterplotLayer({
        id: "vision-risk-zones",
        data: zones,
        getPosition: (z: RiskZonePoint) => [z.lng, z.lat],
        // Area scales with score so a Critical cell reads as bigger, not just redder.
        getRadius: (z: RiskZonePoint) => 260 + z.score * 9,
        radiusUnits: "meters",
        radiusMinPixels: 3,
        radiusMaxPixels: 46,
        getFillColor: (z: RiskZonePoint) =>
          RISK_LABEL_COLOR[z.label] ?? RISK_LABEL_COLOR.Low,
        stroked: false,
        pickable: true,
        onClick: ({ object }: { object?: RiskZonePoint }) =>
          object && onPick?.("risk_zone", object.id),
      }),
    );
  }

  // ── CCTV: cones first so the camera dot sits on top ───────────────────────
  const cams = layerData<CameraPoint>(snapshot.layers.cameras);
  if (visible.cameras && cams.length) {
    out.push(
      new PolygonLayer({
        id: "vision-camera-fov",
        data: cams,
        getPolygon: (c: CameraPoint) => fovWedge(c),
        getFillColor: [232, 121, 249, 46],
        getLineColor: [232, 121, 249, 120],
        lineWidthMinPixels: 1,
        stroked: true,
        filled: true,
        pickable: false,
      }),
      new ScatterplotLayer({
        id: "vision-cameras",
        data: cams,
        getPosition: (c: CameraPoint) => [c.lng, c.lat],
        getRadius: 6,
        radiusUnits: "pixels",
        getFillColor: (c: CameraPoint) =>
          c.is_active ? [232, 121, 249, 240] : [120, 113, 130, 190],
        getLineColor: [10, 10, 10, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: true,
        onClick: ({ object }: { object?: CameraPoint }) =>
          object && onPick?.("camera", object.camera_id),
      }),
    );
  }

  // ── Traffic signals ───────────────────────────────────────────────────────
  const signals = layerData<SignalPoint>(snapshot.layers.signals);
  if (visible.signals && signals.length) {
    out.push(
      new ScatterplotLayer({
        id: "vision-signals",
        data: signals,
        getPosition: (s: SignalPoint) => [s.lng, s.lat],
        getRadius: (s: SignalPoint) => (s.state === "GREEN" ? 7 : 4),
        radiusUnits: "pixels",
        getFillColor: (s: SignalPoint) =>
          SIGNAL_STATE_COLOR[s.state] ?? SIGNAL_STATE_COLOR.NORMAL,
        getLineColor: [10, 10, 10, 255],
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: false,
      }),
    );
  }

  // ── Dispatch routes: three stacked paths for a glow, matching the existing
  //    Leaflet treatment on /operations (weight 16 / 8 / 3) ──────────────────
  const dispatches = layerData<DispatchPoint>(snapshot.layers.dispatches);
  const routed = dispatches.filter((d) => d.route && d.route.length > 1);
  if (visible.dispatches && routed.length) {
    const halo: [number, RGBA][] = [
      [14, [0, 230, 168, 40]],
      [7, [0, 230, 168, 90]],
      [2.5, [180, 255, 230, 235]],
    ];
    halo.forEach(([width, color], i) => {
      out.push(
        new PathLayer({
          id: `vision-dispatch-route-${i}`,
          data: routed,
          // Already [lng, lat] — GeoJSON order, straight from route_geometry.
          getPath: (d: DispatchPoint) => d.route,
          getColor: color,
          getWidth: width,
          widthUnits: "pixels",
          widthMinPixels: 1,
          capRounded: true,
          jointRounded: true,
          pickable: i === halo.length - 1,
          onClick: ({ object }: { object?: DispatchPoint }) =>
            object && onPick?.("dispatch", object.id),
        }),
      );
    });
  }
  if (visible.dispatches && dispatches.length) {
    out.push(
      new ScatterplotLayer({
        id: "vision-dispatch-scenes",
        data: dispatches,
        getPosition: (d: DispatchPoint) => [d.scene_lng, d.scene_lat],
        getRadius: 9,
        radiusUnits: "pixels",
        getFillColor: [239, 68, 68, 235],
        getLineColor: [255, 220, 220, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: true,
        onClick: ({ object }: { object?: DispatchPoint }) =>
          object && onPick?.("dispatch", object.id),
      }),
    );
  }

  // ── Patrol units last so they are never hidden under another layer ────────
  const patrols = layerData<PatrolPoint>(snapshot.layers.patrols);
  if (visible.patrols && patrols.length) {
    out.push(
      new ScatterplotLayer({
        id: "vision-patrols",
        data: patrols,
        getPosition: (p: PatrolPoint) => [p.lng, p.lat],
        getRadius: 8,
        radiusUnits: "pixels",
        getFillColor: (p: PatrolPoint) =>
          PATROL_STATUS_COLOR[p.status] ?? PATROL_STATUS_COLOR.IDLE,
        getLineColor: [10, 10, 10, 255],
        lineWidthMinPixels: 2,
        stroked: true,
        pickable: true,
        onClick: ({ object }: { object?: PatrolPoint }) =>
          object && onPick?.("patrol", object.id),
      }),
    );
  }

  return out;
}
