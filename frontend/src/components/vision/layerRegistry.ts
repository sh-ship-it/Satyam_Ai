/** Single source of truth for Vision's intelligence layers.
 *
 *  `provenance` is not decoration. On a police map an officer may act on what a
 *  pillar or a cone implies, so every layer states where its geometry came from:
 *
 *    live      streamed from the backend right now
 *    cached    real data, last known value, age shown
 *    seeded    real rows in our database, but synthetic demo data
 *    derived   computed from real rows (aggregation, scoring)
 *    simulated FABRICATED geometry — no such field exists in the database yet
 *
 *  `simulated` exists specifically for CCTV field-of-view cones: ops_cameras has
 *  no bearing / fov / range columns, so the cones are invented for the demo.
 *  Labelling that is mandatory, not optional.
 */

export type Provenance = "live" | "cached" | "seeded" | "derived" | "simulated";

export type LayerId =
  | "crime_hex"
  | "risk_zones"
  | "patrols"
  | "dispatches"
  | "signals"
  | "cameras"
  | "environment";

export type LayerSpec = {
  id: LayerId;
  label: string;
  /** Colour swatch shown in the matrix; matches the layer's render colour. */
  swatch: string;
  provenance: Provenance;
  /** True when the layer needs ENABLE_RESPONSE_OPS on the backend. */
  requiresOps: boolean;
  /** Visible by default? Wide-area context layers stay off. */
  defaultOn: boolean;
  hint: string;
};

export const PROVENANCE_STYLE: Record<Provenance, { label: string; className: string }> = {
  live: { label: "live", className: "text-[#00E6A8] border-[#00E6A8]" },
  cached: { label: "cached", className: "text-[#91C5FD] border-[#91C5FD]" },
  seeded: { label: "seeded", className: "text-muted-foreground border-muted-foreground" },
  derived: { label: "derived", className: "text-[#fbbf24] border-[#fbbf24]" },
  simulated: { label: "simulated", className: "text-[#f97316] border-[#f97316]" },
};

export const LAYERS: LayerSpec[] = [
  {
    id: "crime_hex",
    label: "Crime density",
    swatch: "#ef4444",
    provenance: "derived",
    requiresOps: false,
    defaultOn: true,
    hint: "3D hexagonal bins aggregated from geocoded FIR locations",
  },
  {
    id: "risk_zones",
    label: "Risk zones",
    swatch: "#fbbf24",
    provenance: "derived",
    requiresOps: true,
    defaultOn: true,
    hint: "Scored 1.1 km grid cells from the Response-Ops risk model",
  },
  {
    id: "patrols",
    label: "Patrol units",
    swatch: "#a855f7",
    provenance: "seeded",
    requiresOps: true,
    defaultOn: true,
    hint: "Patrol positions and status",
  },
  {
    id: "dispatches",
    label: "Dispatches",
    swatch: "#00E6A8",
    provenance: "live",
    requiresOps: true,
    defaultOn: true,
    hint: "Active incident dispatches and their routes",
  },
  {
    id: "signals",
    label: "Traffic signals",
    swatch: "#22d3ee",
    provenance: "seeded",
    requiresOps: true,
    defaultOn: true,
    hint: "Junction signals and green-corridor state",
  },
  {
    id: "cameras",
    label: "CCTV cameras",
    swatch: "#e879f9",
    provenance: "simulated",
    requiresOps: true,
    defaultOn: true,
    hint: "Camera positions are real rows; the field-of-view cones are FABRICATED for the demo (no bearing/fov columns exist yet)",
  },
  {
    id: "environment",
    label: "Environment",
    swatch: "#60a5fa",
    provenance: "cached",
    requiresOps: false,
    defaultOn: false,
    hint: "Precipitation and wind from Open-Meteo. Wide-area context.",
  },
];

export const LAYER_STORAGE_KEY = "fq-vision-layers";

export function defaultLayerState(): Record<LayerId, boolean> {
  return LAYERS.reduce(
    (acc, l) => {
      acc[l.id] = l.defaultOn;
      return acc;
    },
    {} as Record<LayerId, boolean>,
  );
}
