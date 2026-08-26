/**
 * The five dispatch simulation scenes.
 *
 * WHY THESE ARE FIXED RATHER THAN DERIVED
 * A previous revision paired real patrol units to real crime hotspots on whichever
 * database was active. It worked, and it produced statewide cards on the local
 * database — but the third card was Bidar, an 18.2 km leg, and it reported
 * "No connected road path between these two points in the fetched area". The graph
 * loaded fine; the two endpoints landed in disconnected fragments of the arterial
 * network. A simulation panel whose cards sometimes cannot simulate is worse than
 * one with fewer, dependable cards, so these five are curated instead.
 *
 * EVERY PAIR IS VERIFIED, NOT ASSUMED
 * Each was checked against the real `/api/ops/roadgraph` response by snapping both
 * endpoints to their nearest node and confirming the two sit in the SAME connected
 * component — the exact check Bidar failed. Measured:
 *
 *   Cubbon Park    -> Commercial Street    1.7 km   8,712 nodes   snap 0.28 / 0.05 km
 *   HSR Layout     -> Silk Board Junction  1.9 km   4,960 nodes   snap 0.09 / 0.01 km
 *   Domlur         -> Indiranagar          1.2 km   3,610 nodes   snap 0.00 / 0.01 km
 *   Vidhana Soudha -> Majestic             2.2 km   8,922 nodes   snap 0.08 / 0.04 km
 *   BTM Layout     -> Jayanagar 4th Block  2.0 km   6,683 nodes   snap 0.00 / 0.04 km
 *
 * All five are central Bengaluru, which is the densest OSM coverage in the state
 * and keeps every leg short. Yeshwanthpur -> Malleshwaram (3.0 km, 8,487 nodes) is
 * a verified spare if one of these ever needs replacing.
 *
 * ponytail: fixed coordinates, so the cards do not reflect the active database the
 * way the derived version did. That is the deliberate trade — reliability over
 * provenance for a screen whose whole purpose is to demonstrate the corridor. The
 * panel still shows which database is live, and the upgrade path is to pre-verify
 * derived pairs for connectivity before offering them as cards.
 *
 * ONE EXTERNAL DEPENDENCY WORTH KNOWING
 * Routing needs OpenStreetMap road geometry from Overpass, which rate-limits. The
 * backend caches each graph for 6 hours, so the first run of a scene may fail and a
 * retry a minute later will succeed. The panel reports that honestly rather than
 * drawing a straight line.
 */

export type SimLL = { lat: number; lng: number };

export type SimScene = {
  id: string;
  callsign: string;
  incident: string;
  origin: SimLL;
  originName: string;
  scene: SimLL;
  sceneName: string;
  /** Crow-flies km. Checked against the coordinates by simScenes.check.mjs. */
  distanceKm: number;
};

/**
 * Upper bound on separation. `roadgraph_service.MAX_SPAN_DEG` is 0.35 and
 * `roadPath.BBOX_PAD_DEG` adds 0.02 per side, so anything beyond 0.31 degrees on
 * either axis cannot be fetched at all. Every scene below is far inside this.
 */
export const MAX_SEP_DEG = 0.25;

/** Lower bound, ~220 m. A unit on top of its own scene animates as nothing. */
export const MIN_SEP_DEG = 0.002;

/** Crow-flies km. Good enough for a label at these distances. */
export function sepKm(a: SimLL, b: SimLL): number {
  const mLat = (b.lat - a.lat) * 111.32;
  const mLng = (b.lng - a.lng) * 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(mLat, mLng);
}

export const DEMO_SCENES: SimScene[] = [
  {
    id: "SIM-01",
    callsign: "PCR-21",
    incident: "Armed robbery in progress",
    origin: { lat: 12.9763, lng: 77.5929 },
    originName: "Cubbon Park",
    scene: { lat: 12.985, lng: 77.606 },
    sceneName: "Commercial Street",
    distanceKm: 1.7,
  },
  {
    id: "SIM-02",
    callsign: "PCR-07",
    incident: "Hit & run with injuries",
    origin: { lat: 12.9116, lng: 77.6389 },
    originName: "HSR Layout",
    scene: { lat: 12.9172, lng: 77.6228 },
    sceneName: "Silk Board Junction",
    distanceKm: 1.9,
  },
  {
    id: "SIM-03",
    callsign: "PCR-14",
    incident: "Chain snatching",
    origin: { lat: 12.961, lng: 77.6387 },
    originName: "Domlur",
    scene: { lat: 12.9719, lng: 77.6412 },
    sceneName: "Indiranagar",
    distanceKm: 1.2,
  },
  {
    id: "SIM-04",
    callsign: "PCR-03",
    incident: "Public disturbance",
    origin: { lat: 12.9794, lng: 77.5912 },
    originName: "Vidhana Soudha",
    scene: { lat: 12.9767, lng: 77.5713 },
    sceneName: "Majestic",
    distanceKm: 2.2,
  },
  {
    id: "SIM-05",
    callsign: "PCR-19",
    incident: "Two-wheeler theft",
    origin: { lat: 12.9166, lng: 77.6101 },
    originName: "BTM Layout",
    scene: { lat: 12.925, lng: 77.5938 },
    sceneName: "Jayanagar 4th Block",
    distanceKm: 2.0,
  },
];
