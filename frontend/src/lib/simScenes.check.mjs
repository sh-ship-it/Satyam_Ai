/**
 * Self-check for the dispatch demo scenes. `node src/lib/simScenes.check.mjs`
 *
 * No framework. These are the invariants whose breach is silent on screen:
 *
 *   * a pair beyond the road-graph bbox cap cannot be fetched at all, so the card
 *     can only ever report NO_ROUTE (this is how the derived Bidar scene failed);
 *   * a `distanceKm` that drifts from its own coordinates mislabels the card with a
 *     number nothing else would contradict;
 *   * a coordinate typo that lands outside Karnataka still renders a plausible map.
 *
 * Parses the coordinates straight out of the source so the check cannot pass
 * against a stale copy of the data.
 */
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./simScenes.ts", import.meta.url), "utf8");

const MAX_SEP_DEG = 0.25;
const MIN_SEP_DEG = 0.002;

// Karnataka's real extent, from the seeded station coordinates:
// lat 11.79..18.37, lng 74.02..78.49. Padded slightly.
const KA = { latMin: 11.5, latMax: 18.6, lngMin: 73.8, lngMax: 78.7 };

function sepKm(a, b) {
  const mLat = (b.lat - a.lat) * 111.32;
  const mLng = (b.lng - a.lng) * 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(mLat, mLng);
}

/** Pull the scene objects out of the source text. */
function parseScenes(src) {
  const body = src.slice(src.indexOf("export const DEMO_SCENES"));
  const out = [];
  const re =
    /id:\s*"([^"]+)"[\s\S]*?callsign:\s*"([^"]+)"[\s\S]*?incident:\s*"([^"]+)"[\s\S]*?origin:\s*\{\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)\s*\}[\s\S]*?originName:\s*"([^"]+)"[\s\S]*?scene:\s*\{\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)\s*\}[\s\S]*?sceneName:\s*"([^"]+)"[\s\S]*?distanceKm:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(body))) {
    out.push({
      id: m[1],
      callsign: m[2],
      incident: m[3],
      origin: { lat: +m[4], lng: +m[5] },
      originName: m[6],
      scene: { lat: +m[7], lng: +m[8] },
      sceneName: m[9],
      distanceKm: +m[10],
    });
  }
  return out;
}

const scenes = parseScenes(SRC);

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.log(`FAIL ${msg}`);
    failed++;
  }
};

// ── 1. the set itself ──────────────────────────────────────────────────────
ok(scenes.length === 5, `expected 5 scenes, parsed ${scenes.length}`);
ok(
  new Set(scenes.map((s) => s.id)).size === scenes.length,
  "scene ids must be unique — a duplicate makes the running card ambiguous",
);
ok(
  scenes.map((s) => s.id).join() === "SIM-01,SIM-02,SIM-03,SIM-04,SIM-05",
  `ids must be sequential, got ${scenes.map((s) => s.id).join()}`,
);
ok(
  new Set(scenes.map((s) => s.callsign)).size === scenes.length,
  "callsigns must be unique so two cards cannot claim the same unit",
);

// ── 2. every pair must be fetchable and non-degenerate ─────────────────────
for (const s of scenes) {
  const dLat = Math.abs(s.scene.lat - s.origin.lat);
  const dLng = Math.abs(s.scene.lng - s.origin.lng);
  const sep = Math.max(dLat, dLng);
  ok(
    sep <= MAX_SEP_DEG,
    `${s.id} exceeds the road-graph bbox cap (${sep.toFixed(3)} deg) — cannot route`,
  );
  ok(sep >= MIN_SEP_DEG, `${s.id} is degenerate (${sep.toFixed(4)} deg) — zero-length route`);
}

// ── 3. the printed distance must match the coordinates ─────────────────────
for (const s of scenes) {
  const real = sepKm(s.origin, s.scene);
  ok(
    Math.abs(real - s.distanceKm) < 0.25,
    `${s.id} distanceKm=${s.distanceKm} but coordinates give ${real.toFixed(2)} km`,
  );
}

// ── 4. inside Karnataka ────────────────────────────────────────────────────
for (const s of scenes) {
  for (const [what, p] of [
    ["origin", s.origin],
    ["scene", s.scene],
  ]) {
    ok(
      p.lat >= KA.latMin && p.lat <= KA.latMax && p.lng >= KA.lngMin && p.lng <= KA.lngMax,
      `${s.id} ${what} (${p.lat}, ${p.lng}) is outside Karnataka`,
    );
  }
}

// ── 5. legs stay short, which is why they are dependable ───────────────────
for (const s of scenes) {
  ok(
    s.distanceKm <= 6,
    `${s.id} is ${s.distanceKm} km — long legs are what made the derived Bidar scene fail`,
  );
}

// ── 6. no placeholder copy left in ─────────────────────────────────────────
for (const s of scenes) {
  ok(s.incident.trim().length > 3, `${s.id} has no readable incident`);
  ok(s.originName.trim().length > 1 && s.sceneName.trim().length > 1, `${s.id} has a blank place`);
  ok(
    !/TODO|FIXME|xxx|lorem/i.test(`${s.incident}${s.originName}${s.sceneName}`),
    `${s.id} contains placeholder text`,
  );
}

// ── 7. the cap constants have not drifted from the routing layer ───────────
ok(MAX_SEP_DEG <= 0.35 - 2 * 0.02, "MAX_SEP_DEG must leave room for bbox padding");
ok(SRC.includes("MAX_SEP_DEG = 0.25"), "source constant drifted from this check");
ok(SRC.includes("MIN_SEP_DEG = 0.002"), "source constant drifted from this check");

console.log(
  failed === 0
    ? `simScenes: all checks passed (${scenes.length} scenes)`
    : `simScenes: ${failed} failure(s)`,
);
process.exit(failed === 0 ? 0 : 1);
