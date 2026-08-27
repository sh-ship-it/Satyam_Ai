/**
 * Self-check for the login page's ghost mascot.
 *
 *   node --experimental-strip-types scripts/check-ghost-mascot.mjs
 *
 * Two things here can be wrong in a way you would not spot by glancing at the page,
 * so both are arithmetic rather than eyeballing:
 *
 *   1. The scalloped skirt must land back on the body's left edge. An unclosed
 *      subpath still fills — through the shortest straight line — so the ghost loses
 *      a corner and it looks deliberate.
 *   2. The eyes must never travel further than their sockets allow, at any pointer
 *      distance, including absurd ones.
 */
import assert from "node:assert/strict";

const {
  BODY_LEFT,
  BODY_RIGHT,
  EYE_FULL_AT_PX,
  EYE_TRAVEL,
  EYE_AIM_Y,
  GHOST_CSS,
  GHOST_PATH,
  SCALLOPS,
  SCALLOP_W,
  VIEW_H,
  VIEW_W,
  eyeOffset,
} = await import("../src/lib/ghostMascot.ts");

// ── the skirt has to close ───────────────────────────────────────────────────
assert.equal(
  BODY_LEFT + SCALLOP_W * SCALLOPS,
  BODY_RIGHT,
  "the scallops do not span the skirt — the path will not close",
);
assert.ok(Number.isInteger(SCALLOP_W), "a fractional scallop width leaves a seam");
assert.equal(
  (GHOST_PATH.match(/q-/g) ?? []).length,
  SCALLOPS,
  "scallop count in the path disagrees with SCALLOPS",
);
assert.ok(GHOST_PATH.trim().endsWith("Z"), "the path must be explicitly closed");
// Walk the relative q runs and confirm they land exactly on the left edge.
let x = BODY_RIGHT;
for (const m of GHOST_PATH.matchAll(/q-[\d.]+ 48 -([\d.]+) 0/g)) x -= Number(m[1]);
assert.equal(x, BODY_LEFT, `skirt ends at ${x}, expected ${BODY_LEFT}`);

// The body must sit inside the canvas, or the clip path crops the ghost.
assert.ok(BODY_LEFT > 0 && BODY_RIGHT < VIEW_W, "body overflows the viewBox width");
assert.ok(VIEW_H > VIEW_W, "the ghost is taller than it is wide");

// ── the eyes stay in their sockets ───────────────────────────────────────────
assert.deepEqual(eyeOffset(0, 0), { x: 0, y: 0 }, "a pointer on the face looks ahead");
for (const [dx, dy] of [
  [1e6, 0],
  [0, -1e6],
  [-1e6, 1e6],
  [EYE_FULL_AT_PX, EYE_FULL_AT_PX],
  [3, -4],
  [-0.4, 0.2],
]) {
  const { x, y } = eyeOffset(dx, dy);
  const mag = Math.hypot(x, y);
  assert.ok(
    mag <= EYE_TRAVEL + 1e-9,
    `eyes reached ${mag.toFixed(2)} from (${dx},${dy}); limit is ${EYE_TRAVEL}`,
  );
  assert.ok(Number.isFinite(x) && Number.isFinite(y), "offset must never be NaN");
  // Direction has to be preserved, or the ghost looks away from the pointer.
  if (mag > 0) {
    assert.ok(Math.sign(x) === Math.sign(dx) || dx === 0, "horizontal gaze inverted");
    assert.ok(Math.sign(y) === Math.sign(dy) || dy === 0, "vertical gaze inverted");
  }
}

// Full deflection exactly at the stated distance, and half of it at half distance —
// this is what makes the gaze ease in rather than snap.
assert.ok(Math.abs(Math.hypot(...Object.values(eyeOffset(EYE_FULL_AT_PX, 0))) - EYE_TRAVEL) < 1e-9);
const half = eyeOffset(EYE_FULL_AT_PX / 2, 0);
assert.ok(Math.abs(half.x - EYE_TRAVEL / 2) < 1e-9, "gaze should scale with distance");

// The aim point sits above the body's middle, or the ghost looks permanently down.
assert.ok(EYE_AIM_Y > 0 && EYE_AIM_Y < 0.5, "eye aim point must be above centre");

// ── the liquid read ──────────────────────────────────────────────────────────
// Float and squash must run at DIFFERENT periods. Matched periods make the body
// thinnest at exactly the top of every rise, which reads as a rigid bounce; offset
// periods drift in and out of phase and read as liquid. This is the one thing about
// the effect that is a number rather than a judgement, so it is asserted.
const period = (name) => {
  const m = GHOST_CSS.match(new RegExp(`\\.${name}\\s*\\{[^}]*animation:[^;]*?([\\d.]+)s`));
  assert.ok(m, `no animation duration found for .${name}`);
  return Number(m[1]);
};
const float = period("ghost-float");
const squash = period("ghost-squash");
assert.notEqual(float, squash, "float and squash must not share a period, or it looks rigid");
assert.ok(
  Math.abs(float / squash - Math.round(float / squash)) > 0.05,
  `float ${float}s and squash ${squash}s are near-harmonic; the loop will be obvious`,
);

// The colour has to actually rotate — that was asked for explicitly.
assert.ok(
  /@keyframes ghost-swirl[^}]*}[^}]*rotate\(360deg\)/s.test(GHOST_CSS),
  "swirl must rotate",
);
// A rotation without fill-box spins around the whole viewBox, so the blobs orbit out
// of the body instead of turning inside it.
assert.ok(
  /transform-box:\s*fill-box/.test(GHOST_CSS) && /transform-origin:\s*center/.test(GHOST_CSS),
  "rotation needs fill-box + centre origin or the blobs orbit out of the ghost",
);
// Three blob drifts at three periods; equal ones would move as a rigid unit and never
// blend into each other.
const drifts = [period("ghost-blob-a"), period("ghost-blob-b"), period("ghost-blob-c")];
assert.equal(new Set(drifts).size, 3, `blob periods must differ, got ${drifts.join(", ")}`);

// The blur is gone on purpose; an SVG filter over moving content is re-run per frame.
assert.ok(!/feGaussianBlur|filter:\s*blur/.test(GHOST_CSS), "no blur: it re-filters per frame");

// ── reduced motion stops the drift but keeps the gaze ────────────────────────
const reduced = GHOST_CSS.slice(GHOST_CSS.indexOf("prefers-reduced-motion"));
assert.ok(reduced.includes("animation: none"), "the drifting gradient must stop");
for (const cls of ["ghost-float", "ghost-squash", "ghost-swirl"]) {
  assert.ok(
    reduced.includes(cls),
    `${cls} is autonomous motion and must stop under reduced motion`,
  );
}
assert.ok(
  !reduced.includes(".ghost-eyes"),
  "the eyes answer the pointer, so they are not autonomous motion and must keep working",
);

console.log(
  `check-ghost-mascot: PASS (${SCALLOPS} scallops of ${SCALLOP_W}px close on ${BODY_LEFT}; ` +
    `gaze capped at ${EYE_TRAVEL}u)`,
);
